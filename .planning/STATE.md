---
saga_state_version: 1.0
milestone: v1.4.1-real-tui-status-proof
milestone_name: Real TUI status proof
status: complete
stopped_at: second CI hermeticity repair locally green; final fresh CI pending
last_updated: "2026-07-25T14:46:08Z"
last_activity: 2026-07-25 — Removed terminal-width dependence from live argv assertions by reading drained durable output; full local gate passes.
---

# Session State

## Current Position
Phase/Milestone: v1.4.1-real-tui-status-proof
Status: complete
Last activity: 2026-07-25 — Removed terminal-width dependence from live argv assertions by reading drained durable output; full local gate passes.

## Active Work
- Both discovered CI assumptions are repaired without weakening PTY or argv privacy evidence; local full gate is green.
- Commit/push the second test-only repair and require one fresh GitHub CI success.
- Stop/escalate if red; no tag/release/install until CI is green.


## Deferred
- 2026-07-25 — Harden real-TUI proof for ≥4 concurrently-running sibling jobs by explicitly guaranteeing the test job remains in the bounded detail projection.
- 2026-07-24 — Built-in workspace safety and managed worktrees promoted to v1.3-workspace-safety.
- 2026-07-24 — Persistent backend session resume and cross-run continuation.
- 2026-07-24 — Hidden scheduling, workflow DAGs, and an embedded terminal overlay.
- 2026-07-24 — Built-in Codex CLI adapter; GPT models run through Pi for this milestone.
- 2026-07-24 — Bounded durable logging promoted to active milestone v1.2-log-resilience.
- 2026-07-24 — Live Pi completion delivery proof promoted to and implemented in v1.2.2-live-completion-proof.
- 2026-07-24 — Byte-exact multi-chunk retained-tail proof promoted to and implemented in v1.2.1-tail-verification.
