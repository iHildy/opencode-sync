import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeSyncConfig } from './config.js';
import { resolveSyncLocations } from './paths.js';
import { computeSecretsHash, resolveSecretsBackendConfig } from './secrets-backend.js';

describe('resolveSecretsBackendConfig', () => {
  it('returns none when backend is missing', () => {
    const resolution = resolveSecretsBackendConfig(normalizeSyncConfig({}));
    expect(resolution.state).toBe('none');
  });

  it('rejects unsupported backend types', () => {
    const resolution = resolveSecretsBackendConfig(
      normalizeSyncConfig({
        secretsBackend: {
          type: 'vaultpass',
        },
      })
    );

    expect(resolution.state).toBe('invalid');
    if (resolution.state === 'invalid') {
      expect(resolution.error).toContain('Unsupported');
    }
  });

  it('validates required vault', () => {
    const resolution = resolveSecretsBackendConfig(
      normalizeSyncConfig({
        secretsBackend: {
          type: '1password',
          documents: {
            authJson: 'opencode-auth.json',
            mcpAuthJson: 'opencode-mcp-auth.json',
          },
        },
      })
    );

    expect(resolution.state).toBe('invalid');
    if (resolution.state === 'invalid') {
      expect(resolution.error).toContain('vault');
    }
  });

  it('requires unique document names', () => {
    const resolution = resolveSecretsBackendConfig(
      normalizeSyncConfig({
        secretsBackend: {
          type: '1password',
          vault: 'Personal',
          documents: {
            authJson: 'shared.json',
            mcpAuthJson: 'SHARED.json',
          },
        },
      })
    );

    expect(resolution.state).toBe('invalid');
    if (resolution.state === 'invalid') {
      expect(resolution.error).toContain('unique');
    }
  });

  it('returns ok when valid', () => {
    const resolution = resolveSecretsBackendConfig(
      normalizeSyncConfig({
        secretsBackend: {
          type: '1password',
          vault: 'Personal',
          documents: {
            authJson: 'opencode-auth.json',
            mcpAuthJson: 'opencode-mcp-auth.json',
          },
        },
      })
    );

    expect(resolution.state).toBe('ok');
    if (resolution.state === 'ok') {
      expect(resolution.config.vault).toBe('Personal');
      expect(resolution.config.authJson).toBe('opencode-auth.json');
    }
  });
});

describe('computeSecretsHash', () => {
  it('changes when auth files change', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-'));
    const env = {
      HOME: root,
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'),
    } as NodeJS.ProcessEnv;

    try {
      const locations = resolveSyncLocations(env, 'linux');
      const dataRoot = path.join(locations.xdg.dataDir, 'opencode');
      const authPath = path.join(dataRoot, 'auth.json');
      const mcpPath = path.join(dataRoot, 'mcp-auth.json');

      await mkdir(dataRoot, { recursive: true });

      const emptyHash = await computeSecretsHash(locations);
      await writeFile(authPath, 'first');
      const authHash = await computeSecretsHash(locations);
      await writeFile(mcpPath, 'second');
      const bothHash = await computeSecretsHash(locations);

      expect(emptyHash).not.toBe(authHash);
      expect(authHash).not.toBe(bothHash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
