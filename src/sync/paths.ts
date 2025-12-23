import crypto from 'crypto';
import path from 'path';

import type { SyncConfig } from './config.ts';

export interface XdgPaths {
  homeDir: string;
  configDir: string;
  dataDir: string;
}

export interface SyncLocations {
  xdg: XdgPaths;
  syncConfigPath: string;
  overridesPath: string;
  statePath: string;
  defaultRepoDir: string;
}

export type SyncItemType = 'file' | 'dir';

export interface SyncItem {
  localPath: string;
  repoPath: string;
  type: SyncItemType;
  isSecret: boolean;
  isConfigFile: boolean;
}

export interface ExtraSecretPlan {
  allowlist: string[];
  manifestPath: string;
  entries: Array<{ sourcePath: string; repoPath: string }>;
}

export interface SyncPlan {
  items: SyncItem[];
  extraSecrets: ExtraSecretPlan;
  repoRoot: string;
  homeDir: string;
  platform: NodeJS.Platform;
}

const DEFAULT_CONFIG_NAME = 'opencode.json';
const DEFAULT_CONFIGC_NAME = 'opencode.jsonc';
const DEFAULT_AGENTS_NAME = 'AGENTS.md';
const DEFAULT_SYNC_CONFIG_NAME = 'opencode-sync.jsonc';
const DEFAULT_OVERRIDES_NAME = 'opencode-sync.overrides.jsonc';
const DEFAULT_STATE_NAME = 'opencode-sync-state.json';

const CONFIG_DIRS = ['agent', 'command', 'mode', 'tool', 'themes', 'plugin'];

export function resolveHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    return env.USERPROFILE ?? env.HOMEDRIVE ?? env.HOME ?? '';
  }

  return env.HOME ?? '';
}

export function resolveXdgPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): XdgPaths {
  const homeDir = resolveHomeDir(env, platform);

  if (!homeDir) {
    return {
      homeDir: '',
      configDir: '',
      dataDir: '',
    };
  }

  if (platform === 'win32') {
    const configDir = env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
    const dataDir = env.LOCALAPPDATA ?? path.join(homeDir, 'AppData', 'Local');
    return { homeDir, configDir, dataDir };
  }

  const configDir = env.XDG_CONFIG_HOME ?? path.join(homeDir, '.config');
  const dataDir = env.XDG_DATA_HOME ?? path.join(homeDir, '.local', 'share');

  return { homeDir, configDir, dataDir };
}

export function resolveSyncLocations(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): SyncLocations {
  const xdg = resolveXdgPaths(env, platform);
  const configRoot = path.join(xdg.configDir, 'opencode');
  const dataRoot = path.join(xdg.dataDir, 'opencode');

  return {
    xdg,
    syncConfigPath: path.join(configRoot, DEFAULT_SYNC_CONFIG_NAME),
    overridesPath: path.join(configRoot, DEFAULT_OVERRIDES_NAME),
    statePath: path.join(dataRoot, DEFAULT_STATE_NAME),
    defaultRepoDir: path.join(dataRoot, 'opencode-sync', 'repo'),
  };
}

export function expandHome(inputPath: string, homeDir: string): string {
  if (!inputPath) return inputPath;
  if (!homeDir) return inputPath;
  if (inputPath === '~') return homeDir;
  if (inputPath.startsWith('~/')) return path.join(homeDir, inputPath.slice(2));
  return inputPath;
}

export function normalizePath(
  inputPath: string,
  homeDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  const expanded = expandHome(inputPath, homeDir);
  const resolved = path.resolve(expanded);
  if (platform === 'win32') {
    return resolved.toLowerCase();
  }
  return resolved;
}

export function isSamePath(
  left: string,
  right: string,
  homeDir: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return normalizePath(left, homeDir, platform) === normalizePath(right, homeDir, platform);
}

export function encodeSecretPath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/');
  const safeBase = normalized.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '');
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const base = safeBase ? safeBase.slice(-80) : 'secret';
  return `${base}-${hash}`;
}

export function resolveRepoRoot(config: SyncConfig | null, locations: SyncLocations): string {
  if (config?.localRepoPath) {
    return expandHome(config.localRepoPath, locations.xdg.homeDir);
  }

  return locations.defaultRepoDir;
}

export function buildSyncPlan(
  config: SyncConfig,
  locations: SyncLocations,
  repoRoot: string,
  platform: NodeJS.Platform = process.platform
): SyncPlan {
  const configRoot = path.join(locations.xdg.configDir, 'opencode');
  const dataRoot = path.join(locations.xdg.dataDir, 'opencode');
  const repoConfigRoot = path.join(repoRoot, 'config');
  const repoDataRoot = path.join(repoRoot, 'data');
  const repoSecretsRoot = path.join(repoRoot, 'secrets');
  const repoExtraDir = path.join(repoSecretsRoot, 'extra');
  const manifestPath = path.join(repoSecretsRoot, 'extra-manifest.json');

  const items: SyncItem[] = [];

  const addFile = (name: string, isSecret: boolean, isConfigFile: boolean): void => {
    items.push({
      localPath: path.join(configRoot, name),
      repoPath: path.join(repoConfigRoot, name),
      type: 'file',
      isSecret,
      isConfigFile,
    });
  };

  addFile(DEFAULT_CONFIG_NAME, false, true);
  addFile(DEFAULT_CONFIGC_NAME, false, true);
  addFile(DEFAULT_AGENTS_NAME, false, false);

  for (const dirName of CONFIG_DIRS) {
    items.push({
      localPath: path.join(configRoot, dirName),
      repoPath: path.join(repoConfigRoot, dirName),
      type: 'dir',
      isSecret: false,
      isConfigFile: false,
    });
  }

  if (config.includeSecrets) {
    items.push(
      {
        localPath: path.join(dataRoot, 'auth.json'),
        repoPath: path.join(repoDataRoot, 'auth.json'),
        type: 'file',
        isSecret: true,
        isConfigFile: false,
      },
      {
        localPath: path.join(dataRoot, 'mcp-auth.json'),
        repoPath: path.join(repoDataRoot, 'mcp-auth.json'),
        type: 'file',
        isSecret: true,
        isConfigFile: false,
      }
    );
  }

  const allowlist = config.includeSecrets
    ? (config.extraSecretPaths ?? []).map((entry) =>
        normalizePath(entry, locations.xdg.homeDir, platform)
      )
    : [];

  const entries = allowlist.map((sourcePath) => ({
    sourcePath,
    repoPath: path.join(repoExtraDir, encodeSecretPath(sourcePath)),
  }));

  return {
    items,
    extraSecrets: {
      allowlist,
      manifestPath,
      entries,
    },
    repoRoot,
    homeDir: locations.xdg.homeDir,
    platform,
  };
}
