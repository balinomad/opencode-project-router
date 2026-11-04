import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"
import { registerProject } from "./core/adapter/register"
import { loadManifest, resolveProject } from "./core/config"
import { loadProject } from "./core/project"
import type { DiagnosticSink, PluginContext } from "./core/types"

const MANIFEST_PATH = fileURLToPath(new URL("router.json", import.meta.url))

function getMajorVersion(version: string): number | undefined {
	const majorVersion = Number.parseInt(version.split(".")[0], 10)
	return Number.isFinite(majorVersion) ? majorVersion : undefined
}

async function activate(context: PluginContext): Promise<void> {
	const diagnosticMessages: string[] = []
	const diagnostics: DiagnosticSink = {
		add: (message) => diagnosticMessages.push(message),
	}

	try {
		const manifest = await loadManifest(MANIFEST_PATH, diagnostics)
		if (!manifest) return

		const match = await resolveProject(
			context.location.directory,
			manifest,
			diagnostics,
		)
		if (!match) return

		const project = await loadProject(match.projectDir, diagnostics)
		await registerProject(
			context,
			project,
			manifest.references,
			diagnostics,
		)
	} finally {
		if (diagnosticMessages.length > 0) {
			console.error(
				diagnosticMessages
					.map((message) => `[router] ${message}`)
					.join("\n"),
			)
		}
	}
}

const plugin = {
	id: "router",
	async setup(context: PluginContext) {
		const majorVersion = getMajorVersion(context.app.version)
		if (majorVersion === undefined || majorVersion < 2) return
		await activate(context)
	},
	async server() {
		return {}
	},
} satisfies Plugin.Plugin & { server: () => Promise<Record<string, never>> }

export default plugin
