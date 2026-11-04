import type { Config, Hooks, PluginInput, PluginModule } from "@opencode-ai/plugin"
import { readFile, readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

const MANIFEST_PATH = fileURLToPath(new URL("router.json", import.meta.url))
const DEFAULT_PROJECTS_ROOT = join(
	homedir(),
	".config",
	"opencode",
	"projects",
)
const MANIFEST_VERSION = 1

type ConfigRecord = Record<string, unknown>

type RouterManifest = {
	version?: number
	projects?: string
	containers?: string[]
	permission?: ConfigRecord
}

type LoadedManifest = RouterManifest & {
	manifestPath: string
	projectsRoot: string
}

type DiagnosticSink = {
	add(message: string): void
}

type ProjectMatch = {
	name: string
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

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function expandHomePath(path: string): string {
	return path
		.replace(/^~(?=$|[\\/])/, homedir())
		.replace(/\$\{?HOME\}?/g, homedir())
}

async function canonicalizePath(path: string): Promise<string> {
	try {
		return await realpath(path)
	} catch {
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

function parseJsonc(
	text: string,
	path: string,
	diagnostics: DiagnosticSink,
): ConfigRecord | undefined {
	let output = ""
	let inString = false
	let index = 0

	const peekSignificant = (from: number): string | undefined => {
		let position = from
		while (position < text.length) {
			const current = text[position]
			const next = text[position + 1]
			if (
				current === " " ||
				current === "\t" ||
				current === "\n" ||
				current === "\r"
			) {
				position++
				continue
			}
			if (current === "/" && next === "/") {
				while (position < text.length && text[position] !== "\n") position++
				continue
			}
			if (current === "/" && next === "*") {
				position += 2
				while (
					position < text.length &&
					!(text[position] === "*" && text[position + 1] === "/")
				) {
					position++
				}
				position += 2
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
			output += current
			if (current === "\\") {
				output += next ?? ""
				index += 2
				continue
			}
			if (current === '"') inString = false
			index++
			continue
		}
		if (current === '"') {
			inString = true
			output += current
			index++
			continue
		}
		if (current === "/" && next === "/") {
			while (index < text.length && text[index] !== "\n") index++
			continue
		}
		if (current === "/" && next === "*") {
			index += 2
			while (
				index < text.length &&
				!(text[index] === "*" && text[index + 1] === "/")
			) {
				index++
			}
			index += 2
			continue
		}
		if (current === ",") {
			const significant = peekSignificant(index + 1)
			if (significant === "}" || significant === "]") {
				index++
				continue
			}
		}
		output += current
		index++
	}

	try {
		const value: unknown = JSON.parse(output)
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

async function applyProject(
	config: ConfigRecord,
	projectDir: string,
	diagnostics: DiagnosticSink,
	globalPermissions?: ConfigRecord,
): Promise<void> {
	if (
		(await readTextFile(join(projectDir, "AGENTS.md"), diagnostics)) !==
		undefined
	) {
		ensureArray(config, "instructions").push(join(projectDir, "AGENTS.md"))
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
		const configDir = dirname(filePath)
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
			config[key] =
				key in config ? mergeValues(config[key], value) : value
		}
	}

	if (globalPermissions) {
		config.permission = mergeValues(
			globalPermissions,
			isRecord(config.permission) ? config.permission : {},
		)
	}

	relativizePermissionPaths(config, projectDir)
	expandExternalDirectory(config)

	const opencodeDir = join(projectDir, ".opencode")
	const files = await collectFiles(opencodeDir, diagnostics)
	const skillDirectories = new Set<string>()

	for (const filePath of files) {
		const relativePath = relative(opencodeDir, filePath).split("\\").join("/")
		if (/^agents?\/.+\.md$/.test(relativePath)) {
			const fileText = await readTextFile(filePath, diagnostics)
			if (fileText === undefined) continue
			const { frontmatter, body } = parseMarkdownDocument(
				fileText,
				filePath,
				diagnostics,
			)
			const agentName = stripPrefixAndExtension(relativePath, [
				"agent/",
				"agents/",
			])
			const agents = ensureRecord(config, "agent")
			agents[agentName] = mergeValues(
				agents[agentName] ?? {},
				toAgent(frontmatter, body.trim()),
			)
		} else if (/^commands?\/.+\.md$/.test(relativePath)) {
			const fileText = await readTextFile(filePath, diagnostics)
			if (fileText === undefined) continue
			const { frontmatter, body } = parseMarkdownDocument(
				fileText,
				filePath,
				diagnostics,
			)
			const commandName = stripPrefixAndExtension(relativePath, [
				"command/",
				"commands/",
			])
			const commands = ensureRecord(config, "command")
			commands[commandName] = mergeValues(
				commands[commandName] ?? {},
				toCommand(frontmatter, body.trim()),
			)
		} else if (/^modes?\/[^/]+\.md$/.test(relativePath)) {
			const fileText = await readTextFile(filePath, diagnostics)
			if (fileText === undefined) continue
			const { frontmatter, body } = parseMarkdownDocument(
				fileText,
				filePath,
				diagnostics,
			)
			const agentName = stripPrefixAndExtension(relativePath, [
				"mode/",
				"modes/",
			])
			const agents = ensureRecord(config, "agent")
			agents[agentName] = mergeValues(agents[agentName] ?? {}, {
				...toAgent(frontmatter, body.trim()),
				mode: "primary",
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

async function loadManifest(
	manifestPath: string,
	diagnostics: DiagnosticSink,
): Promise<LoadedManifest | undefined> {
	const manifestText = await readTextFile(manifestPath, diagnostics)
	if (manifestText === undefined) {
		diagnostics.add(`router manifest not found: ${manifestPath}`)
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
		containers: Array.isArray(parsed.containers)
			? parsed.containers.filter(
					(item): item is string => typeof item === "string",
				)
			: undefined,
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

	return { ...manifest, manifestPath, projectsRoot }
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

	const canonicalWorkingDirectory = await canonicalizePath(workingDirectory)
	const containerPaths = await Promise.all(
		(manifest.containers ?? []).map((container) =>
			canonicalizePath(expandHomePath(container)),
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
		name: bestMatch.name,
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
