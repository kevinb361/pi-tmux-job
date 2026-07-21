# pi-tmux-job

Public Pi coding-agent package for observable long-running command execution in tmux panes.

## Change Policy

- Development project; freely editable with review and verification.
- Keep the package generic and public-safe. Work-specific workflows, hostnames, infrastructure details, credentials, and private paths do not belong here.
- The extension executes arbitrary user commands with Pi's permissions. Preserve ownership tagging, bounded output, running-job close protection, and explicit force semantics.
- Do not override Pi's built-in Bash tool. `tmux_job` is an explicit tool for long-running, interactive, or user-visible commands.
- Support tmux 3.2+ and Node.js 24+ unless requirements and CI change together.

## Layout

```text
index.ts                 Pi extension and tmux_job tool registration
job-manager.ts           Tmux pane lifecycle, state, and durable job records
test-manager.mjs         Tmux lifecycle integration tests
test-extension.mjs       Pi discovery and real tool invocation test
scripts/test-in-tmux.sh  Test harness for attached and headless environments
extension-manifest.json  Extension capability metadata
.github/workflows/ci.yml Public CI
```

## Commands

```bash
npm install
npm run typecheck
npm test
npm run check
```

Tests create only harmless temporary panes and must clean them up. Before release, verify extension auto-discovery and a real start/wait/close cycle.

## Cross-CLI

`AGENTS.md` is a symlink to this file. Codex reads AGENTS.md; Claude Code reads CLAUDE.md.
