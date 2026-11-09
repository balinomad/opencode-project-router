import type { Agent, Plugin } from "@opencode/plugin"
import type { AgentEditor } from "@opencode/plugin/promise/agent"
import type {
	CommandDefinition,
	CommandEditor,
} from "@opencode/plugin/promise/command"
import type { ReferenceEditor } from "@opencode/plugin/promise/reference"
import type { SkillEditor } from "@opencode/plugin/promise/skill"

export type ConfigRecord = Record<string, unknown>

export function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type DiagnosticSink = {
	add(message: string): void
}

export type RouterManifest = {
	version?: number
	projects?: string
	containers?: string[]
	references?: ConfigRecord
}

export type LoadedManifest = RouterManifest & {
	projectsRoot: string
}

export type ProjectMatch = {
	projectDir: string
}

export type MarkdownDocument = {
	frontmatter: ConfigRecord
	body: string
}

export type ParsedModelReference = {
	providerID: string
	id: string
	variant?: string
}

export type LoadedAgent = {
	id: string
	fromModesDirectory: boolean
	frontmatter: ConfigRecord
	body: string
}

export type LoadedCommand = {
	name: string
	frontmatter: ConfigRecord
	template: string
}

export type LoadedSkill = {
	id: string
	name: string
	description?: string
	autoinvoke?: boolean
	path: string
	content: string
}

export type LoadedProject = {
	projectDir: string
	agentsText?: string
	agents: LoadedAgent[]
	commands: LoadedCommand[]
	skills: LoadedSkill[]
	references: ConfigRecord
}

export type PluginContext = Plugin.Context
export type {
	AgentEditor,
	CommandDefinition,
	CommandEditor,
	ReferenceEditor,
	SkillEditor,
}

export type AgentDraft = Parameters<Parameters<AgentEditor["update"]>[1]>[0]
export type PermissionRule = AgentDraft["permissions"][number]
export type ModelReference = NonNullable<AgentDraft["model"]>
export type SkillInfo = Parameters<SkillEditor["add"]>[0]
export type ReferenceSource = Parameters<ReferenceEditor["add"]>[1]
export type AgentId = Agent.ID
