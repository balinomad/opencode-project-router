import { parseModelReference } from "../project"
import {
	isRecord,
	type AgentDraft,
	type AgentEditor,
	type DiagnosticSink,
	type LoadedAgent,
	type ModelReference,
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
		// Config holds plain strings; the editor types brand agent and model IDs.
		if (typeof frontmatter.name === "string" && frontmatter.name.trim()) {
			agent.name = frontmatter.name as AgentDraft["name"]
		}
		if (typeof frontmatter.description === "string") {
			agent.description = frontmatter.description
		}
		if (source.fromModesDirectory) {
			agent.mode = "primary"
		} else if (isAgentMode(frontmatter.mode)) {
			agent.mode = frontmatter.mode
		}
		if (typeof frontmatter.hidden === "boolean") {
			agent.hidden = frontmatter.hidden
		}
		if (typeof frontmatter.color === "string") {
			agent.color = frontmatter.color
		}
		if (
			typeof frontmatter.steps === "number" &&
			Number.isInteger(frontmatter.steps) &&
			frontmatter.steps > 0
		) {
			agent.steps = frontmatter.steps
		}

		const model = parseModelReference(frontmatter.model)
		if (model) agent.model = model as ModelReference

		if (isRecord(frontmatter.request)) {
			agent.request = {
				settings: {
					...(isRecord(agent.request?.settings) ? agent.request.settings : {}),
					...(isRecord(frontmatter.request.settings)
						? frontmatter.request.settings
						: {}),
				},
				headers: {
					...(agent.request?.headers ?? {}),
					...(stringRecord(frontmatter.request.headers) ?? {}),
				},
				body: {
					...(isRecord(agent.request?.body) ? agent.request.body : {}),
					...(isRecord(frontmatter.request.body) ? frontmatter.request.body : {}),
				},
			}
		}

		const permissionRules = normalizePermissionRules(frontmatter.permissions)
		if (permissionRules) {
			if (existingAgent) {
				agent.permissions ??= []
				agent.permissions.push(...permissionRules)
			} else {
				agent.permissions = permissionRules
			}
		} else if (!existingAgent) {
			agent.permissions = []
		}

		const systemPrompt = source.body.trim()
		if (systemPrompt) agent.system = systemPrompt
	})

	if (frontmatter.mode !== undefined && !isAgentMode(frontmatter.mode)) {
		diagnostics.add(
			`agent ${source.id} has invalid mode ${String(frontmatter.mode)}`,
		)
	}
}
