import {
	containsShellBlock,
	expandCommandTemplate,
	parseModelReference,
} from "../project"
import type {
	AgentId,
	CommandDefinition,
	CommandEditor,
	DiagnosticSink,
	LoadedCommand,
	ModelReference,
	PluginContext,
} from "../types"

export function applyCommand(
	editor: CommandEditor,
	source: LoadedCommand,
	context: PluginContext,
	diagnostics: DiagnosticSink,
): void {
	const frontmatter = source.frontmatter
	if (frontmatter.subagent === true || frontmatter.subtask === true) {
		diagnostics.add(
			`command ${source.name} skipped: subagent commands are not supported`,
		)
		return
	}
	if (containsShellBlock(source.template)) {
		diagnostics.add(
			`command ${source.name} skipped: shell blocks are not supported`,
		)
		return
	}

	const description =
		typeof frontmatter.description === "string"
			? frontmatter.description
			: undefined
	const agent = typeof frontmatter.agent === "string" ? frontmatter.agent : undefined
	const model = parseModelReference(frontmatter.model)

	const definition: CommandDefinition = {
		name: source.name,
		...(description !== undefined ? { description } : {}),
		execute: async (invocation) => {
			const text = expandCommandTemplate(source.template, invocation.prompt.text)
			if (agent) {
				// OpenCode brands agent IDs in its types, but session switching accepts plain runtime values.
				await context.session.switchAgent({
					sessionID: invocation.sessionID,
					agent: agent as AgentId,
				})
			}
			if (model) {
				// OpenCode brands model IDs in its types, but session switching accepts plain runtime values.
				await context.session.switchModel({
					sessionID: invocation.sessionID,
					model: model as ModelReference,
				})
			}
			await context.session.prompt({
				...invocation.prompt,
				sessionID: invocation.sessionID,
				text,
				delivery: invocation.delivery,
			})
		},
	}

	editor.add(definition)
}
