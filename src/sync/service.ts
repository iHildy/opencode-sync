import path from 'node:path';

import type { PluginInput } from '@opencode-ai/plugin';
import { syncLocalToRepo, syncRepoToLocal } from './apply.js';
import { generateCommitMessage } from './commit.js';
import type { NormalizedSyncConfig } from './config.js';
import {
  canCommitMcpSecrets,
  hasSecretsBackend,
  loadOverrides,
  loadState,
  loadSyncConfig,
  normalizeSyncConfig,
  updateState,
  writeSyncConfig,
} from './config.js';
import { SyncCommandError, SyncConfigMissingError } from './errors.js';
import type { SyncLockInfo } from './lock.js';
import { withSyncLock } from './lock.js';
import { buildSyncPlan, resolveRepoRoot, resolveSyncLocations } from './paths.js';
import {
  commitAll,
  ensureRepoCloned,
  ensureRepoPrivate,
  fetchAndFastForward,
  findSyncRepo,
  getAuthenticatedUser,
  getRepoStatus,
  hasLocalChanges,
  isRepoCloned,
  pushBranch,
  repoExists,
  resolveRepoBranch,
  resolveRepoIdentifier,
} from './repo.js';
import {
  computeSecretsHash,
  createSecretsBackend,
  resolveRepoAuthPaths,
  resolveSecretsBackendConfig,
  type SecretsBackend,
} from './secrets-backend.js';
import {
  createLogger,
  extractTextFromResponse,
  resolveSmallModel,
  showToast,
  unwrapData,
} from './utils.js';

type SyncServiceContext = Pick<PluginInput, 'client' | '$'>;
type Logger = ReturnType<typeof createLogger>;
type Shell = PluginInput['$'];

interface InitOptions {
  repo?: string;
  owner?: string;
  name?: string;
  url?: string;
  branch?: string;
  includeSecrets?: boolean;
  includeMcpSecrets?: boolean;
  includeSessions?: boolean;
  includePromptStash?: boolean;
  includeModelFavorites?: boolean;
  create?: boolean;
  private?: boolean;
  extraSecretPaths?: string[];
  extraConfigPaths?: string[];
  localRepoPath?: string;
}

interface LinkOptions {
  repo?: string;
}

export interface SyncService {
  startupSync: () => Promise<void>;
  status: () => Promise<string>;
  init: (_options: InitOptions) => Promise<string>;
  link: (_options: LinkOptions) => Promise<string>;
  pull: () => Promise<string>;
  push: () => Promise<string>;
  secretsPull: () => Promise<string>;
  secretsPush: () => Promise<string>;
  secretsStatus: () => Promise<string>;
  enableSecrets: (_options?: {
    extraSecretPaths?: string[];
    includeMcpSecrets?: boolean;
  }) => Promise<string>;
  resolve: () => Promise<string>;
}

export function createSyncService(ctx: SyncServiceContext): SyncService {
  const locations = resolveSyncLocations();
  const log = createLogger(ctx.client);
  const lockPath = path.join(path.dirname(locations.statePath), 'sync.lock');

  const formatLockInfo = (info: SyncLockInfo | null): string => {
    if (!info) return 'Another sync is already in progress.';
    return `Another sync is already in progress (pid ${info.pid} on ${info.hostname}, started ${info.startedAt}).`;
  };

  const runExclusive = <T>(fn: () => Promise<T>): Promise<T> =>
    withSyncLock(
      lockPath,
      {
        onBusy: (info) => {
          throw new SyncCommandError(formatLockInfo(info));
        },
      },
      fn
    );

  const skipIfBusy = (fn: () => Promise<void>): Promise<void> =>
    withSyncLock(
      lockPath,
      {
        onBusy: (info) => {
          log.debug('Sync already running, skipping', {
            pid: info?.pid,
            hostname: info?.hostname,
            startedAt: info?.startedAt,
          });
          return;
        },
      },
      fn
    );

  const resolveSecretsBackend = (config: NormalizedSyncConfig): SecretsBackend | null => {
    const resolution = resolveSecretsBackendConfig(config);
    if (resolution.state === 'none') {
      return null;
    }

    if (resolution.state === 'invalid') {
      throw new SyncCommandError(resolution.error);
    }

    return createSecretsBackend({ $: ctx.$, locations, config: resolution.config });
  };

  const ensureAuthFilesNotTracked = async (
    repoRoot: string,
    config: NormalizedSyncConfig
  ): Promise<void> => {
    if (!hasSecretsBackend(config)) return;

    const { authRepoPath, mcpAuthRepoPath } = resolveRepoAuthPaths(repoRoot);
    const tracked: string[] = [];
    const authRelPath = toRepoRelativePath(repoRoot, authRepoPath);
    const mcpRelPath = toRepoRelativePath(repoRoot, mcpAuthRepoPath);

    if (await isRepoPathTracked(ctx.$, repoRoot, authRelPath)) {
      tracked.push(authRelPath);
    }
    if (await isRepoPathTracked(ctx.$, repoRoot, mcpRelPath)) {
      tracked.push(mcpRelPath);
    }

    if (tracked.length === 0) return;

    const trackedList = tracked.join(', ');
    throw new SyncCommandError(
      `Sync repo already tracks secret auth files (${trackedList}). ` +
        'Remove them and rewrite history before enabling a secrets backend.'
    );
  };

  const computeSecretsHashSafe = async (): Promise<string | null> => {
    try {
      return await computeSecretsHash(locations);
    } catch (error) {
      log.warn('Failed to compute secrets hash', { error: formatError(error) });
      return null;
    }
  };

  const updateSecretsHashState = async (): Promise<void> => {
    const hash = await computeSecretsHashSafe();
    if (!hash) return;
    await updateState(locations, { lastSecretsHash: hash });
  };

  const pushSecretsWithBackend = async (backend: SecretsBackend): Promise<'skipped' | 'pushed'> => {
    const hash = await computeSecretsHashSafe();
    if (hash) {
      const state = await loadState(locations);
      if (state.lastSecretsHash === hash) {
        log.debug('Secrets unchanged; skipping secrets push');
        return 'skipped';
      }
    }

    await backend.push();
    if (hash) {
      await updateState(locations, { lastSecretsHash: hash });
    }
    return 'pushed';
  };

  const runSecretsPullIfConfigured = async (config: NormalizedSyncConfig): Promise<void> => {
    const backend = resolveSecretsBackend(config);
    if (!backend) return;
    await backend.pull();
    await updateSecretsHashState();
  };

  const runSecretsPushIfConfigured = async (
    config: NormalizedSyncConfig
  ): Promise<'not_configured' | 'skipped' | 'pushed'> => {
    const backend = resolveSecretsBackend(config);
    if (!backend) return 'not_configured';
    return await pushSecretsWithBackend(backend);
  };

  const secretsBackendNotConfiguredMessage =
    'Secrets backend not configured. Add secretsBackend to opencode-synced.jsonc.';

  const resolveSecretsBackendForCommand = async (): Promise<
    { backend: SecretsBackend } | { message: string }
  > => {
    const config = await getConfigOrThrow(locations);
    const resolution = resolveSecretsBackendConfig(config);
    if (resolution.state === 'none') {
      return {
        message: secretsBackendNotConfiguredMessage,
      };
    }
    if (resolution.state === 'invalid') {
      throw new SyncCommandError(resolution.error);
    }
    return {
      backend: createSecretsBackend({
        $: ctx.$,
        locations,
        config: resolution.config,
      }),
    };
  };

  const runSecretsCommand = async (
    action: (backend: SecretsBackend) => Promise<string>
  ): Promise<string> => {
    const resolved = await resolveSecretsBackendForCommand();
    if ('message' in resolved) {
      return resolved.message;
    }
    return await action(resolved.backend);
  };

  return {
    startupSync: () =>
      skipIfBusy(async () => {
        let config: ReturnType<typeof normalizeSyncConfig> | null = null;
        try {
          config = await loadSyncConfig(locations);
        } catch (error) {
          const message = `Failed to load opencode-synced config: ${formatError(error)}`;
          log.error(message, { path: locations.syncConfigPath });
          await showToast(
            ctx.client,
            `Failed to load opencode-synced config. Check ${locations.syncConfigPath} for JSON errors.`,
            'error'
          );
          return;
        }
        if (!config) {
          await showToast(
            ctx.client,
            'Configure opencode-synced with /sync-init or link to an existing repo with /sync-link',
            'info'
          );
          return;
        }
        try {
          assertValidSecretsBackend(config);
          await runStartup(ctx, locations, config, log, {
            ensureAuthFilesNotTracked,
            runSecretsPullIfConfigured,
          });
        } catch (error) {
          log.error('Startup sync failed', { error: formatError(error) });
          await showToast(ctx.client, formatError(error), 'error');
        }
      }),
    status: async () => {
      const config = await loadSyncConfig(locations);
      if (!config) {
        return 'opencode-synced is not configured. Run /sync-init to set it up.';
      }

      assertValidSecretsBackend(config);

      const repoRoot = resolveRepoRoot(config, locations);
      const state = await loadState(locations);
      let repoStatus: string[] = [];
      let branch = resolveRepoBranch(config);

      const cloned = await isRepoCloned(repoRoot);
      if (!cloned) {
        repoStatus = ['Repo not cloned'];
      } else {
        try {
          const status = await getRepoStatus(ctx.$, repoRoot);
          repoStatus = status.changes;
          branch = status.branch;
        } catch {
          repoStatus = ['Repo status unavailable'];
        }
      }

      const repoIdentifier = resolveRepoIdentifier(config);
      const includeSecrets = config.includeSecrets ? 'enabled' : 'disabled';
      const includeMcpSecrets = config.includeMcpSecrets ? 'enabled' : 'disabled';
      const includeSessions = config.includeSessions ? 'enabled' : 'disabled';
      const includePromptStash = config.includePromptStash ? 'enabled' : 'disabled';
      const includeModelFavorites = config.includeModelFavorites ? 'enabled' : 'disabled';
      const secretsBackend = config.secretsBackend?.type ?? 'none';
      const lastPull = state.lastPull ?? 'never';
      const lastPush = state.lastPush ?? 'never';

      let changesLabel = 'clean';
      if (!cloned) {
        changesLabel = 'not cloned';
      } else if (repoStatus.length > 0) {
        if (repoStatus[0] === 'Repo status unavailable') {
          changesLabel = 'unknown';
        } else {
          changesLabel = `${repoStatus.length} pending`;
        }
      }
      const statusLines = [
        `Repo: ${repoIdentifier}`,
        `Branch: ${branch}`,
        `Secrets: ${includeSecrets}`,
        `Secrets backend: ${secretsBackend}`,
        `MCP secrets: ${includeMcpSecrets}`,
        `Sessions: ${includeSessions}`,
        `Prompt stash: ${includePromptStash}`,
        `Model favorites: ${includeModelFavorites}`,
        `Last pull: ${lastPull}`,
        `Last push: ${lastPush}`,
        `Working tree: ${changesLabel}`,
      ];

      return statusLines.join('\n');
    },
    init: (options: InitOptions) =>
      runExclusive(async () => {
        const config = await buildConfigFromInit(ctx.$, options);

        const repoIdentifier = resolveRepoIdentifier(config);
        const isPrivate = options.private ?? true;

        const exists = await repoExists(ctx.$, repoIdentifier);
        let created = false;
        if (!exists) {
          await createRepo(ctx.$, config, isPrivate);
          created = true;
        }

        await writeSyncConfig(locations, config);
        const repoRoot = resolveRepoRoot(config, locations);
        await ensureRepoCloned(ctx.$, config, repoRoot);
        await ensureSecretsPolicy(ctx, config);

        if (created) {
          const overrides = await loadOverrides(locations);
          const plan = buildSyncPlan(config, locations, repoRoot);
          await syncLocalToRepo(plan, overrides, {
            overridesPath: locations.overridesPath,
            allowMcpSecrets: canCommitMcpSecrets(config),
          });

          const dirty = await hasLocalChanges(ctx.$, repoRoot);
          if (dirty) {
            const branch = resolveRepoBranch(config);
            await commitAll(ctx.$, repoRoot, 'Initial sync from opencode-synced');
            await pushBranch(ctx.$, repoRoot, branch);
            await updateState(locations, { lastPush: new Date().toISOString() });
          }
        }

        const lines = [
          'opencode-synced configured.',
          `Repo: ${repoIdentifier}${created ? ' (created)' : ''}`,
          `Branch: ${resolveRepoBranch(config)}`,
          `Local repo: ${repoRoot}`,
        ];

        return lines.join('\n');
      }),
    link: (options: LinkOptions) =>
      runExclusive(async () => {
        const found = await findSyncRepo(ctx.$, options.repo);

        if (!found) {
          const searchedFor = options.repo
            ? `"${options.repo}"`
            : 'common sync repo names (my-opencode-config, opencode-config, etc.)';

          const lines = [
            `Could not find an existing sync repo. Searched for: ${searchedFor}`,
            '',
            'To link to an existing repo, run:',
            '  /sync-link <repo-name>',
            '',
            'To create a new sync repo, run:',
            '  /sync-init',
          ];
          return lines.join('\n');
        }

        const config = normalizeSyncConfig({
          repo: { owner: found.owner, name: found.name },
          includeSecrets: false,
          includeMcpSecrets: false,
          includeSessions: false,
          includePromptStash: false,
          extraSecretPaths: [],
          extraConfigPaths: [],
        });

        await writeSyncConfig(locations, config);
        const repoRoot = resolveRepoRoot(config, locations);
        await ensureRepoCloned(ctx.$, config, repoRoot);

        const branch = await resolveBranch(ctx, config, repoRoot);

        await fetchAndFastForward(ctx.$, repoRoot, branch);

        const overrides = await loadOverrides(locations);
        const plan = buildSyncPlan(config, locations, repoRoot);
        await syncRepoToLocal(plan, overrides);

        await updateState(locations, {
          lastPull: new Date().toISOString(),
          lastRemoteUpdate: new Date().toISOString(),
        });

        const lines = [
          `Linked to existing sync repo: ${found.owner}/${found.name}`,
          '',
          'Your local opencode config has been OVERWRITTEN with the synced config.',
          'Your local overrides file was preserved and applied on top.',
          '',
          'Restart opencode to apply the new settings.',
          '',
          found.isPrivate
            ? 'To enable secrets sync, run: /sync-enable-secrets'
            : 'Note: Repo is public. Secrets sync is disabled.',
        ];

        await showToast(ctx.client, 'Config synced. Restart opencode to apply.', 'info');
        return lines.join('\n');
      }),
    pull: () =>
      runExclusive(async () => {
        const config = await getConfigOrThrow(locations);
        const repoRoot = resolveRepoRoot(config, locations);
        await ensureRepoCloned(ctx.$, config, repoRoot);
        await ensureSecretsPolicy(ctx, config);
        await ensureAuthFilesNotTracked(repoRoot, config);

        const branch = await resolveBranch(ctx, config, repoRoot);

        const dirty = await hasLocalChanges(ctx.$, repoRoot);
        if (dirty) {
          throw new SyncCommandError(
            `Local sync repo has uncommitted changes. Resolve in ${repoRoot} before pulling.`
          );
        }

        const update = await fetchAndFastForward(ctx.$, repoRoot, branch);
        if (!update.updated) {
          return 'Already up to date.';
        }

        const overrides = await loadOverrides(locations);
        const plan = buildSyncPlan(config, locations, repoRoot);
        await syncRepoToLocal(plan, overrides);
        await runSecretsPullIfConfigured(config);

        await updateState(locations, {
          lastPull: new Date().toISOString(),
          lastRemoteUpdate: new Date().toISOString(),
        });

        await showToast(ctx.client, 'Config updated. Restart opencode to apply.', 'info');
        return 'Remote config applied. Restart opencode to use new settings.';
      }),
    push: () =>
      runExclusive(async () => {
        const config = await getConfigOrThrow(locations);
        const repoRoot = resolveRepoRoot(config, locations);
        await ensureRepoCloned(ctx.$, config, repoRoot);
        await ensureSecretsPolicy(ctx, config);
        await ensureAuthFilesNotTracked(repoRoot, config);
        const branch = await resolveBranch(ctx, config, repoRoot);

        const preDirty = await hasLocalChanges(ctx.$, repoRoot);
        if (preDirty) {
          throw new SyncCommandError(
            `Local sync repo has uncommitted changes. Resolve in ${repoRoot} before pushing.`
          );
        }

        const overrides = await loadOverrides(locations);
        const plan = buildSyncPlan(config, locations, repoRoot);
        await syncLocalToRepo(plan, overrides, {
          overridesPath: locations.overridesPath,
          allowMcpSecrets: canCommitMcpSecrets(config),
        });

        const dirty = await hasLocalChanges(ctx.$, repoRoot);
        if (!dirty) {
          try {
            const secretsResult = await runSecretsPushIfConfigured(config);
            if (secretsResult === 'pushed') {
              return 'No local changes to push. Secrets updated.';
            }
            if (secretsResult === 'skipped') {
              return 'No local changes to push. Secrets unchanged.';
            }
            return 'No local changes to push.';
          } catch (error) {
            log.warn('Secrets push failed after sync check', { error: formatError(error) });
            return `No local changes to push. Secrets push failed: ${formatError(error)}`;
          }
        }

        const message = await generateCommitMessage({ client: ctx.client, $: ctx.$ }, repoRoot);
        await commitAll(ctx.$, repoRoot, message);
        await pushBranch(ctx.$, repoRoot, branch);

        let secretsFailure: string | null = null;
        try {
          await runSecretsPushIfConfigured(config);
        } catch (error) {
          secretsFailure = formatError(error);
          log.warn('Secrets push failed after repo push', { error: secretsFailure });
        }

        await updateState(locations, {
          lastPush: new Date().toISOString(),
        });

        if (secretsFailure) {
          return `Pushed changes: ${message}. Secrets push failed: ${secretsFailure}`;
        }
        return `Pushed changes: ${message}`;
      }),
    secretsPull: () =>
      runExclusive(() =>
        runSecretsCommand(async (backend) => {
          await backend.pull();
          await updateSecretsHashState();
          return 'Pulled secrets from 1Password.';
        })
      ),
    secretsPush: () =>
      runExclusive(() =>
        runSecretsCommand(async (backend) => {
          const result = await pushSecretsWithBackend(backend);
          if (result === 'skipped') {
            return 'Secrets unchanged; skipping 1Password push.';
          }
          return 'Pushed secrets to 1Password.';
        })
      ),
    secretsStatus: () =>
      runExclusive(() =>
        runSecretsCommand(async (backend) => {
          return await backend.status();
        })
      ),
    enableSecrets: (options?: { extraSecretPaths?: string[]; includeMcpSecrets?: boolean }) =>
      runExclusive(async () => {
        const config = await getConfigOrThrow(locations);
        config.includeSecrets = true;
        if (options?.extraSecretPaths) {
          config.extraSecretPaths = options.extraSecretPaths;
        }
        if (options?.includeMcpSecrets !== undefined) {
          config.includeMcpSecrets = options.includeMcpSecrets;
        }

        await ensureRepoPrivate(ctx.$, config);
        await writeSyncConfig(locations, config);

        return 'Secrets sync enabled for this repo.';
      }),
    resolve: () =>
      runExclusive(async () => {
        const config = await getConfigOrThrow(locations);
        const repoRoot = resolveRepoRoot(config, locations);
        await ensureRepoCloned(ctx.$, config, repoRoot);

        const dirty = await hasLocalChanges(ctx.$, repoRoot);
        if (!dirty) {
          return 'No uncommitted changes to resolve.';
        }

        const status = await getRepoStatus(ctx.$, repoRoot);
        const decision = await analyzeAndDecideResolution(
          { client: ctx.client, $: ctx.$ },
          repoRoot,
          status.changes
        );

        if (decision.action === 'commit') {
          const message = decision.message ?? 'Sync: Auto-resolved uncommitted changes';
          await commitAll(ctx.$, repoRoot, message);
          return `Resolved by committing changes: ${message}`;
        }

        if (decision.action === 'reset') {
          try {
            await ctx.$`git -C ${repoRoot} reset --hard HEAD`.quiet();
            await ctx.$`git -C ${repoRoot} clean -fd`.quiet();
            return 'Resolved by discarding all uncommitted changes.';
          } catch (error) {
            throw new SyncCommandError(`Failed to reset changes: ${formatError(error)}`);
          }
        }

        return `Unable to automatically resolve. Please manually resolve in: ${repoRoot}`;
      }),
  };
}

function assertValidSecretsBackend(config: NormalizedSyncConfig): void {
  const resolution = resolveSecretsBackendConfig(config);
  if (resolution.state === 'invalid') {
    throw new SyncCommandError(resolution.error);
  }
}

async function isRepoPathTracked(
  $: Shell,
  repoRoot: string,
  repoRelativePath: string
): Promise<boolean> {
  const safePath = repoRelativePath.split(path.sep).join('/');
  try {
    await $`git -C ${repoRoot} ls-files --error-unmatch ${safePath}`.quiet();
    return true;
  } catch {
    return false;
  }
}

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

async function runStartup(
  ctx: SyncServiceContext,
  locations: ReturnType<typeof resolveSyncLocations>,
  config: ReturnType<typeof normalizeSyncConfig>,
  log: Logger,
  options: {
    ensureAuthFilesNotTracked: (repoRoot: string, config: NormalizedSyncConfig) => Promise<void>;
    runSecretsPullIfConfigured: (config: NormalizedSyncConfig) => Promise<void>;
  }
): Promise<void> {
  const repoRoot = resolveRepoRoot(config, locations);
  log.debug('Starting sync', { repoRoot });

  await ensureRepoCloned(ctx.$, config, repoRoot);
  await ensureSecretsPolicy(ctx, config);
  await options.ensureAuthFilesNotTracked(repoRoot, config);
  const branch = await resolveBranch(ctx, config, repoRoot);
  log.debug('Resolved branch', { branch });

  const dirty = await hasLocalChanges(ctx.$, repoRoot);
  if (dirty) {
    log.warn('Uncommitted changes detected', { repoRoot });
    await showToast(
      ctx.client,
      `Uncommitted changes detected. Run /sync-resolve to auto-fix, or manually resolve in: ${repoRoot}`,
      'warning'
    );
    return;
  }

  const update = await fetchAndFastForward(ctx.$, repoRoot, branch);
  if (update.updated) {
    log.info('Pulled remote changes', { branch });
    const overrides = await loadOverrides(locations);
    const plan = buildSyncPlan(config, locations, repoRoot);
    await syncRepoToLocal(plan, overrides);
    await options.runSecretsPullIfConfigured(config);
    await updateState(locations, {
      lastPull: new Date().toISOString(),
      lastRemoteUpdate: new Date().toISOString(),
    });
    await showToast(ctx.client, 'Config updated. Restart opencode to apply.', 'info');
    return;
  }

  const overrides = await loadOverrides(locations);
  const plan = buildSyncPlan(config, locations, repoRoot);
  await syncLocalToRepo(plan, overrides, {
    overridesPath: locations.overridesPath,
    allowMcpSecrets: canCommitMcpSecrets(config),
  });
  const changes = await hasLocalChanges(ctx.$, repoRoot);
  if (!changes) {
    log.debug('No local changes to push');
    return;
  }

  const message = await generateCommitMessage({ client: ctx.client, $: ctx.$ }, repoRoot);
  log.info('Pushing local changes', { message });
  await commitAll(ctx.$, repoRoot, message);
  await pushBranch(ctx.$, repoRoot, branch);
  await updateState(locations, {
    lastPush: new Date().toISOString(),
  });
}

async function getConfigOrThrow(
  locations: ReturnType<typeof resolveSyncLocations>
): Promise<ReturnType<typeof normalizeSyncConfig>> {
  const config = await loadSyncConfig(locations);
  if (!config) {
    throw new SyncConfigMissingError(
      'Missing opencode-synced config. Run /sync-init to set it up.'
    );
  }
  assertValidSecretsBackend(config);
  return config;
}

async function ensureSecretsPolicy(
  ctx: SyncServiceContext,
  config: ReturnType<typeof normalizeSyncConfig>
) {
  if (!config.includeSecrets) return;
  await ensureRepoPrivate(ctx.$, config);
}

async function resolveBranch(
  ctx: SyncServiceContext,
  config: ReturnType<typeof normalizeSyncConfig>,
  repoRoot: string
): Promise<string> {
  try {
    const status = await getRepoStatus(ctx.$, repoRoot);
    return resolveRepoBranch(config, status.branch);
  } catch {
    return resolveRepoBranch(config);
  }
}

const DEFAULT_REPO_NAME = 'my-opencode-config';

async function buildConfigFromInit($: Shell, options: InitOptions) {
  const repo = await resolveRepoFromInit($, options);
  return normalizeSyncConfig({
    repo,
    includeSecrets: options.includeSecrets ?? false,
    includeMcpSecrets: options.includeMcpSecrets ?? false,
    includeSessions: options.includeSessions ?? false,
    includePromptStash: options.includePromptStash ?? false,
    includeModelFavorites: options.includeModelFavorites ?? true,
    extraSecretPaths: options.extraSecretPaths ?? [],
    extraConfigPaths: options.extraConfigPaths ?? [],
    localRepoPath: options.localRepoPath,
  });
}

async function resolveRepoFromInit($: Shell, options: InitOptions) {
  if (options.url) {
    return { url: options.url, branch: options.branch };
  }
  if (options.owner && options.name) {
    return { owner: options.owner, name: options.name, branch: options.branch };
  }
  if (options.repo) {
    if (options.repo.includes('://') || options.repo.endsWith('.git')) {
      return { url: options.repo, branch: options.branch };
    }
    if (options.repo.includes('/')) {
      const [owner, name] = options.repo.split('/');
      if (owner && name) {
        return { owner, name, branch: options.branch };
      }
    }

    const owner = await getAuthenticatedUser($);
    return { owner, name: options.repo, branch: options.branch };
  }

  // Default: auto-detect owner, use default repo name
  const owner = await getAuthenticatedUser($);
  const name = DEFAULT_REPO_NAME;
  return { owner, name, branch: options.branch };
}

async function createRepo(
  $: Shell,
  config: ReturnType<typeof normalizeSyncConfig>,
  isPrivate: boolean
): Promise<void> {
  const owner = config.repo?.owner;
  const name = config.repo?.name;
  if (!owner || !name) {
    throw new SyncCommandError('Repo creation requires owner/name.');
  }

  const visibility = isPrivate ? '--private' : '--public';
  try {
    await $`gh repo create ${owner}/${name} ${visibility} --confirm`.quiet();
  } catch (error) {
    throw new SyncCommandError(`Failed to create repo: ${formatError(error)}`);
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface ResolutionDecision {
  action: 'commit' | 'reset' | 'manual';
  message?: string;
  reason?: string;
}

async function analyzeAndDecideResolution(
  ctx: { client: SyncServiceContext['client']; $: Shell },
  repoRoot: string,
  changes: string[]
): Promise<ResolutionDecision> {
  try {
    const diff = await ctx.$`git -C ${repoRoot} diff HEAD`.quiet().text();
    const statusOutput = changes.join('\n');

    const prompt = [
      'You are analyzing uncommitted changes in an opencode-synced repository.',
      'Decide whether to commit these changes or discard them.',
      '',
      'IMPORTANT: Only choose "commit" if the changes appear to be legitimate config updates.',
      'Choose "discard" if the changes look like temporary files, cache, or corruption.',
      '',
      'Respond with ONLY a JSON object in this exact format:',
      '{"action": "commit", "message": "your commit message here"}',
      'OR',
      '{"action": "discard", "reason": "explanation why discarding"}',
      '',
      'Status:',
      statusOutput,
      '',
      'Diff preview (first 2000 chars):',
      diff.slice(0, 2000),
    ].join('\n');

    const model = await resolveSmallModel(ctx.client);
    if (!model) {
      return { action: 'manual', reason: 'No AI model available' };
    }

    let sessionId: string | null = null;
    try {
      const sessionResult = await ctx.client.session.create({
        body: { title: 'sync-resolve' },
      });
      const session = unwrapData<{ id: string }>(sessionResult);
      sessionId = session?.id ?? null;
      if (!sessionId) {
        return { action: 'manual', reason: 'Failed to create session' };
      }

      const response = await ctx.client.session.prompt({
        path: { id: sessionId },
        body: {
          model,
          parts: [{ type: 'text', text: prompt }],
        },
      });

      const messageText = extractTextFromResponse(unwrapData(response) ?? response);
      if (!messageText) {
        return { action: 'manual', reason: 'No response from AI' };
      }

      const decision = parseResolutionDecision(messageText);
      return decision;
    } finally {
      if (sessionId) {
        try {
          await ctx.client.session.delete({ path: { id: sessionId } });
        } catch {}
      }
    }
  } catch (error) {
    console.error('[ERROR] AI resolution analysis failed:', error);
    return { action: 'manual', reason: `Error analyzing changes: ${formatError(error)}` };
  }
}

function parseResolutionDecision(text: string): ResolutionDecision {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { action: 'manual', reason: 'Could not parse AI response' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      action?: string;
      message?: string;
      reason?: string;
    };

    if (parsed.action === 'commit' && parsed.message) {
      return { action: 'commit', message: parsed.message };
    }

    if (parsed.action === 'discard') {
      return { action: 'reset', reason: parsed.reason };
    }

    return { action: 'manual', reason: 'Unexpected AI response format' };
  } catch {
    return { action: 'manual', reason: 'Failed to parse AI decision' };
  }
}
