import assert from "node:assert/strict"
import { homedir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
	expandExternalDirectory,
	expandHomePath,
	isPathInside,
	mergeValues,
	parseJsonc,
	parseStringArray,
	relativizePermissionPaths,
	stripPrefixAndExtension,
	toAgent,
	toCommand,
} from "../v1/router"

function createDiagnostics() {
	const messages: string[] = []
	return {
		messages,
		add(message: string) {
			messages.push(message)
		},
	}
}

test("isPathInside accepts the root and descendants only", () => {
	assert.equal(isPathInside("/repo/app", "/repo/app"), true)
	assert.equal(isPathInside("/repo/app", "/repo/app/src"), true)
	assert.equal(isPathInside("/repo/app", "/repo/application"), false)
	assert.equal(isPathInside("/repo/app", "/repo/app/../other"), false)
})

test("expandHomePath expands home references", () => {
	assert.equal(expandHomePath("~/projects"), join(homedir(), "projects"))
	assert.equal(expandHomePath("${HOME}/projects"), join(homedir(), "projects"))
	assert.equal(expandHomePath("relative/path"), "relative/path")
})

test("parseStringArray reports non-string entries", () => {
	const diagnostics = createDiagnostics()
	assert.deepEqual(parseStringArray(["a", "b"], "containers", diagnostics), [
		"a",
		"b",
	])
	assert.deepEqual(
		parseStringArray(["a", 1], "containers", diagnostics),
		["a"],
	)
	assert.equal(diagnostics.messages.length, 1)
	assert.match(diagnostics.messages[0], /non-string entry/)
	assert.equal(parseStringArray(undefined, "containers", diagnostics), undefined)
})

test("parseJsonc accepts comments and trailing commas", () => {
	const diagnostics = createDiagnostics()
	const parsed = parseJsonc(
		`{
			// comment
			"version": 1,
			"containers": ["~/a", "~/b",],
			/* block */
		}`,
		"router.json",
		diagnostics,
	)
	assert.deepEqual(parsed, { version: 1, containers: ["~/a", "~/b"] })
	assert.deepEqual(diagnostics.messages, [])
})

test("parseJsonc reports invalid JSON", () => {
	const diagnostics = createDiagnostics()
	assert.equal(parseJsonc("{", "router.json", diagnostics), undefined)
	assert.equal(diagnostics.messages.length, 1)
	assert.match(diagnostics.messages[0], /invalid JSON/)
})

test("mergeValues merges objects and replaces arrays", () => {
	assert.deepEqual(
		mergeValues({ a: { b: 1 }, list: [1] }, { a: { c: 2 }, list: [2] }),
		{ a: { b: 1, c: 2 }, list: [2] },
	)
})

test("stripPrefixAndExtension removes the collection prefix", () => {
	assert.equal(
		stripPrefixAndExtension("agents/reviewer.md", ["agent/", "agents/"]),
		"reviewer",
	)
	assert.equal(stripPrefixAndExtension("reviewer.md", []), "reviewer")
})

test("relativizePermissionPaths rewrites project-absolute rules", () => {
	const projectDir = join("/repo", "app")
	const config = {
		permission: {
			read: {
				[join(projectDir, "secret")]: "deny",
				"src/*": "allow",
			},
			edit: {
				[join(projectDir, "generated", "**")]: "deny",
			},
		},
	}

	relativizePermissionPaths(config, projectDir)

	assert.deepEqual(config.permission.read, {
		secret: "deny",
		"src/*": "allow",
	})
	assert.deepEqual(config.permission.edit, {
		"generated/*": "deny",
	})
})

test("expandExternalDirectory expands home references", () => {
	const config = {
		permission: {
			external_directory: {
				"~/shared": "allow",
				"${HOME}/other": "deny",
			},
		},
	}

	expandExternalDirectory(config)

	assert.deepEqual(config.permission.external_directory, {
		[join(homedir(), "shared")]: "allow",
		[join(homedir(), "other")]: "deny",
	})
})

test("toAgent keeps known fields and moves the rest into options", () => {
	assert.deepEqual(
		toAgent(
			{
				description: "Reviewer",
				model: "provider/model",
				custom: "value",
			},
			"Review carefully.",
		),
		{
			prompt: "Review carefully.",
			description: "Reviewer",
			model: "provider/model",
			options: { custom: "value" },
		},
	)
})

test("toCommand keeps only supported command fields", () => {
	assert.deepEqual(
		toCommand(
			{ description: "Build", agent: "build", custom: "ignored" },
			"Run the build.",
		),
		{
			template: "Run the build.",
			description: "Build",
			agent: "build",
		},
	)
})
