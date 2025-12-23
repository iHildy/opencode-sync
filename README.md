# opencode-sync

Sync global OpenCode configuration across machines via a GitHub repo, with optional secrets support for private repos.

## Features

- Syncs global OpenCode config (`~/.config/opencode`) and related directories
- Optional secrets sync when the repo is private
- Startup auto-sync with restart toast
- Per-machine overrides via `opencode-sync.overrides.jsonc`
- Custom `/opencode-sync-*` commands and `opencode_sync` tool

## Requirements

- GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
- Git installed and available on PATH

## Install

```bash
npm install -g opencode-sync
```

Enable the plugin in your global OpenCode config:

```jsonc
{
  "plugin": ["opencode-sync"],
}
```

## Configure

Create `~/.config/opencode/opencode-sync.jsonc`:

```jsonc
{
  "repo": {
    "owner": "your-org",
    "name": "opencode-config",
    "branch": "main",
  },
  "includeSecrets": false,
  "extraSecretPaths": [],
}
```

You can also run `/opencode-sync-init` to scaffold this file.

### Synced paths (default)

- `~/.config/opencode/opencode.json` and `opencode.jsonc`
- `~/.config/opencode/AGENTS.md`
- `~/.config/opencode/agent/`, `command/`, `mode/`, `tool/`, `themes/`, `plugin/`

### Secrets (private repos only)

Enable secrets with `/opencode-sync-enable-secrets` or set `"includeSecrets": true`:

- `~/.local/share/opencode/auth.json`
- `~/.local/share/opencode/mcp-auth.json`
- Any extra paths in `extraSecretPaths` (allowlist)

## Overrides

Create a local-only overrides file at:

```
~/.config/opencode/opencode-sync.overrides.jsonc
```

Overrides are merged into the runtime config and re-applied to `opencode.json(c)` after pull.

## Usage

- `/opencode-sync-status` for repo status and last sync
- `/opencode-sync-pull` to fetch and apply remote config
- `/opencode-sync-push` to commit and push local changes
- `/opencode-sync-enable-secrets` to opt in to secrets sync

## Recovery

If the sync repo diverges, resolve it manually:

```bash
cd ~/.local/share/opencode/opencode-sync/repo
git status
git pull --rebase
```

Then re-run `/opencode-sync-pull` or `/opencode-sync-push`.

## Development

- `npm run build`
- `npm run test`
- `npm run lint`
