---
name: uat
description: Drive Playwright-based UAT journeys against a running web app, filing GitHub issues inline the moment a finding surfaces. Each issue mirrors the `/afk-issues` body template + label scheme so `/afk-army` can pick them up directly. Self-bootstraps `docs/uat.md` on first run by interviewing the user and reading the repo. Companion to `/afk-issues` (carve from conversation) and `/afk-army` (drain the queue).
user-invocable: true
---

# uat

`/uat [J<n>... | all | recommend [N] | --no-issues]` — walk the canonical Playwright journeys in `docs/uat.md` against a running dev stack, filing GitHub issues inline as bugs / polish / data-quality gaps surface.

The doc is the spec. This skill is the runner. Every numbered assertion in `docs/uat.md` is checked; every failure becomes one issue; soft observations that meet the bar become `polish` issues. Issues land on the `gh` default repo with `ready-for-agent` + a complexity label, ready for `/afk-army` to drain.

If `docs/uat.md` doesn't exist yet, the skill **bootstraps** it — interviews the user, reads the repo's routes and entry points, recommends a starter set of journeys, writes the file.

## Modes

`/uat` auto-selects mode based on what it finds:

- **Bootstrap** (`docs/uat.md` missing) — interview the user, read the repo, propose 5–8 starter journeys, write them out. No issues are filed in this mode.
- **Recommend** (`/uat recommend [N]`) — read the existing doc, read the repo, propose N more journeys (default 3) that cover surfaces the existing doc hasn't reached. Append on user approval.
- **Run** (default with existing doc) — walk the journeys, file issues for findings. This is the load-bearing mode.

## Args

Tokens compose. With no args, runs all journeys.

- `J<n>` — run that single journey (e.g. `J3`, `J11`)
- `wave<n>` — run a named wave defined in the doc's `## Waves` section (if present)
- `all` — explicit-everything, same as no args
- `recommend [N]` — propose N more journeys, default 3
- `--no-issues` — dry-run; print findings but skip `gh issue create`. Use to sanity-check before filing.

Examples:

- `/uat` → run all journeys in the doc's canonical order
- `/uat J3 J7` → just those two
- `/uat wave1 J11` → wave 1 plus J11
- `/uat recommend 5` → propose 5 more journeys
- `/uat --no-issues` → walk everything, surface findings, file nothing

## Pre-flight (once at top of run)

1. **`gh auth status`** — verify the user is logged in with a token that can create issues + apply labels. Bail with a clear message if not.
2. **`gh repo set-default --view`** — confirm the default repo. Bail if unset.
3. **Required labels** — verify the canonical label vocabulary exists (`ready-for-agent`, `needs-sonnet`, `needs-opus`, `polish`). Offer to create any that are missing.
4. **`docs/uat.md` exists?** — if not, branch to **bootstrap** (see below). If yes, continue.
5. **Stack reachable** — by default, probe `http://localhost:3000`, `http://localhost:5173`, `http://localhost:8080`, `https://localhost`, or whatever the doc's preamble specifies as the dev URL. If 000 / non-200, bail with "stack doesn't look like it's running — start it and re-run /uat."
6. **Playwright session** — open one browser context with `--ignore-https-errors` (dev stacks often use internal CAs or self-signed certs), sign in with whatever auth the doc specifies, reuse across journeys.
7. **Acknowledge invocation** in one line: `Running /uat: <journeys>. Filing to <repo>.`

## Bootstrap mode

Triggered when `docs/uat.md` is missing. The goal: produce a starter `docs/uat.md` with 5–8 well-shaped journeys, written to the user's repo. No issues are filed in this mode.

### Step 1: discovery

Read the repo to ground recommendations in actual surfaces. Touch only static signals (don't run the app):

- `README.md` — project description, install/run instructions, mentioned URLs
- `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` — identify the framework
- Route definitions, based on the framework detected:
  - Express / Fastify: search for `app.get`, `app.post`, `router.<verb>`
  - Next.js / Nuxt / SvelteKit: `pages/` or `app/` directory listings
  - Django: `urls.py` files
  - Flask: `@app.route` decorators
  - Rails: `config/routes.rb`
  - Axum / Actix / Rocket: `Router::new()`, `web::scope`, `#[get]`/`#[post]` macros
  - Spring: `@RequestMapping` / `@GetMapping` annotations
- `docs/` folder — any existing UAT, QA, or user-flow docs
- `.env.example` / `config/` — what auth modes / external services the app expects

Output a one-paragraph internal sketch: "This looks like a `<framework>` app with `<N>` HTTP surfaces, primary entry points appear to be `<paths>`. There's an admin area at `<path>` and a public area at `<path>`."

### Step 2: interview

Ask the user up to 5 questions, one at a time. Skip any that the discovery already answered.

1. **Dev URL** — "What URL is the dev stack on when you `<just run | npm dev | cargo run>`?" Pre-fill from README if obvious.
2. **Auth** — "How do users sign in? (e.g. local creds, OAuth, magic link, no auth)" Capture default test creds if local.
3. **Roles** — "Is there an admin role / multiple user types? If yes, which roles need UAT coverage?"
4. **Critical flows** — "What are the 3 most critical user flows — the ones you'd hate to ship broken?"
5. **Anything else** — "Anything else I should cover that I can't see from the routes? (e.g. webhooks, background jobs with UI signals)"

### Step 3: propose

Synthesize 5–8 starter journeys covering at minimum:

- One sign-in / auth journey (J1)
- One "create the primary entity" journey (whatever the app's core noun is)
- One "list and filter the primary entity" journey
- One admin-only journey, if admin role exists
- One "soft 404 / error handling" journey
- The user's named critical flows

Present them as a list with one-line descriptions. Let the user redirect ("skip the admin one, add X instead") before writing.

### Step 4: write the doc

Generate `docs/uat.md` using the schema below. Include:

- A short preamble: project name, dev URL, auth creds (placeholder if not provided), instructions for running the skill
- A `## Journeys` section with one `### J<n>: <title>` per approved journey
- A `## Waves` section (optional) grouping journeys
- A reminder at the bottom: "Run `/uat recommend` to add more journeys, or `/uat J<n>` to run a single one."

Then bail. The user runs `/uat` again (or `/uat J1`) to actually execute.

## Recommend mode

Triggered by `/uat recommend [N]`. Reads the existing `docs/uat.md`, identifies which routes / surfaces aren't yet covered, proposes N more journeys.

Surface gaps from the diff between the route list (re-discovered as in bootstrap step 1) and the surfaces already named in journey `**Surface:**` lines. Prefer:

- Surfaces with no current journey at all
- Routes the user named as critical but that have only one journey
- Error / boundary cases ("what happens if you submit an empty form on `<surface>`")

Present each candidate with a one-line description. User can accept all, accept a subset, or reject and ask for more. Append accepted ones to `docs/uat.md` with continuing `J<n>` numbering.

## Journey schema

`docs/uat.md` must follow this shape. The runner parses it for assertions and prereqs.

```markdown
# UAT — <project name>

**Dev URL:** <e.g. http://localhost:3000>
**Test creds:** <user> / <password> (local dev only)
**Run:** `/uat` (all journeys), `/uat J3` (one), `/uat recommend` (add more)

## Waves (optional)

- **wave1:** J1, J2, J3
- **wave2:** J4, J5

## Journeys

### J1: Sign in and reach the dashboard

**Surface:** `/login`
**Prereqs:** None (this is the entry journey)

#### Assertions

1. Navigate to `/login`. The page renders with email + password fields and a submit button.
2. Submit with wrong creds. The page shows an inline error within 2 seconds. No navigation.
3. Submit with valid test creds. The browser navigates to `/dashboard` and the page renders the user's name in the top bar.

#### Soft observations (file as polish)

- Anything subjective the runner spots: spacing, copy, focus management, console errors.

### J2: ...
```

### Schema rules

- Journeys are numbered `J1`, `J2`, ... sequentially. No gaps.
- Each journey has exactly: `**Surface:**`, `**Prereqs:**`, `#### Assertions`, and optionally `#### Soft observations`.
- Assertions are a numbered list (`1.`, `2.`, ...) and each one is a single concrete behavioural claim the runner can pass/fail in one screen.
- Prereqs is a one-line list, or `None`. The runner reads this and skips the journey if the prereq is unmet (e.g. "fixture user must be in DB" → runner probes, skips with a one-line note if absent).
- A journey may be marked `(reserved)` instead of having assertions — the runner skips it silently.

## Per-journey loop (run mode)

For each journey in the resolved list:

### 1. Prereq probe

If the journey's `**Prereqs:**` line names something the runner can probe cheaply (a DB row, a file presence, an env var, an external service URL), probe it before spawning Playwright. If the prereq fails, print:

```
J<n> SKIPPED — <one-line reason>
```

and continue to the next journey. Do NOT file an issue for a missing prereq.

If the prereq line is `None` or describes something the runner can't auto-probe, just continue.

### 2. Walk the assertions

Open the journey's first surface in Playwright. Walk the doc's numbered assertions in order.

For each assertion:

- **Pass** → print `J<n>.<m> ✓` and move on
- **Fail** → file an issue immediately (see "Filing an issue" below), print `J<n>.<m> ✗ → filed #<num> [<complexity>] <scope>/<slug> <url>`, and continue with the next assertion
- **Page didn't load at all** (e.g. 502, hard JS crash) — file one issue describing the catastrophic state, then skip remaining assertions for this journey (they have no surface to inspect) and move to the next journey

While walking, also watch for **soft observations** worth filing:

- A JS console error (real `Error`, not a known warning) — always file
- A 4xx/5xx in the network panel that wasn't part of an asserted check — always file
- A visible UI oddity Claude can articulate a concrete acceptance criterion for (e.g. "the KPI tile renders as `NaN`", "the breadcrumb wraps onto two lines on viewport ≥ 1280px") — file with the `polish` label

Bar for filing a soft observation: if Claude can't write a one-sentence "the fix is to …" then it's a vibe, not a finding. Skip vibes.

### 3. End-of-journey reconciliation

After the last assertion of the journey:

1. Print `J<n> done: <pass>/<total> pass, filed <k> issues`.
2. **Same-surface blocked-by pass**: list the issues filed during this journey, harvest backtick-wrapped file paths from each `## Approach` / `## References` block matching common code/config extensions, then collapse each path to a **surface key** (the first directory segment after any deep-path prefix the runner recognizes; falls back to the filename stem if no directories remain). If two or more issues share a surface key, append `## Blocked by #<oldest>` to the younger ones via `gh issue edit <num> --body-file <updated>`. Mirrors `/afk-issues` same-surface serialization; stops `/afk-army` workers from racing schema/template drift.

```bash
# After all issues for this journey are filed and their numbers captured in /tmp/uat-journey-<n>-issues.tsv (num \t bodyfile)

# Collapse a file path to a surface key: take the first remaining
# directory segment (or filename stem if none remains). Adjust the
# prefixes list if your repo has standard deep paths like `src/views/pages/`.
surface_key() {
  local p="$1"
  case "$p" in
    */*) echo "${p%%/*}" ;;
    *)   echo "${p%.*}" ;;
  esac
}

declare -A surface_owner
declare -A surface_path
while IFS=$'\t' read -r num bodyfile; do
  paths=$(grep -oE '`[a-zA-Z0-9_./-]+\.(rs|js|ts|tsx|jsx|py|go|java|rb|php|sql|yaml|yml|toml|json|md|html|css|j2|hbs)`' "$bodyfile" | tr -d '`' | sort -u)
  for p in $paths; do
    key=$(surface_key "$p")
    if [[ -n "${surface_owner[$key]}" ]]; then
      printf '\n\n## Blocked by\n\nSame-surface conflict with #%s (surface `%s`; this issue cites `%s`, the blocker cites `%s`). Will pick up automatically once #%s lands and main settles.\n' \
        "${surface_owner[$key]}" "$key" "$p" "${surface_path[$key]}" "${surface_owner[$key]}" >> "$bodyfile"
      gh issue edit "$num" --body-file "$bodyfile"
      break
    else
      surface_owner[$key]=$num
      surface_path[$key]=$p
    fi
  done
done < /tmp/uat-journey-<n>-issues.tsv
```

If `--no-issues` was passed, skip the reconciliation pass (there's nothing to wire).

## Filing an issue

When an assertion fails (or a soft observation crosses the bar), file immediately while Playwright still has the page open and the logs are warm.

### Title

`<verb>(<scope>): <short crisp summary>` — match repo convention (sample `git log --oneline -50`):

- `bug(<scope>): …` for an asserted behaviour that's false
- `polish(<scope>): …` for soft observations and copy/spacing/accessibility nits
- `feat(<scope>): …` for missing-capability gaps (the doc's `N/A` cases)
- `refactor(<scope>): …` for code-health observations (rare from a UAT run)

Scope is the surface (one or two hyphenated words naming the affected page/module/feature).

### Body

Use this template. `/afk-army` workers parse the AC checklist.

````markdown
## What's broken

<2–6 sentences. Quote the doc's assertion verbatim if it's an asserted failure. Concrete repro: which page, which click sequence, what the page rendered vs what was expected.>

Spotted in **Journey J<n>** assertion <m>. (or **Journey J<n>** soft observation.)

## Approach

<2–5 sentences or a numbered list. Name the likely files. Describe the change, don't prescribe the diff.>

## Acceptance criteria

- [ ] <Concrete behavioural assertion 1 — usually a near-restatement of the doc's assertion>
- [ ] <…>
- [ ] <Last item is usually a regression-prevention test or `data-test` selector to lock the fix>

## Evidence

### Console
```
<paste relevant lines from the Playwright console, errors first, no INFO noise>
```

### Network
```
<status URL duration — one line per failing/slow request, only the ones tied to this finding>
```

### DOM excerpt
```html
<the rendered HTML of the misbehaving region, scoped tight — not the whole page>
```

### DB state (if relevant)
```sql
-- query
SELECT …;
-- result
…
```

## References

- Journey: J<n> assertion <m> (or "soft observation during J<n>")
- View / module: `<best-guess path>` (don't make up file paths; list 2–3 candidates if unsure)
- Repro URL: `<path>`
````

Skip any `### Evidence` subsection that has nothing to put in it. An issue with only a `### Console` block is fine; don't pad with empty `### Network` blocks.

### Labels

- Always: `ready-for-agent`
- Always one of: `needs-sonnet` (default) or `needs-opus`
- Add `polish` for soft observations
- Don't tag `uat` — no dedup scheme is in place; tagging would just clutter

Complexity heuristic mirrors `/afk-issues`:

- **`needs-opus`** when the finding crosses module/package boundaries, names an evaluator/matcher/generator/dispatcher, touches schema migration design, requires reading the room on ambiguous spec, or implies a naming sweep across 5+ files.
- **`needs-sonnet`** for template / view edits, mechanical wiring, adding a `data-test`, copy/label polish, single-file scope. When in doubt, sonnet.

### Posting

```bash
gh issue create \
  --title "<title>" \
  --body-file /tmp/uat-J<n>-<seq>.md \
  --label ready-for-agent \
  --label <needs-sonnet|needs-opus> \
  [--label polish]
```

Capture the URL from stdout, parse the issue number, append `<num>\t<bodyfile>` to `/tmp/uat-journey-<n>-issues.tsv` for the end-of-journey reconciliation pass.

If `--no-issues` is set, write the draft to `/tmp/uat-J<n>-<seq>.md` and print the title + would-be labels to the conversation, but skip `gh issue create`.

## Output cadence

While running, one line per assertion. One block per filed issue:

```
J3.1 ✓
J3.2 ✗ → filed #998 [sonnet] bug(search): "No results" shown when results exist
        https://github.com/owner/repo/issues/998
J3.3 ✓
J3.4 soft → filed #999 [sonnet] polish(search): filter drawer drops focus on close
        https://github.com/owner/repo/issues/999
```

End of each journey:

```
J3 done: 6/8 pass, filed 2 issues (0 deferred for same-surface)
```

End of /uat:

```
#998 [sonnet] bug(search): "No results" shown when results exist
#999 [sonnet] polish(search): filter drawer drops focus on close
#1001 [sonnet] bug(search): pagination resets when a filter changes    ⏸ blocked by #998
#1002 [opus]  feat(performance): dashboard /health is a stub
…

Filed 14 issues across 12 journeys. 3 skipped (prereqs unmet).
Run `/afk-army sonnet 3` to drain, or `/afk-army hybrid 3` if any are needs-opus.
```

Print the URL of each filed issue inline so the user can click through mid-run if they want to stop you.

## What NOT to do

- **Don't refile from prior runs blindly without context** — no dedup is in place. If a /uat run produces what feels like a churn pile of "we filed this last week" issues, surface it in the end-of-run summary as a hint that fixes have stalled rather than silently filing more.
- **Don't file vibes.** If you can't write a concrete acceptance criterion in one sentence, it's not a finding.
- **Don't attach screenshots.** Text evidence only (console / network / DOM / DB). Screenshots would need image hosting and `/afk-army` workers have their own Playwright access if they need to re-look.
- **Don't file an issue for a missing prereq.** If a fixture is missing, the journey is SKIPPED in the summary, not filed.
- **Don't pad findings.** If a journey passes 100%, the right output is `J<n> done: 8/8 pass, filed 0 issues` — not a "celebration" comment, not a tracking issue.
- **Don't auto-start the dev stack.** If it isn't reachable, bail with a clear instruction and let the user start it.
- **Don't apply both `needs-sonnet` and `needs-opus`.** Pick one. Classify on the change, not the surface.
- **Don't ask the user to confirm each finding.** The invocation is the consent. If they want to stop, they'll Ctrl-C / interrupt — the inline issue URLs make that easy.
- **Don't choke on `(reserved)` journeys in `docs/uat.md`.** A reserved journey has no assertions; skip it silently.
- **Don't rewrite the bootstrap doc unprompted.** Once `docs/uat.md` exists, the skill is in run/recommend mode. Edits to the doc go through `/uat recommend` (append-only) or the user editing the file directly.
