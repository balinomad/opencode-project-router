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
	let result = template
	if (result.includes("$ARGUMENTS")) {
		result = result.replaceAll("$ARGUMENTS", () => value)
	}
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

export async function loadProject(
	projectDir: string,
	diagnostics: DiagnosticSink,
): Promise<LoadedProject> {
	const agentsText =
		(await readTextFile(join(projectDir, "AGENTS.md"), diagnostics))?.trim() ||
		undefined
	const opencodeDir = join(projectDir, ".opencode")
	const files = await collectFiles(opencodeDir, diagnostics)
	const agents: LoadedAgent[] = []
	const commands: LoadedCommand[] = []
	const skills: LoadedSkill[] = []

	for (const filePath of files) {
		const relativePath = relative(opencodeDir, filePath).split("\\").join("/")
		const isAgentFile = /^agents?\/.+\.md$/.test(relativePath)
		const isModeFile = /^modes?\/[^/]+\.md$/.test(relativePath)
		const isCommandFile = /^commands?\/.+\.md$/.test(relativePath)
		const isNestedSkillFile = /^skills?\/.+\/SKILL\.md$/.test(relativePath)
		const isFlatSkillFile = /^skills?\/[^/]+\.md$/.test(relativePath)
		if (
			!isAgentFile &&
			!isModeFile &&
			!isCommandFile &&
			!isNestedSkillFile &&
			!isFlatSkillFile
		) {
			continue
		}

		const fileText = await readTextFile(filePath, diagnostics)
		if (fileText === undefined) continue

		if (isAgentFile) {
			const { frontmatter, body } = parseMarkdownDocument(
				fileText,
				filePath,
				diagnostics,
			)
			agents.push({
				id: stripPrefixAndExtension(relativePath, ["agent/", "agents/"]),
				fromModesDirectory: false,
				frontmatter,
				body,
			})
		} else if (isModeFile) {
			const { frontmatter, body } = parseMarkdownDocument(
				fileText,
				filePath,
				diagnostics,
			)
			agents.push({
				id: stripPrefixAndExtension(relativePath, ["mode/", "modes/"]),
				fromModesDirectory: true,
				frontmatter,
				body,
			})
		} else if (isCommandFile) {
			const { frontmatter, body } = parseMarkdownDocument(
				fileText,
				filePath,
				diagnostics,
			)
			commands.push({
				name: stripPrefixAndExtension(relativePath, ["command/", "commands/"]),
				frontmatter,
				template: body.trim(),
			})
		} else if (isNestedSkillFile) {
			skills.push(
				parseSkill(
					basename(dirname(filePath)),
					filePath,
					fileText,
					diagnostics,
				),
			)
		} else if (isFlatSkillFile) {
			skills.push(
				parseSkill(
					stripFileExtension(basename(filePath)),
					filePath,
					fileText,
					diagnostics,
				),
			)
		}
	}

	return {
		projectDir,
		...(agentsText !== undefined ? { agentsText } : {}),
		agents,
		commands,
		skills,
		references: await loadReferences(projectDir, diagnostics),
	}
}
