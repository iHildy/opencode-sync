# Release Process

This project uses Release Please for automated releases.

> [!WARN]
> Before doing anything, ensure that you've setup [Trusted Publishing](#npm-trusted-publishing).

## Release Workflow

### Conventional Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `fix:` patches
- `feat:` minor features
- `feat!:` or `fix!:` breaking changes

### Pre-1.0 Versioning

While version is `0.x.x`, breaking changes bump **minor** version.

### Release Process

1. Push commits to `main` branch
2. Release Please will:
   - Analyze commits
   - Determine version bump
   - Update `package.json`
   - Update `CHANGELOG.md`
   - Create a release PR

3. Review and merge the Release Please PR

### Commit Message Examples

- `fix: resolve task tracking issue`
- `feat: add global task support`
- `feat!: change task management API`
- `docs: improve README`
- `chore: update dependencies`

## Advanced Release Features

### Force a Specific Version

Use the `Release-As` footer in your commit message to force a specific version, bypassing conventional commit analysis:

```bash
git commit --allow-empty -m "chore: release 2.0.0" -m "Release-As: 2.0.0"
```

This creates a commit:

```
chore: release 2.0.0

Release-As: 2.0.0
```

Release Please will open a PR for version `2.0.0` regardless of commit message types.

### Update Extra Files During Release

If you have version numbers in other files beyond `package.json`, configure them in `release-please-config.json`:

```json
{
  "extra-files": [
    "src/version.ts",
    {
      "type": "generic",
      "path": "docs/VERSION.md"
    },
    {
      "type": "yaml",
      "path": ".tool-versions",
      "jsonpath": "$.node"
    }
  ]
}
```

**Supported file types:**

- Generic files (any type)
- JSON files (with JSONPath)
- YAML files (with JSONPath)
- XML files (with XPath)
- TOML files (with JSONPath)

### Magic Comments for Version Markers

Use inline comments to mark where versions should be updated:

```javascript
// x-release-please-version
const VERSION = '1.0.0';

// x-release-please-major
const MAJOR = '1';
```

Or use block markers:

```markdown
<!-- x-release-please-start-version -->

- Current version: 1.0.0
<!-- x-release-please-end -->
```

Available markers:

- `x-release-please-version` - Full semver
- `x-release-please-major` - Major number
- `x-release-please-minor` - Minor number
- `x-release-please-patch` - Patch number

## Do Not

- Manually edit Release Please PRs
- Manually create GitHub releases
- Modify version numbers directly

## Publishing

Releases are automatically published to NPM when the Release Please PR is merged.

### NPM Trusted Publishing

This project uses [NPM Trusted Publishing](https://docs.npmjs.com/trusted-publishers) with GitHub Actions. No npm tokens are needed - authentication is handled automatically via OIDC (OpenID Connect).

**How it works:**

- Each publish uses short-lived, cryptographically-signed tokens specific to your workflow
- Tokens cannot be extracted or reused
- No need to manage or rotate long-lived credentials
- Automatic provenance attestations prove where and how your package was built

**Setup required:**

1. Go to your npm package settings on npmjs.com
2. Add a trusted publisher for GitHub Actions with:
   - **Organization or user**: Your GitHub username/org
   - **Repository**: Your repository name
   - **Workflow filename**: `publish.yml` (the release workflow filename)
3. Optionally, [restrict token access](https://docs.npmjs.com/trusted-publishers#recommended-restrict-token-access-when-using-trusted-publishers) for maximum security

When you merge a release PR, the GitHub Actions workflow will automatically:

1. Build the plugin
2. Publish to NPM with OIDC authentication
3. Generate and attach provenance attestations
4. Create a GitHub release

### Manual Releases

You can also manually trigger a release by pushing a tag in the format `v{semver}`:

```bash
git tag v1.2.3
git push origin v1.2.3
```

This will:

1. Trigger the release workflow
2. Build and publish to NPM using trusted publishing
3. Create a GitHub release

Use manual releases for:

- Hot-fixes outside the normal release cycle
- Bypassing Release Please when needed
- Direct version control over releases

**Learn more:** See the [NPM Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers) for complete setup and best practices.
