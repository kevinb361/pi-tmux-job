import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { AGENT_BACKENDS, AGENT_MODES, buildAgentCommand } from "./agent-adapters.ts";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const agentDirectory = await mkdtemp(join(tmpdir(), "pi-tmux-job-agent-"));
const jobDirectory = await mkdtemp(join(tmpdir(), "pi-tmux-job-extension-"));
process.env.PI_TMUX_JOB_ROOT = jobDirectory;
process.env.PI_TMUX_JOB_MAX_LOG_BYTES = "4096";
process.env.PI_TMUX_WORKTREE_ROOT = join(agentDirectory, "managed-worktrees");
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
const sessionStartHandlers = extension.handlers.get("session_start") ?? [];
assert.equal(sessionStartHandlers.length, 1, "job status must register one session-scoped start handler");
const shutdownHandlers = extension.handlers.get("session_shutdown") ?? [];
assert.equal(shutdownHandlers.length, 1, "agent notifier and job status must share one shutdown cleanup");

const tool = registration.definition;
const agentTool = agentRegistration.definition;
assert.ok(!("max_log_bytes" in tool.parameters.properties));
assert.ok(!("maxLogBytes" in tool.parameters.properties));
assert.ok(!("max_log_bytes" in agentTool.parameters.properties));
assert.ok(!("maxLogBytes" in agentTool.parameters.properties));
assert.deepEqual(agentTool.parameters.properties.intent.enum, ["read", "write"]);
assert.ok(tool.parameters.properties.action.enum.includes("cleanup-workspace"));
assert.deepEqual(agentTool.parameters.properties.workspace.enum, ["auto", "current", "worktree"]);
assert.match(agentTool.description, /intent declares read-only or writer behavior/);
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
	const boundedWaited = await call("wait-bounded", {
		action: "wait",
		target: boundedName,
		timeout_seconds: 10,
		lines: 20,
	});
	assert.equal(boundedWaited.details.job.maxLogBytes, 4096);
	assert.equal(boundedWaited.details.job.logTruncated, true);
	assert.match(boundedWaited.content[0].text, /older terminal output was discarded/);
	const bounded = await call("tail-bounded", { action: "tail", target: boundedName, lines: 1000 });
	assert.match(bounded.content[0].text, /Output truncated/);
	assert.match(bounded.content[0].text, /older terminal output was discarded/);
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

	const policyRepository = join(agentDirectory, "policy-repository");
	await mkdir(policyRepository);
	execFileSync("git", ["-C", policyRepository, "init", "-b", "main"]);
	execFileSync("git", ["-C", policyRepository, "config", "user.name", "Extension Test"]);
	execFileSync("git", ["-C", policyRepository, "config", "user.email", "extension@example.invalid"]);
	await writeFile(join(policyRepository, "tracked.txt"), "base\n");
	execFileSync("git", ["-C", policyRepository, "add", "tracked.txt"]);
	execFileSync("git", ["-C", policyRepository, "commit", "-m", "test base"]);
	const policyName = `policy-auto-${process.pid}`;
	const policyStarted = await callAgent("policy-auto", {
		backend: "pi",
		mode: "dispatch",
		name: policyName,
		prompt: "policy-auto",
		workspace: "auto",
		cwd: policyRepository,
		window: `pi-extension-test-${process.pid}`,
	});
	openTargets.add(policyName);
	assert.equal(policyStarted.details.workspaceDecision.reason, "sole-writer");
	assert.equal(policyStarted.details.workspace.mode, "auto");
	await call(`wait-${policyName}`, { action: "wait", target: policyName, timeout_seconds: 10, lines: 20 });
	await call(`close-${policyName}`, { action: "close", target: policyName });
	openTargets.delete(policyName);

	const occupiedName = `policy-occupied-${process.pid}`;
	const isolatedName = `policy-isolated-${process.pid}`;
	const occupied = await callAgent("policy-occupied", {
		backend: "pi",
		mode: "dispatch",
		name: occupiedName,
		prompt: "policy-occupied-dispatch-return-check",
		workspace: "current",
		cwd: policyRepository,
		window: `pi-extension-test-${process.pid}`,
	});
	openTargets.add(occupiedName);
	assert.match(occupied.details.job.state, /launching|running/);
	const isolated = await callAgent("policy-isolated", {
		backend: "pi",
		mode: "dispatch",
		name: isolatedName,
		prompt: "policy-isolated",
		workspace: "auto",
		cwd: policyRepository,
		window: `pi-extension-test-${process.pid}`,
	});
	openTargets.add(isolatedName);
	assert.equal(isolated.details.workspaceDecision.reason, "writer-conflict");
	assert.equal(isolated.details.workspace.kind, "managed");
	assert.notEqual(isolated.details.workspace.worktreeRoot, occupied.details.workspace.worktreeRoot);
	await assert.rejects(
		call("cleanup-running", { action: "cleanup-workspace", target: occupiedName }),
		/Refusing workspace cleanup while job .* is (launching|running)/,
	);
	for (const target of [isolatedName, occupiedName]) {
		await call(`wait-${target}`, { action: "wait", target, timeout_seconds: 10, lines: 20 });
	}
	const isolatedCleanup = await call("cleanup-isolated", {
		action: "cleanup-workspace",
		target: isolatedName,
	});
	assert.equal(isolatedCleanup.details.cleanup.removed, true);
	assert.equal(isolatedCleanup.details.cleanup.branchDeleted, true);
	const isolatedAgain = await call("cleanup-isolated-again", {
		action: "cleanup-workspace",
		target: isolatedName,
	});
	assert.equal(isolatedAgain.details.cleanup.alreadyRemoved, true);
	await call(`close-${isolatedName}`, { action: "close", target: isolatedName });
	openTargets.delete(isolatedName);
	await assert.rejects(
		call("cleanup-current", { action: "cleanup-workspace", target: occupiedName }),
		/requires a managed tmux_agent workspace/,
	);
	await call(`close-${occupiedName}`, { action: "close", target: occupiedName });
	openTargets.delete(occupiedName);

	const managedName = `policy-managed-${process.pid}`;
	const managedStarted = await callAgent("policy-managed", {
		backend: "pi",
		mode: "dispatch",
		name: managedName,
		prompt: "policy-managed",
		workspace: "worktree",
		cwd: policyRepository,
		window: `pi-extension-test-${process.pid}`,
	});
	openTargets.add(managedName);
	assert.equal(managedStarted.details.workspaceDecision.reason, "explicit-worktree");
	assert.equal(managedStarted.details.workspace.kind, "managed");
	assert.match(managedStarted.details.workspace.createdBranch, /^pi-tmux\//);
	assert.equal((await stat(managedStarted.details.workspace.ownerRecordPath)).mode & 0o777, 0o600);
	const managedMetadata = JSON.parse(
		await readFile(join(managedStarted.details.job.directory, "metadata.json"), "utf8"),
	);
	assert.equal(managedMetadata.cwd, managedStarted.details.workspace.worktreeRoot);
	assert.equal(managedMetadata.workspace.kind, "managed");
	const worktreeCountBefore = execFileSync("git", ["-C", policyRepository, "worktree", "list", "--porcelain"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((line) => line.startsWith("worktree ")).length;
	const ownerCountBefore = (await readdir(dirname(managedStarted.details.workspace.ownerRecordPath))).length;
	await assert.rejects(
		callAgent("policy-managed-duplicate", {
			backend: "pi",
			mode: "dispatch",
			name: managedName,
			prompt: "policy-managed-duplicate",
			workspace: "worktree",
			cwd: policyRepository,
		}),
		/already exists/,
	);
	const worktreeCountAfter = execFileSync("git", ["-C", policyRepository, "worktree", "list", "--porcelain"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((line) => line.startsWith("worktree ")).length;
	assert.equal(worktreeCountAfter, worktreeCountBefore, "failed launch leaked a managed worktree");
	assert.equal(
		(await readdir(dirname(managedStarted.details.workspace.ownerRecordPath))).length,
		ownerCountBefore,
		"failed launch leaked an ownership record",
	);
	await call(`wait-${managedName}`, { action: "wait", target: managedName, timeout_seconds: 10, lines: 20 });
	const managedDirtyPath = join(managedStarted.details.workspace.worktreeRoot, "cleanup-preserve.txt");
	await writeFile(managedDirtyPath, "preserve\n");
	const preservedCleanup = await call("cleanup-managed-dirty", {
		action: "cleanup-workspace",
		target: managedName,
	});
	assert.equal(preservedCleanup.details.cleanup.removed, false);
	assert.equal(preservedCleanup.details.cleanup.preservedReason, "dirty");
	assert.match(preservedCleanup.content[0].text, /Preserved dirty managed workspace/);
	assert.equal(await readFile(managedDirtyPath, "utf8"), "preserve\n");
	await rm(managedDirtyPath);
	const managedCleanup = await call("cleanup-managed-clean", {
		action: "cleanup-workspace",
		target: managedName,
	});
	assert.equal(managedCleanup.details.cleanup.removed, true);
	assert.equal(managedCleanup.details.cleanup.branchDeleted, true);
	assert.match(managedCleanup.content[0].text, /Deleted unchanged extension branch/);
	const managedCleanupAgain = await call("cleanup-managed-again", {
		action: "cleanup-workspace",
		target: managedName,
	});
	assert.equal(managedCleanupAgain.details.cleanup.alreadyRemoved, true);
	assert.match(managedCleanupAgain.content[0].text, /already removed/);
	await call(`close-${managedName}`, { action: "close", target: managedName });
	openTargets.delete(managedName);

	await writeFile(join(policyRepository, "dirty.txt"), "dirty\n");
	await assert.rejects(
		callAgent("policy-dirty", {
			backend: "pi",
			mode: "dispatch",
			name: `policy-dirty-${process.pid}`,
			prompt: "policy-dirty",
			workspace: "auto",
			cwd: policyRepository,
		}),
		/dirty Git worktree/,
	);

	for (const backend of ["pi", "claude", "hermes"]) {
		for (const mode of ["interactive", "dispatch"]) {
			const agentName = `${backend}-${mode}-${process.pid}`;
			const prompt =
				`sentinel-${backend}-${mode}-${process.pid}` +
				(backend === "pi" && mode === "dispatch" ? "-dispatch-return-check" : "");
			const intent = backend === "claude" && mode === "dispatch" ? "read" : "write";
			const started = await callAgent(`agent-${agentName}`, {
				backend,
				mode,
				name: agentName,
				intent,
				workspace: "current",
				prompt: mode === "dispatch" ? prompt : undefined,
				model: backend === "pi" ? "litellm/deep" : undefined,
				thinking: backend === "pi" ? "high" : undefined,
				window: `pi-extension-test-${process.pid}`,
			});
			openTargets.add(agentName);
			assert.equal(started.details.backend, backend);
			assert.equal(started.details.mode, mode);
			assert.equal(started.details.intent, intent);
			assert.equal(started.details.workspaceMode, "current");
			assert.equal(started.details.workspaceDecision.reason, "explicit-current");
			assert.equal(started.details.workspace.intent, intent);
			assert.equal(started.details.workspace.mode, "current");
			assert.equal(started.details.workspace.kind, "current");
			assert.equal(started.details.workspace.isGit, true);
			assert.equal(started.details.job.workspace.worktreeRoot, repoRoot);
			assert.equal(started.details.job.workspace.intent, intent);
			assert.deepEqual(started.details.job.agent, { backend, mode });
			const durableAgentMetadata = JSON.parse(
				await readFile(join(started.details.job.directory, "metadata.json"), "utf8"),
			);
			assert.deepEqual(durableAgentMetadata.agent, { backend, mode });
			if (backend === "pi" && mode === "dispatch") {
				assert.match(started.details.job.state, /launching|running/);
			}
			const launchText = started.content.map((item) => item.text ?? "").join("\n");
			assert.match(launchText, new RegExp(`workspace=current:${intent}:`));
			if (backend === "hermes" && mode === "dispatch") {
				assert.match(launchText, /auto-bypasses approvals/);
				assert.match(launchText, /prompt in process argv/);
			}
			const listed = await call(`list-${agentName}`, { action: "list" });
			assert.match(listed.content[0].text, new RegExp(agentName));
			assert.deepEqual(
				listed.details.jobs.find((job) => job.name === agentName).agent,
				{ backend, mode },
			);
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
				const directory = started.details.job.directory;
				const durableAgentText = await readFile(join(directory, "output.log"), "utf8");
				const liveArgvLine = durableAgentText
					.split("\n")
					.find((line) => line.startsWith("fake-live-argv="));
				assert.ok(liveArgvLine, "fake agent did not report live argv");
				if (backend === "hermes") assert.match(liveArgvLine, new RegExp(prompt));
				else assert.doesNotMatch(liveArgvLine, new RegExp(prompt));

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
