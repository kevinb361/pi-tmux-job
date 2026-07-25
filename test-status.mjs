import assert from "node:assert/strict";
import { projectJobStatus } from "./job-status.ts";

function job(overrides) {
	return {
		sessionId: "$1",
		windowId: "@1",
		paneId: `%${overrides.id.length}`,
		title: overrides.name,
		currentCommand: "bash",
		id: overrides.id,
		name: overrides.name,
		directory: `/tmp/${overrides.id}`,
		state: "running",
		maxLogBytes: 0,
		logTruncated: false,
		...overrides,
	};
}

assert.deepEqual(projectJobStatus([]), { statusText: undefined, widgetLines: [], key: "" });

const jobs = [
	job({
		id: "zeta-1",
		name: "zeta",
		state: "exited",
		exitCode: 0,
		agent: { backend: "claude", mode: "interactive" },
		workspace: { kind: "current" },
	}),
	job({
		id: "alpha-1",
		name: "alpha",
		state: "running",
		agent: { backend: "pi", mode: "dispatch" },
		workspace: { kind: "managed" },
		logTruncated: true,
	}),
	job({ id: "error-1", name: "error", state: "log-failed", exitCode: 2, agent: { backend: "hermes", mode: "dispatch" } }),
	job({ id: "beta-1", name: "beta", state: "launching" }),
];
const originalOrder = jobs.map((item) => item.id);

const full = projectJobStatus(jobs);
assert.equal(full.statusText, "tmux: 2 running · 1 exited · 1 attention");
assert.deepEqual(full.widgetLines, [
	"▶ alpha · pi/dispatch · running · workspace=managed · log=truncated",
	"▶ beta · cmd · launching · workspace=-",
	"! error · hermes/dispatch · log-failed:exit=2 · workspace=-",
	"✓ zeta · claude/interactive · exit=0 · workspace=current",
]);
assert.equal(full.key, [full.statusText, ...full.widgetLines].join("\n"));
assert.deepEqual(jobs.map((item) => item.id), originalOrder, "projection mutated caller ordering");

const reordered = projectJobStatus([jobs[2], jobs[0], jobs[3], jobs[1]]);
assert.deepEqual(reordered, full, "projection changed when input ordering changed");

const bounded = projectJobStatus(jobs, 2);
assert.equal(bounded.widgetLines.length, 3);
assert.deepEqual(bounded.widgetLines, [
	"▶ alpha · pi/dispatch · running · workspace=managed · log=truncated",
	"▶ beta · cmd · launching · workspace=-",
	"… +2 more",
]);
assert.equal(projectJobStatus(jobs, 0).widgetLines[0], "… +4 more");

const failedExit = projectJobStatus([
	job({ id: "failed-1", name: "failed", state: "exited", exitCode: 9 }),
]);
assert.equal(failedExit.statusText, "tmux: 1 exited");
assert.deepEqual(failedExit.widgetLines, ["! failed · cmd · exit=9 · workspace=-"]);

console.log("stable bounded job-status projection tests passed");
