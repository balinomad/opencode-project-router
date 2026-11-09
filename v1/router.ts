import type { Config, Hooks, PluginInput, PluginModule } from "@opencode-ai/plugin"
import { constants } from "node:fs"
import { access, readFile, readdir, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

const MANIFEST_PATH = fileURLToPath(new URL("router.json", import.meta.url))
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME
const CONFIG_HOME =
	XDG_CONFIG_HOME && isAbsolute(XDG_CONFIG_HOME)
		? XDG_CONFIG_HOME
		: join(homedir(), ".config")
const DEFAULT_PROJECTS_ROOT = join(CONFIG_HOME, "opencode", "projects")
const MANIFEST_VERSION = 1

type ConfigRecord = Record<string, unknown>

type RouterManifest = {
	version?: number
	projects?: string
	containers?: string[]
	permission?: ConfigRecord
}

type LoadedManifest = RouterManifest & {
	projectsRoot: string
}

type DiagnosticSink = {
	add(message: string): void
}

type ProjectMatch = {
	projectDir: string
}

type MarkdownDocument = {
	frontmatter: ConfigRecord
	body: string
}

const AGENT_FIELDS = new Set([
	"name",
	"model",
	"variant",
	"description",
	"mode",
	"hidden",
	"color",
	"steps",
	"options",
	"permission",
	"disable",
	"temperature",
	"top_p",
])

const COMMAND_FIELDS = new Set([
	"description",
	"agent",
	"model",
	"variant",
	"subtask",
])

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT"
}

function isNotDirectoryError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOTDIR"
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function parseStringArray(
	value: unknown,
	field: string,
	diagnostics: DiagnosticSink,
): string[] | undefined {
	if (value === undefined) return undefined
	if (!Array.isArray(value)) {
		diagnostics.add(`router manifest field ${field} must be an array of strings`)
		return undefined
	}
	const result: string[] = []
	for (const item of value) {
		if (typeof item === "string") {
			result.push(item)
		} else {
			diagnostics.add(
				`router manifest field ${field} contains a non-string entry`,
			)
		}
	}
	return result
}

function expandHomePath(path: string): string {
	return path
		.replace(/^~(?=$|[\\/])/, homedir())
		.replace(/\$\{?HOME\}?/g, homedir())
}

async function canonicalizePath(
	path: string,
	diagnostics: DiagnosticSink,
): Promise<string> {
	try {
		return await realpath(path)
	} catch (error) {
		if (!isMissingFileError(error) && !isNotDirectoryError(error)) {
			diagnostics.add(`cannot resolve ${path}: ${formatError(error)}`)
		}
		return resolve(path)
	}
}

function isPathInside(parentPath: string, childPath: string): boolean {
	const relativePath = relative(parentPath, childPath)
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	)
}

async function readTextFile(
	path: string,
	diagnostics: DiagnosticSink,
): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8")
	} catch (error) {
		if (!isMissingFileError(error)) {
			diagnostics.add(`cannot read ${path}: ${formatError(error)}`)
		}
		return undefined
	}
}

async function fileExists(
	path: string,
	diagnostics: DiagnosticSink,
): Promise<boolean> {
	try {
		const info = await stat(path)
		if (!info.isFile()) {
			diagnostics.add(`cannot read ${path}: not a regular file`)
			return false
		}
		await access(path, constants.R_OK)
		return true
	} catch (error) {
		if (!isMissingFileError(error)) {
			diagnostics.add(`cannot read ${path}: ${formatError(error)}`)
		}
		return false
	}
}

function skipComment(text: string, index: number): number | undefined {
	if (text[index] !== "/") return undefined
	const next = text[index + 1]
	if (next === "/") {
		let position = index
		while (position < text.length && text[position] !== "\n") position++
		return position
	}
	if (next === "*") {
		let position = index + 2
		while (
			position < text.length &&
			!(text[position] === "*" && text[position + 1] === "/")
		) {
			position++
		}
		return position + 2
	}
	return undefined
}

function parseJsonc(
	text: string,
	path: string,
	diagnostics: DiagnosticSink,
): ConfigRecord | undefined {
	const output: string[] = []
	let inString = false
	let index = 0

	const peekSignificant = (from: number): string | undefined => {
		let position = from
		while (position < text.length) {
			const current = text[position]
			if (
				current === " " ||
				current === "\t" ||
				current === "\n" ||
				current === "\r"
			) {
				position++
				continue
			}
			const commentEnd = skipComment(text, position)
			if (commentEnd !== undefined) {
				position = commentEnd
				continue
			}
			return current
		}
		return undefined
	}

	while (index < text.length) {
		const current = text[index]
		const next = text[index + 1]
		if (inString) {
			output.push(current)
			if (current === "\\") {
				output.push(next ?? "")
				index += 2
				continue
			}
			if (current === '"') inString = false
			index++
			continue
		}
		if (current === '"') {
			inString = true
			output.push(current)
			index++
			continue
		}
		const commentEnd = skipComment(text, index)
		if (commentEnd !== undefined) {
			index = commentEnd
			continue
		}
		if (current === ",") {
			const significant = peekSignificant(index + 1)
			if (significant === "}" || significant === "]") {
				index++
				continue
			}
		}
		output.push(current)
		index++
	}

	try {
		const value: unknown = JSON.parse(output.join(""))
		if (isRecord(value)) return value
		diagnostics.add(`expected a JSON object in ${path}`)
		return undefined
	} catch (error) {
		diagnostics.add(`invalid JSON/JSONC in ${path}: ${formatError(error)}`)
		return undefined
	}
}

async function loadConfigFile(
	path: string,
	diagnostics: DiagnosticSink,
): Promise<ConfigRecord | undefined> {
	const text = await readTextFile(path, diagnostics)
	return text === undefined ? undefined : parseJsonc(text, path, diagnostics)
}

function parseMarkdownDocument(
	text: string,
	path: string,
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
			diagnostics.add(`expected a YAML object in ${path}`)
		}
	} catch (error) {
		diagnostics.add(`invalid front matter in ${path}: ${formatError(error)}`)
	}

	return { frontmatter, body: text.slice(match[0].length) }
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

function mergeValues(base: unknown, value: unknown): unknown {
	if (Array.isArray(base) || Array.isArray(value)) return value
	if (isRecord(base) && isRecord(value)) {
		const result: ConfigRecord = { ...base }
		for (const [key, item] of Object.entries(value)) {
			result[key] = key in result ? mergeValues(result[key], item) : item
		}
		return result
	}
	return value
}

function ensureRecord(container: ConfigRecord, key: string): ConfigRecord {
	const current = container[key]
	if (isRecord(current)) return current
	const created: ConfigRecord = {}
	container[key] = created
	return created
}

function ensureArray(container: ConfigRecord, key: string): unknown[] {
	const current = container[key]
	if (Array.isArray(current)) return current
	const created: unknown[] = []
	container[key] = created
	return created
}

function toAgent(frontmatter: ConfigRecord, systemPrompt: string): ConfigRecord {
	const agent: ConfigRecord = { prompt: systemPrompt }
	const options: ConfigRecord = isRecord(frontmatter.options)
		? { ...frontmatter.options }
		: {}
	for (const [key, value] of Object.entries(frontmatter)) {
		if (key === "options") continue
		if (AGENT_FIELDS.has(key)) {
			agent[key] = value
		} else {
			options[key] = value
		}
	}
	if (Object.keys(options).length > 0) agent.options = options
	return agent
}

function toCommand(frontmatter: ConfigRecord, template: string): ConfigRecord {
	const command: ConfigRecord = { template }
	for (const [key, value] of Object.entries(frontmatter)) {
		if (COMMAND_FIELDS.has(key)) command[key] = value
	}
	return command
}

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

function relativizePermissionPaths(
	config: ConfigRecord,
	projectDir: string,
): void {
	const permission = isRecord(config.permission) ? config.permission : undefined
	if (!permission) return

	for (const action of ["read", "edit", "write"]) {
		const rules = isRecord(permission[action]) ? permission[action] : undefined
		if (!rules) continue

		const normalizedRules: Record<string, string> = {}
		for (const [pattern, ruleEffect] of Object.entries(rules)) {
			if (typeof ruleEffect !== "string") continue
			const expanded = expandHomePath(pattern)
			if (isAbsolute(expanded)) {
				const resolved = resolve(expanded)
				const relativePath = relative(projectDir, resolved).split("\\").join("/")
				normalizedRules[relativePath.replaceAll("**", "*")] = ruleEffect
			} else {
				normalizedRules[pattern] = ruleEffect
			}
		}
		permission[action] = normalizedRules
	}
}

function expandExternalDirectory(config: ConfigRecord): void {
	const permission = isRecord(config.permission) ? config.permission : undefined
	if (!permission) return
	const externalDirectory = isRecord(permission.external_directory)
		? permission.external_directory
		: undefined
	if (!externalDirectory) return

	const normalizedRules: Record<string, string> = {}
	for (const [pattern, ruleEffect] of Object.entries(externalDirectory)) {
		if (typeof ruleEffect !== "string") continue
		normalizedRules[expandHomePath(pattern)] = ruleEffect
	}
	permission.external_directory = normalizedRules
}

function mergeConfigFragment(
	config: ConfigRecord,
	fragment: ConfigRecord,
	configDir: string,
): void {
	if ("instructions" in fragment) {
		const list = Array.isArray(fragment.instructions)
			? fragment.instructions
			: [fragment.instructions]
		const instructions = ensureArray(config, "instructions")
		for (const entry of list) {
			if (typeof entry !== "string") continue
			instructions.push(
				/^https?:\/\//.test(entry)
					? entry
					: resolve(configDir, expandHomePath(entry)),
			)
		}
		delete fragment.instructions
	}
	for (const [key, value] of Object.entries(fragment)) {
		config[key] = key in config ? mergeValues(config[key], value) : value
	}
}

type OpencodeDefinition = {
	collection: "agent" | "command"
	prefixes: string[]
	transform: (frontmatter: ConfigRecord, body: string) => ConfigRecord
}

async function mergeOpencodeDefinition(
	config: ConfigRecord,
	filePath: string,
	relativePath: string,
	diagnostics: DiagnosticSink,
	definition: OpencodeDefinition,
): Promise<void> {
	const fileText = await readTextFile(filePath, diagnostics)
	if (fileText === undefined) return
	const { frontmatter, body } = parseMarkdownDocument(
		fileText,
		filePath,
		diagnostics,
	)
	const name = stripPrefixAndExtension(relativePath, definition.prefixes)
	const records = ensureRecord(config, definition.collection)
	records[name] = mergeValues(
		records[name] ?? {},
		definition.transform(frontmatter, body.trim()),
	)
}

async function applyOpencodeDirectory(
	config: ConfigRecord,
	projectDir: string,
	diagnostics: DiagnosticSink,
): Promise<void> {
	const opencodeDir = join(projectDir, ".opencode")
	const files = await collectFiles(opencodeDir, diagnostics)
	const skillDirectories = new Set<string>()

	for (const filePath of files) {
		const relativePath = relative(opencodeDir, filePath).split("\\").join("/")
		if (/^agents?\/.+\.md$/.test(relativePath)) {
			await mergeOpencodeDefinition(config, filePath, relativePath, diagnostics, {
				collection: "agent",
				prefixes: ["agent/", "agents/"],
				transform: toAgent,
			})
		} else if (/^commands?\/.+\.md$/.test(relativePath)) {
			await mergeOpencodeDefinition(config, filePath, relativePath, diagnostics, {
				collection: "command",
				prefixes: ["command/", "commands/"],
				transform: toCommand,
			})
		} else if (/^modes?\/[^/]+\.md$/.test(relativePath)) {
			await mergeOpencodeDefinition(config, filePath, relativePath, diagnostics, {
				collection: "agent",
				prefixes: ["mode/", "modes/"],
				transform: (frontmatter, body) => ({
					...toAgent(frontmatter, body),
					mode: "primary",
				}),
			})
		} else if (/^skills?\/.+\/SKILL\.md$/.test(relativePath)) {
			skillDirectories.add(dirname(dirname(filePath)))
		}
	}

	if (skillDirectories.size > 0) {
		const paths = Array.from(skillDirectories).sort()
		const skills = ensureRecord(config, "skills")
		const existingPaths = Array.isArray(skills.paths)
			? skills.paths.filter((item): item is string => typeof item === "string")
			: []
		skills.paths = [...existingPaths, ...paths]
	}
}

async function applyProject(
	config: ConfigRecord,
	projectDir: string,
	diagnostics: DiagnosticSink,
	globalPermissions?: ConfigRecord,
): Promise<void> {
	const agentsPath = join(projectDir, "AGENTS.md")
	if (await fileExists(agentsPath, diagnostics)) {
		ensureArray(config, "instructions").push(agentsPath)
	}

	const configFiles = [
		join(projectDir, "opencode.json"),
		join(projectDir, "opencode.jsonc"),
		join(projectDir, ".opencode", "opencode.json"),
		join(projectDir, ".opencode", "opencode.jsonc"),
	]

	for (const filePath of configFiles) {
		const fragment = await loadConfigFile(filePath, diagnostics)
		if (!fragment) continue
		mergeConfigFragment(config, fragment, dirname(filePath))
	}

	if (globalPermissions) {
		config.permission = mergeValues(
			globalPermissions,
			isRecord(config.permission) ? config.permission : {},
		)
	}

	relativizePermissionPaths(config, projectDir)
	expandExternalDirectory(config)
	await applyOpencodeDirectory(config, projectDir, diagnostics)
}

async function loadManifest(
	manifestPath: string,
	diagnostics: DiagnosticSink,
): Promise<LoadedManifest | undefined> {
	let manifestText: string
	try {
		manifestText = await readFile(manifestPath, "utf8")
	} catch (error) {
		if (isMissingFileError(error)) {
			diagnostics.add(`router manifest not found: ${manifestPath}`)
		} else {
			diagnostics.add(`cannot read ${manifestPath}: ${formatError(error)}`)
		}
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(manifestText)
	} catch (error) {
		diagnostics.add(`invalid JSON in ${manifestPath}: ${formatError(error)}`)
		return undefined
	}

	if (!isRecord(parsed)) {
		diagnostics.add(`expected a JSON object in ${manifestPath}`)
		return undefined
	}

	const manifest: RouterManifest = {
		version: typeof parsed.version === "number" ? parsed.version : undefined,
		projects:
			typeof parsed.projects === "string" ? parsed.projects : undefined,
		containers: parseStringArray(parsed.containers, "containers", diagnostics),
		permission: isRecord(parsed.permission) ? parsed.permission : undefined,
	}

	if (manifest.version !== MANIFEST_VERSION) {
		diagnostics.add(
			`unsupported router.json version ${manifest.version}, expected ${MANIFEST_VERSION}`,
		)
		return undefined
	}

	const projectsRoot = manifest.projects
		? resolve(dirname(manifestPath), expandHomePath(manifest.projects))
		: DEFAULT_PROJECTS_ROOT

	return { ...manifest, projectsRoot }
}

async function resolveProject(
	workingDirectory: string,
	manifest: LoadedManifest,
	diagnostics: DiagnosticSink,
): Promise<ProjectMatch | undefined> {
	let projectNames: string[]
	try {
		projectNames = (await readdir(manifest.projectsRoot, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map((entry) => entry.name)
	} catch (error) {
		if (!isMissingFileError(error)) {
			diagnostics.add(
				`cannot read projects directory ${manifest.projectsRoot}: ${formatError(error)}`,
			)
		}
		return undefined
	}

	const canonicalWorkingDirectory = await canonicalizePath(
		workingDirectory,
		diagnostics,
	)
	const containerPaths = await Promise.all(
		(manifest.containers ?? []).map((container) =>
			canonicalizePath(expandHomePath(container), diagnostics),
		),
	)

	let bestMatch: { length: number; name: string } | undefined
	for (const containerPath of containerPaths) {
		for (const projectName of projectNames) {
			const projectPath = join(containerPath, projectName)
			if (!isPathInside(projectPath, canonicalWorkingDirectory)) continue
			if (bestMatch && projectPath.length <= bestMatch.length) continue
			bestMatch = { length: projectPath.length, name: projectName }
		}
	}

	if (!bestMatch) return undefined
	return {
		projectDir: join(manifest.projectsRoot, bestMatch.name),
	}
}

const server = async ({
	directory,
	client,
}: PluginInput): Promise<Hooks> => ({
	config: async (config: Config) => {
		const diagnosticMessages: string[] = []
		const diagnostics: DiagnosticSink = {
			add: (message) => diagnosticMessages.push(message),
		}

		const flushDiagnostics = async () => {
			if (diagnosticMessages.length === 0) return
			const message = diagnosticMessages
				.map((entry) => `[router] ${entry}`)
				.join("\n")
			try {
				if (client?.app?.log) {
					await client.app.log({
						body: { service: "router", level: "warn", message },
					})
				} else {
					console.error(message)
				}
			} catch {
				console.error(message)
			}
		}

		try {
			const manifest = await loadManifest(MANIFEST_PATH, diagnostics)
			if (!manifest) return

			const match = await resolveProject(directory, manifest, diagnostics)
			if (!match) return

			// The v1 config hook receives a typed Config object, but this plugin merges arbitrary project fragments.
			const configRecord = config as unknown as ConfigRecord
			await applyProject(
				configRecord,
				match.projectDir,
				diagnostics,
				manifest.permission,
			)
		} finally {
			await flushDiagnostics()
		}
	},
})

export default {
	id: "router-v1",
	server,
	async setup() {
		return
	},
} satisfies PluginModule & { setup: () => Promise<void> }
