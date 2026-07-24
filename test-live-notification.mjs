import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = await mkdtemp(join(tmpdir(), "pi-tmux-live-notification-"));
const fakeBinDirectory = join(root, "fake-bin");
await mkdir(fakeBinDirectory);
const fakePiPath = join(fakeBinDirectory, "pi");
await writeFile(
	fakePiPath,
	`#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
if [[ "$input" == *shutdown-check* ]]; then sleep 1.2; else sleep 0.35; fi
printf 'fake-pi-complete=%s\\n' "$input"
`,
);
await chmod(fakePiPath, 0o700);
process.env.PI_TMUX_AGENT_PI_BIN = fakePiPath;
process.env.PI_TMUX_JOB_MAX_LOG_BYTES = "4096";

function waitUntil(predicate, message, timeoutMs = 5000) {
	return new Promise((resolvePromise, reject) => {
		const deadline = Date.now() + timeoutMs;
		const poll = () => {
			if (predicate()) return resolvePromise();
			if (Date.now() >= deadline) return reject(new Error(message));
			setTimeout(poll, 20);
		};
		poll();
	});
}

function customCompletions(session) {
	return session.messages.filter(
		(message) => message.role === "custom" && message.customType === "tmux-agent-completion",
	);
}

function assistantText(session) {
	return session.messages
		.filter((message) => message.role === "assistant")
		.flatMap((message) => message.content)
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("\n");
}

async function createLiveSession(label, responses) {
	const agentDirectory = join(root, `agent-${label}`);
	const jobDirectory = join(root, `jobs-${label}`);
	await mkdir(agentDirectory);
	process.env.PI_TMUX_JOB_ROOT = jobDirectory;
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: repoRoot,
		agentDir: agentDirectory,
		settingsManager,
		additionalExtensionPaths: [join(repoRoot, "index.ts")],
	});
	await resourceLoader.reload();
	const faux = fauxProvider({ provider: `faux-${label}` });
	faux.setResponses(responses);
	const model = faux.getModel();
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDirectory, "auth.json"),
		modelsPath: join(agentDirectory, "models.json"),
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const result = await createAgentSession({
		cwd: repoRoot,
		agentDir: agentDirectory,
		model,
		modelRuntime,
		thinkingLevel: "off",
		tools: ["tmux_agent"],
		resourceLoader,
		sessionManager: SessionManager.inMemory(repoRoot),
		settingsManager,
	});
	assert.deepEqual(result.extensionsResult.errors, []);
	const extension = result.extensionsResult.extensions.find((item) => item.path.endsWith("/index.ts"));
	assert.ok(extension, "pi-tmux-job extension was not loaded into the AgentSession");
	const tmuxJob = extension.tools.get("tmux_job")?.definition;
	assert.ok(tmuxJob, "tmux_job cleanup tool was not registered");
	return {
		...result,
		faux,
		tmuxJob,
		unregisterFaux: () => modelRuntime.unregisterProvider(model.provider),
	};
}

async function callTmuxJob(tool, id, params) {
	return tool.execute(id, params, undefined, undefined, { cwd: repoRoot });
}

async function closeOwnedJob(tool, name) {
	try {
		await callTmuxJob(tool, `close-${name}`, { action: "close", target: name, force: true });
	} catch {
		// Best-effort cleanup after an assertion failure.
	}
}

try {
	{
		const name = `live-completion-${process.pid}`;
		const live = await createLiveSession("delivery", [
			fauxAssistantMessage(
				[
					fauxToolCall("tmux_agent", {
						backend: "pi",
						mode: "dispatch",
						name,
						prompt: "live-completion-check",
						window: `pi-live-notification-${process.pid}`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxText("INITIAL_TURN_DONE")]),
			(context) => {
				const followUpContext = JSON.stringify(context.messages);
				assert.match(
					followUpContext,
					/Agent dispatch completed: backend=pi/,
					"follow-up model context did not contain the completion message",
				);
				assert.match(followUpContext, new RegExp(`job=${name}`));
				return fauxAssistantMessage([fauxText("COMPLETION_FOLLOW_UP_SEEN")]);
			},
		]);
		let agentStarts = 0;
		let toolExecutions = 0;
		live.session.subscribe((event) => {
			if (event.type === "agent_start") agentStarts += 1;
			if (event.type === "tool_execution_end" && event.toolName === "tmux_agent") toolExecutions += 1;
		});
		try {
			await live.session.prompt("Dispatch the scripted completion check.");
			try {
				await waitUntil(
					() => assistantText(live.session).includes("COMPLETION_FOLLOW_UP_SEEN") && !live.session.isStreaming,
					"completion notification did not trigger a follow-up Pi turn",
				);
			} catch (error) {
				console.error(
					JSON.stringify(
						{
							agentStarts,
							toolExecutions,
							modelCalls: live.faux.state.callCount,
							messages: live.session.messages,
						},
						null,
						2,
					),
				);
				throw error;
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
			assert.equal(toolExecutions, 1);
			assert.equal(agentStarts, 2, "completion must trigger exactly one additional agent run");
			assert.equal(live.faux.state.callCount, 3, "completion must trigger exactly one follow-up model call");
			assert.equal(customCompletions(live.session).length, 1);
			assert.match(customCompletions(live.session)[0].content, new RegExp(`job=${name}`));
			assert.match(assistantText(live.session), /INITIAL_TURN_DONE/);
			assert.match(assistantText(live.session), /COMPLETION_FOLLOW_UP_SEEN/);
		} finally {
			await closeOwnedJob(live.tmuxJob, name);
			await live.session.reload();
			live.session.dispose();
			live.unregisterFaux();
		}
	}

	{
		const name = `shutdown-completion-${process.pid}`;
		const live = await createLiveSession("shutdown", [
			fauxAssistantMessage(
				[
					fauxToolCall("tmux_agent", {
						backend: "pi",
						mode: "dispatch",
						name,
						prompt: "shutdown-check",
						window: `pi-live-notification-${process.pid}`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxText("SHUTDOWN_INITIAL_TURN_DONE")]),
		]);
		let agentStarts = 0;
		live.session.subscribe((event) => {
			if (event.type === "agent_start") agentStarts += 1;
		});
		try {
			await live.session.prompt("Dispatch the scripted shutdown check.");
			assert.equal(agentStarts, 1);
			await live.session.reload();
			await callTmuxJob(live.tmuxJob, `wait-${name}`, {
				action: "wait",
				target: name,
				timeout_seconds: 5,
				lines: 20,
			});
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
			assert.equal(customCompletions(live.session).length, 0);
			assert.equal(agentStarts, 1, "shutdown completion must not trigger a late agent run");
			assert.equal(live.faux.state.callCount, 2, "shutdown completion must not call the model again");
		} finally {
			await closeOwnedJob(live.tmuxJob, name);
			live.session.dispose();
			live.unregisterFaux();
		}
	}
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log("live Pi completion delivery and shutdown suppression passed");
