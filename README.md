# opencode-project-router

Centralize per-project OpenCode configuration outside project repositories.

## Overview

OpenCode reads project configuration from the repository tree. This plugin maps the current checkout to a central project directory under the central projects root and loads the configuration from there. The repository stays free of `AGENTS.md`, agents, commands, skills, and references.

## When to use this

- You keep project checkouts under one or more container roots and want their OpenCode configuration in a central directory.
- You want per-project `AGENTS.md`, agents, commands, skills, and references without committing them to each repository.
- You want one central project definition to apply to every matching checkout.
- You need to keep repositories clean for policy, review, or portability reasons.

## When not to use this

- The configuration must travel with the repository for collaborators, CI, or fresh clones.
- One global OpenCode configuration is enough for every project.
- You work in a single repository that can own its `AGENTS.md` and `.opencode/` directory.
- You cannot maintain a stable `router.json` and central projects directory on each machine.
- You use OpenCode older than 1.18.29 and cannot upgrade. The v1 plugin requires 1.18.29 or newer.

The repository contains two independent plugins:

- `v1/` for OpenCode 1.18.29 and newer 1.x.
- `v2/` for OpenCode 2.x.

They share no code. Both use the same central `projects` root and the same container-based project discovery.

Install only the plugin that matches your OpenCode major version.

## Compatibility

| Plugin | OpenCode              | Manifest version | Permissions                                         | Notes                                 |
| ------ | --------------------- | ---------------- | --------------------------------------------------- | ------------------------------------- |
| `v1/`  | 1.18.29 and newer 1.x | `1`              | Handles `read`, `edit`, `write`, and external paths | Uses the v1 config hook.              |
| `v2/`  | 2.x                   | `2`              | Not handled; use OpenCode 2.x permissions           | Uses v2 transforms and session hooks. |

The manifest version is the schema version of `router.json`. It is not the OpenCode version.

## Platform support

| Platform | Support | Global configuration directory                                   |
| -------- | ------- | ---------------------------------------------------------------- |
| Linux    | Yes     | `~/.config/opencode` or `$XDG_CONFIG_HOME/opencode`              |
| macOS    | Yes     | `~/.config/opencode` or `$XDG_CONFIG_HOME/opencode`              |
| Windows  | Yes     | `%USERPROFILE%\.config\opencode` or `%XDG_CONFIG_HOME%\opencode` |

OpenCode uses the `~/.config/opencode` layout on every platform unless `XDG_CONFIG_HOME` is set. The system configuration directories differ by platform, but this plugin uses the global configuration directory.

Documentation uses `<config>` for the global OpenCode configuration directory. The table above lists its value for each platform. The default projects root is `<config>/projects`.

Use forward slashes in JSON paths on every platform. The plugin expands `~` and handles Windows drive paths.

## Shared concepts

Each plugin reads a `router.json` manifest. The manifest contains the central projects root, one or more container roots, and plugin-specific settings. The `version` field selects the manifest schema and must match the plugin major version.

A container is a directory that holds project checkouts. The plugin canonicalizes the current directory and finds the project whose checkout path is the longest prefix under any container. If no project matches, the plugin does nothing.

Each central project directory can contain `AGENTS.md`, `.opencode/` definitions, and plugin-specific files. The repository checkout does not need any of these files.

## Quick start

Install from a tagged release. Do not copy files from a moving branch.

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/balinomad/opencode-project-router.git
cd opencode-project-router
```

The copy commands below assume the repository checkout is the current directory.

### OpenCode 1.x

#### Linux and macOS

1. Create the plugin directory and copy the plugin files.
2. Copy `v1/router.example.json` to `~/.config/opencode/plugin/router.json` and edit it.
3. Add `"plugin": ["./plugin/router.ts"]` to `~/.config/opencode/opencode.json` or `opencode.jsonc`.
4. Add `yaml` to `~/.config/opencode/package.json` and run `npm install` in `~/.config/opencode`.
5. Restart OpenCode.

```bash
mkdir -p ~/.config/opencode/plugin
cp v1/router.ts ~/.config/opencode/plugin/router.ts
cp v1/router.example.json ~/.config/opencode/plugin/router.json
```

#### Windows PowerShell

1. Create the plugin directory and copy the plugin files.
2. Copy `router.example.json` to `router.json` and edit it.
3. Add `"plugin": ["./plugin/router.ts"]` to `%USERPROFILE%\.config\opencode\opencode.json` or `opencode.jsonc`.
4. Add `yaml` to `%USERPROFILE%\.config\opencode\package.json` and run `npm install` in that directory.
5. Restart OpenCode.

```powershell
$config = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force "$config\plugin" | Out-Null
Copy-Item .\v1\router.ts "$config\plugin\router.ts"
Copy-Item .\v1\router.example.json "$config\plugin\router.json"
```

See [v1/README.md](v1/README.md) for the complete v1 reference.

### OpenCode 2.x

#### Linux and macOS

1. Copy the `v2/` directory to `~/.config/opencode/plugins/router/`.
2. Install the runtime dependency in the copied directory.
3. Copy `router.example.json` to `router.json` and edit it.
4. Restart OpenCode.

```bash
mkdir -p ~/.config/opencode/plugins/router
cp -R v2/. ~/.config/opencode/plugins/router/
cd ~/.config/opencode/plugins/router
npm install --omit=dev
cp router.example.json router.json
```

OpenCode 2.x discovers the plugin automatically from `~/.config/opencode/plugins/router/`.

#### Windows PowerShell

1. Copy the `v2/` directory to `%USERPROFILE%\.config\opencode\plugins\router`.
2. Install the runtime dependency in the copied directory.
3. Copy `router.example.json` to `router.json` and edit it.
4. Restart OpenCode.

```powershell
$config = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force "$config\plugins\router" | Out-Null
Copy-Item -Recurse .\v2\* "$config\plugins\router"
Set-Location "$config\plugins\router"
npm install --omit=dev
Copy-Item .\router.example.json .\router.json
```

See [v2/README.md](v2/README.md) for the complete v2 reference.

## Central project layout

```text
<config>/projects/my-app/
├── AGENTS.md
├── references.json
└── .opencode/
    ├── agents/
    ├── commands/
    ├── modes/
    └── skills/
```

The v1 plugin also reads project `opencode.json` and `opencode.jsonc` files. The v2 plugin does not merge a central `opencode.json`. The v2 plugin uses `references.json` for references.

## Migration from v1 to v2

1. Install the v2 plugin and remove the v1 plugin from the OpenCode configuration.
2. Change the manifest `version` from `1` to `2`.
3. Move permission rules from `router.json` to the OpenCode 2.x `permissions` array. OpenCode 2.x supports absolute and home-relative paths natively.
4. Move project configuration from central `opencode.json` files to the central `.opencode/` directory. The v2 plugin does not merge central `opencode.json`.
5. Move reference definitions to `references.json` in the central project directory, or to the manifest `references` map.
6. Review commands. The v2 plugin skips commands that contain shell blocks or set `subagent: true` or `subtask: true`.
7. Restart OpenCode.

The v2 plugin uses manifest version `2` and the package name `opencode-project-router-v2`. The v1 plugin uses manifest version `1` and the package name `opencode-project-router-v1`.

## Security

- Central configuration applies to every matching checkout. Review the manifest and central project files before use.
- The v1 plugin can grant permissions for absolute and home-relative paths. Use `allow` rules sparingly.
- Do not commit credentials, tokens, or private project data to a public repository.
- Keep the central projects root outside repositories that other users can modify.

## Documentation

- [v1 reference](v1/README.md)
- [v2 reference](v2/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)
- [Issues](https://github.com/balinomad/opencode-project-router/issues)

## License

MIT. See [LICENSE](LICENSE).
