import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const agentDirectory = await mkdtemp(join(tmpdir(), "pi-tmux-job-agent-"));
const jobDirectory = await mkdtemp(join(tmpdir(), "pi-tmux-job-extension-"));
process.env.PI_TMUX_JOB_ROOT = jobDirectory;

const result = await discoverAndLoadExtensions([join(repoRoot, "index.ts")], repoRoot, agentDirectory);
assert.deepEqual(result.errors, []);
const extension = result.extensions.find((item) => item.path.endsWith("/index.ts"));
assert.ok(extension, "extension was not loaded");
const registration = extension.tools.get("tmux_job");
assert.ok(registration, "tmux_job tool was not registered");

const tool = registration.definition;
const name = `extension-smoke-${process.pid}`;
const call = (id, params) => tool.execute(id, params, undefined, undefined, { cwd: repoRoot });
let open = false;

try {
	await call("start", {
		action: "start",
		name,
		command: "printf 'extension-tool-ok\\n'",
		window: `pi-extension-test-${process.pid}`,
	});
	open = true;
	const waited = await call("wait", {
		action: "wait",
		target: name,
		timeout_seconds: 10,
		lines: 20,
	});
	const text = waited.content.map((item) => item.text ?? "").join("\n");
	assert.match(text, /extension-tool-ok/);
	assert.match(text, /exit=0/);
	await call("close", { action: "close", target: name });
	open = false;
	console.log("tmux_job extension discovery and invocation passed");
} finally {
	if (open) {
		try {
			await call("force-close", { action: "close", target: name, force: true });
		} catch {
			// Best-effort cleanup after a failed assertion.
		}
	}
	await rm(agentDirectory, { recursive: true, force: true });
	await rm(jobDirectory, { recursive: true, force: true });
}
