import assert from "node:assert/strict";
import {
	STATUS_UI_KEY,
	STATUS_WIDGET_KEY,
	startJobStatusSession,
} from "./job-status-ui.ts";

async function flush() {
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
}

function job(overrides = {}) {
	return {
		sessionId: "$1",
		windowId: "@1",
		paneId: "%1",
		title: "ui-job",
		currentCommand: "bash",
		id: "ui-job-1",
		name: "ui-job",
		directory: "/tmp/ui-job",
		state: "running",
		maxLogBytes: 0,
		logTruncated: false,
		originPane: "%1",
		acknowledged: false,
		agent: { backend: "pi", mode: "dispatch" },
		workspace: { kind: "managed" },
		...overrides,
	};
}

function fakeContext(mode) {
	const statusCalls = [];
	const widgetCalls = [];
	return {
		ctx: {
			mode,
			ui: {
				theme: { fg: (color, text) => `[${color}]${text}` },
				setStatus: (...args) => statusCalls.push(args),
				setWidget: (...args) => widgetCalls.push(args),
			},
		},
		statusCalls,
		widgetCalls,
	};
}

const nonTui = fakeContext("rpc");
let nonTuiListCalls = 0;
let nonTuiScheduled = false;
const absent = startJobStatusSession(
	nonTui.ctx,
	async () => {
		nonTuiListCalls += 1;
		return [];
	},
	{ schedule: () => (nonTuiScheduled = true) },
);
assert.equal(absent, undefined);
assert.equal(nonTuiListCalls, 0);
assert.equal(nonTuiScheduled, false);
assert.deepEqual(nonTui.statusCalls, []);
assert.deepEqual(nonTui.widgetCalls, []);

const tui = fakeContext("tui");
const responses = [async () => [job()], async () => [], async () => Promise.reject(new Error("tmux down"))];
let tick;
let cancelled = false;
const monitor = startJobStatusSession(
	tui.ctx,
	async () => responses.shift()(),
	{
		originPane: "%1",
		schedule: (callback) => {
			tick = callback;
			return "timer";
		},
		cancel: (handle) => {
			assert.equal(handle, "timer");
			cancelled = true;
		},
	},
);
assert.ok(monitor);
await flush();
assert.deepEqual(tui.statusCalls.at(-1), [STATUS_UI_KEY, "[accent]tmux: 1 running"]);
assert.deepEqual(tui.widgetCalls.at(-1), [
	STATUS_WIDGET_KEY,
	["▶ ui-job · pi/dispatch · running · workspace=managed"],
	{ placement: "belowEditor" },
]);

tick();
await flush();
assert.deepEqual(tui.statusCalls.at(-1), [STATUS_UI_KEY, undefined]);
assert.deepEqual(tui.widgetCalls.at(-1), [STATUS_WIDGET_KEY, undefined]);

tick();
await flush();
assert.deepEqual(tui.statusCalls.at(-1), [STATUS_UI_KEY, "[warning]tmux: unavailable"]);
assert.deepEqual(tui.widgetCalls.at(-1), [STATUS_WIDGET_KEY, undefined]);

monitor.stop();
assert.equal(cancelled, true);
assert.deepEqual(tui.statusCalls.at(-1), [STATUS_UI_KEY, undefined]);
assert.deepEqual(tui.widgetCalls.at(-1), [STATUS_WIDGET_KEY, undefined]);

console.log("Pi footer and below-editor job-status UI integration tests passed");
