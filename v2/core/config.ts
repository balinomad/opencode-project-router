import { readFile, readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import {
	isRecord,
	type DiagnosticSink,
	type LoadedManifest,
	type ProjectMatch,
	type RouterManifest,
} from "./types"

const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME
const CONFIG_HOME =
	XDG_CONFIG_HOME && isAbsolute(XDG_CONFIG_HOME)
		? XDG_CONFIG_HOME
		: join(homedir(), ".config")
const DEFAULT_PROJECTS_ROOT = join(CONFIG_HOME, "opencode", "projects")
const MANIFEST_VERSION = 2

export function isMissingFileError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT"
}

function isNotDirectoryError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOTDIR"
}

export function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
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

export async function readTextFile(
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

export function expandHomePath(path: string): string {
	return path
		.replace(/^~(?=$|[\\/])/, homedir())
		.replace(/\$\{?HOME\}?/g, homedir())
}

export function resolvePathFrom(baseDirectory: string, path: string): string {
	const expanded = expandHomePath(path)
	return isAbsolute(expanded) ? expanded : resolve(baseDirectory, expanded)
}

function isPathInside(parentPath: string, childPath: string): boolean {
	const relativePath = relative(parentPath, childPath)
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	)
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

export async function loadManifest(
	manifestPath: string,
	diagnostics: DiagnosticSink,
): Promise<LoadedManifest | undefined> {
	let text: string
	try {
		text = await readFile(manifestPath, "utf8")
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
		parsed = JSON.parse(text)
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
		projects: typeof parsed.projects === "string" ? parsed.projects : undefined,
		containers: parseStringArray(parsed.containers, "containers", diagnostics),
		references: isRecord(parsed.references) ? parsed.references : undefined,
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

export async function resolveProject(
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
