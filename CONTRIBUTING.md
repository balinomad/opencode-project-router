# Contributing

## Before you start

- Open an issue before a large change.
- Keep changes focused. One concern per pull request.
- Do not include credentials, tokens, personal paths, or private project data.

## Repository layout

```text
.
├── v1/                 OpenCode 1.x plugin
├── v2/                 OpenCode 2.x plugin
├── .github/workflows/  CI checks
├── README.md           Quick start and shared concepts
├── SECURITY.md         Vulnerability reporting
└── CHANGELOG.md        Release history
```

The three README files have separate roles:

- Root `README.md`: quick start, compatibility, platform support, shared concepts, migration.
- `v1/README.md`: authoritative OpenCode 1.x reference.
- `v2/README.md`: authoritative OpenCode 2.x reference.

Update the relevant version README when behavior changes.

## Development setup

Requirements:

- Node.js 22 or newer.
- npm.

Install dependencies:

```bash
npm ci
```

Run the TypeScript check:

```bash
npm run check
```

Run the tests:

```bash
npm test
```

Tests use the Node.js test runner with `node:test` and `node:assert`. The `test` script bundles the files listed in `package.json` into `.test-dist/`, then `node --test` runs the result. Add new test files to that script. Add coverage for path resolution, manifest parsing, permission rewriting, and central project loading when you change those areas.

Run the bundle checks:

```bash
mkdir -p dist
npx --yes esbuild v1/router.ts --bundle --platform=node --format=esm --outfile=dist/v1.js --external:@opencode-ai/plugin --external:yaml
npx --yes esbuild v2/index.ts --bundle --platform=node --format=esm --outfile=dist/v2.js
```

`dist/` is ignored by Git.

## Code standards

- Use TypeScript.
- Keep strict type checking enabled.
- Do not use `any`.
- Use official OpenCode types where practical.
- Use tabs for TypeScript and JSON indentation.
- Keep functions small and names explicit.
- Keep path handling cross-platform.
- Do not add comments unless they explain non-obvious behavior or a public contract.

## Platform testing

Linux, macOS, and Windows are supported. Test path handling on each platform when you change:

- Project discovery.
- Path containment checks.
- Home directory expansion.
- Permission path relativization.
- Reference path resolution.

Use forward slashes in JSON examples.

## Documentation

- Keep one H1 per Markdown file.
- Use fenced code blocks with language identifiers.
- Use `-` for unordered lists.
- Do not use em dashes.
- Keep paragraphs as single source lines.
- Do not wrap prose manually.

## Pull requests

Include:

- A short summary.
- The problem and the chosen fix.
- The affected plugin version.
- The commands you ran.
- Platform coverage.
- Documentation changes.

## Release checklist

Run this only after all changes are merged and verified on `master`.

1. Confirm `npm ci`, `npm run check`, `npm test`, and both bundle checks pass locally.
2. Confirm the latest `check` workflow run on `master` is green.
3. Update `CHANGELOG.md`: move entries from `Unreleased` into a dated version section.
4. Update `package.json` versions in `v1/` and `v2/` if the plugin versions change.
5. Update the install tag in `README.md`, `v1/README.md`, and `v2/README.md`.
6. Commit and push the release changes.
7. Create and push the annotated tag.
8. Create the GitHub Release from that tag.
9. Verify the release page and install commands.

```bash
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

On GitHub, open **Releases**, select **Draft a new release**, choose the pushed tag, set the title to `v1.0.0`, and paste the matching changelog section as the description. Publish the release. Do not move or reuse a published tag.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

Contributions are accepted under the MIT License. See [LICENSE](LICENSE).
