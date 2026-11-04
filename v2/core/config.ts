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

export const DEFAULT_PROJECTS_ROOT = join(
	homedir(),
	".config",
	"opencode",
	"projects",
)
export const MANIFEST_VERSION = 2

export function isMissingFileError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT"
}

export function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export async function canonicalizePath(path: string): Promise<string> {
	try {
		return await realpath(path)
	} catch {
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

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value.filter((item): item is string => typeof item === "string")
}

export async function loadManifest(
	manifestPath: string,
	diagnostics: DiagnosticSink,
): Promise<LoadedManifest | undefined> {
	const text = await readTextFile(manifestPath, diagnostics)
	if (text === undefined) {
		diagnostics.add(`router manifest not found: ${manifestPath}`)
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
		containers: stringArray(parsed.containers),
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

	return { ...manifest, manifestPath, projectsRoot }
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
