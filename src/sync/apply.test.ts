import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { syncRepoToLocal } from './apply.js';
import type { SyncPlan } from './paths.js';
import { normalizePath } from './paths.js';

describe('syncRepoToLocal extra manifest repoPath validation', () => {
  it('rejects absolute repoPath values from manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-apply-'));
    try {
      const homeDir = path.join(root, 'home');
      const repoRoot = path.join(root, 'repo');
      const localPath = path.join(homeDir, 'target.txt');
      const manifestPath = path.join(repoRoot, 'config', 'extra-manifest.json');

      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            entries: [
              {
                sourcePath: localPath,
                repoPath: '/etc/passwd',
                type: 'file',
              },
            ],
          },
          null,
          2
        ),
        'utf8'
      );

      const plan: SyncPlan = {
        items: [],
        extraConfigs: {
          allowlist: [normalizePath(localPath, homeDir, 'linux')],
          manifestPath,
          entries: [],
        },
        extraSecrets: {
          allowlist: [],
          manifestPath: path.join(repoRoot, 'secrets', 'extra-manifest.json'),
          entries: [],
        },
        repoRoot,
        homeDir,
        platform: 'linux',
      };

      await expect(syncRepoToLocal(plan, null)).rejects.toThrow(/absolute paths are not allowed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal repoPath values from manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-apply-'));
    try {
      const homeDir = path.join(root, 'home');
      const repoRoot = path.join(root, 'repo');
      const localPath = path.join(homeDir, 'target.txt');
      const manifestPath = path.join(repoRoot, 'config', 'extra-manifest.json');

      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            entries: [
              {
                sourcePath: localPath,
                repoPath: '../../etc/passwd',
                type: 'file',
              },
            ],
          },
          null,
          2
        ),
        'utf8'
      );

      const plan: SyncPlan = {
        items: [],
        extraConfigs: {
          allowlist: [normalizePath(localPath, homeDir, 'linux')],
          manifestPath,
          entries: [],
        },
        extraSecrets: {
          allowlist: [],
          manifestPath: path.join(repoRoot, 'secrets', 'extra-manifest.json'),
          entries: [],
        },
        repoRoot,
        homeDir,
        platform: 'linux',
      };

      await expect(syncRepoToLocal(plan, null)).rejects.toThrow(/path escapes repository root/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts safe relative repoPath values from manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-apply-'));
    try {
      const homeDir = path.join(root, 'home');
      const repoRoot = path.join(root, 'repo');
      const localPath = path.join(homeDir, 'target.txt');
      const manifestPath = path.join(repoRoot, 'config', 'extra-manifest.json');
      const repoSourcePath = path.join(repoRoot, 'config', 'extra', 'safe.txt');

      await mkdir(path.dirname(manifestPath), { recursive: true });
      await mkdir(path.dirname(repoSourcePath), { recursive: true });
      await writeFile(repoSourcePath, 'safe-data\n', 'utf8');
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            entries: [
              {
                sourcePath: localPath,
                repoPath: 'config/extra/safe.txt',
                type: 'file',
              },
            ],
          },
          null,
          2
        ),
        'utf8'
      );

      const plan: SyncPlan = {
        items: [],
        extraConfigs: {
          allowlist: [normalizePath(localPath, homeDir, 'linux')],
          manifestPath,
          entries: [],
        },
        extraSecrets: {
          allowlist: [],
          manifestPath: path.join(repoRoot, 'secrets', 'extra-manifest.json'),
          entries: [],
        },
        repoRoot,
        homeDir,
        platform: 'linux',
      };

      await syncRepoToLocal(plan, null);

      const output = await readFile(localPath, 'utf8');
      expect(output).toBe('safe-data\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
