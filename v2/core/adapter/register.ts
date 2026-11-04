import { resolvePathFrom } from "../config"
import {
	isRecord,
	type ConfigRecord,
	type DiagnosticSink,
	type LoadedProject,
	type LoadedSkill,
	type PluginContext,
	type ReferenceEditor,
	type ReferenceSource,
	type SkillEditor,
	type SkillInfo,
} from "../types"
import { applyAgent } from "./agent"
import { applyCommand } from "./command"

type LoadedReferenceSource =
	| {
			type: "local"
			path: string
			description?: string
			hidden?: boolean
	  }
	| {
			type: "git"
			repository: string
			branch?: string
			description?: string
			hidden?: boolean
	  }

function applySkill(editor: SkillEditor, source: LoadedSkill): void {
	// OpenCode brands skill IDs and paths in its types, but the editor accepts plain runtime values.
	editor.add(source as SkillInfo)
}

function toReferenceSource(
	entryName: string,
	entry: unknown,
	projectDir: string,
	diagnostics: DiagnosticSink,
): LoadedReferenceSource | undefined {
	if (typeof entry === "string") {
		if (
			entry.startsWith(".") ||
			entry.startsWith("/") ||
			entry.startsWith("~") ||
			/^[A-Za-z]:[\\/]/.test(entry)
		) {
			return { type: "local", path: resolvePathFrom(projectDir, entry) }
		}
		return { type: "git", repository: entry }
	}

	if (!isRecord(entry)) {
		diagnostics.add(
			`reference ${entryName} skipped: expected a string or object`,
		)
		return undefined
	}

	const description =
		typeof entry.description === "string" ? entry.description : undefined
	const hidden = typeof entry.hidden === "boolean" ? entry.hidden : undefined
	const optionalFields = {
		...(description !== undefined ? { description } : {}),
		...(hidden !== undefined ? { hidden } : {}),
	}

	if (typeof entry.path === "string") {
		return {
			type: "local",
			path: resolvePathFrom(projectDir, entry.path),
			...optionalFields,
		}
	}
	if (typeof entry.repository === "string") {
		const branch = typeof entry.branch === "string" ? entry.branch : undefined
		return {
			type: "git",
			repository: entry.repository,
			...(branch ? { branch } : {}),
			...optionalFields,
		}
	}

	diagnostics.add(`reference ${entryName} skipped: missing path or repository`)
	return undefined
}

function applyReferences(
	editor: ReferenceEditor,
	entries: ConfigRecord,
	projectDir: string,
	diagnostics: DiagnosticSink,
): void {
	for (const [entryName, entry] of Object.entries(entries)) {
		const source = toReferenceSource(entryName, entry, projectDir, diagnostics)
		if (!source) continue
		// OpenCode brands absolute paths in its types, but the editor accepts plain runtime values.
		editor.add(entryName, source as ReferenceSource)
	}
}

export async function registerProject(
	context: PluginContext,
	project: LoadedProject,
	manifestReferenceDefaults: ConfigRecord | undefined,
	diagnostics: DiagnosticSink,
): Promise<void> {
	if (project.agentsText) {
		const text = project.agentsText
		await context.session.hook("context", (event) => {
			event.system.push({ type: "text", text })
		})
	}

	if (project.agents.length > 0) {
		await context.agent.transform((editor) => {
			for (const source of project.agents) {
				applyAgent(editor, source, diagnostics)
			}
		})
	}

	if (project.commands.length > 0) {
		await context.command.transform((editor) => {
			for (const source of project.commands) {
				applyCommand(editor, source, context, diagnostics)
			}
		})
	}

	if (project.skills.length > 0) {
		await context.skill.transform((editor) => {
			for (const source of project.skills) {
				applySkill(editor, source)
			}
		})
	}

	const referenceEntries = {
		...(manifestReferenceDefaults ?? {}),
		...project.references,
	}
	if (Object.keys(referenceEntries).length > 0) {
		await context.reference.transform((editor) => {
			applyReferences(editor, referenceEntries, project.projectDir, diagnostics)
		})
	}
}
