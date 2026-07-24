#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

run_tests() {
  node --no-warnings --experimental-transform-types "$repo_dir/test-manager.mjs"
  node --no-warnings --experimental-transform-types "$repo_dir/test-hermes-config.mjs"
  node --no-warnings --experimental-transform-types "$repo_dir/test-notifier.mjs"
  node --no-warnings --experimental-transform-types "$repo_dir/test-package.mjs"
  node "$repo_dir/test-extension.mjs"
}

if [[ -n "${TMUX:-}" && -n "${TMUX_PANE:-}" ]]; then
  run_tests
  exit 0
fi

command -v tmux >/dev/null 2>&1 || {
  printf 'tmux is required for integration tests\n' >&2
  exit 1
}

test_id="pi-tmux-job-test-$$"
env_file="$(mktemp)"
cleanup() {
  tmux kill-session -t "$test_id" 2>/dev/null || true
  rm -f -- "$env_file"
}
trap cleanup EXIT

tmux new-session -d -s "$test_id" "env > $(printf '%q' "$env_file"); sleep 120"
for _ in {1..50}; do
  [[ -s "$env_file" ]] && break
  sleep 0.1
done
[[ -s "$env_file" ]] || {
  printf 'temporary tmux session did not publish its environment\n' >&2
  exit 1
}

tmux_value="$(grep '^TMUX=' "$env_file" | cut -d= -f2-)"
pane_value="$(grep '^TMUX_PANE=' "$env_file" | cut -d= -f2-)"
[[ -n "$tmux_value" && -n "$pane_value" ]] || {
  printf 'temporary tmux environment is incomplete\n' >&2
  exit 1
}

export TMUX="$tmux_value"
export TMUX_PANE="$pane_value"
run_tests
