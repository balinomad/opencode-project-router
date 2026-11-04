import { parseModelReference } from "../project"
import {
	isRecord,
	type AgentEditor,
	type DiagnosticSink,
	type LoadedAgent,
	type MutableAgentDraft,
	type PermissionRule,
} from "../types"

function isAgentMode(value: unknown): value is "primary" | "subagent" | "all" {
	return value === "primary" || value === "subagent" || value === "all"
}

function normalizePermissionRules(value: unknown): PermissionRule[] | undefined {
	if (!Array.isArray(value)) return undefined
	const rules: PermissionRule[] = []
	for (const item of value) {
		if (!isRecord(item)) continue
		const action = typeof item.action === "string" ? item.action : undefined
		const resource = typeof item.resource === "string" ? item.resource : undefined
		const effect = item.effect
		if (
			!action ||
			!resource ||
			(effect !== "allow" && effect !== "deny" && effect !== "ask")
		) {
			continue
		}
		rules.push({ action, resource, effect })
	}
	return rules
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined
	const result: Record<string, string> = {}
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "string") result[key] = item
	}
	return result
}

export function applyAgent(
	editor: AgentEditor,
	source: LoadedAgent,
	diagnostics: DiagnosticSink,
): void {
	const frontmatter = source.frontmatter
	if (frontmatter.disabled === true) {
		editor.remove(source.id)
		return
	}

	const existingAgent = editor.get(source.id)
	editor.update(source.id, (agent) => {
		// OpenCode brands IDs and model fields in its types, but the editor applies plain runtime values.
		const draft = agent as unknown as MutableAgentDraft

		if (typeof frontmatter.name === "string" && frontmatter.name.trim()) {
			draft.name = frontmatter.name
		}
		if (typeof frontmatter.description === "string") {
			draft.description = frontmatter.description
		}
		if (source.fromModesDirectory) {
			draft.mode = "primary"
		} else if (isAgentMode(frontmatter.mode)) {
			draft.mode = frontmatter.mode
		}
		if (typeof frontmatter.hidden === "boolean") {
			draft.hidden = frontmatter.hidden
		}
		if (typeof frontmatter.color === "string") {
			draft.color = frontmatter.color
		}
		if (
			typeof frontmatter.steps === "number" &&
			Number.isInteger(frontmatter.steps) &&
			frontmatter.steps > 0
		) {
			draft.steps = frontmatter.steps
		}

		const model = parseModelReference(frontmatter.model)
		if (model) draft.model = model

		if (isRecord(frontmatter.request)) {
			draft.request = {
				settings: {
					...(isRecord(draft.request?.settings) ? draft.request.settings : {}),
					...(isRecord(frontmatter.request.settings)
						? frontmatter.request.settings
						: {}),
				},
				headers: {
					...(draft.request?.headers ?? {}),
					...(stringRecord(frontmatter.request.headers) ?? {}),
				},
				body: {
					...(isRecord(draft.request?.body) ? draft.request.body : {}),
					...(isRecord(frontmatter.request.body) ? frontmatter.request.body : {}),
				},
			}
		}

		const permissionRules = normalizePermissionRules(frontmatter.permissions)
		if (permissionRules) {
			if (existingAgent) {
				draft.permissions ??= []
				draft.permissions.push(...permissionRules)
			} else {
				draft.permissions = permissionRules
			}
		} else if (!existingAgent) {
			draft.permissions = []
		}

		const systemPrompt = source.body.trim()
		if (systemPrompt) draft.system = systemPrompt
	})

	if (frontmatter.mode !== undefined && !isAgentMode(frontmatter.mode)) {
		diagnostics.add(
			`agent ${source.id} has invalid mode ${String(frontmatter.mode)}`,
		)
	}
}
