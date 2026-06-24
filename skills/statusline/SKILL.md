---
name: statusline
description: Install or re-point dromsak's forked claude-pace statusline. Wires Claude Code's `statusLine` to `statusline.sh` in this repo's working copy so edits take effect on the next render — no re-install loop. Forked from Astro-Han/claude-pace (Bash + jq, no Node). Invoke as `/statusline` for first install, after moving the repo, or to switch off the upstream claude-pace plugin onto this fork.
user-invocable: true
---

# statusline setup

You are pointing Claude Code's statusline at **this repo's** `statusline.sh`, a
forked claude-pace (model · context · effort | project · branch · git stats, and
a pace-aware 5h/7d quota bar). Idempotent: safe for first install or re-pointing.

The whole point of this fork is live iteration, so the install target is the
**git working copy the user edits** — NOT the installed plugin cache
(`${CLAUDE_PLUGIN_ROOT}`, which only refreshes on `/plugin marketplace update` +
reload, so edits there would not be live). Follow the steps in order; if any step
fails, stop and explain.

## Step 1: Prerequisite — jq

Run `command -v jq`. If missing, tell the user to install it (`brew install jq`
on macOS, `apt install jq` on Linux) and stop — the script degrades to a bare
`Claude [needs jq]` line without it.

## Step 2: Resolve the script's absolute path (working copy)

Find the absolute path to `statusline.sh` in the dromsak/skills **working copy**:

1. If you are already operating inside a dromsak/skills checkout, use
   `"$(git -C . rev-parse --show-toplevel)/skills/statusline/statusline.sh"`.
2. Otherwise try the default dev location for this user:
   `~/dev/skills/skills/statusline/statusline.sh`.
3. Confirm the file exists (`test -f <path>`) and make it executable
   (`chmod +x <path>`). Use the resolved **absolute** path (expand `~`) — the
   statusline runs as a raw shell command and will not expand `~` or
   `${CLAUDE_PLUGIN_ROOT}` at render time.

If no working checkout exists, fall back to
`${CLAUDE_PLUGIN_ROOT}/skills/statusline/statusline.sh` and warn the user that
edits will only take effect after `/plugin marketplace update dromsak-skills` +
a reload, not live.

## Step 3: Wire it into settings.json

Read `~/.claude/settings.json` with the Read tool. With the Edit tool, set the
`statusLine` key to the resolved absolute path, preserving every other key:

```json
"statusLine": {
  "type": "command",
  "command": "<ABSOLUTE_PATH_FROM_STEP_2>",
  "padding": 0
}
```

If `statusLine` already exists (e.g. it points at the old
`~/.claude/statusline.sh` from the upstream claude-pace plugin), update its
`command` in place. If it does not exist, add it as a top-level key.

## Step 4: Confirm

Tell the user:

- The statusline is installed/re-pointed and now reads from
  `<ABSOLUTE_PATH>` — edits to that file are **live on the next render**.
- Start a new session (or wait for the next status update) to see it.
- This replaces the upstream `claude-pace` statusline if it was active; the old
  `~/.claude/statusline.sh` is left untouched as a fallback.
- To revert: point `statusLine.command` back at `~/.claude/statusline.sh`, or
  delete the `statusLine` block from `~/.claude/settings.json`.
