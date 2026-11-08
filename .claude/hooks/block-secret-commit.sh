#!/usr/bin/env bash
# PreToolUse hook (Bash): block `git commit` when the staged diff contains key-like strings.
# Reads the tool call JSON on stdin; exit 2 blocks the call and feeds stderr back to Claude.
input="$(cat)"
cmd="$(printf '%s' "$input" | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)"
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
pattern='(sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9_-]{32,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|eyJhbGciOi[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
if git diff --cached -U0 | grep -E '^\+' | grep -Eq "$pattern"; then
  echo "Blocked: staged changes contain a key-like string. Remove it, use an env var name, and re-stage." >&2
  exit 2
fi
exit 0
