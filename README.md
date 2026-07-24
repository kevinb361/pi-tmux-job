# pi-tmux-job

A Pi coding-agent extension for running long-lived or interactive commands in visible tmux panes. It gives the model structured job controls while keeping execution observable and directly accessible to the operator.

## Why

Pi intentionally does not provide opaque background Bash jobs. `pi-tmux-job` follows that philosophy: commands run in panes you can watch, inspect, interrupt, or take over.

Use normal Bash for quick commands. Use this tool for tests, builds, development servers, log tails, migrations, and other work where visibility or persistence matters.

## Requirements

- Linux or another Unix-like environment
- tmux 3.2 or newer
- Node.js 24 or newer
- Pi coding agent 0.80 or newer
- Pi itself must be running inside tmux

For reliable modified keys in Pi, follow Pi's [tmux setup documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/tmux.md).

## Install

Install directly from GitHub:

```bash
pi install git:github.com/kevinb361/pi-tmux-job
```

Then restart Pi or run:

```text
/reload
```

For local development:

```bash
pi install -l /path/to/pi-tmux-job
```

## Tools

The package registers two LLM-callable tools:

```text
tmux_job
tmux_agent
```

Supported actions:

| Action | Purpose |
|---|---|
| `start` | Start a command in a Pi-owned pane |
| `list` | List open Pi-owned jobs in the current tmux session |
| `status` | Show job state and recent pane output |
| `tail` | Capture recent pane output |
| `wait` | Wait for the command phase to finish, with a bounded timeout |
| `send` | Send literal input and optionally press Enter |
| `interrupt` | Send Ctrl-C |
| `close` | Close a completed pane; running jobs require `force=true` |
| `cleanup-workspace` | Safely remove a stopped agent job's verified managed worktree; no force override |

Jobs are addressed by name, generated ID, or tmux pane ID. The default window is `pi-jobs`; callers can select another safe window name.

### Agent launcher

`tmux_agent` launches the `pi`, `claude`, or `hermes` CLI. The returned job uses the same ownership and lifecycle controls as `tmux_job`.

| Parameter | Purpose |
|---|---|
| `backend` | Required: `pi`, `claude`, or `hermes` |
| `mode` | `dispatch` (default) or `interactive` |
| `intent` | `write` (conservative default) or guaranteed non-mutating `read` |
| `workspace` | `auto` (default), explicit `current`, or isolated `worktree` |
| `name` | Required unique safe job name |
| `prompt` | Required for dispatch; rejected for interactive mode |
| `model` | Exact Pi `provider/model`; valid only with `backend: pi` |
| `thinking` | Pi thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |
| `cwd` | Child working directory; defaults to Pi's current directory |
| `window` | Tmux window; defaults to `pi-jobs` |

Dispatch returns immediately and sends one bounded completion message back to the originating live Pi session. Jobs continue in tmux if Pi reloads or exits, but the old session's watcher is cancelled. Interactive mode starts the native CLI without an initial prompt; use `tmux_job send` or take over the pane directly.

Pi model selection is validated against the live output of `pi --list-models` before launch. Use exact identifiers, for example `openai-codex/gpt-5.6-sol`, `litellm/deep`, `litellm/deep-think`, or `litellm/fast`. GPT and local LiteLLM models run through the Pi harness; this package does not launch Codex CLI.

### Workspace safety

Every agent launch records and reports its repository, worktree, branch or detached revision, dirtiness, allocation mode, and read/write intent. `workspace=auto` applies these rules under a serialized allocator:

- Guaranteed read-only jobs may share the requested tree.
- A sole writer may use a clean, unoccupied requested tree.
- Concurrent writers receive separate managed Git worktrees.
- Dirty or ambiguous writer targets fail closed; `workspace=current` is the explicit operator override.
- `workspace=worktree` explicitly requests managed isolation.
- Concurrent writers in one non-Git directory fail closed because Git isolation is unavailable.

Managed worktrees start at the requested tree's exact `HEAD`; uncommitted source changes are never copied or discarded. Collision-safe `pi-tmux/*` branches, worktrees, and external ownership records are stored under `~/.pi/agent/tmux-worktrees/` by default. Operators can relocate that root before Pi starts:

```bash
export PI_TMUX_WORKTREE_ROOT=/operator/controlled/path
```

The LLM-callable tool cannot override that location. After a managed job stops, inspect its work and run `tmux_job cleanup-workspace`. Cleanup:

- refuses running, unowned, missing/mismatched-ownership, and outside-root targets;
- preserves dirty worktrees and branches containing commits;
- removes only verified clean extension-owned worktrees;
- atomically deletes only extension-created branches still at their original revision;
- is idempotent and has no force/destructive override.

Cleanup leaves the stopped pane available for inspection; close it explicitly afterward. If a branch contains useful commits, cleanup removes the worktree but reports and retains the branch for normal review or merge.

### Backend configuration

Each backend otherwise retains its native configuration. In particular, Hermes continues to load the operator's normal configuration, rules, memory, skills, and plugins. Override executable paths when needed:

```bash
export PI_TMUX_AGENT_PI_BIN=/path/to/pi
export PI_TMUX_AGENT_CLAUDE_BIN=/path/to/claude
export PI_TMUX_AGENT_HERMES_BIN=/path/to/hermes
```

## Example prompts

```text
Run make ci in a visible tmux pane named project-ci, wait for it, and show me the result.
```

```text
Start npm run dev in a tmux pane named web-dev. Leave it running and tail the last 50 lines.
```

```text
List my Pi-owned tmux jobs and close the completed ones.
```

```text
Dispatch a Pi agent named local-review using litellm/deep with high thinking to review this repository. Notify me when it finishes.
```

```text
Launch Claude Code interactively in a pane named claude-debug, then show me how to take over the pane.
```

```text
Dispatch Hermes as hermes-docs to review the README. I accept Hermes one-shot approval bypass and argv prompt exposure.
```

```text
Dispatch two writer agents with workspace=auto. Keep their changes isolated, show me each branch, and do not clean either workspace until I approve the results.
```

## Behavior

- Panes are created detached, so Pi retains focus.
- Jobs in the same named window are tiled automatically.
- The initial command runs through the user's login shell with stdin, stdout, and stderr attached to a genuine tmux PTY.
- Tmux-native pane logging keeps commands out of a `tee` pipeline. Unlimited mode preserves the full initial-command log.
- Operators may set `PI_TMUX_JOB_MAX_LOG_BYTES` to a positive byte count to retain only the newest chronological bytes per job; unset or `0` keeps unlimited logs. Agent tools cannot override this policy.
- When capped output discards older bytes, job status shows `log=truncated:<bytes>`, tool results include a retention warning, and the job directory contains `log-truncated`.
- Completed panes remain open at a shell for inspection.
- Each job records its command, metadata, state, exit code, and retained initial-command log under:

```text
~/.pi/agent/tmux-jobs/<job-id>/
```

- `close` removes the pane but intentionally retains those records and does not implicitly delete a managed workspace.
- Managed workspace ownership records remain outside the worktree; successful cleanup leaves a small removal tombstone for idempotence and auditability.
- Only panes tagged by this extension can be managed through the tool.
- Output returned to the model is bounded to Pi's 50KB/2000-line limits.

## Troubleshooting

- **Not running inside tmux:** start Pi from a tmux session; the tools intentionally refuse an unobservable fallback.
- **Executable unavailable:** install the selected CLI or set its `PI_TMUX_AGENT_*_BIN` override.
- **Model rejected:** run `pi --list-models` and pass an exact `provider/model`; unqualified or ambiguous names are rejected.
- **Job name already exists:** close the existing owned pane or choose another name.
- **Automatic writer launch refused as dirty:** commit or stash the requested tree, choose another clean worktree, or explicitly use `workspace=current` only when sharing that exact dirty tree is intentional.
- **Cleanup preserved a workspace:** inspect the reported path. Commit or remove dirty changes before retrying; committed branches are intentionally retained after cleanup.
- **Dispatch survives reload without notifying:** expected—the tmux job continues, but session-scoped watchers are cancelled on reload or shutdown. Inspect it with `tmux_job list/status/wait`.
- **Full command output needed:** read the retained `output.log` path reported by the tool; model-facing output remains bounded. If `log-truncated` exists, output before the retained chronological tail is no longer available.

## Safety model

This extension has the same command-execution authority as Pi's Bash tool. It provides execution and visibility—not authorization.

- It does not add production approval or permission gates.
- Agent adapters do not inject explicit permission-bypass flags and otherwise preserve each CLI's native behavior.
- **Hermes exception:** dispatch uses native one-shot mode, which auto-bypasses Hermes approvals and transiently exposes the prompt in process argv; the tool reports this on every Hermes dispatch.
- It refuses to close a running job unless forced.
- It does not manage unrelated tmux panes or worktrees without matching external ownership records.
- Automatic allocation isolates concurrent Git writers; explicit `workspace=current` deliberately accepts shared-tree risk.
- Managed cleanup has no model-reachable force option and preserves dirty worktrees and committed branches.
- Review third-party agent instructions before allowing them to invoke arbitrary commands.

## Non-goals

This release does not provide persistent backend session resume, automatic merging of managed branches, workflow DAGs, hidden scheduling, an embedded terminal overlay, or a Codex CLI adapter. Workspace isolation is local Git worktree management, not a sandbox or permission boundary.

## Development

```bash
npm install
npm run check
```

The integration tests create harmless short-lived panes and temporary Git repositories. They verify start, duplicate-name rejection, waiting, output capture, input, interruption, continuously bounded logging, package installation, agent lifecycle behavior, workspace policy and concurrent-writer isolation, managed creation/rollback/cleanup preservation, exactly-once completion delivery into a real Pi AgentSession follow-up turn, and reload suppression of late notifications. When not already inside tmux, the test harness creates and removes a temporary tmux session.

`npm run check` audits the production package surface with `npm audit --omit=dev`. The Pi SDK packages are peer/dev dependencies used for typing and tests, not shipped runtime dependencies; assess any full-tree audit findings against the pinned upstream Pi SDK separately.

## License

MIT
