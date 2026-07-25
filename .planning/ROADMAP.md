# Roadmap

## Milestones

- ✅ **v1.1 Agent dispatch** — Observable Pi, Claude Code, and Hermes child agents run through tmux, with model selection through Pi for GPT and local LiteLLM routes.
- ✅ **v1.2 Log resilience** — Operators can bound retained per-job terminal logs without weakening PTY behavior or completion evidence.
- ✅ **v1.2.1 Tail verification** — Byte-exact tests prove chronological retained-tail behavior across repeated small over-budget writes.
- ✅ **v1.2.2 Live completion proof** — A real in-memory Pi AgentSession proves dispatch completion enters the originating session exactly once and triggers a follow-up turn, while shutdown suppresses late delivery.
- ✅ **v1.3 Workspace safety** — Agent dispatches understand Git/worktree identity, isolate concurrent writers, fail closed around ambiguous dirty state, and clean up only extension-owned safe worktrees.
- ✅ **v1.4 Job status widget** — A quiet session-scoped footer and bounded below-editor widget show live owned-job state without noisy polling output or lifecycle leaks.
