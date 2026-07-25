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

---

## Audit: v1.4.1-real-tui-status-proof — 2026-07-25

Auditor: Claude Opus 4.8 (`claude-opus-4-8[1m]`), independent frontier close-out auditor invoked via `.planning/config.json` `close_out_auditor`. Authored no v1.1/v1.2/v1.2.1/v1.2.2/v1.3/v1.4/v1.4.1 slice.
Scope: v1.4.1 "Real TUI status proof" — a real Pi `InteractiveMode` bridge and real tmux job proving rendered running, exited, pane-close-cleared, and monitor-stop-cleared status behavior without raw terminal startup or resource leaks (REQ-025).
Files reviewed: 11 files changed, 208 insertions(+), 19 deletions(-) vs the milestone-start commit `85489a3` (git diff --shortstat). Production source delta is **zero** (`index.ts` and all `job-*.ts`/adapters unchanged); the milestone is the new proof `test-real-tui-status.mjs` (+180), its harness wiring (`scripts/test-in-tmux.sh` +1), `test-package.mjs` (+2 README assertions, version 1.4.1), README (+1 paragraph + test-list line), version bumps to 1.4.1 (`package.json`, `extension-manifest.json`, `package-lock.json`), and planning files.

Method: read STATE/ROADMAP/REQUIREMENTS/TRACEABILITY and both saga skills; inspected the pinned Pi SDK 0.81.1 `InteractiveMode` internals (`node_modules/.../interactive-mode.{d.ts,js}`) to verify the seams the test pokes; re-ran the structure lint and the gate fresh via both invocation paths; instrumented the real `InteractiveMode` footer/widget storage with a throwaway replica to isolate the failure (removed after use). No implementation, test, package, README, ROADMAP, REQUIREMENTS, or STATE file was edited.

### Correctness

- [info] The proof is genuine where it counts. The test drives the _real_ extension UI context (`mode.createExtensionUIContext()`, `interactive-mode.js:1656` — the same object Pi hands extensions), and reads Pi's _real_ stores and renderers: `setStatus`→`setExtensionStatus`→`footerDataProvider.setExtensionStatus` (`interactive-mode.js`), `setWidget(...belowEditor)`→`setExtensionWidget` which wraps the extension's lines in a real `Container`/`Text` component tree (`interactive-mode.js:1455-1487`), and `mode.footer` = real `FooterComponent`. Instrumentation confirms the running→exited transition renders exactly the expected `▶ … · cmd · running` and `✓ … · cmd · exit=0` content. FooterComponent and below-editor widget rendering are authentically exercised. `InteractiveMode` is constructed without `init()`/`run()`, so no raw terminal input is started (constructor builds `new TUI(new ProcessTerminal())` but never enters raw mode) — the requirement's "without starting raw terminal input" clause holds.
- [info] Replacing `ui.requestRender` with a no-op does **not** materially weaken the proof. `setExtensionStatus` and `renderWidgets` (`interactive-mode.js:1535-1541`) call `this.ui.requestRender()` only to schedule a terminal byte-paint; the data still lands in `footerDataProvider`/`extensionWidgetsBelow` and the component tree is still built. The test then invokes the real components' `.render(width)` directly. Only Pi's internal terminal diff/paint pipeline is skipped — which requires a live TTY the requirement explicitly excludes. The seam is the correct, minimal suppression of an out-of-scope side effect, not a shortcut that fakes the render.
- [critical] **The proof is non-hermetic and its assertions are mis-scoped.** `TmuxJobManager.list()` (`job-manager.ts:302-349`) enumerates every pane in the manager's tmux session (`tmux list-panes -a`, filtered to `rowSession === sessionId` + the `@pi_tmux_job_id`/`@pi_tmux_job_dir` ownership options), returning _all_ owned jobs in the session. `test-real-tui-status.mjs` asserts session-wide singleton counts — `/tmux: 1 running/` (line 129), `status.includes("tmux: 1 exited")` (line 137), `rendered(mode.footer)` `/tmux: 1 exited/` (line 140) — and requires the status map to go empty after closing its single job (lines 144-149). Any second owned job in the session breaks all of them. The exited-widget branch (`rendered(widget).includes("exit=0")`, line 138) would also match the wrong job. The widget-content checks are already scoped by `lifecycleName`, but the footer/clear checks are not.

### Safety

- [info] Resource hygiene is sound. The `finally` block stops the monitor, force-closes any still-open tmux targets, calls `mode.stop()`, `session.dispose()`, `modelRuntime.unregisterProvider(...)`, kills the tmux window, and removes the temp root. No Pi/model/tmux/timer/temp leak on either the pass or the assertion-failure path (verified — a failing run still tears the window and temp dir down).
- [warning] The milestone's production behavior is correct and, if anything, the test under-proves it: the footer legitimately aggregates _all_ owned jobs (`tmux: 1 running · 1 exited` observed), which is the headline value of a multi-job status widget. The proof only ever asserts the single-job case and actively breaks when the multi-job case it should showcase occurs.

### Test Coverage

- [critical] The gate result is **invocation-dependent**, and it is RED in the environment where close-out runs:
  - Isolated-session path (harness spawns its own temp tmux session; `npm run check` from a non-tmux shell): all **12/12** suites pass, including `real Pi InteractiveMode running, exited, closed, and stop status proof passed`. Reproduced fresh (`env -u TMUX -u TMUX_PANE bash scripts/test-in-tmux.sh`). This is the executor's "gate green" path and it is legitimate.
  - In-session path (`npm run check` invoked inside a tmux session already holding a sibling owned pi-tmux job): the configured gate exits **1** deterministically (3/3 standalone + the gate) at `test-real-tui-status.mjs:135` — "real InteractiveMode did not render exited footer/widget state". Seven suites pass before the abort (`set -euo pipefail`); `npm audit` is never reached.
  - The close-out itself triggers the failure: this auditor process runs inside an owned pane (`@pi_tmux_job_name=v141-closeout-audit`, `@pi_tmux_job_id=v141-closeout-audit-ms09706t-…`, session `$0`) that saga-run dispatched through the very extension under test, so `list()` reports two running jobs. The same failure occurs for any user who runs `npm run check` from a tmux session while a `tmux_agent`/`tmux_job` is live — a first-class use of this extension.
- [info] Underlying feature coverage remains strong: the pure projection (`test-status.mjs`), monitor lifecycle (`test-status-monitor.mjs`), and UI bridge against a typed fake (`test-status-ui.mjs`) all pass; this milestone's new test correctly closes the v1.4 audit's "typed-fake only" warning by exercising the real InteractiveMode — it just does so with mis-scoped assertions.

### Architecture Fit

- [info] Reaching Pi's `private` fields (`mode.ui`, `mode.footer`, `mode.footerDataProvider`, `mode.extensionWidgetsBelow`, `mode.createExtensionUIContext()`) is legitimate for a render proof — `private` is compile-time only and the test is `.mjs`, so runtime access is valid and typecheck does not police it. It is inherently brittle to SDK internal renames, but that is an accepted cost of white-box render verification and is not a defect. No production coupling is introduced (the test is not shipped; `files` excludes tests).

### Operability

- [warning] The recorded evidence was misleading before this audit: `.planning/TRACEABILITY.md` and STATE described REQ-025 runtime evidence as green and the "Full gate passes," stated unconditionally. That is true only for the isolated-session invocation and silently false for the in-session/concurrent-job case. TRACEABILITY has been rewritten this pass to record both paths and the RED close-out gate; STATE is left for the executor (out of auditor scope) and should be corrected before any retry.
- [info] The fix is small, test-local, and low-risk: scope the footer and empty-clear assertions to the test's own job id/name (mirroring the existing widget-line scoping), or construct the `TmuxJobManager` against a dedicated tmux session/server so `list()` cannot see sibling jobs. Either restores a hermetic, deterministic proof and additionally lets the test assert the multi-job aggregate on purpose. No production code change is required.

### ASSERTED Items from TRACEABILITY.md

- REQ-025 — **confirmed not PROVEN.** The evidence is located and the render path is genuinely correct, but the located proof does not reproduce green under the milestone's own close-out conditions (in-session gate exits 1, deterministically). It passes only in an isolated tmux session. Classified ASSERTED (claimed `[x]`, no _passing_ proof under close-out conditions). Not upgraded to PROVEN.

### Verdict

FAIL

- Critical findings: 2 (non-hermetic mis-scoped assertions in `test-real-tui-status.mjs`; the configured gate `npm run check` exits 1 deterministically in the close-out / concurrent-owned-job environment)
- Warnings: 2 (the proof under-proves the multi-job aggregate it should showcase; pre-audit records overstated the evidence as unconditionally green)
- Info: the render proof, `requestRender` seam, resource hygiene, and private-field access are all sound; production source delta is zero and REQ-001…REQ-024 re-prove green in the isolated path

This is not a production defect — the projection, monitor, UI bridge, real InteractiveMode rendering, and the `ui.requestRender` seam are all correct, and `npm run check` from a normal non-tmux shell is 12/12 green. It is a test-hermeticity defect that makes the milestone's own gate red in the exact environment where close-out executes, backed by a records claim ("Full gate passes") that is not unconditionally true. Fail-closed per the close-out brief: REQ-025 is ASSERTED (not PROVEN) and the configured gate fails in-session, so the milestone does not pass audit and must remain open. Remediation: scope `test-real-tui-status.mjs`'s footer/clear assertions to its own job identity (or isolate its tmux session), then re-run the independent close-out. `saga-audit` does not flip ROADMAP/STATE; no completion flip is authorized.

---

## Audit: v1.4.1-real-tui-status-proof (RE-AUDIT after repair) — 2026-07-25

Auditor: Claude Opus 4.8 (`claude-opus-4-8[1m]`), independent frontier re-auditor invoked via `.planning/config.json` `close_out_auditor`. Authored no v1.1/v1.2/v1.2.1/v1.2.2/v1.3/v1.4/v1.4.1 slice. This section is a **second, independent close-out** run after the historical FAIL immediately above; that FAIL section is retained verbatim and is not rewritten.
Scope: v1.4.1 "Real TUI status proof" — a real Pi `InteractiveMode` bridge and real tmux job proving rendered running, exited, pane-close-cleared, and monitor-stop-cleared status behavior without raw terminal startup or resource leaks (REQ-025), plus a REQ-001…REQ-024 regression sweep.
Files reviewed: 11 files changed, 118 insertions(+), 47 deletions(-) vs the milestone-start commit `85489a3` (`git diff --shortstat`). **Production source delta is zero** — `index.ts`, all `job-*.ts`, `agent-adapters.ts`, `model-registry.ts`, `completion-notifier.ts`, `log-writer.mjs`, `workspace-manager.ts` are byte-identical to `85489a3`. The changed files are the (untracked) proof `test-real-tui-status.mjs`, its harness wiring (`scripts/test-in-tmux.sh`), `test-package.mjs`, README, version bumps to 1.4.1 (`package.json`, `extension-manifest.json`, `package-lock.json`), and the `.planning/` records. The repair the first audit demanded lives entirely in `test-real-tui-status.mjs`.

Method: read STATE/ROADMAP/REQUIREMENTS/TRACEABILITY and the installed `saga-check`/`saga-audit` skills; ran `saga-check` structure lane (`run-lint.sh .`, exit 0) treating REQ-025 ASSERTED as a claim; inspected the projection (`job-status.ts`), monitor (`job-status-monitor.ts`), UI bridge (`job-status-ui.ts`), and `list()` ownership filter (`job-manager.ts:302-349`) against the repaired test; re-ran the configured gate fresh **from this owned auditor pane under the exact adverse condition the first audit exposed**. No implementation, test, package, README, ROADMAP, REQUIREMENTS, or STATE file was edited; only TRACEABILITY and this AUDIT section were written.

### The adverse condition was genuinely reproduced

- [info] Live tmux inspection confirms the auditor runs inside owned pane `%1448` (`@pi_tmux_job_name=v141-closeout-reaudit`, `@pi_tmux_job_id=v141-closeout-reaudit-ms0gb0o0-8c177c`, session `0`), dispatched by saga-run through the very extension under test, **and** a second concurrent owned sibling pane `%1447` (`@pi_tmux_job_name=dns-lifecycle-review`) is live in the same session. `TmuxJobManager.list()` filters on tmux session + `@pi_tmux_job_id`/`@pi_tmux_job_dir` only (`job-manager.ts:326`), independent of the test's fresh temp job root, so the test's own manager genuinely enumerates both siblings. Because the harness runs `run_tests` directly when `TMUX`/`TMUX_PANE` are set (`scripts/test-in-tmux.sh`), the anchor is `%1448` → session `0` → the in-session path. This is precisely the environment that made the first audit's gate exit 1.

### Correctness — the repair is real, not cosmetic

- [info] The proof remains genuine where it counts. A real `AgentSession` + `InteractiveMode` are built without `init()`/`run()` (no raw-terminal input; constructor builds a `TUI`/`ProcessTerminal` but never enters raw mode), the concrete `mode.createExtensionUIContext()` drives `startJobStatusSession`, and the test reads Pi's real `footerDataProvider`/`extensionWidgetsBelow` stores plus real `FooterComponent`/Container/Text `.render()`. Replacing `mode.ui.requestRender` with a no-op suppresses only the out-of-scope terminal byte-paint the requirement excludes; the data still lands in the real stores and the real component tree is still rendered.
- [info] Every repair clause the brief named is present and correct:
  - **Own-line scoping** — `jobLine(mode, name)` selects the widget line containing the test's job name; running asserts `/cmd · running · workspace=-/` (`:150`) and exited asserts `cmd · exit=0` (`:156`) on that own line, not a session-wide count.
  - **Footer renders the published aggregate** — `footerRendersPublishedStatus(mode)` (`:74-77`) reads whatever aggregate the monitor last published into `footerDataProvider` and requires the real `FooterComponent.render()` to include it. With siblings this is the true multi-job aggregate (e.g. `tmux: 3 running`, then `tmux: 2 running · 1 exited`), so the assertion tracks reality instead of a hardcoded `1`.
  - **Pane close preserves sibling aggregation** — after closing its own job the test waits for its own line to disappear (`:162-165`), then reads `manager.list()` and requires empty surfaces **only** when `remainingAfterClose.length === 0` (`:167-169`); otherwise it requires the footer to still render the surviving aggregate (`:171`). Removes only the test's own line; siblings keep the widget alive.
  - **Empty UI only without siblings** — same `remainingAfterClose.length === 0` gate; the unconditional empty-surface assertion is confined to the no-sibling branch.
  - **Monitor stop clears both surfaces** — `monitor.stop()` then asserts both `STATUS_UI_KEY` and `STATUS_WIDGET_KEY` are absent from the real stores (`:181-184`). This is a monitor invariant, not job-dependent: `JobStatusMonitor.stop()` (`job-status-monitor.ts:52-60`) unconditionally publishes `{kind:"clear"}` → `applyJobStatusUpdate` clear → `clearStatusUi` → `setStatus/setWidget(undefined)` (`job-status-ui.ts:28-37`). Correct even with siblings present.

### Safety / resource hygiene

- [info] The `finally` block stops the monitor, force-closes every still-open owned target, calls `mode.stop()`, `session.dispose()`, `modelRuntime.unregisterProvider(...)`, kills the tmux window, and removes the temp root — on both the pass and assertion-failure paths. No Pi/model/tmux/timer/temp leak. Reaching Pi `private` fields from a `.mjs` test is legitimate white-box render verification (runtime access is valid; typecheck does not police it) and ships nothing (`files` excludes tests).

### Test Coverage — gate is now green under close-out conditions

- [info] Configured gate re-run fresh from the owned auditor pane with the sibling pane visible: `npm run check` exits **0** — typecheck, all twelve suites including `real Pi InteractiveMode running, exited, closed, and stop status proof passed`, and `npm audit --omit=dev` = `found 0 vulnerabilities`. This is the invocation path that deterministically exited 1 before the repair. `saga-check` structure lane (`run-lint.sh .`) re-run fresh: exit 0, no findings.
- [info] Underlying feature coverage is unchanged and strong: pure projection (`test-status.mjs`), monitor lifecycle (`test-status-monitor.mjs`), typed-fake UI bridge (`test-status-ui.mjs`), plus this milestone's real-InteractiveMode proof which closes the v1.4 "typed-fake only" warning — now with correctly-scoped assertions.
- [warning] Residual, non-blocking test-robustness gap: the below-editor widget is bounded to four detail lines + overflow (`job-status.ts:69-71`), and the test keeps its own line visible by relying on the natural running-before-exited ordering rather than scoping the projection to its own job id. Under the observed close-out load (two persistent siblings, ≤3 running) the own line stays within the bound. But ≥4 concurrently-running owned siblings sorted before the test's exited job would push its line into `… +N more`, and `jobLine` would return `undefined` → the exited-phase `waitUntil` would time out. This is environment-dependent test brittleness, not a production defect, and it does not occur under the close-out conditions where the gate was reproduced green. A future hardening would pass a per-test `detailLimit`/self-scope so the own line is guaranteed visible regardless of sibling count.

### Architecture Fit / Operability

- [info] Production source is untouched, so the v1.1…v1.4 correctness/safety/architecture posture carries forward by construction and every prior suite re-proves green in the same run. Records are now honest: TRACEABILITY records the single reproduced green gate under the real sibling condition (no unconditional "full gate passes" overstatement), and the historical FAIL is retained for provenance.

### ASSERTED Items from TRACEABILITY.md

- REQ-025 — **upgraded to PROVEN.** The prior ASSERTED classification was correct at the time (no passing proof under close-out conditions). This re-audit locates the evidence and freshly reproduces it green under the exact adverse condition (owned auditor pane + a second concurrent owned sibling visible to `list()`): the gate exits 0 with the real InteractiveMode proof passing and 0 vulnerabilities. No other ASSERTED/OPEN/WAIVED items exist.

### Verdict

PASS

- Critical findings: 0 (nothing blocks milestone closure; the two Criticals from the historical FAIL — mis-scoped assertions and the in-session gate exiting 1 — are both resolved and reproduced resolved)
- Warnings: 1 (bounded-widget test-robustness gap: ≥4 concurrently-running owned siblings could hide the test's own exited line; environment-dependent, does not trigger under close-out, non-blocking future hardening)
- Info: the real bridge, `requestRender` seam, own-job scoping, footer-aggregate/pane-close/monitor-stop clauses, resource hygiene, and zero production-source delta are all sound

v1.4.1 passes re-audit. REQ-025 is independently PROVEN: the repaired `test-real-tui-status.mjs` scopes running/exited/close assertions to the test job's own rendered line, requires the real `FooterComponent` to render the currently-published multi-job aggregate, removes only the test's own line on pane close while preserving sibling aggregation, requires empty surfaces only when no siblings remain, and clears both surfaces on monitor stop via a code invariant — and the configured `npm run check` exits 0 from the owned auditor pane with a second concurrent owned sibling genuinely visible to `list()`, the exact condition that produced the historical FAIL. Production source delta is zero, structure lint is clean, and `npm audit` reports zero vulnerabilities. The one warning is a non-blocking test-robustness follow-up. `saga-audit` does not flip ROADMAP/STATE; the mechanical completion step remains with the executor's `saga-run` after this PASS.
