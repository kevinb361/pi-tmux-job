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

## Tool

The package registers one LLM-callable tool:

```text
tmux_job
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

Jobs are addressed by name, generated ID, or tmux pane ID. The default window is `pi-jobs`; callers can select another safe window name.

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

## Behavior

- Panes are created detached, so Pi retains focus.
- Jobs in the same named window are tiled automatically.
- The initial command runs through the user's login shell.
- Completed panes remain open at a shell for inspection.
- Each job records its command, metadata, state, exit code, and full initial-command log under:

```text
~/.pi/agent/tmux-jobs/<job-id>/
```

- `close` removes the pane but intentionally retains those records.
- Only panes tagged by this extension can be managed through the tool.
- Output returned to the model is bounded to Pi's 50KB/2000-line limits.

## Safety model

This extension has the same command-execution authority as Pi's Bash tool. It provides execution and visibility—not authorization.

- It does not add production approval or permission gates.
- It refuses to close a running job unless forced.
- It does not manage unrelated tmux panes.
- Callers should not launch concurrent jobs that edit the same shared files.
- Review third-party agent instructions before allowing them to invoke arbitrary commands.

## Development

```bash
npm install
npm run check
```

The integration test creates harmless short-lived panes and verifies start, duplicate-name rejection, waiting, output capture, input, interruption, and cleanup. When not already inside tmux, the test harness creates and removes a temporary tmux session.

## License

MIT
