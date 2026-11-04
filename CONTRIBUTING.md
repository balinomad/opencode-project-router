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

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

Contributions are accepted under the MIT License. See [LICENSE](LICENSE).
