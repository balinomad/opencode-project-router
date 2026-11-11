import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { type TestContext } from "node:test"
import {
	containsShellBlock,
	expandCommandTemplate,
	loadProject,
	parseModelReference,
} from "../v2/core/project"

function createDiagnostics() {
	const messages: string[] = []
	return {
		messages,
		add(message: string) {
			messages.push(message)
		},
	}
}

async function createProject(t: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "router-project-"))
	t.after(async () => {
		await rm(root, { recursive: true, force: true })
	})
	return root
}

test("parseModelReference parses string and object forms", () => {
	assert.deepEqual(parseModelReference("openrouter/anthropic/claude#high"), {
		providerID: "openrouter",
		id: "anthropic/claude",
		variant: "high",
	})
	assert.deepEqual(parseModelReference({ providerID: "p", id: "m" }), {
		providerID: "p",
		id: "m",
	})
	assert.deepEqual(parseModelReference({ providerID: "p", model: "m" }), {
		providerID: "p",
		id: "m",
	})
	assert.equal(parseModelReference("invalid"), undefined)
	assert.equal(parseModelReference({ providerID: "p" }), undefined)
})

test("expandCommandTemplate substitutes arguments", () => {
	assert.equal(expandCommandTemplate("Run $ARGUMENTS", "all tests"), "Run all tests")
	assert.equal(expandCommandTemplate("echo $1 $2", "one two"), "echo one two")
	assert.equal(
		expandCommandTemplate("echo $1", '"two words" second'),
		"echo two words",
	)
	assert.equal(
		expandCommandTemplate("Do the task.", "extra context"),
		"Do the task.\n\nextra context",
	)
})

test("containsShellBlock detects shell expressions", () => {
	assert.equal(containsShellBlock("Run !`git status`."), true)
	assert.equal(containsShellBlock("Run the tests."), false)
})

test("loadProject reads AGENTS.md and central definitions", async (t) => {
	const projectDir = await createProject(t)
	await writeFile(join(projectDir, "AGENTS.md"), "# Central project\n")
	await writeFile(
		join(projectDir, "references.json"),
		JSON.stringify({ docs: { path: "./docs" } }),
	)

	const agentDir = join(projectDir, ".opencode", "agents")
	await mkdir(agentDir, { recursive: true })
	await writeFile(
		join(agentDir, "reviewer.md"),
		"---\ndescription: Reviews code\n---\nReview carefully.\n",
	)

	const modeDir = join(projectDir, ".opencode", "modes")
	await mkdir(modeDir, { recursive: true })
	await writeFile(
		join(modeDir, "plan.md"),
		"---\ndescription: Plans work\n---\nPlan first.\n",
	)

	const commandDir = join(projectDir, ".opencode", "commands")
	await mkdir(commandDir, { recursive: true })
	await writeFile(
		join(commandDir, "build.md"),
		"---\ndescription: Builds\n---\nRun $ARGUMENTS\n",
	)

	const skillDir = join(projectDir, ".opencode", "skills", "demo")
	await mkdir(skillDir, { recursive: true })
	await writeFile(
		join(skillDir, "SKILL.md"),
		"---\nname: Demo\ndescription: Demo skill\n---\nSkill body.\n",
	)
	await writeFile(
		join(projectDir, ".opencode", "skills", "flat.md"),
		"---\nname: Flat\n---\nFlat body.\n",
	)

	const diagnostics = createDiagnostics()
	const project = await loadProject(projectDir, diagnostics)

	assert.equal(project.projectDir, projectDir)
	assert.equal(project.agentsText, "# Central project")
	assert.deepEqual(
		project.agents.map((agent) => [agent.id, agent.fromModesDirectory]),
		[
			["reviewer", false],
			["plan", true],
		],
	)
	assert.equal(project.agents[0].body.trim(), "Review carefully.")
	assert.deepEqual(
		project.commands.map((command) => [command.name, command.template]),
		[["build", "Run $ARGUMENTS"]],
	)
	assert.deepEqual(
		project.skills.map((skill) => [skill.id, skill.name, skill.content]),
		[
			["demo", "Demo", "Skill body."],
			["flat", "Flat", "Flat body."],
		],
	)
	assert.deepEqual(project.references, { docs: { path: "./docs" } })
	assert.deepEqual(diagnostics.messages, [])
})
