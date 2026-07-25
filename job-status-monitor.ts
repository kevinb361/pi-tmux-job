import type { TmuxPaneJob } from "./job-manager.ts";
import { projectJobStatus, type JobStatusView } from "./job-status.ts";

export const DEFAULT_STATUS_POLL_INTERVAL_MS = 1000;

export type JobStatusUpdate =
	| { kind: "view"; view: JobStatusView }
	| { kind: "error"; message: string }
	| { kind: "clear" };

export interface JobStatusMonitorOptions {
	listJobs: () => Promise<TmuxPaneJob[]>;
	publish: (update: JobStatusUpdate) => void;
	intervalMs?: number;
	project?: (jobs: TmuxPaneJob[]) => JobStatusView;
	schedule?: (callback: () => void, intervalMs: number) => unknown;
	cancel?: (handle: unknown) => void;
}

function errorMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	return raw.replaceAll(/\s+/g, " ").trim().slice(0, 240) || "unknown polling error";
}

export class JobStatusMonitor {
	private readonly intervalMs: number;
	private readonly project: (jobs: TmuxPaneJob[]) => JobStatusView;
	private readonly schedule: (callback: () => void, intervalMs: number) => unknown;
	private readonly cancel: (handle: unknown) => void;
	private timer: unknown;
	private active = false;
	private inFlight = false;
	private generation = 0;
	private publishedKey: string | undefined;

	constructor(private readonly options: JobStatusMonitorOptions) {
		this.intervalMs = Math.max(100, Math.floor(options.intervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS));
		this.project = options.project ?? projectJobStatus;
		this.schedule = options.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
		this.cancel = options.cancel ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.generation += 1;
		const generation = this.generation;
		this.timer = this.schedule(() => void this.refresh(generation), this.intervalMs);
		void this.refresh(generation);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.generation += 1;
		if (this.timer !== undefined) this.cancel(this.timer);
		this.timer = undefined;
		this.publishedKey = undefined;
		this.options.publish({ kind: "clear" });
	}

	private async refresh(generation: number): Promise<void> {
		if (!this.active || generation !== this.generation || this.inFlight) return;
		this.inFlight = true;
		try {
			const jobs = await this.options.listJobs();
			if (!this.active || generation !== this.generation) return;
			const view = this.project(jobs);
			const key = `view:${view.key}`;
			if (key !== this.publishedKey) {
				this.publishedKey = key;
				this.options.publish({ kind: "view", view });
			}
		} catch (error) {
			if (!this.active || generation !== this.generation) return;
			const message = errorMessage(error);
			const key = `error:${message}`;
			if (key !== this.publishedKey) {
				this.publishedKey = key;
				this.options.publish({ kind: "error", message });
			}
		} finally {
			this.inFlight = false;
		}
	}
}
