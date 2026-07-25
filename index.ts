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
import {
	AGENT_BACKENDS,
	AGENT_MODES,
	PI_THINKING_LEVELS,
	agentExecutable,
	buildAgentCommand,
} from "./agent-adapters.ts";
import { DispatchCompletionNotifier } from "./completion-notifier.ts";
import { TmuxJobManager, type TmuxPaneJob } from "./job-manager.ts";
import { startJobStatusSession } from "./job-status-ui.ts";
import { validatePiModel } from "./model-registry.ts";
import {
	WORKSPACE_INTENTS,
	WORKSPACE_MODES,
	ManagedWorkspaceManager,
	WorkspaceAllocator,
	decideWorkspace,
	describeWorkspace,
	inspectWorkspace,
} from "./workspace-manager.ts";

const ACTIONS = [
	"start",
	"list",
	"status",
	"tail",
	"wait",
	"send",
	"interrupt",
	"acknowledge",
	"close",
	"cleanup-workspace",
] as const;

function describeJob(job: TmuxPaneJob): string {
	const exit = job.exitCode === undefined ? "-" : String(job.exitCode);
	const retention =
		job.maxLogBytes === 0
			? "unlimited"
			: job.logTruncated
				? `truncated:${job.maxLogBytes}`
				: `capped:${job.maxLogBytes}`;
	return (
		`${job.name} id=${job.id} pane=${job.paneId} state=${job.state} exit=${exit} ` +
		`window=${job.windowId} log=${retention}${describeWorkspace(job.workspace)}`
	);
}

function logRetentionNotice(job: TmuxPaneJob): string {
	if (!job.logTruncated) return "";
	return (
		`\n\n[Persistent output.log retains the newest ${job.maxLogBytes} bytes; older terminal output was discarded. ` +
		`Truncation marker: ${job.directory}/log-truncated]`
	);
}

function formatJobs(jobs: TmuxPaneJob[]): string {
	if (jobs.length === 0) return "No Pi-owned tmux jobs are open in this session.";
	return jobs.map(describeJob).join("\n");
}

function boundedOutput(output: string, retainedOutputPath?: string): string {
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return truncation.content;
	return (
		`${truncation.content}\n\n` +
		`[Output truncated to ${truncation.outputLines}/${truncation.totalLines} lines ` +
		`(${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}).` +
		(retainedOutputPath ? ` Retained job log: ${retainedOutputPath}]` : "]")
	);
}

function requireParameter(value: string | undefined, name: string): string {
	if (!value?.trim()) throw new Error(`${name} is required for this tmux_job action`);
	return value;
}

export default function (pi: ExtensionAPI) {
	const exec = (command: string, args: string[], options?: Parameters<typeof pi.exec>[2]) =>
		pi.exec(command, args, options);
	const manager = new TmuxJobManager(exec);
	const workspaceAllocator = new WorkspaceAllocator();
	const managedWorkspaces = new ManagedWorkspaceManager(exec);
	const notifier = new DispatchCompletionNotifier(manager, (message, options) => pi.sendMessage(message, options));
	let statusMonitor: ReturnType<typeof startJobStatusSession>;
	pi.on("session_start", (_event, ctx) => {
		statusMonitor?.stop();
		statusMonitor = startJobStatusSession(ctx, () => manager.list(), { originPane: manager.originPane });
	});
	pi.on("session_shutdown", () => {
		notifier.shutdown();
		statusMonitor?.stop();
		statusMonitor = undefined;
	});

	pi.registerTool({
		name: "tmux_job",
		label: "tmux job",
		description:
			"Run and manage observable commands in Pi-owned panes in a dedicated tmux window. " +
			"Use start for long-running or user-visible commands, list/status/tail/wait to monitor them, " +
			"send for interactive input, interrupt for Ctrl-C, acknowledge to hide stopped-job passive status without closing its pane, close to remove a pane, and cleanup-workspace for owned agent worktrees. " +
			"start requires name and command. All actions except start/list require target (job name, id, or pane id). " +
			"send requires text. acknowledge refuses running jobs. close refuses running jobs unless force=true. cleanup-workspace refuses running, non-managed, or unowned workspaces and preserves dirty trees. Output is limited to 50KB/2000 lines.",
		promptSnippet: "Run and monitor long-lived commands in visible Pi-owned tmux panes",
		promptGuidelines: [
			"Use tmux_job instead of background bash when a command is long-running, interactive, or the user asks to watch it live.",
			"Use normal bash for short commands; do not create tmux panes for routine listings or quick checks unless the user explicitly requests it.",
			"tmux_job provides execution and visibility, not authorization; preserve all production, migration, and destructive-operation approval gates.",
			"Do not launch concurrent tmux_job commands that edit the same shared repository files; prepare shared state serially before parallel execution.",
			"Use cleanup-workspace only after inspecting and waiting for a managed tmux_agent job; dirty worktrees and committed branches are intentionally preserved.",
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
					const text =
						`${describeJob(captured.job)}\n\n${boundedOutput(
							captured.output,
							`${captured.job.directory}/output.log`,
						)}` + logRetentionNotice(captured.job);
					return { content: [{ type: "text", text }], details: { job: captured.job } };
				}
				case "tail": {
					const target = requireParameter(params.target, "target");
					const captured = await manager.capture(target, params.lines ?? 100, signal);
					return {
						content: [
							{
								type: "text",
								text:
									boundedOutput(captured.output, `${captured.job.directory}/output.log`) +
									logRetentionNotice(captured.job),
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
								text:
									`${prefix}\n${describeJob(captured.job)}\n\n${boundedOutput(
										captured.output,
										`${captured.job.directory}/output.log`,
									)}` + logRetentionNotice(captured.job),
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
				case "acknowledge": {
					const target = requireParameter(params.target, "target");
					const job = await manager.acknowledge(target, signal);
					return {
						content: [
							{
								type: "text",
								text: `Acknowledged ${job.name}; passive status is hidden and pane ${job.paneId} remains open.`,
							},
						],
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
								text:
									`Closed ${job.name} (${job.paneId}). Persistent files remain at ${job.directory}.` +
									logRetentionNotice(job),
							},
						],
						details: { job },
					};
				}
				case "cleanup-workspace": {
					const target = requireParameter(params.target, "target");
					const job = await manager.resolve(target, signal);
					if (!job) throw new Error(`No Pi-owned tmux job found for target: ${target}`);
					if (["launching", "running"].includes(job.state)) {
						throw new Error(`Refusing workspace cleanup while job ${job.name} is ${job.state}`);
					}
					const cleanup = await managedWorkspaces.cleanup(job.workspace, signal);
					if (!cleanup.removed) {
						return {
							content: [
								{
									type: "text",
									text:
										`Preserved dirty managed workspace for ${job.name}: ${cleanup.worktreePath}\n` +
										`Branch retained: ${cleanup.branch}. Inspect, commit, or clean it before retrying cleanup.`,
								},
							],
							details: { job, cleanup },
						};
					}
					const branchResult = cleanup.branchDeleted
						? `Deleted unchanged extension branch ${cleanup.branch}.`
						: `Retained committed branch ${cleanup.branch}.`;
					return {
						content: [
							{
								type: "text",
								text:
									`${cleanup.alreadyRemoved ? "Managed workspace was already removed" : "Removed managed workspace"} ` +
									`for ${job.name}: ${cleanup.worktreePath}\n${branchResult} ` +
									`Pane ${job.paneId} remains available for inspection; close it explicitly when done.`,
							},
						],
						details: { job, cleanup },
					};
				}
			}
		},
	});

	pi.registerTool({
		name: "tmux_agent",
		label: "tmux agent",
		description:
			"Launch Pi, Claude Code, or Hermes as an observable child agent in a Pi-owned tmux pane. " +
			"dispatch requires a prompt and returns immediately; interactive starts the native CLI for direct use. " +
			"intent declares read-only or writer behavior and defaults conservatively to write; workspace defaults to auto. " +
			"Pi and Claude prompts use private stdin transport; Hermes one-shot mode exposes its prompt in argv and auto-bypasses approvals. " +
			"Use tmux_job with the returned name or pane id to inspect, send input, interrupt, wait, or close.",
		promptSnippet: "Launch observable Pi, Claude Code, or Hermes child agents in tmux panes",
		promptGuidelines: [
			"Use tmux_agent when delegating a bounded task to Pi, Claude Code, or Hermes and tmux_job to manage the resulting pane.",
			"Declare intent=read only when the child task is guaranteed not to mutate its workspace; omitted intent defaults to write.",
			"Use workspace=auto by default. workspace=current explicitly accepts a dirty or occupied tree and requires operator-approved context; workspace=worktree requests isolation.",
			"Agent launch visibility does not replace approval for production, destructive, migration, or network changes.",
		],
		parameters: Type.Object({
			backend: StringEnum(AGENT_BACKENDS, { description: "Child-agent CLI" }),
			mode: Type.Optional(
				StringEnum(AGENT_MODES, { description: "dispatch (default) or interactive native CLI" }),
			),
			intent: Type.Optional(
				StringEnum(WORKSPACE_INTENTS, {
					description: "Workspace intent; read is non-mutating, write is conservative default",
				}),
			),
			workspace: Type.Optional(
				StringEnum(WORKSPACE_MODES, {
					description: "Workspace allocation: auto (default), explicit current tree, or managed worktree",
				}),
			),
			name: Type.String({ description: "Unique safe pane/job name" }),
			prompt: Type.Optional(Type.String({ description: "Task prompt; required for dispatch" })),
			model: Type.Optional(
				Type.String({ description: "Exact Pi provider/model identifier; valid only for the pi backend" }),
			),
			thinking: Type.Optional(
				StringEnum(PI_THINKING_LEVELS, { description: "Pi thinking level; valid only for the pi backend" }),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory; defaults to Pi's cwd" })),
			window: Type.Optional(Type.String({ description: "Tmux window; defaults to pi-jobs" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }], details: {} };
			const mode = params.mode ?? "dispatch";
			if (mode === "dispatch" && !params.prompt?.trim()) {
				throw new Error("prompt is required for tmux_agent dispatch");
			}
			if (mode === "interactive" && params.prompt !== undefined) {
				throw new Error("interactive tmux_agent launches do not accept a prompt; use tmux_job send instead");
			}
			if (params.backend !== "pi" && (params.model !== undefined || params.thinking !== undefined)) {
				throw new Error("model and thinking are currently supported only for the pi backend");
			}
			const model =
				params.backend === "pi" && params.model !== undefined
					? await validatePiModel(exec, agentExecutable("pi"), params.model, signal)
					: undefined;
			const cwd = resolve(ctx.cwd, params.cwd ?? ".");
			const intent = params.intent ?? "write";
			const workspaceMode = params.workspace ?? "auto";
			const allocated = await workspaceAllocator.run(async () => {
				const inspected = await inspectWorkspace(exec, cwd, intent, workspaceMode, signal);
				const decision = decideWorkspace(inspected, await manager.list(signal));
				const managed =
					decision.kind === "managed"
						? await managedWorkspaces.create(inspected, params.name, signal)
						: undefined;
				const workspace = managed?.workspace ?? inspected;
				try {
					const job = await manager.start({
						name: params.name,
						command: buildAgentCommand(params.backend, mode, { model, thinking: params.thinking }),
						cwd: managed?.cwd ?? cwd,
						windowName: params.window,
						input: mode === "dispatch" ? params.prompt : undefined,
						workspace,
						agent: { backend: params.backend, mode },
						signal,
					});
					return { job, workspace, decision };
				} catch (error) {
					if (managed) return managedWorkspaces.rollback(managed, error);
					throw error;
				}
			});
			const { job, workspace, decision } = allocated;
			if (mode === "dispatch") notifier.watch(job, params.backend);
			const warning =
				params.backend === "hermes" && mode === "dispatch"
					? "\nWarning: native Hermes one-shot mode auto-bypasses approvals and exposes its prompt in process argv."
					: "";
			return {
				content: [
					{
						type: "text",
						text:
							`Started ${params.backend} ${mode}: ${describeJob(job)}\n` +
							`Persistent files: ${job.directory}\n` +
							`Use tmux_job with ${job.name} or ${job.paneId} for lifecycle controls.${warning}`,
					},
				],
				details: {
					job,
					backend: params.backend,
					mode,
					model,
					thinking: params.thinking,
					intent,
					workspace,
					workspaceMode,
					workspaceDecision: decision,
				},
			};
		},
	});
}
