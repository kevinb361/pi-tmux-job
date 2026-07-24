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
- [warning] REQ-006 end-to-end delivery boundary: the completion notification into a _live Pi turn_ is proven only at the unit layer (`test-notifier.mjs`, fake `notify`) plus wiring assertions (`test-extension.mjs:65-66` one `session_shutdown` handler; `index.ts:57` `pi.sendMessage` callback). No integration test observes an actual delivered turn. Wiring is simple and asserted, so risk is low; an integration assertion would close the gap before shipping.
- [info] Untested minor negative paths: registry read failure (`model-registry.ts:28-30`, nonzero `pi --list-models`), `cwd`-not-a-directory (`job-manager.ts:239-240`), and the 64KB command / 1MB input limits (`job-manager.ts:231-235`). All are correct by inspection; low value to add.

### Architecture Fit

- [info] Clean separation with no circular dependencies: `agent-adapters.ts` (pure command construction), `model-registry.ts` (validation), `completion-notifier.ts` (session-scoped, type-only import from job-manager), `job-manager.ts` (tmux lifecycle), `index.ts` (registration + wiring). The new `tmux_agent` tool reuses the existing owned-pane lifecycle rather than forking it — good fit with the v1.0 surface.
- [info] `shellQuote` is duplicated in `job-manager.ts:57` and `agent-adapters.ts:20`. Harmless; could be shared later.

### Operability

- [info] Debuggability is a strength: per-job durable records (`command.sh`, `runner.sh`, `output.log`, `state`, `exit-code`, `metadata.json`, `closed`) under `~/.pi/agent/tmux-jobs/<id>/`, an explicit state machine (`launching`/`running`/`exited`/`launch-failed`/`log-failed`), specific error messages, and a thorough README troubleshooting section including the reload/watcher-cancellation behavior.
- [info] The v1.1 implementation currently resides in the _uncommitted working tree_ (6 new untracked files + 10 modified). This is expected for a pre-close-out milestone; commit the milestone before or at the ROADMAP/STATE flip so the shipped state is captured in history.

### ASSERTED Items from TRACEABILITY.md

- None. Independent traceability sweep classified all of REQ-001 … REQ-010 as PROVEN with located and freshly reproduced evidence; there are no ASSERTED, OPEN, or WAIVED items to adjudicate.

### Verdict

PASS

- Critical findings: 0 (nothing blocks milestone closure)
- Warnings: 2 (unbounded on-disk `output.log`; REQ-006 live-turn delivery has unit+wiring proof but no end-to-end integration test) — both low-risk, non-blocking, recommended follow-ups
- Info: 8 (design notes, minor untested negative paths, `shellQuote` duplication, commit-before-close reminder)

The milestone is closure-ready. Every requirement is independently PROVEN and freshly reproduced, the gate passes clean with zero vulnerabilities, and no correctness or safety defect was found. The two warnings are quality follow-ups, not closure blockers. `saga-audit` does not flip ROADMAP/STATE; the mechanical completion step remains with `saga-run` after this PASS.

---

## Audit: v1.2-log-resilience — 2026-07-24

Auditor: Opus 4.8 (claude-opus-4-8[1m]) — independent frontier close-out context; executed no v1.2 slice.
Scope: v1.2 Log resilience — operators can bound retained per-job terminal logs without weakening PTY behavior or completion evidence (REQ-011, REQ-012).
Files reviewed: v1.2 delta vs HEAD (v1.1 release) — 11 tracked source/test/doc files changed (`job-manager.ts` +58, `index.ts` +49, `completion-notifier.ts` +15, `test-manager.mjs` +84, `test-extension.mjs`, `test-notifier.mjs`, `test-package.mjs`, `README.md`, `extension-manifest.json`, `package.json`, `CLAUDE.md`) plus 2 new untracked files: `log-writer.mjs` (89 LOC, the streaming sink) and `test-log-writer.mjs` (byte-exact unit test).

Independence: confirmed. This context did not author or execute any reviewed slice. `.planning/config.json` carries a non-empty `close_out_auditor` key, so the frontier close-out gate is satisfiable. Gate re-run fresh: `npm run check` exit 0 (typecheck + all six in-tmux suites, all passing; `npm audit --omit=dev` = 0 vulnerabilities). Existing PROVEN labels were treated as claims and re-verified against source, tests, and this run.

### Correctness — continuous disk-bound enforcement

- [info] The bound is enforced _continuously_, not just at completion. `log-writer.mjs:30-75` `writeBounded` holds `output.log` at ≤`maxBytes` after every stdin chunk across three cases: (1) chunk ≥ cap → truncate to 0 and keep the newest `maxBytes` of the chunk; (2) `size + chunk ≤ cap` → append in place; (3) over-budget smaller chunk → read the newest `maxBytes - chunk.length` bytes of the existing file, truncate to 0, rewrite `[retained tail][new chunk]`. Each case truncates before writing, so the on-disk file never transiently exceeds the cap. Verified independently against `test-manager.mjs:143-150`, which samples every on-disk `output.log*` file 30× _during_ sustained real-tmux output (80×1025-byte lines) and asserts ≤4096 each time with ≥3 non-empty running samples — a genuine mid-execution enforcement proof, not an end-state check.
- [info] Chronological tail correctness holds. In all three cases the retained region is the _newest_ bytes and the new chunk is appended after them, preserving order. `test-log-writer.mjs:37-43` byte-exactly proves the single-write path retains `oversized.subarray(-4096)` via `deepEqual`; the integration test confirms the newest marker (`REQ011_NEWEST_MARKER`) survives real multi-chunk streaming under the cap.
- [info] Policy parsing is strict and safe-integer bounded (`job-manager.ts:70-81`): rejects non-numeric and negative values, and values beyond `Number.isSafeInteger`. `readMaxLogBytes` (`:92-107`) re-validates the persisted metadata on every `list`. `undefined`/`0` → unlimited, correctly routed to `writeUnlimited` (`log-writer.mjs:18-28,83`).
- No correctness defects found. The implementation matches requirement intent, not merely the tests.

### Logger drain / error behavior

- [info] Drain-before-exit is preserved under capping. The runner tears down the pipe with `tmux pipe-pane` then waits up to ~5s for the logger's `pipe-drained` sentinel before flipping state to `exited`; a missing sentinel yields `log-failed` (`job-manager.ts:166-176`). The logger writes `drained` only after the stdin loop completes without throwing (`log-writer.mjs:82-89`); on any I/O error it logs to stderr, sets a nonzero exit code, and deliberately does _not_ write the sentinel — so a logger failure is surfaced as `log-failed`, fail-visible rather than silent. The capped integration path proves the finished marker lands in the durable log and exit 0 is recorded.
- [info] `writeBounded` uses an `r+` handle with position-addressed writes (not `O_APPEND`), correct for the truncate/rewrite pattern; the unlimited path uses append mode, exercised green by the unit test.

### Backward compatibility

- [info] Additive and non-breaking. `TmuxPaneJob` gains `maxLogBytes`/`logTruncated`; a v1.1-style job with no `maxLogBytes` in metadata resolves to `0` (unlimited) and an absent `log-truncated` marker resolves to `false`, so pre-v1.2 jobs read cleanly. The `describeJob` `log=` field and retention notices are purely additive to tool output. Unset `PI_TMUX_JOB_MAX_LOG_BYTES` reproduces v1.1's unlimited behavior, proven by `test-manager.mjs:167-179` (log grows past 4096). All legacy lifecycle assertions (unowned filtering, duplicate rejection, close protection, interrupt, force) remain green in the same run.

### Tool reporting

- [info] Truncation is reported through every operator-facing channel and never through an LLM-settable knob. Job status/tail/wait/close show `log=truncated:<bytes>` and append a retention notice pointing at the `log-truncated` marker (`index.ts:24-44,146-231`); the dispatch completion notice states "truncated to newest N bytes" with `maxLogBytes`/`logTruncated`/`logPath` in structured details (`completion-notifier.ts:61-84`); tool text includes "older terminal output was discarded" (asserted `test-extension.mjs:118-123`, `test-notifier.mjs:53-67`). Neither `tmux_job` nor `tmux_agent` exposes a `maxLogBytes` parameter (schema `index.ts:93-113,249-264`; asserted `test-extension.mjs:72-74`), satisfying the "LLM-callable tools cannot override the policy" clause of REQ-011.

### Package contents

- [info] `log-writer.mjs` is listed in `package.json` `files` (`:18`) and asserted present in the packed offline install (`test-package.mjs:30`). Version bumped to 1.2.0 in both `package.json` and `extension-manifest.json` (asserted equal, `:65-67`). README documents the `PI_TMUX_JOB_MAX_LOG_BYTES` policy, `log-truncated` marker, newest-chronological-bytes semantics, and the no-override guarantee (`README.md:124-125,144`), all asserted in the packed README (`test-package.mjs:69-80`). Both tools discover from the installed package.

### Test Coverage

- [info] Coverage is strong and behavior-oriented across layers: a byte-exact logger unit test, a real-tmux sustained-output test that samples the on-disk bound mid-execution, capped-vs-unlimited-vs-invalid policy paths, TTY-under-cap, truncation metadata/marker/reporting, notifier bounded content, and packed-package + README contract.
- [warning] The multi-chunk case-3 tail (many small over-budget chunks) is verified only by newest-marker presence, not a byte-exact ordering comparison; the exact-tail `deepEqual` covers the single-big-chunk path (case 1). Logic is simple and the continuous bound + newest-marker are proven, so risk is low — a byte-exact incremental-tail assertion would fully close it. Non-blocking follow-up.
- [warning] REQ-006 live-turn delivery boundary persists from v1.1: completion into an actual Pi turn is proven only at the unit + wiring layer, unchanged by v1.2. Low risk, non-blocking.

### Safety

- [info] No new attack surface. The logger is spawned under `umask 077` with `--log`/`--drained`/`--truncated` paths shell-quoted (`job-manager.ts:355-358`), writes are 0600, and the cap is operator-scoped (env/constructor) with no model-reachable override. This tightens the v1.1 "unbounded on-disk output.log" warning: on-disk retention is now boundable by policy.

### ASSERTED Items from TRACEABILITY.md

- None. The independent sweep classified REQ-001 … REQ-012 as PROVEN (REQ-006 with the noted live-turn boundary). No ASSERTED, OPEN, or WAIVED items to adjudicate.

### Verdict

PASS

- Critical findings: 0 (nothing blocks milestone closure)
- Warnings: 2 (multi-chunk case-3 tail proven by newest-marker not byte-exact ordering; REQ-006 live-turn delivery has unit+wiring proof only) — both low-risk, non-blocking follow-ups
- Info: 9 (continuous-bound design, drain/error semantics, backward-compat, reporting channels, package contents, safety notes)

v1.2 is closure-ready. Both new requirements (REQ-011 bounded continuous retention, REQ-012 preserved PTY/drain/exit + truncation reporting) are independently PROVEN with located, freshly reproduced evidence; the gate passes clean with zero vulnerabilities; the disk-bound is enforced continuously during execution (not just at end); chronological newest-bytes retention is byte-exact for the single-write path and marker-confirmed under real tmux; drain/error behavior is fail-visible; backward compatibility with v1.1 unlimited behavior holds; and no correctness or safety defect was found. `saga-audit` does not flip ROADMAP/STATE; the mechanical completion step remains with the executor's `saga-run` after this PASS.
