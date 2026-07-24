import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { DispatchCompletionNotifier } from "./completion-notifier.ts";

function job(overrides = {}) {
	return {
		sessionId: "$1",
		windowId: "@1",
		paneId: "%1",
		title: "test",
		currentCommand: "bash",
		id: "job-1",
		name: "agent-1",
		directory: "/tmp/tmux-agent/job-1",
		state: "running",
		...overrides,
	};
}

{
	const messages = [];
	let waits = 0;
	const completed = job({ state: "exited", exitCode: 0 });
	const manager = {
		async wait() {
			waits += 1;
			return { job: completed, timedOut: false };
		},
	};
	const notifier = new DispatchCompletionNotifier(manager, (message, options) => messages.push({ message, options }));
	notifier.watch(job(), "pi");
	notifier.watch(job(), "pi");
	await flush();
	assert.equal(waits, 1);
	assert.equal(messages.length, 1);
	assert.match(messages[0].message.content, /backend=pi/);
	assert.match(messages[0].message.content, /exit=0/);
	assert.match(messages[0].message.content, /Inspect: .*\/output\.log/);
	assert.deepEqual(messages[0].options, { deliverAs: "followUp", triggerTurn: true });
}

{
	const messages = [];
	const longDirectory = `/tmp/${"x".repeat(6000)}/job-failed`;
	const failed = job({ id: "job-failed", name: "agent-failed", directory: longDirectory, state: "exited", exitCode: 7 });
	const manager = { async wait() { return { job: failed, timedOut: false }; } };
	const notifier = new DispatchCompletionNotifier(manager, (message) => messages.push(message));
	notifier.watch(failed, "claude");
	await flush();
	assert.equal(messages.length, 1);
	assert.match(messages[0].content, /backend=claude/);
	assert.match(messages[0].content, /exit=7/);
	assert.ok(messages[0].content.length < 5000);
	assert.ok(messages[0].details.logPath.endsWith("/output.log"));
}

{
	const messages = [];
	let aborted = false;
	const manager = {
		wait(_target, _timeout, signal) {
			return new Promise((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new Error("cancelled"));
					},
					{ once: true },
				);
			});
		},
	};
	const notifier = new DispatchCompletionNotifier(manager, (message) => messages.push(message));
	notifier.watch(job({ id: "job-shutdown" }), "hermes");
	notifier.shutdown();
	notifier.shutdown();
	await flush();
	assert.equal(aborted, true);
	assert.deepEqual(messages, []);
	notifier.watch(job({ id: "job-after-shutdown" }), "pi");
	await flush();
	assert.deepEqual(messages, []);
}

console.log("tmux_agent completion notifier tests passed");
