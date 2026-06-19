---
name: merge-train
description: Land a batch of already-authored, CI-green PRs with a single batch-verify merge-train — integrate them all on one throwaway branch, run the project's gate ONCE on the combined result, bisect on red to isolate the offending PR, squash-merge the survivors, clean up. Takes PRs as input, NOT issues — it implements nothing. Invoke as `/merge-train` (auto-discovers open, non-draft, gate-green PRs) or `/merge-train 12 34 …` (explicit set). Human-gated: shows the pick table and confirms before merging.
user-invocable: true
---

# merge-train

`/merge-train` — land a batch of **already-authored, CI-green PRs** in one shot, behind a single run of the project's full gate. **Input is PRs, not issues** — it merges work that already exists and implements nothing.

It integrates the selected PRs on one throwaway branch, runs the gate **once** on the combined result (not N times, once per PR), bisects on red to isolate the offending PR, squash-merges the survivors, and cleans up. One bad PR parks itself; the rest still land.

Sibling to `/afk-army`, which is *issue*-driven (pick → implement → push → merge its **own** branches). This shares afk-army's merge-train engine but takes **existing PRs** as the front end.

## FIRST ACTION

Invoke `Skill(skill="dromsak-guidelines")`. Its rails govern orchestration judgement. If not found, log once and continue — never stall.

## When NOT to use

- **A single PR** → just review and `gh pr merge` it. The merge-train's value is gating the *integrated* batch once; for one PR that's pure overhead.
- **PRs that haven't passed their pre-merge CI** → wait for green. This trusts CI as the *entry filter* and spends the expensive full gate on the integrated result, not on re-litigating each PR.
- **Stacked / interdependent PRs that must land in a set order** → tell me the order. The default integration order is oldest-first and assumes the PRs are independent.

## 1. Resolve repo + gate + pre-flight notes (this conversation)

- **Repo**: `--repo owner/name` if given, else `REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)`. Bail only if empty (not in a repo / unresolvable remote) — don't guess.
- **Gate** (run once, on the integrated result): the project's documented *canonical* gate. Find it in `CLAUDE.md`, a `just`/`make` recipe, `package.json` scripts, the language's test/lint runner. Print it in one line and confirm before running.
- **Pre-flight notes** — read the project `CLAUDE.md` + agent memory *before touching anything*. A heavy local gate often needs the repo quiesced first: a running dev stack stopped, a cache server pinned, an isolated build dir. Apply whatever the project documents; a repo with no such notes skips it. **Don't assume — read.**

## 2. Select the PR set (this conversation) — human gate

Auto-discover when no PR numbers are passed:
```bash
gh pr list --repo "$REPO" --state open --draft=false --limit 100 \
  --json number,title,headRefName,mergeable,statusCheckRollup
```
Filter in `jq`:
- Keep open, non-draft PRs whose CI rolls up to **all SUCCESS** and whose `mergeable == "MERGEABLE"`. Drop anything red, draft, `CONFLICTING`, or `UNKNOWN` (re-poll `UNKNOWN` once — GitHub computes mergeability lazily).
- If explicit numbers were passed, use **exactly those** — but still verify each is open + green + mergeable, and warn (don't silently drop) on any that isn't.

Print a pick table (`#`, title, branch, CI, mergeable). **Confirm the set before integrating** — this is the human merge gate; never merge an auto-discovered set without an explicit go.

## 3. Pre-flight (quiesce)

Apply the step-1 project notes (stop a dev stack, pin a cache server, reserve an isolated build dir, …) and remember to restore at the end. A repo with no notes skips this step.

## 4. Batch-verify merge-train (this conversation, bash)

Verify the **integrated** result once — not each PR N times.
```bash
cd <main repo>; git fetch origin main
git switch -C merge-train-integration origin/main   # -C resets a stale branch a prior run left; -c would abort
for br in <each SELECTED PR branch>; do
  git merge --no-edit "origin/$br" || echo "CONFLICT in $br — resolve inline or park"
done
<GATE>          # the one gate run for the whole batch
```
- **Don't pipe `git switch` through `tail`/`head`** — the pipe's exit code is the pager's, not git's, so a failed create reads as success.
- Conflicts during integration are usually trivial **sibling drift** (a renamed field, a changed wrapper type) — resolve inline and continue. A genuinely tangled one gets parked like a gate-red culprit.
- **Never put the integration worktree or its build dir on `/tmp` / tmpfs** — a full build is large, and on tmpfs that's RAM the kernel can't reclaim. Use a real disk path; isolate it only if another job already holds the project's default build dir.

## 5. Land or bisect

- **Green** → squash-merge every selected PR, `--delete-branch`. GitHub's merge ref lags a force-advance, so on `gh pr merge` failing with `Base branch was modified` or `mergeable=UNKNOWN`, poll `gh pr view <N> --json mergeable,mergeStateStatus` until `MERGEABLE/CLEAN` and retry the merge. `Closes #N` in the body auto-closes the linked issue.
- **Red** → **bisect**: split the PR set in half, gate each half on a fresh `merge-train-integration` off `origin/main`, recurse on the red half to isolate the culprit(s). Merge the innocents; **park** only the culprit — leave its PR open, post the gate-log head, and flag it for human eyes. Innocents merging still counts as forward progress; one bad PR never strands the rest.

## 6. Clean up, restore, report

```bash
cd <main repo>
git switch -q main && git fetch -q --prune origin     # drop remote-tracking refs for branches deleted at merge
git branch -D merge-train-integration 2>/dev/null
for br in <each MERGED branch>; do git push -q origin --delete "$br" 2>/dev/null; done
```
- **Restore** whatever step 3 quiesced, then `git pull --ff-only origin main` so the checkout is current with what you just landed.
- **Report**: one line per outcome — `✅ merged #N`, `🚨 parked #N (gate red / conflict)`. State the end result plainly (all landed / N landed + M parked).

## What this skill does NOT do

- Implement, pick issues, or spawn workers — that's `/afk-army`. This only merges PRs that already exist.
- Merge a red or unconfirmed set without you — the pick-table confirm and the bisect-park are the human + safety gates.
- Run alongside another `/merge-train` or an `/afk-army` drain on the **same repo** — both monopolize the build + full gate and will thrash each other. Serialize them by hand: one heavy gate per repo at a time. A merge-train in a *different* repo can coexist.

## Files

- `SKILL.md` — this orchestration. No workflow script: the merge-train is inline bash, extracted from `/afk-army` step 5.
