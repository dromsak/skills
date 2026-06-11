---
name: afk-issues
description: Carve findings from the current conversation into well-shaped GitHub issues. Batches by module by default — one issue per module carrying ALL that module's findings (worker context-loading dominates cost, so N findings per file-read beats N file-reads). Generates title + acceptance-criteria body, classifies complexity (needs-sonnet vs needs-opus), wires same-surface `## Blocked by` markers automatically, and tags `ready-for-agent`. Companion to `/afk-army`, which then drains the resulting queue.
user-invocable: true
---

# afk-issues

`/afk-issues [opus|sonnet] [labels...]` — carve the findings the user just walked through into GitHub issues.

The natural input is the **current conversation**: the user has been doing UAT, code review, grilling, or an `/architect` audit, has surfaced findings, and now wants them filed at agent-shaped granularity. The skill reads the recent conversation context, identifies each distinct finding, **groups findings by module**, and emits one issue per module group (see Batching below) — one issue per finding only when findings don't share a module.

## Target repo

The skill files issues against **the repo you invoked it in** — derived from the current directory's git remote. No `gh repo set-default` required (that's a separate, optional config; `gh` already resolves the repo from the cwd remote). Resolve it once at pre-flight and pass it explicitly to every `gh` call:

```bash
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
```

If `REPO` is empty — not inside a git repo, or the remote isn't a GitHub repo `gh` can resolve (e.g. several remotes and no default to disambiguate) — bail with a clear message and ask the user to run the skill from inside the target repo (or set a default). Don't guess an owner/repo.

## Args parsing

- **`opus` / `sonnet`** — force every issue to that complexity class regardless of heuristic. Default: per-issue classification.
- **`labels...`** — extra labels to apply to every issue (e.g. `polish`, `priority:high`). Always applied IN ADDITION to the auto-assigned complexity label + `ready-for-agent`.
- No args → auto-classify, only `ready-for-agent` + complexity label per issue.

Examples:
- `/afk-issues` → file the conversation's findings, auto-classify each, no extra labels.
- `/afk-issues sonnet` → file all findings as `needs-sonnet` even if the heuristic would lean opus.
- `/afk-issues opus polish` → file as `needs-opus`, also tag `polish`.

## Pre-flight

1. **`gh auth status`** — verify the user is logged in with a token that can create issues + apply labels. Bail with a clear message if not.
2. **Resolve the target repo from the cwd** — `REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)`. This is whatever repo the skill was invoked in; no default-repo config needed. If empty, bail (not in a git repo, or unresolvable remote). Pass `--repo "$REPO"` to every `gh` command below.
3. **Re-read the recent conversation** for findings. A finding is a discrete bug, polish item, regression, or UX gap the user (or you) named. Each gets one issue.
4. **Don't invent findings** — only file what was actually discussed. If the user described 5 things, file 5 issues. Don't pad.
5. **Don't ask the user to confirm each finding.** This skill is "I just walked you through them, file them." If you genuinely cannot tell whether something was a finding vs an aside, drop it; the user will say "you missed X" rather than slow-walking through 8 confirmation prompts.

## Required labels

Before posting, verify the repo has the canonical label vocabulary. Missing labels are the most common source of silent failure for `/afk-army` workers.

```bash
required="ready-for-agent needs-sonnet needs-opus agent-working awaiting-merge polish"
for l in $required; do
  gh label list --repo "$REPO" --search "$l" --json name --jq '.[].name' | grep -qx "$l" || \
    echo "MISSING: $l"
done
```

If any are missing, offer to create them with `gh label create <name>` and short descriptions, then continue.

## Batching — one issue per module (DEFAULT)

**This is the token- and wall-clock lever; everything else is formatting.** An `/afk-army` worker's cost is dominated by context loading — CLAUDE.md, conventions, reading the module — not by the diff it writes. One worker that reads `patch_handler.rs` once and fixes its five findings costs barely more than a worker that fixes one. So:

- **Group findings by primary module/surface** (the file or directory the fix lives in). One issue per group, every finding in the group a line in the AC checklist. A finding that shares no module with any other gets a singleton issue, as before.
- **Cross-module extractions get their own issue, filed first.** A shared-helper extraction (consolidate N copies into one util) is its own wave-1 issue; the module batches that consume the helper get `## Blocked by` pointing at it. Never fold an extraction into one of its consumer batches.
- **Bonus:** module batching means sibling issues rarely touch the same files — the same-surface serialization pass below mostly no-ops, and `/afk-army`'s merge-train sees near-zero conflicts.

### Bulk source mode — point at a committed report

When the findings come from a bulk source with a written artifact (an `/architect` audit report, a long review doc), **do not duplicate finding prose into issue bodies**:

1. Require the report **committed and pushed to the default branch first** — workers branch off main and must be able to `Read` it in their worktree. If it isn't committed, stop and commit it (or have the user do so) before filing.
2. Each issue body lists its findings as: `**<finding-id>** — <one-line summary> (report § / file:line)`, plus a References entry naming the report path. The one-liners keep the issue skimmable on GitHub; the report carries the full problem/fix detail.
3. The AC checklist gets one item per finding (the worker re-reads the report section for the detail).

### Sizing a batch

A module batch is still **one agent sitting**. The "too big" markers below apply to *scope breadth*, not AC count — a batch of 12 mechanical riders in one module is fine; two unrelated surfaces in one issue is not. Split a batch at natural submodule seams when it exceeds ~15 findings, mixes opus-grade findings with mechanical riders such that the whole issue would classify opus for mostly-sonnet work (split by grade), or couples to another module's in-flight extraction (split + `## Blocked by`).

## Building each issue

Every issue body MUST follow this template — `/afk-army` workers parse it for AC and file references:

```markdown
## What's broken

<2–6 sentences, concrete repro details, copy actual DOM/SQL/HTTP excerpts where helpful. Quote the user's reported symptom verbatim if they framed it precisely.>

Spotted in **<context>** (e.g. a UAT journey, a code review pass, a bug report).

## Approach

<2–5 sentences or a numbered list. Name the likely files. Don't prescribe the diff — describe the change.>

## Acceptance criteria

- [ ] <Concrete behavioural assertion 1>
- [ ] <…>
- [ ] <Last item is usually a regression-prevention or test-coverage item>

## References

- View / module: `<path>` (best guess; don't make up file paths)
- Repro URL: `<path>` (if web UI)
- Related docs / decisions as relevant
```

### Title

`<verb>(<scope>): <short crisp summary>` — match existing repo convention. Examples:

- `bug(dashboard): Last-updated column is missing the data-updated-at ISO 8601 attribute`
- `polish(orders): drop the Status column, fold the state into the row badge`
- `feat(account): revoke active sessions and force re-login on password change`

Use `bug` for breakage, `polish` for affordance/copy, `feat` for new capability, `refactor` for cleanup. Scope is the surface (one or two hyphenated words naming the affected module/page/feature) — sample what's already in `git log --oneline -50` and match the style.

### Body sizing — keep it agent-shaped

Aim for an issue a single agent worker can complete in a 30–90 minute run (verify gate included). Markers that the issue is TOO BIG:

- The "Acceptance criteria" list exceeds 6 items — **unless it's a module batch of mechanical riders** (see Batching), where one AC line per finding is the intended shape.
- Two or more independent surfaces are named in "Approach".
- The change requires both a schema migration AND a backfill AND template work.

If a finding is too big, **split it**: file 2–3 issues with explicit `## Blocked by` markers chaining them in order.

## Complexity classification

Auto-assign **one** of `needs-sonnet` (default) or `needs-opus` per issue.

### `needs-opus` heuristic — file as opus when the issue body contains any of:

- Crate / module / package boundary language: "trace through", "audit the X path", "across modules", "evaluator", "matcher", "generator", "dispatcher"
- Architectural decision / design framing
- Naming sweeps that span 5+ files
- Ambiguous spec where the worker has to read the room (the AC list itself uses hedged language like "or equivalent", "either … or …")
- Schema migration design (not just adding a column — designing the column)
- Anything touching a complex evaluator, scheduler, or generator in the codebase

### `needs-sonnet` heuristic — file as sonnet when:

- Template / view / markup edit ("change `hx-post` from X to Y")
- Mechanical wiring (renaming a slug, adding a `data-*` attribute, swapping a column reference)
- Adding a test for an existing behaviour
- Copy / label / accessibility polish
- Single-file or single-template scope

When in doubt, **prefer sonnet**. Sonnet handles all of the above competently; Opus is the escalation path, not the default.

If args force a class (`/afk-issues opus`), skip the heuristic.

## Same-surface serialization

Before posting, harvest file path references from each issue body (look in `## Approach` and `## References` for backtick paths matching a code/config file extension). If two or more issues reference the same file, the **lower-priority** ones get a `## Blocked by #<oldest>` block appended pointing at the first one in their group.

The mechanism stops `/afk-army` workers from racing schema/template drift when sibling issues touch the same surface.

```bash
# After all issues are drafted in /tmp/afk-issues-<N>.md files
declare -A surface_owner
for f in /tmp/afk-issues-*.md; do
  n="${f##*/afk-issues-}"; n="${n%.md}"
  # Adjust the extension list to match the languages in the target repo
  paths=$(grep -oE '`[a-zA-Z0-9_./-]+\.(rs|js|ts|tsx|jsx|py|go|java|rb|php|sql|yaml|yml|toml|json|md|html|css|j2|hbs)`' "$f" | tr -d '`' | sort -u)
  for p in $paths; do
    if [[ -n "${surface_owner[$p]}" ]]; then
      printf '\n\n## Blocked by\n\nSame-surface conflict with #%s (`%s`). Will pick up automatically once #%s lands and main settles.\n' "${surface_owner[$p]}" "$p" "${surface_owner[$p]}" >> "$f"
      break
    else
      surface_owner[$p]=$n
    fi
  done
done
```

`#<oldest>` here means "the issue I'm about to file first" — the array tracks order of carve, not GitHub numbering (since we don't know the issue numbers until `gh issue create` returns them). After creation, the `## Blocked by` markers need to be **rewritten** with the real issue numbers — see "Posting" below.

## Posting

1. For each issue, write the body to `/tmp/afk-issues-<seq>.md` (seq = 01, 02, ...).
2. Apply same-surface serialization (above) using `<seq>` as the placeholder.
3. Create each issue in order with `gh issue create --repo "$REPO" --title "<title>" --body-file /tmp/afk-issues-<seq>.md --label ready-for-agent --label <complexity-label> [--label <extras>]`. Capture the returned URL (and parse the issue number from it).
4. After all issues exist, rewrite any `Same-surface conflict with #<seq>` references in the bodies to their real GitHub numbers, then `gh issue edit <blocked-number> --repo "$REPO" --body-file <updated-file>`. (Two passes is cleaner than racing the issue numbers during creation.)
5. Print a summary table:

```
#935 [sonnet] dashboard: missing data-updated-at attribute
#936 [sonnet] dashboard: "just now" shown for future timestamps   ⏸ blocked by #935
#937 [sonnet] search: category filter uses the wrong slug
#938 [sonnet] checkout: only 2/16 promo codes apply
#939 [sonnet] search: "No results" shown while results exist      ⏸ blocked by #937
#940 [sonnet] onboarding: verify-email link returns 404
#941 [sonnet] orders: status filter renders empty
#942 [sonnet] notifications: weekly digest not sent

Filed 8 issues. 6 ready, 2 same-surface-deferred.
Run `/afk-army` to drain — no args: worker models come from the per-issue labels, and the Workflow runtime owns parallelism.
```

## What NOT to do

- Don't file an issue without an AC checklist. The afk-army worker prompt parses it.
- Don't file an issue whose AC depends on private context not in the body. The worker doesn't see this conversation.
- Don't speculate about file paths. If you're not sure, list 2–3 candidates as "likely under one of:" — don't invent a specific line number.
- Don't apply both `needs-sonnet` and `needs-opus`. Pick one.
- Don't apply `needs-opus` to a polish/template-edit issue just because the broader area is complex. Classify on the **change**, not the **surface**.
- Don't ask the user "should I file these?" — the invocation IS the consent. If they want to redirect, they'll interrupt.

## Re-classification (existing issues)

`/afk-issues reclassify` — walk all open `ready-for-agent` issues that lack a complexity label, run the heuristic on each, and apply `needs-sonnet` or `needs-opus`. Useful after this skill is introduced to backfill the existing backlog. Doesn't touch issues that already have a complexity label.

```bash
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh issue list --repo "$REPO" --label ready-for-agent --limit 100 --json number,labels,body \
  | jq -r '.[] | select((.labels | map(.name) | contains(["needs-sonnet"]) or contains(["needs-opus"])) | not) | "\(.number)\t\(.body | gsub("\n"; " ") | .[0:200])"' \
  | while IFS=$'\t' read -r num body; do
      # apply heuristic, then:
      gh issue edit $num --repo "$REPO" --add-label needs-sonnet
    done
```

Print the reclassification table at the end.
