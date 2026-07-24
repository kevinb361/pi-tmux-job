# Audit Log: pi-tmux-job

---

## Audit: v1.1-agent-dispatch — 2026-07-24

Auditor: Opus 4.8 (claude-opus-4-8[1m]) — independent frontier close-out context; executed no v1.1 slice.
Scope: v1.1 Agent dispatch — observable Pi, Claude Code, and Hermes child agents run through tmux, with model selection through Pi for GPT and local LiteLLM routes.
Files reviewed: 16 files changed — 10 tracked (502 insertions(+), 42 deletions(-) vs HEAD) plus 6 new untracked source/test files (406 LOC): `agent-adapters.ts`, `completion-notifier.ts`, `model-registry.ts`, `test-hermes-config.mjs`, `test-notifier.mjs`, `test-package.mjs`.

Independence: confirmed. This context did not author or execute any reviewed slice. `.planning/config.json` contains a non-empty `close_out_auditor` key, so the frontier-verify close-out gate is satisfiable. Gate re-run fresh by the auditor: `npm run check` exit 0 (typecheck + `test-manager`, `test-hermes-config`, `test-notifier`, `test-package`, `test-extension`, all passed; `npm audit --omit=dev` found 0 vulnerabilities). Structure lint exit 0. Existing PROVEN labels were treated as claims and re-verified against code, tests, and a fresh run.

### Correctness
- [info] Command-completion and log-drain protocol is sound: `job-manager.ts:75-149` synchronizes the runner against a logger-ready sentinel before execution and a pipe-drained sentinel after `tmux pipe-pane` teardown, so the exit code and full initial-command log are durable before state flips to `exited`. Verified end-to-end by `test-manager.mjs:89-112` (exit 23, ordered `req001-first`<`req001-last`, `finished ... exit=23`).
- [info] Model routing matches intent: `agent-adapters.ts:44-51` always launches the `pi`/`claude`/`hermes` executable directly with no Codex CLI path; `model-registry.ts:32-44` enforces exact `provider/model`. Live `pi --list-models` (reproduced 2026-07-24) resolves `litellm/deep`, `litellm/deep-think`, `litellm/fast`, and `openai-codex/gpt-5.6-sol`, confirming GPT and local LiteLLM routes flow through Pi.
- No correctness defects found. Implementations match requirement intent, not merely the tests.

### Safety
- [info] Shell construction is quoted throughout: `shellQuote` (`job-manager.ts:57`, `agent-adapters.ts:20`) wraps every interpolated path/executable; job/window names are pattern-validated (`job-manager.ts:44-55`); `agentExecutable` rejects NUL/CR/LF in override paths (`agent-adapters.ts:26-29`). Prompt bytes for pi/claude are file-fed over stdin at mode 0600 and never reach argv; the Hermes `--oneshot "$(<…)"` argv exposure is the single documented, tested exception (`test-extension.mjs:209-232`).
- [info] Blast radius is contained by design: job dirs 0700, artifacts 0600/0700; running-job close protection (`job-manager.ts:390-392`); the extension asserts it carries only Bash-tool authority and adds no approval gates (README `## Safety model`). This is intended scope, not a defect.
- [warning] Durable `output.log` grows unbounded on disk (`job-manager.ts:306` appends via `pipe-pane`), while only model-facing output is bounded to 50KB. A long-lived, noisy dispatch job can accumulate a large log. This is a deliberate tradeoff (tmux-native logging over a `tee` pipeline, README:123) and is low-risk, but there is no rotation or cap. Fix-before-shipping is optional; track for later.

### Test Coverage
- [info] Coverage is strong and behavior-oriented: real-tmux lifecycle, fake backends across all backend×mode combinations, live `/proc/$$/cmdline` argv inspection, 0600 input-transport checks, packed-package offline install + discovery, notifier duplicate-suppression/shutdown, and Hermes config-inheritance under isolated `HOME`. Key negative paths covered: missing model, ambiguous model, duplicate name, running-job close refusal, interrupt→exit 130.
- [warning] REQ-006 end-to-end delivery boundary: the completion notification into a *live Pi turn* is proven only at the unit layer (`test-notifier.mjs`, fake `notify`) plus wiring assertions (`test-extension.mjs:65-66` one `session_shutdown` handler; `index.ts:57` `pi.sendMessage` callback). No integration test observes an actual delivered turn. Wiring is simple and asserted, so risk is low; an integration assertion would close the gap before shipping.
- [info] Untested minor negative paths: registry read failure (`model-registry.ts:28-30`, nonzero `pi --list-models`), `cwd`-not-a-directory (`job-manager.ts:239-240`), and the 64KB command / 1MB input limits (`job-manager.ts:231-235`). All are correct by inspection; low value to add.

### Architecture Fit
- [info] Clean separation with no circular dependencies: `agent-adapters.ts` (pure command construction), `model-registry.ts` (validation), `completion-notifier.ts` (session-scoped, type-only import from job-manager), `job-manager.ts` (tmux lifecycle), `index.ts` (registration + wiring). The new `tmux_agent` tool reuses the existing owned-pane lifecycle rather than forking it — good fit with the v1.0 surface.
- [info] `shellQuote` is duplicated in `job-manager.ts:57` and `agent-adapters.ts:20`. Harmless; could be shared later.

### Operability
- [info] Debuggability is a strength: per-job durable records (`command.sh`, `runner.sh`, `output.log`, `state`, `exit-code`, `metadata.json`, `closed`) under `~/.pi/agent/tmux-jobs/<id>/`, an explicit state machine (`launching`/`running`/`exited`/`launch-failed`/`log-failed`), specific error messages, and a thorough README troubleshooting section including the reload/watcher-cancellation behavior.
- [info] The v1.1 implementation currently resides in the *uncommitted working tree* (6 new untracked files + 10 modified). This is expected for a pre-close-out milestone; commit the milestone before or at the ROADMAP/STATE flip so the shipped state is captured in history.

### ASSERTED Items from TRACEABILITY.md
- None. Independent traceability sweep classified all of REQ-001 … REQ-010 as PROVEN with located and freshly reproduced evidence; there are no ASSERTED, OPEN, or WAIVED items to adjudicate.

### Verdict
PASS
- Critical findings: 0 (nothing blocks milestone closure)
- Warnings: 2 (unbounded on-disk `output.log`; REQ-006 live-turn delivery has unit+wiring proof but no end-to-end integration test) — both low-risk, non-blocking, recommended follow-ups
- Info: 8 (design notes, minor untested negative paths, `shellQuote` duplication, commit-before-close reminder)

The milestone is closure-ready. Every requirement is independently PROVEN and freshly reproduced, the gate passes clean with zero vulnerabilities, and no correctness or safety defect was found. The two warnings are quality follow-ups, not closure blockers. `saga-audit` does not flip ROADMAP/STATE; the mechanical completion step remains with `saga-run` after this PASS.
