import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { resolve } from "node:path";
import { TmuxJobManager, type TmuxPaneJob } from "./job-manager.ts";

const ACTIONS = ["start", "list", "status", "tail", "wait", "send", "interrupt", "close"] as const;

function describeJob(job: TmuxPaneJob): string {
	const exit = job.exitCode === undefined ? "-" : String(job.exitCode);
	return `${job.name} id=${job.id} pane=${job.paneId} state=${job.state} exit=${exit} window=${job.windowId}`;
}

function formatJobs(jobs: TmuxPaneJob[]): string {
	if (jobs.length === 0) return "No Pi-owned tmux jobs are open in this session.";
	return jobs.map(describeJob).join("\n");
}

function boundedOutput(output: string, fullOutputPath?: string): string {
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return truncation.content;
	return (
		`${truncation.content}\n\n` +
		`[Output truncated to ${truncation.outputLines}/${truncation.totalLines} lines ` +
		`(${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}).` +
		(fullOutputPath ? ` Full job log: ${fullOutputPath}]` : "]")
	);
}

function requireParameter(value: string | undefined, name: string): string {
	if (!value?.trim()) throw new Error(`${name} is required for this tmux_job action`);
	return value;
}

export default function (pi: ExtensionAPI) {
	const manager = new TmuxJobManager((command, args, options) => pi.exec(command, args, options));

	pi.registerTool({
		name: "tmux_job",
		label: "tmux job",
		description:
			"Run and manage observable commands in Pi-owned panes in a dedicated tmux window. " +
			"Use start for long-running or user-visible commands, list/status/tail/wait to monitor them, " +
			"send for interactive input, interrupt for Ctrl-C, and close to remove a pane. " +
			"start requires name and command. All actions except start/list require target (job name, id, or pane id). " +
			"send requires text. close refuses running jobs unless force=true. Output is limited to 50KB/2000 lines.",
		promptSnippet: "Run and monitor long-lived commands in visible Pi-owned tmux panes",
		promptGuidelines: [
			"Use tmux_job instead of background bash when a command is long-running, interactive, or the user asks to watch it live.",
			"Use normal bash for short commands; do not create tmux panes for routine listings or quick checks unless the user explicitly requests it.",
			"tmux_job provides execution and visibility, not authorization; preserve all production, migration, and destructive-operation approval gates.",
			"Do not launch concurrent tmux_job commands that edit the same shared repository files; prepare shared state serially before parallel execution.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS, { description: "Job operation" }),
			name: Type.Optional(
				Type.String({ description: "Unique safe pane/job name for start, such as server1:01-office" }),
			),
			command: Type.Optional(Type.String({ description: "Shell command for start" })),
			cwd: Type.Optional(Type.String({ description: "Working directory for start; defaults to Pi's cwd" })),
			window: Type.Optional(
				Type.String({ description: "Dedicated tmux window name for start; defaults to pi-jobs" }),
			),
			target: Type.Optional(Type.String({ description: "Existing job name, id, or pane id" })),
			lines: Type.Optional(
				Type.Integer({ description: "Lines to capture for tail/status", minimum: 1, maximum: 1000 }),
			),
			timeout_seconds: Type.Optional(
				Type.Integer({ description: "Maximum wait duration", minimum: 1, maximum: 7200 }),
			),
			text: Type.Optional(Type.String({ description: "Literal text for send" })),
			press_enter: Type.Optional(Type.Boolean({ description: "Press Enter after send; defaults true" })),
			force: Type.Optional(Type.Boolean({ description: "Allow close to kill a running job" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }], details: {} };

			switch (params.action) {
				case "start": {
					const name = requireParameter(params.name, "name");
					const command = requireParameter(params.command, "command");
					const cwd = resolve(ctx.cwd, params.cwd ?? ".");
					const job = await manager.start({
						name,
						command,
						cwd,
						windowName: params.window,
						signal,
					});
					return {
						content: [
							{
								type: "text",
								text:
									`Started ${describeJob(job)}\n` +
									`Persistent files: ${job.directory}\n` +
									"Use tmux_job wait/status/tail with this job name or pane id.",
							},
						],
						details: { job },
					};
				}
				case "list": {
					const jobs = await manager.list(signal);
					return { content: [{ type: "text", text: formatJobs(jobs) }], details: { jobs } };
				}
				case "status": {
					const target = requireParameter(params.target, "target");
					const captured = await manager.capture(target, params.lines ?? 30, signal);
					const text = `${describeJob(captured.job)}\n\n${boundedOutput(
						captured.output,
						`${captured.job.directory}/output.log`,
					)}`;
					return { content: [{ type: "text", text }], details: { job: captured.job } };
				}
				case "tail": {
					const target = requireParameter(params.target, "target");
					const captured = await manager.capture(target, params.lines ?? 100, signal);
					return {
						content: [
							{
								type: "text",
								text: boundedOutput(captured.output, `${captured.job.directory}/output.log`),
							},
						],
						details: { job: captured.job },
					};
				}
				case "wait": {
					const target = requireParameter(params.target, "target");
					let polls = 0;
					const result = await manager.wait(target, params.timeout_seconds ?? 1800, signal, (job) => {
						polls += 1;
						if (polls % 5 === 0) {
							onUpdate?.({
								content: [{ type: "text", text: `Waiting: ${describeJob(job)}` }],
								details: { job },
							});
						}
					});
					const captured = await manager.capture(result.job.paneId, params.lines ?? 60, signal);
					const prefix = result.timedOut ? "Wait timed out; job is still running." : "Job command finished.";
					return {
						content: [
							{
								type: "text",
								text: `${prefix}\n${describeJob(captured.job)}\n\n${boundedOutput(
									captured.output,
									`${captured.job.directory}/output.log`,
								)}`,
							},
						],
						details: { job: captured.job, timedOut: result.timedOut },
					};
				}
				case "send": {
					const target = requireParameter(params.target, "target");
					if (params.text === undefined) throw new Error("text is required for tmux_job send");
					const job = await manager.send(target, params.text, params.press_enter ?? true, signal);
					return {
						content: [{ type: "text", text: `Sent literal input to ${job.name} (${job.paneId}).` }],
						details: { job },
					};
				}
				case "interrupt": {
					const target = requireParameter(params.target, "target");
					const job = await manager.interrupt(target, signal);
					return {
						content: [{ type: "text", text: `Sent Ctrl-C to ${job.name} (${job.paneId}).` }],
						details: { job },
					};
				}
				case "close": {
					const target = requireParameter(params.target, "target");
					const job = await manager.close(target, params.force ?? false, signal);
					return {
						content: [
							{
								type: "text",
								text: `Closed ${job.name} (${job.paneId}). Persistent files remain at ${job.directory}.`,
							},
						],
						details: { job },
					};
				}
			}
		},
	});
}
