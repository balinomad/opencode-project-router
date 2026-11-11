import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import test, { type TestContext } from "node:test"
import {
	expandHomePath,
	loadManifest,
	resolveProject,
	resolvePathFrom,
} from "../v2/core/config"

function createDiagnostics() {
	const messages: string[] = []
	return {
		messages,
		add(message: string) {
			messages.push(message)
		},
	}
}

async function createWorkspace(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "router-test-"))
	t.after(async () => {
		await rm(root, { recursive: true, force: true })
	})
	return root
}

test("expandHomePath expands home references", () => {
	assert.equal(expandHomePath("~/projects"), join(homedir(), "projects"))
	assert.equal(expandHomePath("relative/path"), "relative/path")
})

test("resolvePathFrom resolves relative, absolute, and home paths", () => {
	assert.equal(resolvePathFrom("/repo/app", "docs"), "/repo/app/docs")
	assert.equal(resolvePathFrom("/repo/app", "/shared"), "/shared")
	assert.equal(
		resolvePathFrom("/repo/app", "~/shared"),
		join(homedir(), "shared"),
	)
})

test("loadManifest resolves the projects root relative to the manifest", async (t) => {
	const root = await createWorkspace(t)
	const manifestPath = join(root, "router.json")
	await writeFile(
		manifestPath,
		JSON.stringify({
			version: 2,
			projects: "./central",
			containers: ["./repos"],
			references: { docs: { path: "./docs" } },
		}),
	)
	const diagnostics = createDiagnostics()

	const manifest = await loadManifest(manifestPath, diagnostics)

	assert.ok(manifest)
	assert.equal(manifest.projectsRoot, join(root, "central"))
	assert.deepEqual(manifest.containers, ["./repos"])
	assert.deepEqual(manifest.references, { docs: { path: "./docs" } })
	assert.deepEqual(diagnostics.messages, [])
})

test("loadManifest rejects unsupported versions", async (t) => {
	const root = await createWorkspace(t)
	const manifestPath = join(root, "router.json")
	await writeFile(manifestPath, JSON.stringify({ version: 1 }))
	const diagnostics = createDiagnostics()

	assert.equal(await loadManifest(manifestPath, diagnostics), undefined)
	assert.equal(diagnostics.messages.length, 1)
	assert.match(diagnostics.messages[0], /unsupported router\.json version/)
})

test("loadManifest reports invalid JSON and missing files", async (t) => {
	const root = await createWorkspace(t)
	const manifestPath = join(root, "router.json")
	await writeFile(manifestPath, "{")

	const invalid = createDiagnostics()
	assert.equal(await loadManifest(manifestPath, invalid), undefined)
	assert.match(invalid.messages[0], /invalid JSON/)

	const missing = createDiagnostics()
	assert.equal(
		await loadManifest(join(root, "missing.json"), missing),
		undefined,
	)
	assert.match(missing.messages[0], /router manifest not found/)
})

test("resolveProject finds the matching central project", async (t) => {
	const root = await createWorkspace(t)
	const projectsRoot = join(root, "projects")
	const container = join(root, "repos")
	const projectDir = join(projectsRoot, "app")
	const workingDirectory = join(container, "app", "src")
	await mkdir(projectDir, { recursive: true })
	await mkdir(workingDirectory, { recursive: true })

	const diagnostics = createDiagnostics()
	const match = await resolveProject(
		workingDirectory,
		{
			version: 2,
			projectsRoot,
			containers: [container],
		},
		diagnostics,
	)

	assert.deepEqual(match, { projectDir })
	assert.deepEqual(diagnostics.messages, [])
})

test("resolveProject returns undefined outside every container", async (t) => {
	const root = await createWorkspace(t)
	const projectsRoot = join(root, "projects")
	const container = join(root, "repos")
	await mkdir(join(projectsRoot, "app"), { recursive: true })
	await mkdir(join(root, "elsewhere"), { recursive: true })

	const diagnostics = createDiagnostics()
	const match = await resolveProject(
		join(root, "elsewhere"),
		{ version: 2, projectsRoot, containers: [container] },
		diagnostics,
	)

	assert.equal(match, undefined)
	assert.deepEqual(diagnostics.messages, [])
})

test("resolveProject canonicalizes symlinked checkouts", async (t) => {
	const root = await createWorkspace(t)
	const projectsRoot = join(root, "projects")
	const container = join(root, "repos")
	const projectDir = join(projectsRoot, "app")
	const checkout = join(container, "app")
	await mkdir(projectDir, { recursive: true })
	await mkdir(join(checkout, "src"), { recursive: true })
	await symlink(checkout, join(container, "alias"), "dir")

	const match = await resolveProject(
		join(container, "alias", "src"),
		{ version: 2, projectsRoot, containers: [container] },
		createDiagnostics(),
	)

	assert.deepEqual(match, { projectDir })
})
