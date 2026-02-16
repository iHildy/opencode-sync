# Fork Feature: 1Password Secrets Backend (NO secrets in git)

## Problem
Upstream `opencode-synced` can sync OpenCode secrets by committing:
- `~/.local/share/opencode/auth.json`
- `~/.local/share/opencode/mcp-auth.json`

We want to keep using the plugin for config/sessions, but **never store tokens in git**.

## Goal
Add an optional secrets backend to this plugin:
- `auth.json` and `mcp-auth.json` are stored in **1Password** (as opaque blobs)
- they are **pulled** from 1Password after syncing config
- they are **pushed** back to 1Password when changed
- they are **never committed** to git (even if `includeSecrets: true`)
- keep everything else working exactly like upstream

## Non-goals
- Don’t parse or reinterpret `auth.json` / `mcp-auth.json` structure.
- Don’t implement a filesystem watcher daemon. Keep it command-based.
- Don’t leak secrets in logs/errors.

## Configuration (add to opencode-synced.jsonc)
Add a new optional config block:

```jsonc
{
  "includeSecrets": false,
  "secretsBackend": {
    "type": "1password",
    "vault": "Personal",
    "documents": {
      "authJson": "opencode-auth.json",
      "mcpAuthJson": "opencode-mcp-auth.json"
    }
  }
}
```

Rules:

If secretsBackend.type is missing, run upstream behavior.

If type === "1password", auth.json and mcp-auth.json must NOT be included in git sync, regardless of includeSecrets.

1Password Storage Approach
Use 1Password Document items to store the raw files.

Required CLI operations (execute via child process; never print file contents):

op document get <name> --vault <vault> --out-file <path>

op document create --vault <vault> <file> --title <name>

op document edit <name> --vault <vault> <file>

Implementation Plan (do in order)
1) Locate current secret sync logic
Search the repo for:

includeSecrets

auth.json / mcp-auth.json

extraSecretPaths

/sync-pull /sync-push
Identify the exact function(s) that assemble the list of paths to copy/commit.

2) Add config typing + validation
Extend config types to include secretsBackend.

Validate:

vault required

documents.authJson required

documents.mcpAuthJson required

documents.authJson and documents.mcpAuthJson must be unique

3) Add a SecretsBackend interface
Internal interface:

pull(): Promise<void> // 1P -> local files

push(): Promise<void> // local files -> 1P

status(): Promise<string> (optional)

4) Implement OnePasswordBackend
Implementation rules:

Use child_process to call op.

Detect if op is installed; return a clear, non-secret error.

For pull:

op document get <name> --vault <vault> --out-file <tmp>

atomically write to target path (write temp + rename)

set restrictive perms (0600) where possible

If document is missing, do not fail hard; just skip.

For push:

if local file doesn’t exist: skip.

create doc if missing; otherwise edit doc.

Files to manage (XDG-aware):

Linux/macOS: ~/.local/share/opencode/auth.json and ~/.local/share/opencode/mcp-auth.json

Windows: %LOCALAPPDATA%\opencode\auth.json and %LOCALAPPDATA%\opencode\mcp-auth.json

5) Wire backend into sync lifecycle
Hook points:

After /sync-pull applies repo changes -> call backend.pull()

After /sync-push successfully commits/pushes (or when no repo changes) -> call backend.push()

Add explicit commands:

/sync-secrets-pull

/sync-secrets-push

/sync-secrets-status

6) Enforce “never commit auth files”
When secretsBackend.type === "1password":

Ensure the git sync path list excludes:

~/.local/share/opencode/auth.json

~/.local/share/opencode/mcp-auth.json

Additionally:

Detect if these files are already tracked in the sync repo.

If yes: stop and print remediation instructions (remove + rewrite history).

7) Change detection (recommended)
Add lightweight hashing:

compute SHA256 of local auth.json and mcp-auth.json

store last pushed hash in plugin state

only call backend.push() when changed (avoid unnecessary 1P calls)

8) QA / Acceptance Tests (manual)
Machine A:

Configure secretsBackend=1password

Run /sync-secrets-push (creates docs if missing)

Run /sync-push (must NOT commit auth files)

Machine B:

/sync-link then /sync-pull

/sync-secrets-pull

Verify OpenCode is authenticated without manual token copy

Update tokens:

Run opencode auth login or OpenCode /connect (updates auth.json)

Run /sync-secrets-push

On machine B run /sync-secrets-pull and verify updated auth works

Security Constraints (strict)
Never print secrets.

Never write secrets into the repo.

Never include secrets in thrown error messages.

Ensure local auth files are chmod 0600 where supported.

If 1Password backend fails, do not destroy local auth files.
