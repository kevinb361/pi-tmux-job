import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { AGENT_BACKENDS, AGENT_MODES, buildAgentCommand } from "./agent-adapters.ts";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const agentDirectory = await mkdtemp(join(tmpdir(), "pi-tmux-job-agent-"));
const jobDirectory = await mkdtemp(join(tmpdir(), "pi-tmux-job-extension-"));
process.env.PI_TMUX_JOB_ROOT = jobDirectory;
const fakeBinDirectory = join(agentDirectory, "fake-bin");
await mkdir(fakeBinDirectory);
const fakeAgent = `#!/usr/bin/env bash
if [ "\${1:-}" = "--list-models" ]; then
  printf 'provider model context max-out thinking images\\n'
  printf 'litellm deep 258K 32K no no\\n'
  printf 'alternate deep 128K 16K no no\\n'
  printf 'litellm deep-think 258K 32K yes no\\n'
  printf 'litellm fast 196K 32K no no\\n'
  printf 'openai-codex gpt-test 128K 32K yes no\\n'
  exit 0
fi
printf 'fake-backend=%s\\n' "\${0##*/}"
printf 'fake-args='
printf '<%s>' "$@"
printf '\\n'
printf 'fake-live-argv='
tr '\\0' '|' < "/proc/$$/cmdline"
printf '\\n'
if [ -t 0 ]; then
  printf 'fake-input=<tty>\\n'
  trap 'printf "fake-interrupted\\n"; exit 130' INT
  while IFS= read -r line; do
    printf 'fake-received=<%s>\\n' "$line"
  done
else
  input="$(cat)"
  if [[ "$input" == *dispatch-return-check* ]]; then sleep 2; fi
  printf 'fake-input=<%s>\\n' "$input"
fi
`;
for (const backend of ["pi", "claude", "hermes"]) {
	const path = join(fakeBinDirectory, backend);
	await writeFile(path, fakeAgent);
	await chmod(path, 0o700);
	process.env[`PI_TMUX_AGENT_${backend.toUpperCase()}_BIN`] = path;
}

const forbiddenBypassFlag = /--yolo|--dangerously-skip-permissions|--dangerously-bypass-approvals-and-sandbox/;
for (const backend of AGENT_BACKENDS) {
	for (const mode of AGENT_MODES) assert.doesNotMatch(buildAgentCommand(backend, mode), forbiddenBypassFlag);
}

const result = await discoverAndLoadExtensions([join(repoRoot, "index.ts")], repoRoot, agentDirectory);
assert.deepEqual(result.errors, []);
const extension = result.extensions.find((item) => item.path.endsWith("/index.ts"));
assert.ok(extension, "extension was not loaded");
const registration = extension.tools.get("tmux_job");
assert.ok(registration, "tmux_job tool was not registered");
const agentRegistration = extension.tools.get("tmux_agent");
assert.ok(agentRegistration, "tmux_agent tool was not registered");
const shutdownHandlers = extension.handlers.get("session_shutdown") ?? [];
assert.equal(shutdownHandlers.length, 1, "tmux_agent must register one session-scoped notifier cleanup");

const tool = registration.definition;
const agentTool = agentRegistration.definition;
assert.match(agentTool.description, /Hermes one-shot mode exposes its prompt in argv/);
const readme = await readFile(join(repoRoot, "README.md"), "utf8");
assert.match(readme, /Hermes exception/);
assert.match(readme, /auto-bypasses Hermes approvals/);
const name = `extension-smoke-${process.pid}`;
const call = (id, params) => tool.execute(id, params, undefined, undefined, { cwd: repoRoot });
const callAgent = (id, params) => agentTool.execute(id, params, undefined, undefined, { cwd: repoRoot });
const openTargets = new Set();

try {
	await call("start", {
		action: "start",
		name,
		command: "printf 'extension-tool-ok\\n'",
		window: `pi-extension-test-${process.pid}`,
	});
	openTargets.add(name);
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
	openTargets.delete(name);

	const boundedName = `bounded-output-${process.pid}`;
	await call("start-bounded", {
		action: "start",
		name: boundedName,
		command: "for i in $(seq 1 1500); do printf '%080d\\n' \"$i\"; done",
		window: `pi-extension-test-${process.pid}`,
	});
	openTargets.add(boundedName);
	await call("wait-bounded", { action: "wait", target: boundedName, timeout_seconds: 10, lines: 20 });
	const bounded = await call("tail-bounded", { action: "tail", target: boundedName, lines: 1000 });
	assert.match(bounded.content[0].text, /Output truncated/);
	assert.ok(Buffer.byteLength(bounded.content[0].text, "utf8") < 55 * 1024);
	await call("close-bounded", { action: "close", target: boundedName });
	openTargets.delete(boundedName);

	await assert.rejects(
		callAgent("missing-model", {
			backend: "pi",
			mode: "dispatch",
			name: `missing-model-${process.pid}`,
			prompt: "test",
			model: "litellm/missing",
		}),
		/not present in the live registry/,
	);
	await assert.rejects(
		callAgent("ambiguous-model", {
			backend: "pi",
			mode: "dispatch",
			name: `ambiguous-model-${process.pid}`,
			prompt: "test",
			model: "deep",
		}),
		/Ambiguous Pi model deep/,
	);

	for (const backend of ["pi", "claude", "hermes"]) {
		for (const mode of ["interactive", "dispatch"]) {
			const agentName = `${backend}-${mode}-${process.pid}`;
			const prompt =
				`sentinel-${backend}-${mode}-${process.pid}` +
				(backend === "pi" && mode === "dispatch" ? "-dispatch-return-check" : "");
			const started = await callAgent(`agent-${agentName}`, {
				backend,
				mode,
				name: agentName,
				prompt: mode === "dispatch" ? prompt : undefined,
				model: backend === "pi" ? "litellm/deep" : undefined,
				thinking: backend === "pi" ? "high" : undefined,
				window: `pi-extension-test-${process.pid}`,
			});
			openTargets.add(agentName);
			assert.equal(started.details.backend, backend);
			assert.equal(started.details.mode, mode);
			if (backend === "pi" && mode === "dispatch") {
				assert.match(started.details.job.state, /launching|running/);
			}
			const launchText = started.content.map((item) => item.text ?? "").join("\n");
			if (backend === "hermes" && mode === "dispatch") {
				assert.match(launchText, /auto-bypasses approvals/);
				assert.match(launchText, /prompt in process argv/);
			}
			const listed = await call(`list-${agentName}`, { action: "list" });
			assert.match(listed.content[0].text, new RegExp(agentName));
			if (mode === "interactive") {
				const stillRunning = await call(`bounded-wait-${agentName}`, {
					action: "wait",
					target: agentName,
					timeout_seconds: 1,
					lines: 20,
				});
				assert.equal(stillRunning.details.timedOut, true);
				await call(`send-${agentName}`, {
					action: "send",
					target: agentName,
					text: `input-${backend}`,
					press_enter: true,
				});
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
				const tailed = await call(`tail-${agentName}`, { action: "tail", target: agentName, lines: 30 });
				assert.match(tailed.content[0].text, new RegExp(`fake-received=<input-${backend}>`));
				await call(`interrupt-${agentName}`, { action: "interrupt", target: agentName });
			}
			const agentWaited = await call(`wait-${agentName}`, {
				action: "wait",
				target: agentName,
				timeout_seconds: 10,
				lines: 30,
			});
			const agentText = agentWaited.content.map((item) => item.text ?? "").join("\n");
			assert.match(agentText, new RegExp(`fake-backend=${backend}`));
			if (mode === "interactive") {
				if (backend === "pi") {
					assert.match(agentText, /fake-args=<--model><litellm\/deep><--thinking><high>/);
				} else assert.match(agentText, /fake-args=<>/);
				assert.match(agentText, /fake-input=<tty>/);
				assert.match(agentText, /fake-interrupted/);
				assert.match(agentText, /exit=130/);
			} else if (backend === "pi") {
				assert.match(
					agentText,
					/fake-args=<--model><litellm\/deep><--thinking><high><--print><--no-session>/,
				);
				assert.match(agentText, new RegExp(`fake-input=<${prompt}>`));
			} else if (backend === "claude") {
				assert.match(agentText, /fake-args=<--print>/);
				assert.match(agentText, new RegExp(`fake-input=<${prompt}>`));
			} else {
				assert.match(agentText, new RegExp(`fake-args=<--oneshot><${prompt}>`));
			}
			if (mode === "dispatch") {
				const liveArgvLine = agentText.split("\n").find((line) => line.startsWith("fake-live-argv="));
				assert.ok(liveArgvLine, "fake agent did not report live argv");
				if (backend === "hermes") assert.match(liveArgvLine, new RegExp(prompt));
				else assert.doesNotMatch(liveArgvLine, new RegExp(prompt));

				const directory = started.details.job.directory;
				assert.equal(await readFile(join(directory, "input.txt"), "utf8"), prompt);
				assert.equal((await stat(join(directory, "input.txt"))).mode & 0o777, 0o600);
				for (const artifact of ["command.sh", "metadata.json"]) {
					assert.doesNotMatch(await readFile(join(directory, artifact), "utf8"), new RegExp(prompt));
				}
				const paneMetadata = execFileSync(
					"tmux",
					[
						"display-message",
						"-p",
						"-t",
						started.details.job.paneId,
						"#{pane_title}|#{pane_start_command}|#{@pi_tmux_job_id}|#{@pi_tmux_job_name}|#{@pi_tmux_job_dir}",
					],
					{ encoding: "utf8" },
				);
				assert.doesNotMatch(paneMetadata, new RegExp(prompt));
			}
			await call(`close-${agentName}`, { action: "close", target: agentName });
			openTargets.delete(agentName);
		}
	}
	await shutdownHandlers[0]({ type: "session_shutdown", reason: "reload" }, {});
	console.log("tmux_job and tmux_agent extension discovery and invocation passed");
} finally {
	for (const target of openTargets) {
		try {
			await call(`force-close-${target}`, { action: "close", target, force: true });
		} catch {
			// Best-effort cleanup after a failed assertion.
		}
	}
	await rm(agentDirectory, { recursive: true, force: true });
	await rm(jobDirectory, { recursive: true, force: true });
}
