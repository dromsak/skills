---
name: statusline
description: Install or re-point dromsak's forked claude-pace statusline (model · context · effort | project · branch · git stats, and a pace-aware 5h/7d quota bar). By default it installs a stable copy to `~/.claude/statusline-pace.sh` and points there — machine-independent, survives plugin updates, no checkout required. If a `dromsak/skills` working checkout is present it instead points live at that copy for script iteration. Forked from Astro-Han/claude-pace (Bash + jq, no Node). Invoke as `/statusline` for first install, to refresh the stable copy after a plugin update, or to switch off the upstream claude-pace plugin onto this fork.
user-invocable: true
---

# statusline setup

You are pointing Claude Code's `statusLine` at dromsak's forked claude-pace
`statusline.sh` (model · context · effort | project · branch · git stats, and a
pace-aware 5h/7d quota bar). Idempotent: safe for first install or re-pointing.

There are two install modes. **Pick automatically — do not warn or "freak out"
when there is no working checkout; the stable copy is the normal, expected
outcome on most machines.**

- **Stable copy (default, every machine).** Copy the plugin's bundled
  `statusline.sh` to the fixed path `~/.claude/statusline-pace.sh` and point
  `statusLine` there. This is how upstream claude-pace works: a stable,
  machine-independent path. It does **not** depend on a git checkout and does
  **not** break on `/plugin marketplace update` (the cache dir is content-hashed,
  so its path changes every update — never point `statusLine` at it directly).
- **Live checkout (opt-in, dev box only).** If a `dromsak/skills` working
  checkout is present, point `statusLine` straight at its
  `skills/statusline/statusline.sh` so edits to that file are live on the next
  render. This is only for hacking on the script itself.

Follow the steps in order; if a step fails, stop and explain.

## Step 1: Prerequisite — jq

Run `command -v jq`. If missing, tell the user to install it (`brew install jq`
on macOS, `apt install jq` on Linux) and stop — the script degrades to a bare
`Claude [needs jq]` line without it.

## Step 2: Choose the mode and resolve the script path

Check for a `dromsak/skills` working checkout, in this order:

1. If you are operating inside a `dromsak/skills` checkout, use
   `"$(git -C . rev-parse --show-toplevel)/skills/statusline/statusline.sh"`.
2. Otherwise try the default dev location:
   `~/dev/skills/skills/statusline/statusline.sh`.

If one of those exists (`test -f`), you are in **live checkout** mode — that
absolute path (expand `~`) is your target; `chmod +x` it and skip to Step 3.

Otherwise you are in **stable copy** mode (the normal case — no warning):

1. Locate the bundled script at `${CLAUDE_PLUGIN_ROOT}/skills/statusline/statusline.sh`
   (`${CLAUDE_PLUGIN_ROOT}` is set while this skill runs — it is the plugin's
   content-hashed cache dir). Confirm the source exists (`test -f`).
2. Copy it to the fixed path and make it executable:
   `cp "${CLAUDE_PLUGIN_ROOT}/skills/statusline/statusline.sh" ~/.claude/statusline-pace.sh && chmod +x ~/.claude/statusline-pace.sh`.
3. Your target is the absolute path `~/.claude/statusline-pace.sh` with `~`
   expanded (e.g. `/home/<user>/.claude/statusline-pace.sh`) — the statusline
   runs as a raw shell command and will not expand `~` or `${CLAUDE_PLUGIN_ROOT}`
   at render time.

## Step 3: Wire it into settings.json

Read `~/.claude/settings.json` with the Read tool. With the Edit tool, set the
`statusLine` key to the resolved absolute path from Step 2, preserving every
other key:

```json
"statusLine": {
  "type": "command",
  "command": "<ABSOLUTE_PATH_FROM_STEP_2>",
  "padding": 0
}
```

If `statusLine` already exists (e.g. it points at the old
`~/.claude/statusline.sh` from the upstream claude-pace plugin, or at a stale
content-hashed cache path), update its `command` in place. If it does not exist,
add it as a top-level key.

## Step 4: Confirm

Tell the user, matching the mode you used:

- **Stable copy:** the statusline is installed and `statusLine` now points at
  `~/.claude/statusline-pace.sh` — a stable, machine-independent path that
  survives plugin updates. To pick up a newer bundled script after
  `/plugin marketplace update dromsak-skills`, just re-run `/statusline` (it
  re-copies). For live script editing, clone `dromsak/skills` to `~/dev/skills`
  and re-run `/statusline` to switch to live mode.
- **Live checkout:** the statusline now reads directly from `<ABSOLUTE_PATH>` —
  edits to that file are live on the next render.

Then, for both modes:

- Start a new session (or wait for the next status update) to see it.
- This replaces the upstream `claude-pace` statusline if it was active; the old
  `~/.claude/statusline.sh` is left untouched as a fallback.
- To revert: point `statusLine.command` back at `~/.claude/statusline.sh`, or
  delete the `statusLine` block from `~/.claude/settings.json`.
