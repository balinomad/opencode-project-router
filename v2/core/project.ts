import { readdir } from "node:fs/promises"
import { basename, dirname, extname, join, relative } from "node:path"
import { parse as parseYaml } from "yaml"
import { formatError, isMissingFileError, readTextFile } from "./config"
import {
	isRecord,
	type ConfigRecord,
	type DiagnosticSink,
	type LoadedAgent,
	type LoadedCommand,
	type LoadedProject,
	type LoadedSkill,
	type MarkdownDocument,
	type ParsedModelReference,
} from "./types"

function stripFileExtension(path: string): string {
	const extension = extname(path)
	return extension ? path.slice(0, -extension.length) : path
}

function stripPrefixAndExtension(
	relativePath: string,
	prefixes: string[],
): string {
	for (const prefix of prefixes) {
		if (relativePath.startsWith(prefix)) {
			return stripFileExtension(relativePath.slice(prefix.length))
		}
	}
	return stripFileExtension(relativePath)
}

function parseMarkdownDocument(
	text: string,
	filePath: string,
	diagnostics: DiagnosticSink,
): MarkdownDocument {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
	if (!match) return { frontmatter: {}, body: text }

	let frontmatter: ConfigRecord = {}
	try {
		const parsed: unknown = parseYaml(match[1])
		if (isRecord(parsed)) {
			frontmatter = parsed
		} else if (parsed !== undefined && parsed !== null) {
			diagnostics.add(`expected a YAML object in ${filePath}`)
		}
	} catch (error) {
		diagnostics.add(
			`invalid front matter in ${filePath}: ${formatError(error)}`,
		)
	}

	return { frontmatter, body: text.slice(match[0].length) }
}

export function parseModelReference(value: unknown): ParsedModelReference | undefined {
	if (typeof value === "string") {
		const [reference, ...variantParts] = value.split("#")
		const slash = reference.indexOf("/")
		if (slash <= 0 || slash === reference.length - 1) return undefined
		const variant = variantParts.join("#")
		return {
			providerID: reference.slice(0, slash),
			id: reference.slice(slash + 1),
			...(variant ? { variant } : {}),
		}
	}

	if (!isRecord(value)) return undefined
	const providerID =
		typeof value.providerID === "string" ? value.providerID : undefined
	const id =
		typeof value.id === "string"
			? value.id
			: typeof value.model === "string"
				? value.model
				: undefined
	if (!providerID || !id) return undefined
	const variant = typeof value.variant === "string" ? value.variant : undefined
	return { providerID, id, ...(variant ? { variant } : {}) }
}

function parseCommandArguments(input: string): string[] {
	const matches = input.match(/(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi) ?? []
	return matches.map((argument) => argument.replace(/^["']|["']$/g, ""))
}

export function expandCommandTemplate(template: string, input: string): string {
	const value = input.trim()
	let result = template.replaceAll("$ARGUMENTS", () => value)
	const args = parseCommandArguments(value)
	result = result.replace(
		/\$(\d+)/g,
		(_match, index: string) => args[Number(index) - 1] ?? "",
	)
	if (!template.includes("$ARGUMENTS") && !/\$\d+/.test(template)) {
		return [result, value].filter(Boolean).join("\n\n")
	}
	return result
}

export function containsShellBlock(template: string): boolean {
	return new RegExp("!`[\\s\\S]*?`").test(template)
}

function parseSkill(
	skillId: string,
	filePath: string,
	text: string,
	diagnostics: DiagnosticSink,
): LoadedSkill {
	const { frontmatter, body } = parseMarkdownDocument(
		text,
		filePath,
		diagnostics,
	)
	const name =
		typeof frontmatter.name === "string" && frontmatter.name.trim()
			? frontmatter.name
			: skillId
	const description =
		typeof frontmatter.description === "string"
			? frontmatter.description
			: undefined
	const metadata = isRecord(frontmatter.metadata)
		? frontmatter.metadata
		: undefined
	const metadataAutoinvoke = metadata?.["opencode/autoinvoke"]
	const disableModelInvocation = frontmatter["disable-model-invocation"]
	const autoinvoke =
		typeof metadataAutoinvoke === "boolean"
			? metadataAutoinvoke
			: typeof disableModelInvocation === "boolean"
				? !disableModelInvocation
				: undefined

	return {
		id: skillId,
		name,
		...(description !== undefined ? { description } : {}),
		...(autoinvoke !== undefined ? { autoinvoke } : {}),
		path: filePath,
		content: body.trim(),
	}
}

async function collectFiles(
	directory: string,
	diagnostics: DiagnosticSink,
	files: string[] = [],
): Promise<string[]> {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch (error) {
		if (!isMissingFileError(error)) {
			diagnostics.add(`cannot read ${directory}: ${formatError(error)}`)
		}
		return files
	}

	for (const entry of entries) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) {
			await collectFiles(path, diagnostics, files)
		} else if (entry.isFile()) {
			files.push(path)
		}
	}
	return files
}

async function loadReferences(
	projectDir: string,
	diagnostics: DiagnosticSink,
): Promise<ConfigRecord> {
	const path = join(projectDir, "references.json")
	const text = await readTextFile(path, diagnostics)
	if (text === undefined) return {}

	try {
		const parsed: unknown = JSON.parse(text)
		if (isRecord(parsed)) return parsed
		diagnostics.add(`expected a JSON object in ${path}`)
	} catch (error) {
		diagnostics.add(`invalid JSON in ${path}: ${formatError(error)}`)
	}
	return {}
}

type ProjectFileKind = "agent" | "mode" | "command" | "nestedSkill" | "flatSkill"

const PROJECT_FILE_PATTERNS: ReadonlyArray<
	readonly [ProjectFileKind, RegExp]
> = [
	["agent", /^agents?\/.+\.md$/],
	["mode", /^modes?\/[^/]+\.md$/],
	["command", /^commands?\/.+\.md$/],
	["nestedSkill", /^skills?\/.+\/SKILL\.md$/],
	["flatSkill", /^skills?\/[^/]+\.md$/],
]

function classifyProjectFile(relativePath: string): ProjectFileKind | undefined {
	for (const [kind, pattern] of PROJECT_FILE_PATTERNS) {
		if (pattern.test(relativePath)) return kind
	}
	return undefined
}

type ProjectFile = {
	kind: ProjectFileKind
	filePath: string
	relativePath: string
	fileText: string
}

function addProjectFile(
	project: Pick<LoadedProject, "agents" | "commands" | "skills">,
	file: ProjectFile,
	diagnostics: DiagnosticSink,
): void {
	const { kind, filePath, relativePath, fileText } = file
	if (kind === "command") {
		const { frontmatter, body } = parseMarkdownDocument(
			fileText,
			filePath,
			diagnostics,
		)
		project.commands.push({
			name: stripPrefixAndExtension(relativePath, ["command/", "commands/"]),
			frontmatter,
			template: body.trim(),
		})
		return
	}

	if (kind === "agent" || kind === "mode") {
		const { frontmatter, body } = parseMarkdownDocument(
			fileText,
			filePath,
			diagnostics,
		)
		project.agents.push({
			id: stripPrefixAndExtension(
				relativePath,
				kind === "mode" ? ["mode/", "modes/"] : ["agent/", "agents/"],
			),
			fromModesDirectory: kind === "mode",
			frontmatter,
			body,
		})
		return
	}

	const skillId =
		kind === "nestedSkill"
			? basename(dirname(filePath))
			: stripFileExtension(basename(filePath))
	project.skills.push(parseSkill(skillId, filePath, fileText, diagnostics))
}

export async function loadProject(
	projectDir: string,
	diagnostics: DiagnosticSink,
): Promise<LoadedProject> {
	const agentsText =
		(await readTextFile(join(projectDir, "AGENTS.md"), diagnostics))?.trim() ||
		undefined
	const opencodeDir = join(projectDir, ".opencode")
	const files = await collectFiles(opencodeDir, diagnostics)
	const collections = {
		agents: [] as LoadedAgent[],
		commands: [] as LoadedCommand[],
		skills: [] as LoadedSkill[],
	}

	for (const filePath of files) {
		const relativePath = relative(opencodeDir, filePath).split("\\").join("/")
		const kind = classifyProjectFile(relativePath)
		if (!kind) continue
		const fileText = await readTextFile(filePath, diagnostics)
		if (fileText === undefined) continue
		addProjectFile(
			collections,
			{ kind, filePath, relativePath, fileText },
			diagnostics,
		)
	}

	return {
		projectDir,
		...(agentsText !== undefined ? { agentsText } : {}),
		...collections,
		references: await loadReferences(projectDir, diagnostics),
	}
}
