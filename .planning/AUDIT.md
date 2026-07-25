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

---

## Audit: v1.2.1-tail-verification — 2026-07-24

Auditor: Opus 4.8 (claude-opus-4-8[1m]) — independent frontier close-out context; executed no v1.1/v1.2/v1.2.1 slice.
Scope: v1.2.1 Tail verification — byte-exact tests prove chronological retained-tail behavior across repeated small over-budget writes (REQ-013), without weakening cap, truncation-marker, or drain guarantees (REQ-011).
Files reviewed: v1.2.1 delta vs HEAD (v1.2 release, commit 88053c6) — working-tree changes only, no new commit yet. Source `log-writer.mjs` **unchanged**. Changed: `test-log-writer.mjs` (+52/-8: helper extraction `writerPaths`/`writerArguments`/`waitForExactLog` + new chunked multi-write test), `test-package.mjs` (version assert 1.2.0→1.2.1), `package.json`/`extension-manifest.json`/`package-lock.json` (version 1.2.0→1.2.1), plus `.planning/{REQUIREMENTS,ROADMAP,STATE,TRACEABILITY}.md`.

Independence: confirmed. This context did not author or execute any reviewed slice. `.planning/config.json` carries a non-empty `close_out_auditor` key, so the frontier close-out gate is satisfiable. Saga structure lint (`saga-lint --format json`) re-run fresh: `clean: true`, 0 findings, exit 0. Gate re-run fresh: `npm run check` exit 0 (typecheck + all six in-tmux suites, all passing incl. `bounded, unlimited, and byte-exact chunked log-writer tests passed`; `npm audit --omit=dev` = 0 vulnerabilities). Existing PROVEN labels and checked boxes were treated as claims and re-verified against source, tests, recomputed chunk arithmetic, and this run.

### Delta character — test-and-metadata-only, source frozen

- [info] v1.2.1 is a pure verification milestone: it adds the byte-exact multi-chunk retained-tail proof that the v1.2 audit explicitly flagged as the one open warning ("multi-chunk case-3 tail proven by newest-marker not byte-exact ordering … a byte-exact incremental-tail assertion would fully close it"). `git diff HEAD -- log-writer.mjs` is empty — the enforcement logic is unchanged from the already-PROVEN v1.2 writer, so there is no new runtime behavior to regress, only a stronger test over existing code. This is the correct shape for a "tail verification" milestone.

### REQ-013 — does the test genuinely force repeated small over-budget rewrites?

- [info] Yes, verified by independent arithmetic and by reading `writeBounded` against the test. Each chunk is `[chunk-<i>]` (9 B) + `<i>` repeated 61× (61 B) + `\n` (1 B) = **71 B**, for single-digit indices 0–9. Cap is 128 B. Since 71 < 128, the oversized-chunk path (case 1) never fires — the test isolates the _small-chunk_ paths, which is exactly REQ-013's target. Trace: chunk 0 → `size+chunk=71≤128` → case 2 append (`size=71`); chunks 1–9 → `size+chunk=128+71 > 128` → case 3 over-budget rewrite (read newest `128-71=57` B, `truncate(0)`, rewrite `[retained 57][new 71]=128`). That is **nine genuine repeated case-3 over-budget rewrites**, not one.
- [info] The "delayed per-write exact comparison" is what forces the repetition rather than coalescing into one buffer. After each `child.stdin.write(chunk)`, the test blocks in `waitForExactLog` until the on-disk file equals `completeInput.subarray(-128)` for the running stream. Because each chunk's content is distinct (`chunk-0`…`chunk-9`), a stale file can never spuriously match the new expected value, so the poll only returns once _that_ chunk has been fully processed and rewritten to disk. The next chunk is therefore sent strictly after the prior one is drained — Node cannot coalesce them into a single stdin read, so each is a separate `for await` iteration and a separate over-budget rewrite. The synchronization is load-bearing, not cosmetic.
- [info] Intermediate correctness is checked, not just the end state: `waitForExactLog` asserts the byte-exact newest-128 suffix after _every_ chunk (its deadline fallback is `assert.deepEqual`), so all nine mid-stream case-3 rewrites are byte-verified. Final assertions confirm file == newest 128 B of the full 710-B stream, `size==128`, `truncated=="true\n"`, `drained=="drained\n"`. Cap, truncation-marker, and drain guarantees (REQ-011/REQ-012 clauses cited by REQ-013) are all re-asserted for this multi-write path. Read-offset safety holds: case 3 only runs when `size+chunk>maxBytes` with `chunk<maxBytes`, which implies `size ≥ maxBytes-chunk = retainedBytes`, so the `handle.read(..., size-retainedBytes)` never underflows.

### Package metadata consistency

- [info] Version is coherent at 1.2.1 across `package.json`, `extension-manifest.json`, and both `package-lock.json` occurrences. `test-package.mjs` asserts the packed `packageJson.version == "1.2.1"` and `manifest.version == packageJson.version`, and this ran green in the fresh gate. `git grep 1.2.0` over tracked non-lock, non-planning files returns nothing — no stale version string survives. README carries no version literal, so no doc drift. `log-writer.mjs` remains listed in `package.json` `files` and asserted present in the offline install.

### Regressions & safety

- [info] No regression surface. The test refactor (path/argument helpers, `...paths` spread in the close handler) preserves `runWriter`'s behavior exactly; the two pre-existing sub-tests (100 KB single-write cap, unlimited) are unchanged in intent and pass. No source, schema, tool, or safety-relevant file changed, so the v1.1/v1.2 safety posture (0600 artifacts, 0700 job dirs, operator-only cap with no model-reachable override, quoted logger spawn, fail-visible drain) is carried forward intact. `npm audit --omit=dev` = 0 vulnerabilities.
- [info] Working-tree state: the milestone is uncommitted (test + metadata + planning edits staged in the working tree, no new commit). Expected for pre-close-out; commit the milestone at or before the ROADMAP/STATE flip so shipped state lands in history. Not a defect.

### ASSERTED Items from TRACEABILITY.md

- None. The independent sweep classified REQ-001 … REQ-013 as PROVEN (REQ-006 with the noted, unchanged live-turn delivery boundary). No ASSERTED, OPEN, or WAIVED items to adjudicate. REQ-013's prior v1.2 warning is now fully closed by the byte-exact incremental proof.

### Verdict

PASS

- Critical findings: 0 (nothing blocks milestone closure)
- Warnings: 1 (REQ-006 live-turn delivery still has unit+wiring proof only, no end-to-end integration test — unchanged from v1.1/v1.2, low-risk, out of v1.2.1 scope)
- Info: notes on the test-only/source-frozen delta, verified nine-rewrite forcing mechanism, mid-stream byte-exactness, metadata consistency, and no-regression/safety posture

v1.2.1 is closure-ready. REQ-013 is independently PROVEN: the delayed per-write exact comparisons genuinely force nine repeated small over-budget rewrites of the existing `writeBounded` case-3 path, every intermediate and final state is byte-checked against the true chronological newest-`maxBytes` suffix, and cap/truncation-marker/drain guarantees hold throughout. Package metadata is consistent at 1.2.1 with no stale references, the source is unchanged so there is no new runtime regression surface, structure lint is clean, and the gate passes with zero vulnerabilities. The single remaining warning (REQ-006 live-turn delivery) predates this milestone and is out of scope. `saga-audit` does not flip ROADMAP/STATE; the mechanical completion step remains with the executor's `saga-run` after this PASS.

---

## Audit: v1.2.2-live-completion-proof — 2026-07-24

Auditor: Opus 4.8 (claude-opus-4-8[1m]) — independent frontier close-out context; executed no v1.2.2 slice.
Scope: v1.2.2 Live completion proof — a real in-memory Pi AgentSession proves dispatch completion enters the originating session exactly once and triggers a follow-up turn, while shutdown suppresses late delivery (REQ-014). Also re-swept REQ-001…REQ-013 as claims against a fresh gate.
Files reviewed: v1.2.2 delta vs HEAD (v1.2.1 release, commit 1bdd50a) — working-tree changes only, no new commit yet. New untracked file `test-live-notification.mjs` (237 LOC, the real-AgentSession proof). Changed: `scripts/test-in-tmux.sh` (+1, wires the new test into `run_tests`), `package.json`/`extension-manifest.json`/`package-lock.json` (version 1.2.1→1.2.2), `test-package.mjs` (version assert 1.2.1→1.2.2), `README.md`/`CLAUDE.md` (doc updates), plus `.planning/{REQUIREMENTS,ROADMAP,STATE,TRACEABILITY}.md`. **No production source changed:** `git diff HEAD` over `index.ts`, `agent-adapters.ts`, `completion-notifier.ts`, `job-manager.ts`, `model-registry.ts`, `log-writer.mjs` is empty.

Independence: confirmed. This context did not author or execute any reviewed slice. `.planning/config.json` carries a non-empty `close_out_auditor` key, so the frontier close-out gate is satisfiable. Saga structure lint (`saga-lint --format json`) re-run fresh: `clean: true`, 0 findings, exit 0. Gate re-run fresh by the auditor: `npm run check` exit 0, confirmed via captured exit status (typecheck + all seven in-tmux suites incl. `live Pi completion delivery and shutdown suppression passed`; `npm audit --omit=dev` = `found 0 vulnerabilities`). Existing PROVEN labels and checked boxes were treated as claims and re-verified against source, tests, and this run.

### Delta character — test-and-metadata-only, production source frozen

- [info] v1.2.2 adds only a test, its harness wiring, a version bump, and docs. The completion/notifier/shutdown runtime it proves (`completion-notifier.ts` `DispatchCompletionNotifier`, `index.ts:74-75` `pi.sendMessage` + `session_shutdown` wiring, `job-manager.ts` wait/lifecycle) is byte-identical to the already-shipped v1.2.1 code. There is therefore **no new production runtime behavior to regress** — the milestone strengthens evidence over frozen code, which is the correct shape for a "live completion proof" milestone. Production runtime behavior is confirmed unchanged.
- [info] The new test is genuinely wired into the gate: `scripts/test-in-tmux.sh:11` runs `test-live-notification.mjs` inside `run_tests`, so `npm run check` (via `npm test`) executes it. Confirmed by the fresh run printing `live Pi completion delivery and shutdown suppression passed` between the notifier and package suites.

### REQ-014 — does the test exercise the real Pi pipeline the requirement demands?

Independently inspected `test-live-notification.mjs` line-by-line and traced it against `index.ts`/`completion-notifier.ts`. Each REQ-014 clause is met by a real, non-mocked mechanism:

- [info] **Real AgentSession + extension registration.** `createAgentSession` is driven with a real `ModelRuntime`, `SessionManager.inMemory`, `SettingsManager.inMemory`, and `DefaultResourceLoader` that loads the packaged `index.ts` via `additionalExtensionPaths`. The test asserts `result.extensionsResult.errors == []`, that the extension whose path ends `/index.ts` is present, and that its registered `tmux_agent` and `tmux_job` tools exist. This is the shipped extension in a real session, not a stub.
- [info] **Real tool execution + real tmux child.** The scripted `fauxProvider` emits a `tmux_agent` dispatch tool call; the tool runs the real `manager.start` path, spawning a genuine tmux pane running a fake `pi` executable that reads the prompt over stdin (private transport, no argv exposure) and exits after ~0.35 s. The test counts `tool_execution_end` events with `toolName === "tmux_agent"` and asserts exactly one. Requires a real tmux (the harness provides `TMUX`/`TMUX_PANE`); the gate ran it inside tmux 3.4.
- [info] **Custom-message ingestion + follow-up model context.** After the child exits, `DispatchCompletionNotifier.monitor` calls the wired `pi.sendMessage(..., {deliverAs:"followUp", triggerTurn:true})`. The test asserts exactly one `role==="custom"` / `customType==="tmux-agent-completion"` session message whose `content` matches `job=<name>`, and — the strongest check — the third faux response is a function that stringifies `context.messages` and asserts the delivered completion text (`Agent dispatch completed: backend=pi`, `job=<name>`) is actually in the follow-up model context before returning `COMPLETION_FOLLOW_UP_SEEN`. This proves ingestion into the _model's_ context, not merely into `session.messages`.
- [info] **Exactly-once behavior.** The test asserts `toolExecutions == 1`, `agentStarts == 2` (exactly one additional agent run), `faux.state.callCount == 3` (exactly one follow-up model call), and `customCompletions.length == 1`, followed by a 300 ms quiescence sleep. The exactly-once guarantee is structurally enforced in code (`completion-notifier.ts` `delivered` Set + `while` loop break after `!timedOut`), so the timing window is a secondary belt-and-suspenders check rather than the primary guarantee — adequate, and the code invariant is the real basis.
- [info] **Real reload/session_shutdown suppression.** Scenario 2 dispatches a slow (~1.2 s) child, then calls real `session.reload()` (which fires `session_shutdown` → `notifier.shutdown()`, aborting the monitor's `AbortController` and setting `active=false`) _before_ the child completes. It then `tmux_job wait`s for the child to actually exit and sleeps 300 ms, so the completion event genuinely occurs after shutdown, and asserts zero custom messages, `agentStarts` still 1, and `faux.callCount` still 2. Had suppression failed, the post-reload child exit would have delivered a message and triggered a run/call — the assertions would catch it. This is a genuine post-shutdown suppression proof, not a race that happens to pass.

### Timing, race robustness, failure visibility, cleanup

- [info] Timing margins are comfortable: `waitUntil` deadline 5000 ms vs a ~0.35 s child (scenario 1) and a 5 s `tmux_job wait` vs a ~1.2 s child (scenario 2). Low flake risk under normal load. The exactly-once and suppression guarantees rest on code invariants (delivered Set, loop break, abort-on-shutdown, post-loop `active`/`aborted`/`delivered` guard in `completion-notifier.ts:56`), so a slow machine would at worst time out loudly rather than pass spuriously.
- [info] Failure visibility is good: the scenario-1 `waitUntil` is wrapped in try/catch that dumps `agentStarts`, `toolExecutions`, `modelCalls`, and full `session.messages` as JSON before rethrowing.
- [info] Cleanup is disciplined: each scenario force-closes its owned pane in `finally` (`closeOwnedJob`), reloads/disposes the session, and unregisters the faux provider; the outer `finally` removes the temp root. Per-session `PI_TMUX_JOB_ROOT` isolates job dirs; `PI_TMUX_JOB_MAX_LOG_BYTES=4096` means the live path also exercises capped logging. Names/windows are `process.pid`-scoped to avoid collisions.

### Metadata consistency, documentation, regressions, safety

- [info] Version is coherent at 1.2.2 across `package.json`, `extension-manifest.json`, and both `package-lock.json` package entries; `test-package.mjs` asserts the packed `packageJson.version == "1.2.2"` and `manifest.version == packageJson.version`, green in the fresh gate. `git grep 1.2.0|1.2.1` over tracked non-lock, non-planning files returns nothing. The lone `1.2.0` in `package-lock.json:1738` is the transitive dev dep `fast-xml-builder@1.2.0`, not this package — not drift.
- [info] Documentation updated in step: `README.md` now lists exactly-once completion delivery into a real Pi AgentSession follow-up turn and reload suppression among the integration behaviors; `CLAUDE.md` adds the `test-live-notification.mjs` layout line. ROADMAP still shows v1.2.2 as 🚧 and STATE `status: active` / "independent v1.2.2 close-out pending" — correctly **not** flipped; that mechanical step is out of an auditor's authority.
- [info] No regression surface: production source is unchanged, so the v1.1/v1.2/v1.2.1 correctness/drain/cap/safety posture carries forward intact. The added test only reads/spawns within temp dirs and tmux panes it owns and cleans. `npm audit --omit=dev` = 0 vulnerabilities. The fake `pi` binary uses `set -euo pipefail`, consumes the prompt over stdin (no argv exposure), and is confined to the per-run `fake-bin` temp dir.

### ASSERTED Items from TRACEABILITY.md

- None. The independent sweep classified REQ-001 … REQ-014 as PROVEN with located, freshly reproduced evidence. No ASSERTED, OPEN, or WAIVED items to adjudicate. The REQ-006 "live-turn delivery, unit+wiring only" boundary flagged in the v1.1/v1.2/v1.2.1 audits is now **closed**: REQ-014 drives the identical `pi.sendMessage`/`session_shutdown` wiring through a real AgentSession and observes the delivered follow-up turn.

### Verdict

PASS

- Critical findings: 0 (nothing blocks milestone closure)
- Warnings: 0 blocking. The only standing warning across prior audits (REQ-006 live-turn delivery had unit+wiring proof only) is resolved by this milestone.
- Info: notes on the test-and-metadata-only frozen-source delta, harness wiring, the five REQ-014 clause-by-clause mechanisms, timing/failure-visibility/cleanup, and metadata/doc/regression/safety posture.

v1.2.2 is closure-ready. REQ-014 is independently PROVEN: the test loads the shipped extension into a real in-memory Pi `AgentSession`, executes `tmux_agent` dispatch against a real tmux child, and asserts exactly one `tmux-agent-completion` message ingested into the follow-up model context with exactly one additional agent run and model call, plus a genuine post-`reload()`/`session_shutdown` suppression proof over a child that completes after shutdown. Production runtime behavior is unchanged (source byte-identical to HEAD), the new test is wired into and passes the fresh gate, version metadata is consistent at 1.2.2 with no stale references, structure lint is clean, and `npm audit` reports zero vulnerabilities. `saga-audit` does not flip ROADMAP/STATE; the mechanical completion step remains with the executor's `saga-run` after this PASS.

---

## Audit: v1.3-workspace-safety — 2026-07-24

Auditor: independent Claude Code dispatch in a read-only tmux agent; authored none of the v1.3 slices.
Scope: REQ-015 through REQ-019 plus regression safety for REQ-001 through REQ-014.
Full report: `/tmp/pi-tmux-v1.3-audit.txt` (session artifact); durable verdict and findings are recorded below.

### Evidence reproduced

- `npm run check` exited 0: TypeScript, all eight tmux suites, packed install/discovery, real AgentSession completion proof, and `npm audit --omit=dev` with 0 vulnerabilities.
- Saga lint returned `clean: true` with no findings.
- Package, lockfile, and manifest versions are consistent at 1.3.0; `workspace-manager.ts` is present in the packed package.
- REQ-015 through REQ-018 were independently traced to implementation and behavioral tests. REQ-019's documentation, package, regression, and no-force-override clauses were verified directly.

### Safety findings

- No Critical, High, or Medium findings.
- [info] Dirty writes fail closed at policy and creation layers; concurrent writer allocation is serialized and proven to select a distinct managed worktree.
- [info] Creation and cleanup verify external ownership and constrain cleanup targets beneath the operator root.
- [info] Unchanged branch deletion uses atomic `git update-ref -d <ref> <expected-old-value>`; dirty worktrees and committed branches are retained.
- [info] Cleanup is idempotent through durable tombstones and exposes no model-reachable force/destructive override.
- [low] One malformed self-written workspace record can make `list()` fail rather than skip/quarantine only that record. This mirrors existing malformed-metadata behavior, does not affect historical records lacking workspace metadata, and is a non-blocking future hardening item.
- [info] Read intent is declared rather than sandbox-enforced, and the allocation mutex is per extension instance. Both boundaries are documented and consistent with package scope.

### Requirement verdicts

- REQ-015: PASS
- REQ-016: PASS
- REQ-017: PASS
- REQ-018: PASS
- REQ-019: PASS
- REQ-001 through REQ-014 regression sweep: PASS

### Verdict

PASS

v1.3 is release-ready. No code change was requested by the auditor. The single Low robustness observation is deferred; it does not weaken workspace ownership, cleanup safety, or backward compatibility.

---

## Audit: v1.4-job-status-widget — 2026-07-25

Auditor: Opus 4.8 (claude-opus-4-8[1m]) — independent frontier close-out context; executed no v1.4 slice.
Scope: v1.4 Job status widget — a quiet session-scoped footer aggregate and bounded below-editor widget show live owned-job state without noisy polling output or lifecycle leaks (REQ-020 through REQ-024). Also re-swept REQ-001…REQ-019 for regression safety.
Files reviewed: v1.4 delta vs HEAD (v1.3 release, commit c4f52cb) — 15 tracked files changed, 149 insertions(+), 29 deletions(-) — plus 6 new untracked files (3 source: `job-status.ts`, `job-status-monitor.ts`, `job-status-ui.ts`; 3 tests: `test-status.mjs`, `test-status-monitor.mjs`, `test-status-ui.mjs`). Production source delta is confined to `index.ts` (+13) and `job-manager.ts` (+40) plus the three new pure modules; `agent-adapters.ts`, `completion-notifier.ts`, `model-registry.ts`, `log-writer.mjs`, `workspace-manager.ts` are byte-identical to HEAD.

Independence: confirmed. This context authored and executed no reviewed slice. `.planning/config.json` carries a non-empty `close_out_auditor` key, so the frontier-verify close-out gate is satisfiable and a non-frontier executor can perform mechanical closure after reading these certified artifacts. Saga structure lint (`run-lint.sh .`) re-run fresh: the sole pre-rewrite finding was `TRACE_DONE_OPEN` for REQ-024 — the executor's deliberate pre-audit OPEN, not a malformed spine — and it clears to exit 0 after the independent TRACEABILITY rewrite. Gate re-run fresh by the auditor: `npm run check` exit 0, confirmed via captured exit status (typecheck + all eleven in-tmux suites, incl. the three new `job-status` proofs, all passing; `npm audit --omit=dev` = `found 0 vulnerabilities`). Existing PROVEN labels and checked boxes were treated as claims and re-verified against source, tests, the real Pi SDK, and this run.

### Delta character — additive, no existing path mutated

- [info] The v1.4 runtime change is purely additive. `job-manager.ts` gains an optional `agent?: AgentJobMetadata` field with a strict `parseAgentMetadata` that returns `undefined` for absent metadata (historical compat) and throws only on a malformed _present_ value; it is threaded through `readJobMetadata`, `list`, and `start` alongside the existing `workspace` field using the same additive shape. `index.ts` adds a `session_start`/`session_shutdown` monitor lifecycle and passes `agent: { backend, mode }` into `manager.start`. No PTY/drain, log-writer, completion-notifier, workspace, or model-routing code path is touched, so the v1.1–v1.3 correctness/safety posture carries forward by construction — and is re-confirmed green in the fresh gate.

### Correctness (REQ-020, REQ-021)

- [info] REQ-020 metadata is genuinely additive and backward-compatible. `parseAgentMetadata` (`job-manager.ts:146-160`) validates `backend`/`mode` against `AGENT_BACKENDS`/`AGENT_MODES` and is symmetric with the existing workspace parser. Generic `tmux_job` jobs never carry it (`index.ts` only sets `agent` on the `tmux_agent` path). `test-manager.mjs:66-75` proves generic omission, malformed refusal (`await assert.rejects(manager.list(), /Invalid agent in job metadata/)`), and missing-field round-trip; `test-extension.mjs:353-372` proves durable + listed round-trip for every backend×mode through real tmux.
- [info] REQ-021 projection is correct and pure. `projectJobStatus` (`job-status.ts:55-73`) sorts a copy (`[...jobs].sort`), never mutating input (asserted `test-status.mjs:54,57`); classifies running/exited/attention; orders running(0)→attention(1)→exited(2) with name→id ties; and reports every required field — name, `backend/mode` or `cmd`, `state`/`exit=<code>`, `workspace=<kind>`, `log=truncated`. Overflow is explicit (`… +N more`), correct even at `detailLimit` 0 (`… +4 more`, `test-status.mjs:66`).

### Safety (REQ-022, REQ-024)

- [info] The monitor cannot overlap, spam, or leak. `JobStatusMonitor` (`job-status-monitor.ts`) guards a single in-flight poll (`inFlight`), publishes only on changed `view:`/`error:` keys, bounds normalized error text to 240 chars, and enforces a 100 ms minimum cadence. Late-result and cross-session suppression rest on a `generation` counter incremented on both `start()` and `stop()` and re-checked after each `await`, so a poll resolving after stop/reload is discarded (`test-status-monitor.mjs:98-112`). This is a code invariant, not a timing race.
- [info] No background resource starts from the extension factory (REQ-024 core clause). The factory body only registers handlers/tools; `setInterval` is reachable only inside `monitor.start()`, itself reachable only from a TUI `session_start`. `test-package.mjs:107-116` wraps `discoverAndLoadExtensions` and asserts `factoryIntervalCalls === 0` — a real resource-leak check over the packed extension.
- [info] Non-TUI modes are inert. `startJobStatusSession` returns `undefined` for `ctx.mode !== "tui"` (`job-status-ui.ts:56`), so RPC/JSON/print start no timer, no `manager.list()` polling, and touch no UI surface — proven end-to-end by `test-status-ui.mjs:48-63` (no schedule, no list call, empty status/widget arrays).
- [info] No new model-reachable or destructive surface. The status feature is a read-only projection of `manager.list()`; the three modules contain no `exec`/`spawn`/`rm`/`unlink`/`registerTool`/`notify`/`sendMessage` (grep-confirmed). UI output is bounded (≤4 detail lines + overflow, 240-char errors) and lives on footer/widget surfaces, not model-facing tool output — so no unbounded model output and no noisy notifications are introduced.

### Test Coverage

- [info] Coverage is strong and behavior-oriented across three layers. Pure projection: `test-status.mjs` (12 cases incl. immutability, reorder-invariance, overflow at limits 2 and 0). Monitor lifecycle: `test-status-monitor.mjs` drives a fake scheduler + deferred promises through min-interval, immediate/idempotent start, overlap suppression, view dedup, identical-error dedup, recovery republish, cancel/clear, and post-stop late-result + dead-callback suppression. UI bridge: `test-status-ui.mjs` proves non-TUI inertness, exact themed `setStatus`/`setWidget(belowEditor)` calls, active-first content, empty/error clearing, and timer cancellation. `test-extension.mjs` adds real-extension handler-count assertions.
- [warning] The real-Pi TUI rendering surface (`ctx.ui.setStatus`/`setWidget`) is exercised only against a locally-declared `JobStatusUiContext` fake, not a live Pi TUI session. I independently mitigated this by inspecting the pinned Pi SDK 0.81.1: the `session_start (_event, ctx)` signature, `ctx.mode` enum, and `setStatus`/`setWidget(key, lines, { placement: "belowEditor" })`/`theme.fg` API all match the bridge exactly (`docs/extensions.md`, `docs/tui.md`, `docs/rpc.md`). Risk is low and the contract is confirmed by inspection, but there is no automated guard against a future Pi UI-API drift. Non-blocking follow-up: a thin real-`AgentSession` TUI-mode smoke (analogous to `test-live-notification.mjs`) would close it.

### Architecture Fit

- [info] Clean separation with correct dependency direction: `job-status.ts` (pure, type-only import of `TmuxPaneJob`) ← `job-status-monitor.ts` (scheduling/dedup, injectable scheduler) ← `job-status-ui.ts` (Pi bridge) ← `index.ts` (wiring). No circular dependencies; the monitor is fully testable via injected `schedule`/`cancel`/`project`. The `agent` metadata mirrors the established `workspace` metadata pattern rather than inventing a new one. Good fit.
- [info] The single shared `session_shutdown` handler cleans up both the notifier and the status monitor (`index.ts:99-103`), and `session_start` replaces any prior monitor before starting a fresh one — correct handling of session replacement (`new`/`resume`/`fork`) with no handler accumulation, asserted by the one-handler counts in `test-extension.mjs` and `test-package.mjs`.

### Operability

- [info] Debuggability is preserved and extended. Exited jobs remain listed until their pane closes (`job-manager.ts:255-257` execs a login shell after the command), so the widget accurately reflects inspectable panes. A polling failure degrades to a single quiet `tmux: unavailable` footer state with a README troubleshooting entry pointing at `tmux_job list` for the full error. README documents the TUI-only scope, the four-line+overflow bound, cadence, and non-TUI no-timer behavior.
- [info] Working-tree state: the milestone is uncommitted (additive source/tests + version/doc/planning edits in the working tree, no new commit). Expected for a pre-close-out milestone; commit at or before the ROADMAP/STATE flip so shipped state lands in history. Not a defect.

### ASSERTED Items from TRACEABILITY.md

- None. The independent sweep classifies REQ-001…REQ-024 as PROVEN with located, freshly reproduced evidence. There are no ASSERTED, OPEN, or WAIVED items to adjudicate. The pre-audit REQ-024 OPEN (a deliberate executor placeholder pending this audit) is now PROVEN: packaging is consistent at 1.4.0, all three status modules are packed, the factory-timer leak check passes, the README contract holds, and this independent audit returns PASS.

### Verdict

PASS

- Critical findings: 0 (nothing blocks milestone closure)
- Warnings: 1 (real-Pi TUI render surface exercised only against a locally-typed fake; the Pi SDK 0.81.1 contract was confirmed by direct inspection, so risk is low — a real-session TUI smoke is the non-blocking follow-up)
- Info: correctness/safety/architecture/operability notes on the additive delta, pure projection, generation-based leak safety, factory no-timer proof, non-TUI inertness, and dependency structure

v1.4 is closure-ready. Every new requirement (REQ-020 additive backend/mode metadata, REQ-021 stable bounded projection, REQ-022 non-overlapping leak-free monitor, REQ-023 non-replacing footer/widget integration, REQ-024 documented/packaged/regression-proven) is independently PROVEN with located, freshly reproduced evidence; the production delta is additive-only and every prior REQ-001…REQ-019 regression suite passes clean with zero vulnerabilities; the monitor's overlap/late-result/leak guarantees are code invariants proven by a fake-scheduler suite; the extension factory starts no background timer and non-TUI modes are inert; and the real Pi SDK UI/event contract matches the bridge by inspection. The single warning is a test-surface gap over a contract confirmed by inspection, not a defect. `saga-audit` does not flip ROADMAP/STATE; the mechanical completion step remains with the executor's `saga-run` after this PASS.
