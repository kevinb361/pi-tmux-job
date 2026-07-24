import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildAgentCommand } from "./agent-adapters.ts";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "pi-tmux-hermes-home-"));
const home = join(root, "home");
const configDirectory = join(home, ".hermes");
const executable = join(root, "fake-hermes");
const inputPath = join(root, "prompt.txt");
const previousExecutable = process.env.PI_TMUX_AGENT_HERMES_BIN;

try {
	await mkdir(configDirectory, { recursive: true });
	await writeFile(join(configDirectory, "config.yaml"), "fixture_config: inherited\n");
	await writeFile(inputPath, "fixture prompt");
	await writeFile(
		executable,
		`#!/usr/bin/env bash
printf 'config='
cat "$HOME/.hermes/config.yaml"
printf 'args='
printf '<%s>' "$@"
printf '\\n'
`,
	);
	await chmod(executable, 0o700);
	process.env.PI_TMUX_AGENT_HERMES_BIN = executable;

	for (const mode of ["interactive", "dispatch"]) {
		const command = buildAgentCommand("hermes", mode);
		assert.doesNotMatch(
			command,
			/--safe-mode|--ignore-user-config|--ignore-rules|--yolo|--no-plugins|--disable-plugins/,
		);
		const { stdout } = await execFileAsync("bash", ["-lc", command], {
			env: { ...process.env, HOME: home, PI_TMUX_JOB_INPUT: inputPath },
		});
		assert.match(stdout, /config=fixture_config: inherited/);
		if (mode === "interactive") assert.match(stdout, /args=<>/);
		else assert.match(stdout, /args=<--oneshot><fixture prompt>/);
	}
} finally {
	if (previousExecutable === undefined) delete process.env.PI_TMUX_AGENT_HERMES_BIN;
	else process.env.PI_TMUX_AGENT_HERMES_BIN = previousExecutable;
	await rm(root, { recursive: true, force: true });
}

console.log("Hermes native configuration inheritance tests passed");
