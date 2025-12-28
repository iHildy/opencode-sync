# opencode-sync

Sync global OpenCode configuration across machines via a GitHub repo, with optional secrets support for private repos.

## Features

- Syncs global OpenCode config (`~/.config/opencode`) and related directories
- Optional secrets sync when the repo is private
- Optional session sync to share conversation history across machines
- Optional prompt stash sync to share stashed prompts and history across machines
- Startup auto-sync with restart toast
- Per-machine overrides via `opencode-sync.overrides.jsonc`
- Custom `/opencode-sync-*` commands and `opencode_sync` tool

## Requirements

- GitHub CLI (`gh`) installed and authenticated (`gh auth login`)
- Git installed and available on PATH

## Setup

Enable the plugin in your global OpenCode config (OpenCode will install it on next run):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-sync"],
}
```

OpenCode does not auto-update plugins. To update, remove the cached plugin and restart OpenCode:

```bash
rm -rf ~/.cache/opencode/node_modules/opencode-sync
opencode
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
  "includeSessions": false,
  "includePromptStash": false,
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

### Sessions (private repos only)

Sync your OpenCode sessions (conversation history from `/sessions`) across machines by setting `"includeSessions": true`. This requires `includeSecrets` to also be enabled since sessions may contain sensitive data.

```jsonc
{
  "repo": { ... },
  "includeSecrets": true,
  "includeSessions": true
}
```

Synced session data:

- `~/.local/share/opencode/storage/session/` - Session files
- `~/.local/share/opencode/storage/message/` - Message history
- `~/.local/share/opencode/storage/part/` - Message parts
- `~/.local/share/opencode/storage/session_diff/` - Session diffs

### Prompt Stash (private repos only)

Sync your stashed prompts and prompt history across machines by setting `"includePromptStash": true`. This requires `includeSecrets` to also be enabled since prompts may contain sensitive data.

```jsonc
{
  "repo": { ... },
  "includeSecrets": true,
  "includePromptStash": true
}
```

Synced prompt data:

- `~/.local/state/opencode/prompt-stash.jsonl` - Stashed prompts
- `~/.local/state/opencode/prompt-history.jsonl` - Prompt history

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
- `/opencode-sync-resolve` to automatically resolve uncommitted changes using AI

<details>
<summary>Manual (slash command alternative)</summary>

### Configure

Create `~/.config/opencode/opencode-sync.jsonc`:

```jsonc
{
  "repo": {
    "owner": "your-org",
    "name": "opencode-config",
    "branch": "main",
  },
  "includeSecrets": false,
  "includeSessions": false,
  "includePromptStash": false,
  "extraSecretPaths": [],
}
```

### Enable secrets (private repo required)

Set `"includeSecrets": true` and optionally add `"extraSecretPaths"`. The plugin will refuse to sync secrets if the repo is not private.

### Trigger a sync

Restart OpenCode to run the startup sync flow (pull remote, apply if changed, push local changes if needed).

### Check status

Inspect the local repo directly:

```bash
cd ~/.local/share/opencode/opencode-sync/repo
git status
git log --oneline -5
```

</details>

## Recovery

If the sync repo has uncommitted changes, you can:

1. **Auto-resolve using AI**: Run `/opencode-sync-resolve` to let AI analyze and decide whether to commit or discard the changes
2. **Manual resolution**: Navigate to the repo and resolve manually:

```bash
cd ~/.local/share/opencode/opencode-sync/repo
git status
git pull --rebase
```

Then re-run `/opencode-sync-pull` or `/opencode-sync-push`.

## Development

- `bun run build`
- `bun run test`
- `bun run lint`
