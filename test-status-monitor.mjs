import assert from "node:assert/strict";
import { JobStatusMonitor } from "./job-status-monitor.ts";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function flush() {
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
}

function job(state = "running") {
	return {
		sessionId: "$1",
		windowId: "@1",
		paneId: "%1",
		title: "monitor-job",
		currentCommand: "bash",
		id: "monitor-job-1",
		name: "monitor-job",
		directory: "/tmp/monitor-job",
		state,
		maxLogBytes: 0,
		logTruncated: false,
	};
}

const responses = [];
const updates = [];
let listCalls = 0;
let tick;
let scheduledInterval;
let cancelledHandle;
const timerHandle = Symbol("timer");
const monitor = new JobStatusMonitor({
	listJobs: async () => {
		listCalls += 1;
		const response = responses.shift();
		if (!response) throw new Error("test response queue exhausted");
		return response();
	},
	publish: (update) => updates.push(update),
	intervalMs: 10,
	schedule: (callback, intervalMs) => {
		tick = callback;
		scheduledInterval = intervalMs;
		return timerHandle;
	},
	cancel: (handle) => {
		cancelledHandle = handle;
	},
});

const first = deferred();
responses.push(() => first.promise);
monitor.start();
monitor.start();
assert.equal(scheduledInterval, 100, "poll interval minimum was not enforced");
assert.equal(listCalls, 1, "start did not refresh immediately or was not idempotent");
tick();
assert.equal(listCalls, 1, "overlapping poll started while the first was unresolved");
first.resolve([job()]);
await flush();
assert.equal(updates.length, 1);
assert.equal(updates[0].kind, "view");
assert.equal(updates[0].view.statusText, "tmux: 1 running");

responses.push(async () => [job()]);
tick();
await flush();
assert.equal(updates.length, 1, "unchanged projected view was republished");

responses.push(async () => {
	throw new Error("  tmux\n unavailable  ");
});
tick();
await flush();
assert.deepEqual(updates.at(-1), { kind: "error", message: "tmux unavailable" });
const errorUpdateCount = updates.length;
responses.push(async () => {
	throw new Error("tmux unavailable");
});
tick();
await flush();
assert.equal(updates.length, errorUpdateCount, "identical polling error was republished");

responses.push(async () => [job()]);
tick();
await flush();
assert.equal(updates.at(-1).kind, "view", "recovery did not republish an unchanged successful view");

const late = deferred();
responses.push(() => late.promise);
tick();
assert.equal(listCalls, 6);
monitor.stop();
monitor.stop();
assert.equal(cancelledHandle, timerHandle);
assert.deepEqual(updates.at(-1), { kind: "clear" });
const stoppedUpdateCount = updates.length;
late.resolve([job("exited")]);
await flush();
assert.equal(updates.length, stoppedUpdateCount, "late result published after monitor stop");
tick();
await flush();
assert.equal(listCalls, 6, "poll callback remained active after monitor stop");

console.log("session-scoped job-status monitor lifecycle tests passed");
