import type { TmuxPaneJob } from "./job-manager.ts";

export const DEFAULT_STATUS_DETAIL_LIMIT = 4;

export interface JobStatusView {
	statusText?: string;
	widgetLines: string[];
	key: string;
}

type StatusClass = "running" | "exited" | "attention";

function statusClass(job: TmuxPaneJob): StatusClass {
	if (["launching", "running"].includes(job.state)) return "running";
	if (job.state === "exited") return "exited";
	return "attention";
}

function compareJobs(left: TmuxPaneJob, right: TmuxPaneJob): number {
	const priority: Record<StatusClass, number> = { running: 0, attention: 1, exited: 2 };
	const classOrder = priority[statusClass(left)] - priority[statusClass(right)];
	if (classOrder !== 0) return classOrder;
	const nameOrder = left.name.localeCompare(right.name);
	if (nameOrder !== 0) return nameOrder;
	return left.id.localeCompare(right.id);
}

function jobMarker(job: TmuxPaneJob): string {
	if (statusClass(job) === "running") return "▶";
	if (job.state === "exited" && job.exitCode === 0) return "✓";
	return "!";
}

function jobIdentity(job: TmuxPaneJob): string {
	return job.agent ? `${job.agent.backend}/${job.agent.mode}` : "cmd";
}

function jobState(job: TmuxPaneJob): string {
	if (job.state === "exited") return `exit=${job.exitCode ?? "?"}`;
	if (job.exitCode !== undefined) return `${job.state}:exit=${job.exitCode}`;
	return job.state;
}

function detailLine(job: TmuxPaneJob): string {
	const fields = [
		`${jobMarker(job)} ${job.name}`,
		jobIdentity(job),
		jobState(job),
		`workspace=${job.workspace?.kind ?? "-"}`,
	];
	if (job.logTruncated) fields.push("log=truncated");
	return fields.join(" · ");
}

export function projectJobStatus(
	jobs: TmuxPaneJob[],
	detailLimit = DEFAULT_STATUS_DETAIL_LIMIT,
): JobStatusView {
	if (jobs.length === 0) return { statusText: undefined, widgetLines: [], key: "" };

	const counts: Record<StatusClass, number> = { running: 0, exited: 0, attention: 0 };
	for (const job of jobs) counts[statusClass(job)] += 1;
	const countParts = (["running", "exited", "attention"] as const)
		.filter((kind) => counts[kind] > 0)
		.map((kind) => `${counts[kind]} ${kind}`);
	const statusText = `tmux: ${countParts.join(" · ")}`;

	const ordered = [...jobs].sort(compareJobs);
	const boundedLimit = Math.max(0, Math.floor(detailLimit));
	const widgetLines = ordered.slice(0, boundedLimit).map(detailLine);
	if (ordered.length > boundedLimit) widgetLines.push(`… +${ordered.length - boundedLimit} more`);
	return { statusText, widgetLines, key: [statusText, ...widgetLines].join("\n") };
}
