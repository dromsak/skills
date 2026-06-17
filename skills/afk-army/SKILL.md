---
name: afk-army
description: Drain the `ready-for-agent` GitHub backlog by spawning one worker subagent per unblocked issue via the Workflow runtime — each implements in its own managed worktree, pushes, and opens a PR — then land them with a single batch-verify merge-train (integrate all, gate once, bisect on red). The orchestrator (this conversation) picks the queue and runs the merge, then LOOPS: after each merge-train it re-picks issues freshly unblocked by what just merged and drains the next wave, continuing until the reachable dependency graph is exhausted. The runtime owns worktrees, parallelism, and result tracking. Interactive, not unattended.
user-invocable: true
---

# afk-army

`/afk-army` — drain the `ready-for-agent` queue **to exhaustion**. No arguments: each issue's worker model is read from its own `needs-opus`/`needs-sonnet` label, the repo and gate auto-derive (below), and the runtime sets parallelism. **This conversation is the orchestrator**: it picks the unblocked issues, fires a Workflow that spawns one worker per issue (parallel, each in a runtime-managed git worktree — implement → push → PR), runs a single **batch-verify merge-train** to land them, then **loops back and re-picks** — issues whose `## Blocked by` chain was waiting on the PRs that just merged are now unblocked, so they become the next wave. It keeps going wave after wave until nothing drainable remains. One invocation drains the whole reachable graph; you don't re-invoke per wave.

The Workflow runtime owns worktree lifecycle, concurrency, background execution, and structured results — so this skill is thin orchestration, not the hand-rolled choreography it used to be (no heartbeats, no CWD-drift policing, no manual top-up loop, no golden-cache hacks).

Issues filed by `/afk-issues` are **module-batched by default** — one issue per module carrying several findings, often as finding-ID pointers into a committed report (e.g. `docs/audits/…`). Nothing changes here: the worker reads the referenced report inside its worktree (it branches off main, so the report must already be on the default branch — `/afk-issues` enforces that at filing time), and the batch's AC checklist is the work list.

**No self-imposed concurrency cap.** Each wave passes *every* currently-unblocked issue to the workflow at once; the runtime sets the real ceiling (it paces to its own `min(16, cores−2)` and queues the rest). Never batch, sample, or cap the wave yourself — that's interference. The only thing that bounds a wave's width is the dependency graph (how many issues are unblocked right now), never a number you pick.

## ⚠️ One load-bearing assumption (read once)

This design assumes a Workflow `isolation:'worktree'` agent can **`git push` a branch and `gh pr create`** with the session's auth. It's very likely true (agents have Bash; the worktree shares the repo's remotes) but is **unverified**. If your first run shows workers implementing fine but failing at push/PR, that's this assumption breaking — the fix is to have workers return their diff and the orchestrator push it. Flagged so a first-run failure reads as "known unknown," not a mystery.

## FIRST ACTION

Invoke `Skill(skill="dromsak-guidelines")`. Its rails govern orchestration judgement. If not found, log once and continue — never stall.

## When NOT to use

Laptop will sleep / SSH may drop / you want it overnight unattended → don't. The orchestrator lives in this conversation; if it dies, in-flight workers strand. Also: afk-army is for **many small independent issues**. A single large interdependent refactor (e.g. splitting a large module or package) is the *wrong* shape — those want a focused agent or a `Plan` pass, not a parallel drain.

## 1. Resolve repo + gate (this conversation)

- **Per-repo drain lock — claim it before the queue.** Two `/afk-army` drains in the *same* repo oversubscribe the host (their worker builds don't serialize) — the real hazard is two drains in a large codebase like posturermm. Drains in *different* repos coexist: a light curator drain alongside a posturermm drain is fine, and the host's `dev-build.slice` cgroup is the box-wide OOM backstop regardless. So serialize **per repo, not globally**. Resolve `REPO` (next bullet) first, then claim a per-repo lock:
  ```bash
  # REPO must already be resolved (see the Repo bullet below).
  slug=$(printf '%s' "$REPO" | tr -c 'a-zA-Z0-9' '-')
  LOCK=~/.cache/afk-army-drain."$slug".lock.d
  if mkdir "$LOCK" 2>/dev/null; then
    printf 'repo=%s started=%s\n' "$REPO" "$(date -u +%FT%TZ)" > "$LOCK/owner"
  else
    started=$(sed -n 's/.*started=//p' "$LOCK/owner" 2>/dev/null)
    age=$(( $(date -u +%s) - $(date -u -d "${started:-now}" +%s 2>/dev/null || echo "$(date -u +%s)") ))
    if [ "$age" -gt 21600 ]; then            # >6h ⇒ a dead drain; reclaim
      rm -rf "$LOCK"; mkdir "$LOCK"; printf 'repo=%s started=%s\n' "$REPO" "$(date -u +%FT%TZ)" > "$LOCK/owner"
    else
      echo "Another /afk-army drain is active on $REPO ($(cat "$LOCK/owner" 2>/dev/null)). Run ONE drain PER REPO at a time. A drain in a different repo can run alongside this. If that drain died, \`rm -rf $LOCK\` and retry."; exit 0
    fi
  fi
  ```
  **Release at loop end and on any early exit:** `rm -rf "$LOCK"` (the per-repo path you claimed — never another repo's). The host's `dev-build.slice` cgroup is the *resource* backstop (caps aggregate build CPU/RAM so even two coexisting drains can't kill the box); this lock is the *don't-even-try-two-in-one-repo* guard that keeps each repo's drain fast (full budget) and serialized.
- **Repo**: `--repo owner/name` if given, else derive from the cwd — `REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)`. No `gh repo set-default` needed (`gh` resolves the cwd remote on its own). Bail only if `REPO` is empty — not in a git repo, or an unresolvable remote — don't guess.
- **Full gate** (run once, at merge): `--gate`, else discover — the project's documented gate in `CLAUDE.md`, a `just verify`/`verify-gate` recipe, `package.json` test/lint scripts, `cargo test`/`nextest`, `go test ./...`, etc. Print it in one line and confirm before spawning.
- **Cheap worker gate** (optional): a *fast* compile/lint only if it's genuinely cheap on this project and won't thrash under N-way parallelism. Default **none** — the orchestrator's single full gate is the safety. (On a project with one giant compilation unit, a "cheap" check isn't cheap; leave it off.)

## 2. Pick the queue (this conversation) — LOOP BODY

> **Steps 2–5 are one wave, and the wave repeats.** Run them, then go to step 6, which sends you back here to re-pick. Everything in steps 2–5 is written for "the current wave." Resolve repo + gate (step 1) only once, on the first wave.

```bash
gh issue list --repo <REPO> --label ready-for-agent --search "no:assignee" --limit 100 \
  --json number,title,body,labels,createdAt
```
Filter in `jq`, sort `createdAt` ascending (oldest first):
- Drop bodies containing a `## Blocked by` that references a still-open issue.
- Keep every remaining issue regardless of complexity label — **no model filtering**. Each issue's worker model is resolved per-issue from its label (`needs-opus` → opus, else sonnet), so a mixed opus/sonnet queue drains together in the one loop.

**Reconcile `agent-working` claims — don't blindly skip them.** An `agent-working` label means one of two very different things: a *live* claim (another session is working it — skip) or a *dead* claim (a prior run was interrupted after claiming but before/without finishing — nothing is behind it). Blindly dropping all `agent-working` issues is a trap: if the dead claims are the unblocked roots of a `## Blocked by` chain, the *entire* queue becomes un-pickable and the drain exits reporting "nothing to do" while the backlog sits frozen. So for each `agent-working` issue, check whether real work exists:
```bash
gh pr list --repo <REPO> --state open --search "<N> in:body" --json number --jq length   # PR that Closes #N?
git ls-remote --heads origin "*<N>-*" | head -1                                            # army/<N>-… branch?
```
If **either** exists → live, skip it. If **neither** → dead claim; reclaim it by folding it back into the pick set (it stays `agent-working`; re-claiming is a no-op). This makes an interrupted drain self-heal on the next invocation.

Then, per kept issue: resolve its model from its label (`needs-opus` → opus, else sonnet), build a kebab `slug` from the title, fetch its recent comments. Print a pick table (`#`, title, model). **Claim each** before the workflow:
```bash
gh issue edit <N> --repo <REPO> --remove-label ready-for-agent --add-label agent-working
```
No same-surface pre-gating — file conflicts surface once, at integration (step 5), and resolve there. That whole prediction step is gone.

## 3. Run the drain workflow

```
Workflow({
  scriptPath: "<this skill's directory>/afk-workflow.js",
  args: {
    issues: [{ number, title, body, comments, model, slug }, …],   // every kept issue
    repo: "<REPO>",
    branchPrefix: "army/",
    workerVerify: "<cheap gate cmd, or omit>"
  }
})
```
Pass **all** kept issues — the runtime paces concurrency and drains the rest as slots free; you don't batch or cap manually. It runs in the background (you're free meanwhile) and notifies on completion, returning `{prs, escalated, needs_info, lost, counts}`.

## 4. Park failures, keep draining (on return)

The loop **does not halt on a snag** — it parks the failed issue (and only what depends on it) for the human, merges everything healthy, and keeps going. The human gate is preserved: a parked issue is never merged without you; it just doesn't freeze the rest of the drain.

- For each `escalated` / `needs_info` / `lost`: flip `agent-working` → `needs-human-review` (or `needs-info`), post the reason. **Add it to a session-level `PARKED` set** you carry across waves (so the final report lists everything parked, not just this wave's).
- A parked issue stays **open** and loses `ready-for-agent`, so its `## Blocked by` dependents are automatically dropped by the step-2 pick on every future wave — the parked *subtree* sits out the rest of the drain without any extra bookkeeping.
- **Successful workers → proceed to step 5** and merge their PRs (the merge-train also runs when only *some* workers succeeded — integrate and gate the green ones, leave the parked ones untouched).
- If a wave returns **zero** successes (every worker parked) → run no merge-train; go to step 6, which will detect no forward progress and end the loop.

## 5. Batch-verify merge-train (this conversation, bash)

Verify the **integrated** result once — not each PR N times.

```bash
cd <main repo>; git fetch origin main
git switch -C afk-integration origin/main   # -C (force): resets a stale afk-integration left by a prior run; -c would abort
for br in <each SUCCESSFUL PR branch this wave>; do git merge --no-edit "origin/$br" || { echo "conflict in $br — resolve"; }; done
<FULL GATE>          # the one gate run for this wave's batch
```
(Don't pipe the `git switch` through `tail`/`head` — the pipe's exit code is the pager's, not git's, so a failed create looks like success.)
- **Never place the integration worktree or `CARGO_TARGET_DIR` under `/tmp` or any tmpfs.** A full workspace debug build is tens of GB; on tmpfs those "disk writes" are RAM the kernel can't reclaim, which livelocked the dev LXC twice on 2026-06-12 (page-cache thrash at 8GB/s reads, forced reboots both times). If the main checkout is busy — e.g. a second army or another session owns `afk-integration` — use a disk path like `~/.cache/afk-int-<repo>` for the worktree and its target dir.
- **Green** → squash-merge every PR. GitHub's merge-ref lags a force-push/advance, so on `gh pr merge` failing with "Base branch was modified" or `mergeable=UNKNOWN`, poll `gh pr view --json mergeable,mergeStateStatus` until `MERGEABLE/CLEAN` and retry the merge call. `--delete-branch`. `Closes #N` auto-closes the issue — **which is what unblocks the next wave's dependents**, so a clean merge here is the loop's forward motion.
- **Red** → **bisect**: split the PR set in half, gate each half on a fresh integration branch, recurse on the red half(s) to isolate the culprit(s). Merge the innocent PRs; **park** only the culprit (flip → `needs-human-review`, add to `PARKED`, post the gate-log head, leave its PR open). The bisect-merged innocents still count as forward progress.
- Conflicts during integration are usually trivial sibling drift (a renamed field, a changed wrapper type) — resolve inline and continue; a genuinely tangled one gets parked like any other culprit.
- **Sweep merged refs + worktrees — clean up after yourself.** Once this wave's PRs are merged, remove the cruft so branches and worktrees don't pile up across waves and runs. Touch only what **merged** — leave parked issues' branches, PRs, and worktrees alone:
  ```bash
  cd <main repo>
  git switch -q main && git fetch -q --prune origin      # drop remote-tracking refs for branches deleted at merge
  git branch -D afk-integration 2>/dev/null              # the throwaway integration branch
  # remote army/* branches whose PR merged (covers a non-gh landing that skipped --delete-branch):
  for br in <each MERGED PR branch this wave>; do git push -q origin --delete "$br" 2>/dev/null; done
  # local army/* branches already merged into main:
  git branch --merged main | sed 's/^[* ]*//' | grep '^army/' | xargs -r git branch -d
  # runtime worktrees: it auto-removes UNCHANGED ones, but a worker that committed leaves its
  # worktree behind — prune stale admin entries, then drop any leftover army/* worktree dir:
  git worktree prune
  git worktree list --porcelain | awk '/^worktree /{w=$2} /^branch / && /army\//{print w}' | xargs -r -I{} git worktree remove --force {}
  ```

Per-wave, report one line per outcome: `✅ merged #N`, `🚨 parked #N (gate red / conflict)`, `🤔 needs-info #N`. Then continue to step 6.

## 6. Loop or stop (this conversation)

After the merge-train, decide whether to drain another wave:

1. **Re-pick** (step 2) against the *current* issue state — the issues just closed by `Closes #N` have flipped their dependents from blocked to ready.
2. **If the new pick set is non-empty → go to step 3** and drain the next wave. Do not ask the user; this is the auto-feed.
3. **Stop the loop when the pick set is empty.** Two distinct end states:
   - **Drained** — no `ready-for-agent` issues remain at all. Clean finish.
   - **Stalled** — `ready-for-agent` issues remain but *every* one is blocked by an open issue (a `PARKED` culprit, or a blocker outside this drain's scope). Nothing is drainable without a human. Report the stall and which parked issue(s) are damming each remaining one.
4. **No-progress guard (anti-spin).** If a wave merged **nothing** (every issue parked, or the only ready issues are blocked by this same wave's fresh parks), stop — re-picking would return the same un-drainable set forever. This is the stalled end state; do not loop again.

Between waves the conversation stays alive and idle (you're notified when each background workflow + gate completes) — no user input is needed until the loop ends.

## 7. Final report (loop end)

One consolidated summary across all waves: total `✅ merged` (with #s), the `PARKED` set with per-issue reasons and labels applied, and — if stalled — the blocked-but-not-drainable remainder with the parked issue damming each. End state is **drained** or **stalled**, stated plainly.

**Then release the per-repo drain lock** (section 1): `rm -rf "$LOCK"` (the per-repo path you claimed — never another repo's). Do this on every exit path — drained, stalled, or aborted — so the next drain on this repo isn't blocked by a lock the finished run left behind.

## What this skill does NOT do

- Hand-roll worktrees, heartbeats, concurrency caps, or `RESULT:`-string parsing — the Workflow runtime owns all of it.
- Cap, batch, or sample a wave from our side — every unblocked issue goes in; the runtime sets the real parallelism ceiling.
- Run the full gate inside workers (cost) — the merge-train runs it once per wave on the integrated result.
- Halt the whole drain on one snag — a failed issue is parked (`needs-human-review`, PR left open) and the loop keeps draining everything independent of it.
- Merge a parked PR without you, or auto-deploy. Parking preserves the human merge gate for the issue that needs eyes; it does not gate the healthy ones.
- Run unattended (interactive; needs this conversation alive across the waves).

## Files

- `SKILL.md` — this orchestration.
- `afk-workflow.js` — the parallel implement→push drain (one worker per issue, isolated worktree, structured return).
