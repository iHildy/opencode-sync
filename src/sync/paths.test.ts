import { describe, expect, it } from 'vitest';

import type { SyncConfig } from './config.js';
import { normalizeSyncConfig } from './config.js';
import { buildSyncPlan, resolveSyncLocations, resolveXdgPaths } from './paths.js';

describe('resolveXdgPaths', () => {
  it('resolves linux defaults', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const paths = resolveXdgPaths(env, 'linux');

    expect(paths.configDir).toBe('/home/test/.config');
    expect(paths.dataDir).toBe('/home/test/.local/share');
  });

  it('resolves windows defaults', () => {
    const env = {
      USERPROFILE: 'C:\\Users\\Test',
      APPDATA: 'C:\\Users\\Test\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
    } as NodeJS.ProcessEnv;
    const paths = resolveXdgPaths(env, 'win32');

    expect(paths.configDir).toBe('C:\\Users\\Test\\AppData\\Roaming');
    expect(paths.dataDir).toBe('C:\\Users\\Test\\AppData\\Local');
  });
});

describe('resolveSyncLocations', () => {
  it('respects opencode_config_dir', () => {
    const env = {
      HOME: '/home/test',
      opencode_config_dir: '/custom/opencode',
    } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');

    expect(locations.configRoot).toBe('/custom/opencode');
    expect(locations.syncConfigPath).toBe('/custom/opencode/opencode-synced.jsonc');
    expect(locations.overridesPath).toBe('/custom/opencode/opencode-synced.overrides.jsonc');
  });
});

describe('buildSyncPlan', () => {
  it('includes modern opencode config directories by default', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');
    const localPaths = new Set(plan.items.map((item) => item.localPath));

    expect(localPaths.has('/home/test/.config/opencode/agents')).toBe(true);
    expect(localPaths.has('/home/test/.config/opencode/instructions')).toBe(true);
    expect(localPaths.has('/home/test/.config/opencode/plugins')).toBe(true);
    expect(localPaths.has('/home/test/.config/opencode/skills')).toBe(true);
    expect(localPaths.has('/home/test/.config/opencode/superpowers')).toBe(true);
  });

  it('excludes secrets when includeSecrets is false', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
      extraSecretPaths: ['/home/test/.ssh/id_rsa'],
      extraConfigPaths: ['/home/test/.config/opencode/custom.json'],
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');
    const secretItems = plan.items.filter((item) => item.isSecret);

    expect(secretItems.length).toBe(0);
    expect(plan.extraSecrets.allowlist.length).toBe(0);
    expect(plan.extraConfigs.allowlist.length).toBe(1);
  });

  it('includes opencode-synced config file in items', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');
    const syncItem = plan.items.find((item) => item.localPath === locations.syncConfigPath);

    expect(syncItem).toBeTruthy();
  });

  it('filters sync config from extra config paths', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
      extraConfigPaths: [locations.syncConfigPath],
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');

    expect(plan.extraConfigs.allowlist.length).toBe(0);
  });

  it('stores extra config paths as portable home-relative source paths', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
      extraConfigPaths: ['/home/test/.config/opencode/skills'],
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');

    expect(plan.extraConfigs.entries[0]?.sourcePath).toBe('~/.config/opencode/skills');
  });

  it('uses stable repo paths for home-relative extras across platforms', () => {
    const linuxEnv = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const macEnv = { HOME: '/Users/test' } as NodeJS.ProcessEnv;
    const linuxLocations = resolveSyncLocations(linuxEnv, 'linux');
    const macLocations = resolveSyncLocations(macEnv, 'darwin');
    const linuxConfig: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
      extraConfigPaths: ['/home/test/.config/opencode/skills'],
    };
    const macConfig: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
      extraConfigPaths: ['/Users/test/.config/opencode/skills'],
    };

    const linuxPlan = buildSyncPlan(
      normalizeSyncConfig(linuxConfig),
      linuxLocations,
      '/repo',
      'linux'
    );
    const macPlan = buildSyncPlan(normalizeSyncConfig(macConfig), macLocations, '/repo', 'darwin');

    expect(linuxPlan.extraConfigs.entries[0]?.repoPath).toBe(
      macPlan.extraConfigs.entries[0]?.repoPath
    );
  });

  it('includes secrets when includeSecrets is true', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: true,
      extraSecretPaths: ['/home/test/.ssh/id_rsa'],
      extraConfigPaths: ['/home/test/.config/opencode/custom.json'],
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');
    const secretItems = plan.items.filter((item) => item.isSecret);

    expect(secretItems.length).toBe(2);
    expect(plan.extraSecrets.allowlist.length).toBe(1);
    expect(plan.extraConfigs.allowlist.length).toBe(1);
  });

  it('excludes auth files when using 1password backend', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: true,
      secretsBackend: {
        type: '1password',
        vault: 'Personal',
        documents: {
          authJson: 'opencode-auth.json',
          mcpAuthJson: 'opencode-mcp-auth.json',
        },
      },
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');

    const authItem = plan.items.find((item) =>
      item.localPath.endsWith('/.local/share/opencode/auth.json')
    );
    const mcpItem = plan.items.find((item) =>
      item.localPath.endsWith('/.local/share/opencode/mcp-auth.json')
    );

    expect(authItem).toBeUndefined();
    expect(mcpItem).toBeUndefined();
  });

  it('includes model favorites by default and allows disabling', () => {
    const env = { HOME: '/home/test' } as NodeJS.ProcessEnv;
    const locations = resolveSyncLocations(env, 'linux');
    const config: SyncConfig = {
      repo: { owner: 'acme', name: 'config' },
      includeSecrets: false,
    };

    const plan = buildSyncPlan(normalizeSyncConfig(config), locations, '/repo', 'linux');
    const favoritesItem = plan.items.find((item) =>
      item.localPath.endsWith('/.local/state/opencode/model.json')
    );

    expect(favoritesItem).toBeTruthy();

    const disabledPlan = buildSyncPlan(
      normalizeSyncConfig({ ...config, includeModelFavorites: false }),
      locations,
      '/repo',
      'linux'
    );
    const disabledItem = disabledPlan.items.find((item) =>
      item.localPath.endsWith('/.local/state/opencode/model.json')
    );

    expect(disabledItem).toBeUndefined();
  });
});
