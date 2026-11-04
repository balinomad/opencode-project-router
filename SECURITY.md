# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `v2/`   | Yes       |
| `v1/`   | Yes       |

Both plugins are maintained in this repository. The v1 plugin is for OpenCode 1.x. The v2 plugin is for OpenCode 2.x.

## Reporting a vulnerability

Do not open a public issue for a security vulnerability.

Report the issue through GitHub Security Advisories:

[https://github.com/balinomad/opencode-project-router/security/advisories/new](https://github.com/balinomad/opencode-project-router/security/advisories/new)

Include:

- The affected plugin version, `v1` or `v2`.
- The OpenCode version.
- The operating system.
- A minimal reproduction.
- The impact.
- Any suggested fix.

Remove credentials, tokens, personal paths, and private project data from the report.

## Scope

Security-sensitive areas include:

- Permission path handling in the v1 plugin.
- Project discovery and path containment checks.
- Command registration in the v2 plugin.
- Reference path resolution.
- Manifest and project file parsing.

The plugins do not execute shell commands. The v2 plugin skips commands that contain shell blocks or request subagent execution.

## Response

Reports are reviewed on a best-effort basis. There is no guaranteed response time or fix deadline.

## Safe configuration

- Review `router.json` and central project files before use.
- Use `allow` permission rules sparingly.
- Keep the central projects root outside repositories that other users can modify.
- Do not commit credentials or private project data.
