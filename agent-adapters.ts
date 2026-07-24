export const AGENT_BACKENDS = ["pi", "claude", "hermes"] as const;
export const AGENT_MODES = ["interactive", "dispatch"] as const;
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type AgentBackend = (typeof AGENT_BACKENDS)[number];
export type AgentMode = (typeof AGENT_MODES)[number];
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export interface AgentCommandOptions {
	model?: string;
	thinking?: PiThinkingLevel;
}

const EXECUTABLE_ENV: Record<AgentBackend, string> = {
	pi: "PI_TMUX_AGENT_PI_BIN",
	claude: "PI_TMUX_AGENT_CLAUDE_BIN",
	hermes: "PI_TMUX_AGENT_HERMES_BIN",
};

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function agentExecutable(backend: AgentBackend): string {
	const executable = process.env[EXECUTABLE_ENV[backend]]?.trim() || backend;
	if (executable.includes("\0") || executable.includes("\n") || executable.includes("\r")) {
		throw new Error(`Invalid ${backend} executable path`);
	}
	return executable;
}

export function buildAgentCommand(
	backend: AgentBackend,
	mode: AgentMode,
	options: AgentCommandOptions = {},
): string {
	const executable = shellQuote(agentExecutable(backend));
	const piOptions =
		backend === "pi"
			? `${options.model ? ` --model ${shellQuote(options.model)}` : ""}${options.thinking ? ` --thinking ${options.thinking}` : ""}`
			: "";
	if (mode === "interactive") return `${executable}${piOptions}`;

	switch (backend) {
		case "pi":
			return `${executable}${piOptions} --print --no-session`;
		case "claude":
			return `${executable} --print`;
		case "hermes":
			return `${executable} --oneshot "$(<"$PI_TMUX_JOB_INPUT")"`;
	}
}
