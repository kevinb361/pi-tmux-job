import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TmuxJobManager } from "./job-manager.ts";

async function retainedLogBytes(directory) {
	try {
		const names = (await readdir(directory)).filter((name) => name.startsWith("output.log"));
		return (await Promise.all(names.map((name) => stat(join(directory, name))))).reduce(
			(total, entry) => total + entry.size,
			0,
		);
	} catch (error) {
		if (error.code === "ENOENT") return 0;
		throw error;
	}
}

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
	assert.equal(completed.agent, undefined);
	const genericMetadataPath = join(completed.directory, "metadata.json");
	const genericMetadata = JSON.parse(await readFile(genericMetadataPath, "utf8"));
	assert.equal(genericMetadata.agent, undefined);
	genericMetadata.agent = { backend: "unknown", mode: "dispatch" };
	await writeFile(genericMetadataPath, `${JSON.stringify(genericMetadata)}\n`);
	await assert.rejects(manager.list(), /Invalid agent in job metadata/);
	delete genericMetadata.agent;
	await writeFile(genericMetadataPath, `${JSON.stringify(genericMetadata)}\n`);
	assert.equal((await manager.resolve(completedName)).agent, undefined);

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

	const previousConfiguredCap = process.env.PI_TMUX_JOB_MAX_LOG_BYTES;
	process.env.PI_TMUX_JOB_MAX_LOG_BYTES = "4096";
	const cappedManager = new TmuxJobManager(exec, { rootDirectory });
	if (previousConfiguredCap === undefined) delete process.env.PI_TMUX_JOB_MAX_LOG_BYTES;
	else process.env.PI_TMUX_JOB_MAX_LOG_BYTES = previousConfiguredCap;
	const cappedName = `capped-${suffix}`;
	const capped = await cappedManager.start({
		name: cappedName,
		command:
			"if [ -t 0 ] && [ -t 1 ] && [ -t 2 ]; then printf 'REQ012_TTY_OK\\n'; else exit 92; fi; " +
			"for i in $(seq 1 80); do printf '%01024d\\n' \"$i\"; sleep 0.01; done; " +
			"printf 'REQ011_NEWEST_MARKER\\n'",
		cwd: process.cwd(),
		windowName,
	});
	cleanupTargets.push(capped.paneId);
	let runningSamples = 0;
	for (let index = 0; index < 30; index += 1) {
		const retainedBytes = await retainedLogBytes(capped.directory);
		assert.ok(retainedBytes <= 4096, `retained capped logs grew to ${retainedBytes} bytes`);
		if (retainedBytes > 0) runningSamples += 1;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.ok(runningSamples >= 3, `expected sustained running samples, observed ${runningSamples}`);
	const cappedWaited = await cappedManager.wait(cappedName, 10);
	assert.equal(cappedWaited.job.exitCode, 0);
	assert.equal(cappedWaited.job.maxLogBytes, 4096);
	assert.equal(cappedWaited.job.logTruncated, true);
	assert.ok((await retainedLogBytes(capped.directory)) <= 4096);
	const cappedLog = await readFile(join(capped.directory, "output.log"), "utf8");
	assert.match(cappedLog, /REQ011_NEWEST_MARKER/);
	assert.match(cappedLog, /\[tmux-job\] finished=.* exit=0/);
	assert.equal(await readFile(join(capped.directory, "log-truncated"), "utf8"), "true\n");
	const cappedMetadata = JSON.parse(await readFile(join(capped.directory, "metadata.json"), "utf8"));
	assert.equal(cappedMetadata.maxLogBytes, 4096);
	const cappedCapture = await cappedManager.capture(cappedName, 1000);
	assert.match(cappedCapture.output, /REQ012_TTY_OK/);
	await cappedManager.close(cappedName, false);
	cleanupTargets.splice(cleanupTargets.indexOf(capped.paneId), 1);

	const unlimitedName = `unlimited-${suffix}`;
	const unlimited = await manager.start({
		name: unlimitedName,
		command: "printf '%020000d\\n' 1; printf 'REQ011_UNLIMITED_MARKER\\n'",
		cwd: process.cwd(),
		windowName,
	});
	cleanupTargets.push(unlimited.paneId);
	const unlimitedWaited = await manager.wait(unlimitedName, 10);
	assert.equal(unlimitedWaited.job.exitCode, 0);
	assert.ok((await stat(join(unlimited.directory, "output.log"))).size > 4096);
	await manager.close(unlimitedName, false);
	cleanupTargets.splice(cleanupTargets.indexOf(unlimited.paneId), 1);

	const previousMaxLogBytes = process.env.PI_TMUX_JOB_MAX_LOG_BYTES;
	process.env.PI_TMUX_JOB_MAX_LOG_BYTES = "invalid";
	const invalidManager = new TmuxJobManager(exec, { rootDirectory });
	if (previousMaxLogBytes === undefined) delete process.env.PI_TMUX_JOB_MAX_LOG_BYTES;
	else process.env.PI_TMUX_JOB_MAX_LOG_BYTES = previousMaxLogBytes;
	await assert.rejects(
		invalidManager.start({
			name: `invalid-cap-${suffix}`,
			command: "true",
			cwd: process.cwd(),
			windowName,
		}),
		/PI_TMUX_JOB_MAX_LOG_BYTES must be 0 or a positive integer byte count/,
	);

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
