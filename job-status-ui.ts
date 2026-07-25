import type { TmuxPaneJob } from "./job-manager.ts";
import {
	JobStatusMonitor,
	type JobStatusMonitorOptions,
	type JobStatusUpdate,
} from "./job-status-monitor.ts";

export const STATUS_UI_KEY = "tmux-job-status";
export const STATUS_WIDGET_KEY = "tmux-job-jobs";

interface JobStatusUiContext {
	mode: string;
	ui: {
		theme: { fg: (color: any, text: string) => string };
		setStatus: (key: string, text: string | undefined) => void;
		setWidget: (
			key: string,
			content: string[] | undefined,
			options?: { placement?: "aboveEditor" | "belowEditor" },
		) => void;
	};
}

type MonitorOverrides = Partial<
	Pick<JobStatusMonitorOptions, "intervalMs" | "project" | "schedule" | "cancel">
>;

function clearStatusUi(ctx: JobStatusUiContext): void {
	ctx.ui.setStatus(STATUS_UI_KEY, undefined);
	ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
}

export function applyJobStatusUpdate(ctx: JobStatusUiContext, update: JobStatusUpdate): void {
	if (update.kind === "clear") {
		clearStatusUi(ctx);
		return;
	}
	if (update.kind === "error") {
		ctx.ui.setStatus(STATUS_UI_KEY, ctx.ui.theme.fg("warning", "tmux: unavailable"));
		ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
		return;
	}
	if (!update.view.statusText || update.view.widgetLines.length === 0) {
		clearStatusUi(ctx);
		return;
	}
	ctx.ui.setStatus(STATUS_UI_KEY, ctx.ui.theme.fg("accent", update.view.statusText));
	ctx.ui.setWidget(STATUS_WIDGET_KEY, update.view.widgetLines, { placement: "belowEditor" });
}

export function startJobStatusSession(
	ctx: JobStatusUiContext,
	listJobs: () => Promise<TmuxPaneJob[]>,
	overrides: MonitorOverrides = {},
): JobStatusMonitor | undefined {
	if (ctx.mode !== "tui") return undefined;
	const monitor = new JobStatusMonitor({
		...overrides,
		listJobs,
		publish: (update) => applyJobStatusUpdate(ctx, update),
	});
	monitor.start();
	return monitor;
}
