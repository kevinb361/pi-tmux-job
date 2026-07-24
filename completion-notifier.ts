import type { TmuxJobManager, TmuxPaneJob } from "./job-manager.ts";
import type { AgentBackend } from "./agent-adapters.ts";

interface CompletionMessage {
	customType: string;
	content: string;
	display: boolean;
	details: Record<string, unknown>;
}

interface CompletionOptions {
	deliverAs: "followUp";
	triggerTurn: true;
}

type Notify = (message: CompletionMessage, options: CompletionOptions) => void;
type WaitManager = Pick<TmuxJobManager, "wait">;

function boundedField(value: string, maxLength = 2048): string {
	if (value.length <= maxLength) return value;
	return `…${value.slice(-(maxLength - 1))}`;
}

export class DispatchCompletionNotifier {
	private active = true;
	private readonly watching = new Map<string, AbortController>();
	private readonly delivered = new Set<string>();

	constructor(
		private readonly manager: WaitManager,
		private readonly notify: Notify,
	) {}

	watch(job: TmuxPaneJob, backend: AgentBackend): void {
		if (!this.active || this.watching.has(job.id) || this.delivered.has(job.id)) return;
		const controller = new AbortController();
		this.watching.set(job.id, controller);
		void this.monitor(job, backend, controller);
	}

	shutdown(): void {
		if (!this.active) return;
		this.active = false;
		for (const controller of this.watching.values()) controller.abort();
		this.watching.clear();
	}

	private async monitor(job: TmuxPaneJob, backend: AgentBackend, controller: AbortController): Promise<void> {
		try {
			let completed = job;
			while (this.active && !controller.signal.aborted) {
				const result = await this.manager.wait(job.id, 7200, controller.signal);
				completed = result.job;
				if (!result.timedOut) break;
			}
			if (!this.active || controller.signal.aborted || this.delivered.has(job.id)) return;

			this.delivered.add(job.id);
			const exit = completed.exitCode === undefined ? "unknown" : String(completed.exitCode);
			const logPath = boundedField(`${completed.directory}/output.log`);
			const content =
				`Agent dispatch completed: backend=${backend} job=${completed.name} id=${completed.id} ` +
				`pane=${completed.paneId} state=${completed.state} exit=${exit}\n` +
				`Inspect: ${logPath}\nManage with tmux_job target=${completed.name}`;
			this.notify(
				{
					customType: "tmux-agent-completion",
					content,
					display: true,
					details: { backend, jobId: completed.id, paneId: completed.paneId, exitCode: completed.exitCode, logPath },
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		} catch {
			// Cancellation, pane removal, and notification failures must not outlive or crash the session.
		} finally {
			this.watching.delete(job.id);
		}
	}
}
