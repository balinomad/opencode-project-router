# OpenCode Project Router for OpenCode 1.x

> This plugin has ID `router-v1`. Under OpenCode 2.x it is a no-op.

## Overview

The v1 plugin centralizes project configuration outside project repositories. It maps the current checkout to a central project directory and merges that directory into the OpenCode 1.x configuration.

The plugin solves two problems that OpenCode 1.x does not solve natively:

1. Project configuration is stored outside repositories.
2. Permissions can use absolute and home-relative paths.

A project can exist in multiple checkout locations and share one central configuration.

## Requirements

- OpenCode 1.18.29 or newer 1.x.
- The `yaml` package in the global OpenCode configuration directory.
- No separate Node.js runtime. OpenCode loads the TypeScript plugin.

## Paths

| Platform | Global configuration directory                                   |
| -------- | ---------------------------------------------------------------- |
| Linux    | `~/.config/opencode` or `$XDG_CONFIG_HOME/opencode`              |
| macOS    | `~/.config/opencode` or `$XDG_CONFIG_HOME/opencode`              |
| Windows  | `%USERPROFILE%\.config\opencode` or `%XDG_CONFIG_HOME%\opencode` |

Documentation uses `<config>` for the global OpenCode configuration directory. The default projects root is `<config>/projects`.

## Installation

### Linux and macOS

1. Create the plugin directory.
2. Copy the plugin and example manifest.
3. Edit the manifest.
4. Enable the plugin.
5. Install the `yaml` dependency.
6. Restart OpenCode.

```bash
mkdir -p ~/.config/opencode/plugin
cp v1/router.ts ~/.config/opencode/plugin/router.ts
cp v1/router.example.json ~/.config/opencode/plugin/router.json
```

Add the plugin to `~/.config/opencode/opencode.json` or `opencode.jsonc`:

```jsonc
{
  "plugin": ["./plugin/router.ts"]
}
```

Add `yaml` to `~/.config/opencode/package.json` if it is not already available:

```json
{
  "dependencies": {
    "yaml": "^2.9.0"
  }
}
```

Then run `npm install` in `~/.config/opencode`.

### Windows PowerShell

1. Create the plugin directory.
2. Copy the plugin and example manifest.
3. Edit the manifest.
4. Enable the plugin.
5. Install the `yaml` dependency.
6. Restart OpenCode.

```powershell
$config = "$env:USERPROFILE\.config\opencode"
New-Item -ItemType Directory -Force "$config\plugin" | Out-Null
Copy-Item .\v1\router.ts "$config\plugin\router.ts"
Copy-Item .\v1\router.example.json "$config\plugin\router.json"
```

Add the plugin to `%USERPROFILE%\.config\opencode\opencode.json` or `opencode.jsonc`:

```jsonc
{
  "plugin": ["./plugin/router.ts"]
}
```

Add `yaml` to `%USERPROFILE%\.config\opencode\package.json` if it is not already available:

```json
{
  "dependencies": {
    "yaml": "^2.9.0"
  }
}
```

Then run `npm install` in `%USERPROFILE%\.config\opencode`.

If `XDG_CONFIG_HOME` is set, replace `~/.config` or `%USERPROFILE%\.config` with that directory.

## Manifest

The manifest is `router.json` in the plugin directory. It must be valid JSON. It does not support comments or trailing commas.

```json
{
  "version": 1,
  "projects": "~/.config/opencode/projects",
  "containers": ["~/repos"],
  "permission": {
    "read": {
      "~/tmp/opencode/*": "allow"
    },
    "edit": {
      "~/tmp/opencode/*": "allow"
    },
    "write": {
      "~/tmp/opencode/*": "allow"
    }
  }
}
```

`~` expands to the user's home directory on Linux, macOS, and Windows. On Windows, `~/.config/opencode` resolves under `%USERPROFILE%`.

### Fields

| Field        | Type     | Required | Default             | Description                                                                                               |
| ------------ | -------- | -------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| `version`    | integer  | Yes      | None                | Manifest schema version. Must be `1`.                                                                     |
| `projects`   | string   | No       | `<config>/projects` | Root directory for central project directories. Supports `~` expansion.                                   |
| `containers` | string[] | No       | `[]`                | Checkout roots used for project discovery. Discovery does nothing when this list is empty.                |
| `permission` | object   | No       | None                | Global permission defaults. Global OpenCode configuration and project configuration override these rules. |

## Project discovery

The plugin canonicalizes the current working directory and compares it with every project path under every container. The longest matching project path wins.

```text
container: ~/repos
project:   my-app
cwd:       ~/repos/my-app/packages/api
match:     my-app
```

If no project matches, the plugin does not apply project configuration.

## Central project files

Each project directory can contain:

- `AGENTS.md`
- `opencode.json` or `opencode.jsonc`
- `.opencode/opencode.json` or `.opencode/opencode.jsonc`
- `.opencode/agent/` or `.opencode/agents/`
- `.opencode/command/` or `.opencode/commands/`
- `.opencode/mode/` or `.opencode/modes/`
- `.opencode/skill/` or `.opencode/skills/` with `SKILL.md`

Agent and command files use Markdown with YAML front matter. Mode files become primary agents. Skills use the directory form with `SKILL.md`. OpenCode 1.x does not discover flat skill Markdown files.

## Permissions

### Global defaults and project overrides

Permissions in `router.json` are defaults. Project configuration overrides them. The merge order is:

1. Global `router.json` permission defaults.
2. Global OpenCode configuration.
3. Project `opencode.json` or `opencode.jsonc`.
4. Project `.opencode/opencode.json` or `.opencode/opencode.jsonc`.

### Path relativization

OpenCode 1.x evaluates permission paths against project-relative paths. The plugin converts absolute and home-relative paths for these actions:

- `read`
- `edit`
- `write`

The plugin expands `~` and `$HOME`, computes the path relative to the project directory, and replaces `**` with `*`.

Example on Linux and macOS:

```json
{
  "permission": {
    "edit": {
      "/tmp/opencode/*": "allow"
    }
  }
}
```

Example on Windows:

```json
{
  "permission": {
    "edit": {
      "C:/tmp/opencode/*": "allow"
    }
  }
}
```

Use forward slashes in JSON. The plugin and OpenCode normalize Windows separators.

### External directory

`permission.external_directory` controls access to external paths. These patterns remain absolute. The plugin expands `~` and `$HOME`, but does not relativize the pattern.

```json
{
  "permission": {
    "external_directory": {
      "~/shared/*": "allow"
    }
  }
}
```

The manifest `router.json` does not have an `external_directory` key. Configure this rule in the global OpenCode configuration or in a project configuration file.

### Wildcards

`*` matches any character, including `/`. The plugin converts `**` to `*` during relativization. Use `*` in new rules.

### Project override example

In `<config>/projects/my-app/opencode.json`:

```jsonc
{
  "permission": {
    "edit": {
      "~/tmp/opencode/*": "deny",
      "~/my-scratch/*": "allow"
    }
  }
}
```

This project denies the global allow for `~/tmp/opencode/` and allows `~/my-scratch/`.

## Platform notes

- Linux, macOS, and Windows are supported.
- Use forward slashes in JSON paths on every platform.
- `~` expands to the current user's home directory.
- Windows drive paths such as `C:/tmp/opencode/*` are supported.
- The global configuration directory is `~/.config/opencode` on Linux and macOS, and `%USERPROFILE%\.config\opencode` on Windows.
- If `XDG_CONFIG_HOME` is set, the global configuration directory is `$XDG_CONFIG_HOME/opencode`.

## Troubleshooting

### Plugin does not load

Check:

1. `router.ts` exists in the plugin directory.
2. The plugin path in `opencode.json` or `opencode.jsonc` is correct.
3. The `yaml` package is installed in the global configuration directory.
4. OpenCode was restarted.
5. The OpenCode log contains a `[router]` diagnostic.

### Project not found

Check:

1. The current directory is under a configured container.
2. The project directory exists under the projects root.
3. The project directory name matches the checkout directory name.
4. Container paths in `router.json` are correct.
5. Windows paths use a drive letter and forward slashes.

### Permissions not applied

Check:

1. The manifest `version` is `1`.
2. The rule is under `permission.read`, `permission.edit`, or `permission.write`.
3. External directory rules are under `permission.external_directory`.
4. No project-level `deny` overrides the global allow rule.
5. OpenCode was restarted after the manifest change.

### Manifest JSON errors

The manifest must be valid JSON. Check:

1. All strings use double quotes.
2. All braces and brackets are closed.
3. There are no comments or trailing commas.
4. The file is named `router.json`.

Project `opencode.jsonc` files may contain comments and trailing commas.

### Permission denied despite an allow rule

Check:

1. The rule uses the correct action: `read`, `edit`, or `write`.
2. The path pattern matches the target file.
3. The relativized pattern is correct for the project directory.
4. No project-level `deny` overrides the rule.
5. OpenCode was restarted.

## Limitations

- Supports OpenCode 1.x only. The manifest version must be `1`.
- Requires the `yaml` package.
- The manifest must be valid JSON.
- `external_directory` patterns remain absolute.
- `*` matches across `/`. The plugin converts `**` to `*`.
- Skills use the `SKILL.md` directory form. Flat skill Markdown files are not supported by OpenCode 1.x.
- `AGENTS.md` is read when the plugin loads. The plugin does not watch for changes.

## Security

- Global permissions apply to every matched project. Use `allow` rules sparingly.
- Project-level `deny` rules override global `allow` rules. Use them for sensitive projects.
- External directory rules grant reference access, not write access.
- Audit `router.json` periodically for unintended permissions.
- Do not commit credentials, tokens, or private project data.
- Report vulnerabilities according to [SECURITY.md](../SECURITY.md).

## Support

Report issues at [github.com/balinomad/opencode-project-router/issues](https://github.com/balinomad/opencode-project-router/issues).
