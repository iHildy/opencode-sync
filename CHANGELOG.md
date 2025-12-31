# Changelog

All notable changes to this project will be documented here by Release Please.

## [0.2.0](https://github.com/iHildy/opencode-synced/compare/v0.1.1...v0.2.0) (2025-12-31)


### Features

* add /opencode-sync-resolve command to auto-resolve changes ([35e3545](https://github.com/iHildy/opencode-synced/commit/35e354507bffa7dc380d90fd771f8a3f8424cebe))
* add GitHub user auto-detection and auto-create sync repo ([8998f8c](https://github.com/iHildy/opencode-synced/commit/8998f8cbbf62cd90a50dc8dc064eb31de7303235))
* add prompt stash sync option (includePromptStash) ([2699008](https://github.com/iHildy/opencode-synced/commit/2699008967a48af5f8418d89201172e64152265d))
* add sync-link command and improve repo management ([f7bbc7b](https://github.com/iHildy/opencode-synced/commit/f7bbc7b655efd507d97662203df8d22d13bc64ff))


### Bug Fixes

* address reviewer feedback on startup reliability and toasts ([11d417b](https://github.com/iHildy/opencode-synced/commit/11d417b8d8abad3a2c4a2d0e59c436c2f318fce2))
* adjust repo org/name detection ([b1c0fef](https://github.com/iHildy/opencode-synced/commit/b1c0fef508c3f9ea6e00a42abb033fcbdad18c19))
* improve startup sync reliability and repository validation ([2480fb2](https://github.com/iHildy/opencode-synced/commit/2480fb2f9b2874014eeef992e0b7f2c51a70476e))


### Reverts

* event-driven startup sync in favor of setTimeout delay ([221bf8c](https://github.com/iHildy/opencode-synced/commit/221bf8c04f4fe322f138b204202e4ea2e098f7ad))

## [0.1.1](https://github.com/iHildy/opencode-synced/compare/v0.1.0...v0.1.1) (2025-12-31)


### Bug Fixes

* address reviewer feedback on startup reliability and toasts ([11d417b](https://github.com/iHildy/opencode-synced/commit/11d417b8d8abad3a2c4a2d0e59c436c2f318fce2))
* improve startup sync reliability and repository validation ([2480fb2](https://github.com/iHildy/opencode-synced/commit/2480fb2f9b2874014eeef992e0b7f2c51a70476e))


### Reverts

* event-driven startup sync in favor of setTimeout delay ([221bf8c](https://github.com/iHildy/opencode-synced/commit/221bf8c04f4fe322f138b204202e4ea2e098f7ad))

## 0.1.0 (2025-12-30)

### Features

- **sync**: Initial implementation of OpenCode configuration sync via GitHub
- **sync**: Support for secrets sync in private repositories
- **sync**: Support for session history sync
- **sync**: Support for prompt stash sync
- **sync**: Added `/sync-*` slash commands for easy management
- **sync**: Added automatic sync on OpenCode startup
- **sync**: Added AI-powered conflict resolution with `/sync-resolve`
- **sync**: Automatic GitHub repository detection and creation during initialization
