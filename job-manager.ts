import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

export type ExecFunction = (
	command: string,
	args: string[],
	options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
) => Promise<ExecResult>;

export interface TmuxPaneJob {
	sessionId: string;
	windowId: string;
	paneId: string;
	title: string;
	currentCommand: string;
	id: string;
	name: string;
	directory: string;
	state: string;
	exitCode?: number;
}

export interface StartJobOptions {
	name: string;
	command: string;
	cwd: string;
	windowName?: string;
	signal?: AbortSignal;
}

// tmux escapes control characters in format output, so use a printable sentinel.
const FIELD_SEPARATOR = "|||PI_TMUX_JOB|||";
const DEFAULT_WINDOW_NAME = "pi-jobs";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const WINDOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/;

function assertSafeName(value: string, kind: "job" | "window"): void {
	const pattern = kind === "job" ? NAME_PATTERN : WINDOW_PATTERN;
	if (!pattern.test(value)) {
		throw new Error(
			`${kind} name must start with an alphanumeric character and contain only ` +
				`letters, numbers, dot, underscore, colon, or dash`,
		);
	}
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseExitCode(value: string): number | undefined {
	if (!/^\d+$/.test(value.trim())) return undefined;
	return Number.parseInt(value.trim(), 10);
}

async function readOptional(path: string): Promise<string | undefined> {
	try {
		return (await readFile(path, "utf8")).trim();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function runnerScript(cwd: string, commandPath: string, logPath: string, statePath: string, exitPath: string): string {
	return `#!/usr/bin/env bash
set +e

cwd=${shellQuote(cwd)}
command_file=${shellQuote(commandPath)}
log_file=${shellQuote(logPath)}
state_file=${shellQuote(statePath)}
exit_file=${shellQuote(exitPath)}
interrupted=0
trap 'interrupted=1' INT

write_state() {
  local value="$1"
  local tmp="${statePath}.tmp.$$"
  printf '%s\\n' "$value" > "$tmp"
  mv -f -- "$tmp" "$state_file"
}

write_state running
rm -f -- "$exit_file"
printf '[tmux-job] started=%s cwd=%s\\n' "$(date --iso-8601=seconds)" "$cwd" | tee -a "$log_file"
cd -- "$cwd"
cd_rc=$?
if [ "$cd_rc" -ne 0 ]; then
  printf '[tmux-job] unable to enter cwd; exit=%s\\n' "$cd_rc" | tee -a "$log_file"
  printf '%s\\n' "$cd_rc" > "$exit_file"
  write_state exited
else
  shell="\${SHELL:-/bin/bash}"
  set -o pipefail
  "$shell" -lc "$(<"$command_file")" 2>&1 | tee -a "$log_file"
  rc=\${PIPESTATUS[0]}
  printf '%s\\n' "$rc" > "$exit_file"
  write_state exited
  printf '[tmux-job] finished=%s exit=%s\\n' "$(date --iso-8601=seconds)" "$rc" | tee -a "$log_file"
fi

printf '\\n[tmux-job] command finished; pane left open for inspection\\n'
cd -- "$cwd" 2>/dev/null || cd -- "$HOME"
exec "\${SHELL:-/bin/bash}" -l
`;
}

export class TmuxJobManager {
	private readonly rootDirectory: string;
	private readonly anchorPane: string;

	constructor(
		private readonly exec: ExecFunction,
		options: { rootDirectory?: string; anchorPane?: string } = {},
	) {
		this.rootDirectory =
			options.rootDirectory ?? process.env.PI_TMUX_JOB_ROOT ?? resolve(homedir(), ".pi", "agent", "tmux-jobs");
		this.anchorPane = options.anchorPane ?? process.env.TMUX_PANE ?? "";
	}

	async ensureAvailable(signal?: AbortSignal): Promise<string> {
		if (!process.env.TMUX || !this.anchorPane) {
			throw new Error("tmux_job requires Pi to be running inside tmux");
		}
		const version = await this.exec("tmux", ["-V"], { signal, timeout: 5000 });
		if (version.code !== 0) {
			throw new Error(`tmux is unavailable: ${version.stderr.trim() || version.stdout.trim()}`);
		}
		const session = await this.exec(
			"tmux",
			["display-message", "-p", "-t", this.anchorPane, "#{session_id}"],
			{ signal, timeout: 5000 },
		);
		if (session.code !== 0 || !session.stdout.trim()) {
			throw new Error(`Unable to identify Pi's tmux session: ${session.stderr.trim()}`);
		}
		return session.stdout.trim();
	}

	async list(signal?: AbortSignal): Promise<TmuxPaneJob[]> {
		const sessionId = await this.ensureAvailable(signal);
		const format = [
			"#{session_id}",
			"#{window_id}",
			"#{pane_id}",
			"#{pane_title}",
			"#{pane_current_command}",
			"#{@pi_tmux_job_id}",
			"#{@pi_tmux_job_name}",
			"#{@pi_tmux_job_dir}",
		].join(FIELD_SEPARATOR);
		const result = await this.exec("tmux", ["list-panes", "-a", "-F", format], {
			signal,
			timeout: 5000,
		});
		if (result.code !== 0) throw new Error(`Unable to list tmux panes: ${result.stderr.trim()}`);

		const jobs: TmuxPaneJob[] = [];
		for (const line of result.stdout.split("\n")) {
			if (!line) continue;
			const [rowSession, windowId, paneId, title, currentCommand, id, name, directory] = line.split(
				FIELD_SEPARATOR,
			);
			if (rowSession !== sessionId || !id || !directory) continue;
			const state = (await readOptional(resolve(directory, "state"))) ?? "unknown";
			const rawExit = await readOptional(resolve(directory, "exit-code"));
			jobs.push({
				sessionId: rowSession,
				windowId,
				paneId,
				title,
				currentCommand,
				id,
				name,
				directory,
				state,
				exitCode: rawExit === undefined ? undefined : parseExitCode(rawExit),
			});
		}
		return jobs;
	}

	async start(options: StartJobOptions): Promise<TmuxPaneJob> {
		assertSafeName(options.name, "job");
		const windowName = options.windowName ?? DEFAULT_WINDOW_NAME;
		assertSafeName(windowName, "window");
		if (!options.command.trim()) throw new Error("command must not be empty");
		if (Buffer.byteLength(options.command, "utf8") > 64 * 1024) {
			throw new Error("command exceeds the 64KB tmux_job limit");
		}

		const cwd = resolve(options.cwd);
		const cwdStat = await stat(cwd);
		if (!cwdStat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
		const sessionId = await this.ensureAvailable(options.signal);
		const existing = await this.list(options.signal);
		if (existing.some((job) => job.name === options.name)) {
			throw new Error(`A tmux job named ${options.name} already exists; close it before reusing the name`);
		}

		const id = `${options.name}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
		const directory = resolve(this.rootDirectory, id);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await chmod(directory, 0o700);
		const commandPath = resolve(directory, "command.sh");
		const runnerPath = resolve(directory, "runner.sh");
		const logPath = resolve(directory, "output.log");
		const statePath = resolve(directory, "state");
		const exitPath = resolve(directory, "exit-code");
		await writeFile(commandPath, `${options.command}\n`, { mode: 0o700 });
		await writeFile(runnerPath, runnerScript(cwd, commandPath, logPath, statePath, exitPath), { mode: 0o700 });
		await writeFile(statePath, "launching\n", { mode: 0o600 });
		await writeFile(
			resolve(directory, "metadata.json"),
			`${JSON.stringify({ id, name: options.name, cwd, windowName, createdAt: new Date().toISOString() }, null, 2)}\n`,
			{ mode: 0o600 },
		);

		const windows = await this.exec(
			"tmux",
			["list-windows", "-t", sessionId, "-F", `#{window_id}${FIELD_SEPARATOR}#{window_name}`],
			{ signal: options.signal, timeout: 5000 },
		);
		if (windows.code !== 0) throw new Error(`Unable to list tmux windows: ${windows.stderr.trim()}`);
		const windowId = windows.stdout
			.split("\n")
			.map((line) => line.split(FIELD_SEPARATOR))
			.find(([, name]) => name === windowName)?.[0];

		const createArgs = windowId
			? ["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", windowId, "-c", cwd, runnerPath]
			: [
					"new-window",
					"-d",
					"-P",
					"-F",
					"#{pane_id}",
					"-t",
					sessionId,
					"-n",
					windowName,
					"-c",
					cwd,
					runnerPath,
				];
		const created = await this.exec("tmux", createArgs, { signal: options.signal, timeout: 5000 });
		if (created.code !== 0 || !created.stdout.trim()) {
			await writeFile(statePath, "launch-failed\n", { mode: 0o600 });
			throw new Error(`Unable to create tmux pane: ${created.stderr.trim() || created.stdout.trim()}`);
		}
		const paneId = created.stdout.trim();
		for (const [key, value] of [
			["@pi_tmux_job_id", id],
			["@pi_tmux_job_name", options.name],
			["@pi_tmux_job_dir", directory],
		] as const) {
			const tagged = await this.exec("tmux", ["set-option", "-p", "-t", paneId, key, value], {
				signal: options.signal,
				timeout: 5000,
			});
			if (tagged.code !== 0) throw new Error(`Unable to tag tmux pane ${paneId}: ${tagged.stderr.trim()}`);
		}
		await this.exec("tmux", ["select-pane", "-t", paneId, "-T", options.name], {
			signal: options.signal,
			timeout: 5000,
		});
		await this.exec("tmux", ["select-layout", "-t", paneId, "tiled"], {
			signal: options.signal,
			timeout: 5000,
		});

		const job = await this.resolve(paneId, options.signal);
		if (!job) throw new Error(`Created pane ${paneId}, but could not discover its job metadata`);
		return job;
	}

	async resolve(target: string, signal?: AbortSignal): Promise<TmuxPaneJob | undefined> {
		const jobs = await this.list(signal);
		return jobs.find((job) => job.paneId === target || job.id === target || job.name === target);
	}

	async capture(target: string, lines = 100, signal?: AbortSignal): Promise<{ job: TmuxPaneJob; output: string }> {
		const job = await this.requireJob(target, signal);
		const boundedLines = Math.max(1, Math.min(lines, 1000));
		const result = await this.exec(
			"tmux",
			["capture-pane", "-p", "-t", job.paneId, "-S", `-${boundedLines}`],
			{ signal, timeout: 5000 },
		);
		if (result.code !== 0) throw new Error(`Unable to capture ${job.paneId}: ${result.stderr.trim()}`);
		return { job: (await this.resolve(job.paneId, signal)) ?? job, output: result.stdout.trimEnd() };
	}

	async send(target: string, text: string, pressEnter: boolean, signal?: AbortSignal): Promise<TmuxPaneJob> {
		if (text.includes("\0")) throw new Error("text must not contain a NUL byte");
		const job = await this.requireJob(target, signal);
		const sent = await this.exec("tmux", ["send-keys", "-t", job.paneId, "-l", text], {
			signal,
			timeout: 5000,
		});
		if (sent.code !== 0) throw new Error(`Unable to send text to ${job.paneId}: ${sent.stderr.trim()}`);
		if (pressEnter) {
			const entered = await this.exec("tmux", ["send-keys", "-t", job.paneId, "Enter"], {
				signal,
				timeout: 5000,
			});
			if (entered.code !== 0) throw new Error(`Unable to press Enter in ${job.paneId}: ${entered.stderr.trim()}`);
		}
		return (await this.resolve(job.paneId, signal)) ?? job;
	}

	async interrupt(target: string, signal?: AbortSignal): Promise<TmuxPaneJob> {
		const job = await this.requireJob(target, signal);
		const result = await this.exec("tmux", ["send-keys", "-t", job.paneId, "C-c"], {
			signal,
			timeout: 5000,
		});
		if (result.code !== 0) throw new Error(`Unable to interrupt ${job.paneId}: ${result.stderr.trim()}`);
		return (await this.resolve(job.paneId, signal)) ?? job;
	}

	async close(target: string, force: boolean, signal?: AbortSignal): Promise<TmuxPaneJob> {
		const job = await this.requireJob(target, signal);
		if (["launching", "running"].includes(job.state) && !force) {
			throw new Error(`Refusing to close running job ${job.name}; interrupt it first or pass force=true`);
		}
		const result = await this.exec("tmux", ["kill-pane", "-t", job.paneId], { signal, timeout: 5000 });
		if (result.code !== 0) throw new Error(`Unable to close ${job.paneId}: ${result.stderr.trim()}`);
		await writeFile(resolve(job.directory, "closed"), `${new Date().toISOString()}\n`, { mode: 0o600 });
		return job;
	}

	async wait(
		target: string,
		timeoutSeconds: number,
		signal?: AbortSignal,
		onPoll?: (job: TmuxPaneJob) => void,
	): Promise<{ job: TmuxPaneJob; timedOut: boolean }> {
		const deadline = Date.now() + Math.max(1, Math.min(timeoutSeconds, 7200)) * 1000;
		let job = await this.requireJob(target, signal);
		while (["launching", "running"].includes(job.state)) {
			if (signal?.aborted) throw new Error("tmux_job wait cancelled");
			if (Date.now() >= deadline) return { job, timedOut: true };
			onPoll?.(job);
			await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1000));
			job = await this.requireJob(job.paneId, signal);
		}
		return { job, timedOut: false };
	}

	private async requireJob(target: string, signal?: AbortSignal): Promise<TmuxPaneJob> {
		if (!target.trim()) throw new Error("target is required for this tmux_job action");
		const job = await this.resolve(target, signal);
		if (!job) throw new Error(`No Pi-owned tmux job found for target: ${target}`);
		return job;
	}
}
