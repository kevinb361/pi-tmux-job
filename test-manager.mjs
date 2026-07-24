import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TmuxJobManager } from "./job-manager.ts";

function exec(command, args, options = {}) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let killed = false;
		let timer;
		const kill = () => {
			killed = true;
			child.kill("SIGTERM");
		};
		if (options.signal) {
			if (options.signal.aborted) kill();
			else options.signal.addEventListener("abort", kill, { once: true });
		}
		if (options.timeout) timer = setTimeout(kill, options.timeout);
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolve({ stdout, stderr, code: code ?? 1, killed });
		});
	});
}

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const rootDirectory = await mkdtemp(join(tmpdir(), "pi-tmux-job-test-"));
const windowName = `pi-job-test-${process.pid}`;
const manager = new TmuxJobManager(exec, { rootDirectory });
const cleanupTargets = [];

try {
	const completedName = `smoke-${suffix}`;
	const completed = await manager.start({
		name: completedName,
		command: "printf 'tmux-job-smoke-ok\\n'",
		cwd: process.cwd(),
		windowName,
	});
	cleanupTargets.push(completed.paneId);
	assert.equal(completed.name, completedName);
	assert.match(completed.paneId, /^%\d+$/);

	const unownedResult = await exec("tmux", [
		"split-window",
		"-d",
		"-P",
		"-F",
		"#{pane_id}",
		"-t",
		windowName,
		"sleep 30",
	]);
	assert.equal(unownedResult.code, 0);
	const unownedPane = unownedResult.stdout.trim();
	cleanupTargets.push(unownedPane);
	assert.ok(!(await manager.list()).some((job) => job.paneId === unownedPane));
	await exec("tmux", ["kill-pane", "-t", unownedPane]);
	cleanupTargets.splice(cleanupTargets.indexOf(unownedPane), 1);

	await assert.rejects(
		manager.start({ name: completedName, command: "true", cwd: process.cwd(), windowName }),
		/already exists/,
	);

	const waited = await manager.wait(completed.paneId, 10);
	assert.equal(waited.timedOut, false);
	assert.equal(waited.job.state, "exited");
	assert.equal(waited.job.exitCode, 0);
	const captured = await manager.capture(completedName, 30);
	assert.match(captured.output, /tmux-job-smoke-ok/);
	await manager.send(completedName, "printf 'tmux-job-send-ok\\n'", true);
	await new Promise((resolve) => setTimeout(resolve, 300));
	const afterSend = await manager.capture(completedName, 30);
	assert.match(afterSend.output, /tmux-job-send-ok/);
	await manager.close(completedName, false);
	cleanupTargets.splice(cleanupTargets.indexOf(completed.paneId), 1);

	const ttyName = `tty-${suffix}`;
	const ttyJob = await manager.start({
		name: ttyName,
		command:
			"printf 'req001-first\\n'; " +
			"if [ -t 0 ] && [ -t 1 ] && [ -t 2 ]; then printf 'req001-tty-ok\\n'; " +
			"else printf 'req001-tty-failed\\n'; exit 91; fi; " +
			"printf 'req001-last\\n'; exit 23",
		cwd: process.cwd(),
		windowName,
	});
	cleanupTargets.push(ttyJob.paneId);
	const ttyWaited = await manager.wait(ttyName, 10);
	assert.equal(ttyWaited.timedOut, false);
	assert.equal(ttyWaited.job.state, "exited");
	assert.equal(ttyWaited.job.exitCode, 23);
	const durableLog = await readFile(join(ttyWaited.job.directory, "output.log"), "utf8");
	assert.match(durableLog, /req001-first/);
	assert.match(durableLog, /req001-tty-ok/);
	assert.match(durableLog, /req001-last/);
	assert.match(durableLog, /\[tmux-job\] finished=.* exit=23/);
	assert.ok(durableLog.indexOf("req001-first") < durableLog.indexOf("req001-last"));
	await manager.close(ttyName, false);
	cleanupTargets.splice(cleanupTargets.indexOf(ttyJob.paneId), 1);

	const runningName = `running-${suffix}`;
	const running = await manager.start({
		name: runningName,
		command: "sleep 30",
		cwd: process.cwd(),
		windowName,
	});
	cleanupTargets.push(running.paneId);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const timedOut = await manager.wait(runningName, 1);
	assert.equal(timedOut.timedOut, true);
	await assert.rejects(manager.close(runningName, false), /Refusing to close running job/);
	await manager.interrupt(runningName);
	const interrupted = await manager.wait(runningName, 10);
	assert.equal(interrupted.timedOut, false);
	assert.equal(interrupted.job.state, "exited");
	assert.notEqual(interrupted.job.exitCode, 0);
	await manager.close(runningName, false);
	cleanupTargets.splice(cleanupTargets.indexOf(running.paneId), 1);

	const forceName = `force-${suffix}`;
	const forced = await manager.start({
		name: forceName,
		command: "sleep 30",
		cwd: process.cwd(),
		windowName,
	});
	cleanupTargets.push(forced.paneId);
	await new Promise((resolve) => setTimeout(resolve, 300));
	const forcedClosed = await manager.close(forceName, true);
	assert.equal(forcedClosed.name, forceName);
	cleanupTargets.splice(cleanupTargets.indexOf(forced.paneId), 1);

	console.log("tmux-job manager smoke tests passed");
} finally {
	for (const pane of cleanupTargets) {
		await exec("tmux", ["kill-pane", "-t", pane]);
	}
	await exec("tmux", ["kill-window", "-t", windowName]);
	await rm(rootDirectory, { recursive: true, force: true });
}
