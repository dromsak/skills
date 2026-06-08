# dromsak/skills

Personal toolbox of Claude Code skills, packaged as a plugin. The headline
workflow is the **AFK pipeline** — a way to drive a GitHub-Issues-shaped
backlog through a fleet of parallel Claude Code subagents without leaving
the room mentally, but also without leaving the room physically (this
isn't unattended overnight automation; it's "I can do other things in this
conversation while five workers grind").

## What's in here

| Skill | What it does |
|---|---|
| [`afk-issues`](skills/afk-issues/SKILL.md) | Carve findings from the current conversation into well-shaped GitHub issues with acceptance criteria, complexity labels, and same-surface `## Blocked by` markers. |
| [`afk-army`](skills/afk-army/SKILL.md) | Drain the `ready-for-agent` queue via the **Workflow runtime** — one worker subagent per unblocked issue, each in a runtime-managed git worktree (implement → push → PR), then a single **batch-verify merge-train** lands them (integrate all, gate once, bisect on red). Pairs `SKILL.md` (orchestration) with `afk-workflow.js` (the parallel drain). |
| [`uat`](skills/uat/SKILL.md) | Drive Playwright-based UAT journeys against a running web app, filing GitHub issues inline. Self-bootstraps `docs/uat.md` on first run by interviewing you and reading your routes. |
| [`architect`](skills/architect/SKILL.md) | Senior-architect audit of one code surface — finds wheel-reinvention, over-engineering, duplication, dead code, layering drift, and bloat across 15 named lenses, adversarially verifies each finding, ranks by impact÷effort, and (only on your pick) routes fixes into the AFK pipeline. Language-agnostic engine: auto-detects the stack and reads an optional per-repo `.claude/architect.md` profile for named surfaces and project rules. Read-first, two human gates, no autonomous mode. Pairs `SKILL.md` with `audit-workflow.js` (the frugal ~2-agents/chunk fan-out). |
| [`grill-me`](skills/grill-me/SKILL.md) | Interview the user relentlessly about a plan or design until reaching shared understanding. Vendored from [`mattpocock/skills`](https://github.com/mattpocock/skills). |
| [`dromsak-guidelines`](skills/dromsak-guidelines/SKILL.md) | dromsak's personal operating profile, centred on **context engineering / token-maxxing** — small relevant working set, just-in-time loading, parallel read-only subagents for fan-out, compact at theme boundaries, frugal delegation, verify-once-at-the-boundary. Its §4 consolidates the karpathy LLM-coding rails (MIT — see Attribution), and it adds an advisory-lane autonomy stance. Loaded by `afk-army` workers; load at session start. |

## The AFK pipeline

The three workflow skills (`afk-issues`, `afk-army`, `uat`) are designed
to work as a tight pipeline. They share a body template, a label
vocabulary (`ready-for-agent`, `needs-sonnet`, `needs-opus`,
`agent-working`, `needs-human-review`, `needs-info`), a branch prefix
(`army/*`), and a `## Blocked by` convention for explicit issue
dependencies. (Same-surface *serialization* is no longer pre-computed —
file conflicts now surface and resolve once, at the merge-train's
integration step.)

Typical loop:

1. **`/uat`** — walk your Playwright journeys, file an issue per finding.
2. **`/afk-issues`** — carve any findings from the current conversation
   that didn't come from `/uat` (code reviews, grilling sessions, bug
   reports) into more issues.
3. **`/afk-army sonnet`** — fires one worker per unblocked issue (the
   runtime paces concurrency), each implements + opens a PR, then the
   batch-verify merge-train lands the green ones in the same run. No
   separate merge phase — it pauses for you only if a worker escalates.

You can use the skills independently, but mixing in custom labels or a
different body template means hand-editing the skill prompts — the
contract is hardcoded, not configurable.

## Installation

This is a Claude Code plugin, served from the marketplace defined in
`.claude-plugin/marketplace.json`. Install is two steps — add the
marketplace, then install the plugin from it (you can't `/plugin install`
a bare repo URL):

```
/plugin marketplace add dromsak/skills
/plugin install dromsak-skills@dromsak-skills
```

(`dromsak/skills` is a public repo, so no auth is needed to add the
marketplace. To pick up new skills later: `/plugin marketplace update
dromsak-skills` then reload.)

After install, the five skills are user-invocable as `/afk-issues`,
`/afk-army`, `/uat`, `/grill-me`, and `/dromsak-guidelines`.

## Setup (for the workflow skills)

`afk-issues`, `afk-army`, and `uat` all need:

1. **`gh` configured** — `gh auth status` should show a logged-in user with
   permission to create issues, labels, and PRs on your target repo.
2. **A default repo** — `gh repo set-default <owner>/<name>`. The skills
   read this to know where to file issues and open PRs.
3. **Canonical labels** — `ready-for-agent`, `needs-sonnet`, `needs-opus`,
   `agent-working`, `needs-human-review`, `needs-info`. The skills check
   for these at pre-flight and offer to create any that are missing.

`afk-army` additionally:

4. **A full verify gate** — run *once*, at the merge-train, against the
   integrated result (not per-PR, not by workers). Pin it with
   `/afk-army --gate "<cmd>"`, else it's discovered from your `CLAUDE.md`,
   a `just verify`/`verify-gate` recipe, `package.json` scripts,
   `cargo test`/`nextest`, `go test ./...`, etc. Workers run no gate by
   default (the merge-train is the safety); supply a *cheap* one only if
   it won't thrash under parallelism.
5. **RAM is the real ceiling, not a thread count.** The Workflow runtime
   paces how many workers run at once — you don't set a number. On a box
   with a heavy compiled toolchain (e.g. a large Rust crate or C++/CMake
   target), peak RAM
   across simultaneous workers is the binding constraint; keep an eye on
   it rather than tuning a thread count.

`uat` additionally:

6. **Wants a Playwright MCP** — the
   [`playwright`](https://github.com/microsoft/playwright)
   MCP server (or the `mcp__playwright__*` tools) must be available. The
   skill drives the browser through those.
7. **Bootstraps `docs/uat.md` on first run** — interviews you about your
   app's routes, auth, roles, and critical flows, then writes a starter
   doc with 5–8 journeys. Subsequent `/uat` runs walk that doc.

## What this is NOT

- **Not unattended overnight automation.** `/afk-army` runs inside an
  interactive Claude Code session — the orchestrator lives in *this
  conversation*. If your laptop closes or your SSH drops, it dies and
  in-flight workers may strand. Use it as "I can keep this conversation
  alive in the background while I do other things," not "I can walk away
  for 8 hours."
- **It auto-merges clean batches — know that going in.** When every
  worker succeeds and the batch-verify gate is green, the merge-train
  lands all the PRs without a per-PR review stop; it pauses for you only
  when a worker *escalates* (gate red after retries, spec ambiguity,
  conflict). If you want a human review window before anything lands,
  stop the run at the PR stage and merge yourself. The gate is the
  safety, not human eyes on every diff.
- **Not for unauthenticated public repos.** The skills assume `gh`-shaped
  auth and a private-or-personal workflow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: PRs welcome,
review when I have time, upstream fixes for vendored skills go to their
original repos.

## Attribution

- `grill-me` is vendored from
  [`mattpocock/skills`](https://github.com/mattpocock/skills) (Matt
  Pocock, MIT).
- `dromsak-guidelines` is original work; its §4 coding rails consolidate and
  adapt the karpathy rails from
  [`forrestchang/karpathy-skills`](https://github.com/forrestchang/karpathy-skills)
  (`forrestchang`, MIT — itself derived from Andrej Karpathy's observations on
  LLM coding pitfalls), credited in-file; the rest are dromsak's own.

Both upstream repos are MIT-licensed; per-skill `SKILL.md` files include
in-body attribution comments, and the full notices are in
[`LICENSE`](LICENSE).

## License

[MIT](LICENSE).
