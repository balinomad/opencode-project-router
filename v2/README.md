# OpenCode Project Router for OpenCode 2.x

> This plugin has ID `router`. Under OpenCode 1.x it is a no-op.

## Overview

The v2 plugin centralizes project configuration outside project repositories. It maps the current checkout to a central project directory and registers that directory with OpenCode 2.x.

The plugin loads `AGENTS.md`, agents, modes, commands, skills, and references from the central project directory. The repository checkout does not need any of these files.

## Requirements

- OpenCode 2.x.
- The `yaml` package in the plugin directory.
- No separate Node.js runtime. OpenCode loads the TypeScript plugin.
- `@opencode/plugin` is a development-only dependency. It is not required at runtime.

## Paths

| Platform | Global configuration directory                                   |
| -------- | ---------------------------------------------------------------- |
| Linux    | `~/.config/opencode` or `$XDG_CONFIG_HOME/opencode`              |
| macOS    | `~/.config/opencode` or `$XDG_CONFIG_HOME/opencode`              |
| Windows  | `%USERPROFILE%\.config\opencode` or `%XDG_CONFIG_HOME%\opencode` |

Documentation uses `<config>` for the global OpenCode configuration directory. The default projects root is `<config>/projects`.

## Installation

Install from a tagged release. Do not copy files from a moving branch.

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/balinomad/opencode-project-router.git
cd opencode-project-router
```

The copy commands below assume the repository checkout is the current directory.

### Linux and macOS

1. Copy the `v2/` directory to the global plugins directory.
2. Install the runtime dependency.
3. Copy the example manifest.
4. Edit the manifest.
5. Restart OpenCode.

```bash
mkdir -p ~/.config/opencode/plugins/router
cp -R v2/. ~/.config/opencode/plugins/router/
cd ~/.config/opencode/plugins/router
npm install --omit=dev
cp router.example.json router.json
```

OpenCode 2.x discovers the plugin automatically from `~/.config/opencode/plugins/router/`.

### Windows PowerShell

1. Copy the `v2/` directory to the global plugins directory.
2. Install the runtime dependency.
3. Copy the example manifest.
4. Edit the manifest.
5. Restart OpenCode.

```powershell
$config = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force "$config\plugins\router" | Out-Null
Copy-Item -Recurse .\v2\* "$config\plugins\router"
Set-Location "$config\plugins\router"
npm install --omit=dev
Copy-Item .\router.example.json .\router.json
```

If `XDG_CONFIG_HOME` is set, replace `~/.config` or `%USERPROFILE%\.config` with that directory.

## Manifest

The manifest is `router.json` in the plugin directory. It must be valid JSON. It does not support comments or trailing commas.

```json
{
  "version": 2,
  "projects": "~/.config/opencode/projects",
  "containers": ["~/repos"],
  "references": {}
}
```

`~` expands to the user's home directory on Linux, macOS, and Windows. On Windows, `~/.config/opencode` resolves under `%USERPROFILE%`.

### Fields

| Field        | Type     | Required | Default             | Description                                                                   |
| ------------ | -------- | -------- | ------------------- | ----------------------------------------------------------------------------- |
| `version`    | integer  | Yes      | None                | Manifest schema version. Must be `2`.                                         |
| `projects`   | string   | No       | `<config>/projects` | Root directory for central project directories. Supports `~` expansion.       |
| `containers` | string[] | No       | `[]`                | Checkout roots used for project discovery. Discovery does nothing when empty. |
| `references` | object   | No       | `{}`                | Global reference defaults. Project `references.json` entries override them.   |

The manifest version is the schema version of `router.json`. It is not the OpenCode version.

## Project discovery

The plugin canonicalizes the current location directory and compares it with every project path under every container. The longest matching project path wins.

```text
container: ~/repos
project:   my-app
cwd:       ~/repos/my-app/packages/api
match:     my-app
```

If no project matches, the plugin does not register project configuration.

## Project files

Each central project directory can contain:

```text
<config>/projects/my-app/
├── AGENTS.md
├── references.json
└── .opencode/
    ├── agents/
    │   └── reviewer.md
    ├── modes/
    │   └── planner.md
    ├── commands/
    │   └── review.md
    └── skills/
        └── git-release/
            └── SKILL.md
```

### AGENTS.md

`AGENTS.md` is injected into the session context. The plugin reads it when the plugin loads.

### Agents and modes

Agent files use the OpenCode 2.x Markdown agent format. The Markdown body becomes the system prompt. Front matter accepts `name`, `description`, `mode`, `hidden`, `color`, `steps`, `model`, `request`, `permissions`, and `disabled`.

- Files under `agents/` or `agent/` become agents.
- Files under `modes/` or `mode/` become primary agents.
- Nested paths become agent IDs with `/`.
- `disabled: true` removes the agent.
- Permissions on built-in agent overrides are appended.

### Commands

Command files use the OpenCode 2.x Markdown command format. The body is the template. Front matter accepts `description`, `agent`, `model`, `subagent`, and legacy `subtask`.

Template expansion supports:

- `$ARGUMENTS` for the full argument string.
- `$1` to `$n` for positional arguments.
- Argument append after a blank line when the template has no placeholder.

The plugin skips commands that contain a shell block or set `subagent: true` or `subtask: true`. It writes a `[router]` warning to the OpenCode log.

### Skills

Skills use the OpenCode 2.x layout. Both directory skills and flat Markdown skills are supported.

```text
.opencode/skills/git-release/SKILL.md
.opencode/skills/review.md
```

The skill ID is path-derived. Front matter supports `name`, `description`, `metadata.opencode/autoinvoke`, and `disable-model-invocation`.

### References

References are declared in `references.json` in the central project directory, or in the manifest `references` map. Project entries override manifest entries.

```json
{
  "docs": {
    "path": "~/shared/docs",
    "description": "Product documentation"
  },
  "effect": {
    "repository": "Effect-TS/effect",
    "branch": "main"
  }
}
```

Local paths resolve relative to the central project directory, or are used as written when absolute or home-relative. Windows absolute paths such as `C:/docs` are supported.

## Platform notes

- Linux, macOS, and Windows are supported.
- Use forward slashes in JSON paths on every platform.
- `~` expands to the current user's home directory.
- Windows drive paths such as `C:/docs` are supported.
- The global configuration directory is `~/.config/opencode` on Linux and macOS, and `%USERPROFILE%\.config\opencode` on Windows.
- If `XDG_CONFIG_HOME` is set, the global configuration directory is `$XDG_CONFIG_HOME/opencode`.

## Version guard

The plugin runs only when the OpenCode major version is 2 or newer. On OpenCode 1.x it does nothing.

## Troubleshooting

### Plugin does not load

Check:

1. The plugin directory exists at `~/.config/opencode/plugins/router/` or `%USERPROFILE%\.config\opencode\plugins\router\`.
2. `package.json` exists in the plugin directory.
3. `npm install --omit=dev` completed successfully.
4. OpenCode was restarted.
5. The OpenCode log contains a `[router]` diagnostic.

### Project not found

Check:

1. The current directory is under a configured container.
2. The project directory exists under the projects root.
3. The project directory name matches the checkout directory name.
4. `router.json` has `"version": 2`.
5. Windows paths use a drive letter and forward slashes.

### Command missing

A command is skipped when it contains a shell block or sets `subagent: true` or `subtask: true`. Check the OpenCode log for a `[router]` warning.

### Agent missing

Check that the file is under `.opencode/agents/`, `.opencode/agent/`, `.opencode/modes/`, or `.opencode/mode/`. Check that it uses v2 front matter. Invalid `mode` values are reported in the log.

### Reference missing

Check:

1. `references.json` is valid JSON.
2. Local paths exist.
3. Git repository names are correct.
4. Project entries override manifest entries with the same name.

## Limitations

- No permission handling. Configure permissions in OpenCode 2.x configuration.
- No central `opencode.json` merge.
- No shell block expansion in commands.
- No subagent command execution.
- `AGENTS.md` is read at plugin load. The plugin does not watch for changes.

## Security

- Central configuration applies to every matching checkout. Review the manifest and central project files before use.
- OpenCode 2.x permissions control file and command access. Configure them in the global or project OpenCode configuration.
- Do not commit credentials, tokens, or private project data to a public repository.
- Keep the central projects root outside repositories that other users can modify.
- Report vulnerabilities according to [SECURITY.md](../SECURITY.md).

## Support

Report issues at [github.com/balinomad/opencode-project-router/issues](https://github.com/balinomad/opencode-project-router/issues).
