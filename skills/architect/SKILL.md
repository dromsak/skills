---
name: architect
description: Senior-architect audit of a code surface — finds bespoke wheel-reinvention, over-engineering, duplication, dead code, layering drift, and bloat, adversarially verifies each finding, ranks them, and (only on your pick) routes fixes through /afk-issues → /afk-army. Language-agnostic: auto-detects the stack and reads an optional per-repo `.claude/architect.md` profile for named surfaces and project rules. Read-first, never autonomous. Invoke as `/architect <scope>` where scope is a named surface (from the repo profile) or any path/file/fuzzy module name.
user-invocable: true
---

# architect

`/architect <scope>` — audit one surface like a senior architect would, then hand you a ranked, **verified** list of what to fix. You pick what gets actioned; nothing changes without two human gates (you choose the fixes, you merge the PRs). There is **no autonomous mode** by design.

This is the portable engine. It runs in any repo: it auto-detects the language, applies a language-agnostic lens set plus a per-language idiom lens, and — if the target repo has a `.claude/architect.md` profile — picks up that repo's **named surfaces, project constraints, and layering rules**. With no profile it still works: scope is any path/file/fuzzy name, lenses are the generic set.

## Flow (one mode)

```
resolve scope → read intent (+ optional repo profile) → audit (lensed)
   → adversarially verify each finding → rank
   → write report to docs/audits/ + present here → you multi-select fixes
   → code fixes route to /afk-issues → /afk-army  |  doc/decision fixes handled directly with your approval
```

## 0. Load the repo profile (if any) and detect the stack

Before anything else:

1. **Look for `.claude/architect.md`** in the target repo. If present, it is the profile — it can define a **surface manifest** (named scope → path globs), a one-paragraph **project context / constraints** (e.g. "deliberately monolithic — don't recommend microservices"), **drift rules** (the layering invariants for lens ⑧), and **language-idiom** notes (lens ⑭). Everything in it is optional, and it's self-describing — parse what's there. The authoring spec lives in `profile-format.md` in this skill's directory; Read it only when offering to create or explain a profile. Absent ⇒ zero-config mode.
2. **Detect the language** from project markers (`Cargo.toml`→Rust, `package.json`/`tsconfig.json`→TS/Node, `pyproject.toml`/`requirements.txt`→Python, `go.mod`→Go, …) and the file extensions in scope. A repo can be polyglot — detect per-scope. The detected language selects the default idiom lens (⑭) and tunes the build/test/async lens prose.

## 1. Resolve the scope

The arg is a **named surface** (only if the repo profile defines one), or **any path/file**, or a **fuzzy module name** — the skill never refuses a target.

- **Named surface** → look it up in the profile's surface manifest, expand to its path globs.
- **A real path or file** → use it verbatim.
- **Fuzzy** (`scheduler`, `auth`, …) → `fd <name> --type d` / `--type f` under the tree; if 2+ plausible matches, ask "did you mean X or Y?"

Resolve to a concrete **file list** (source files for the detected language, plus templates/styles/config where they're part of the surface). Print the resolved target + file/line count before auditing.

## 2. Read the intent — as testimony, not law

Before judging, skim the repo's `CONTEXT.md` / `README`, any `docs/adr/` or design docs, the `.claude/architect.md` profile, and `CLAUDE.md` rules to understand *why* the code is shaped this way. **Documented decisions are testimony from the accused, not the law** — a decision baked into an ADR can itself be the bug. You are explicitly licensed to flag "this documented decision codified a mistake" with evidence (lens ⑨). Never reject a good finding because "a doc says so."

## 3. Audit — the lenses

Hunt for these *named* failure modes (vague "make it better" is banned — every finding cites `file:line`, the offending code, a concrete fix, and where relevant the **named replacement library/std API + estimated LOC delta**). These lenses are mirrored as the subagent-facing `LENS_GUIDE` in `audit-workflow.js` — **edit both** when you add or reword one (the JS `LENSES` enum is id-only, kept deliberately terse):

**Leanness** — ① wheel reinvention (bespoke code a maintained library/std already does — *name it*) · ② over-engineering (abstractions with one impl, generics/type-params used once, unused config knobs, speculative flexibility) · ③ duplication (same logic in N places, drifted) · ④ dead code (unreferenced functions/types/flags/routes/templates).

**Structure** — ⑤ shallow/leaky modules (pass-through wrappers, leaked internals) · ⑥ LLM-navigability (imprecise names — the standard is `userSessionStore.ts`/`order_repository.go`, not `store.ts`/`repo.go`; scattered cohesion; high coupling/ripple — *not* raw line count) · ⑦ inconsistency (the same thing done 3 ways; divergent error handling/naming — the dominant LLM-grown-code smell) · ⑧ drift-watch / layering violations (business logic in the wrong layer, reaching past the data-access/repository layer, illegal upward module/crate dependencies — **the precise invariants come from the repo profile if it has them; otherwise apply generic layering judgment**) · ⑨ suspect decisions (documented decisions the code reveals as wrong/obsolete).

**Velocity** (weighted up — leaner ⇒ faster LLM dev) — ⑩ test signal (tests asserting mocks, over-mocked setups, duplicated fixtures, tests of trivial glue, slow tests dominating the suite) · ⑪ build/compile-time (bloat that slows the inner loop — monomorphization/proc-macro overuse in Rust, barrel-file/type-graph blowups in TS, unused/duplicate deps) · ⑫ async/concurrency simplicity (needless locking/shared-state guards — `Arc<Mutex>`, redundant mutexes, over-broad critical sections — over-spawned tasks/threads, blocking calls in async, sequential awaits that should run concurrently).

**Correctness & security** — ⑬ security-architecture (auth/authz boundaries, secret handling, trust boundaries *by design* — additive to diff-level and CVE-level scanners) · ⑭ language-idiom correctness **a linter can't catch** (only flag what the project's `-D warnings`/eslint/mypy already miss): floating-point for money (use decimal/integer-cents); panicking on fallible paths in library code (`unwrap`/`expect`, unchecked `!`, bare `throw` swallowing context); error-propagation shape (swallowed errors, stringly-typed errors where an enum/union belongs). **The exact idiom checklist comes from the detected language / repo profile.**

**Schema (opt-in):** ⑮ data-model/schema shape (over/under-normalization, redundant/derivable columns, collapsible migrations) — higher-uncertainty for an LLM, so only enabled when the scope is a database/persistence layer (named `db`/`database`, or you pass `schemaScope`), and the verifier is told to be extra-skeptical.

## 4. Scale the machinery to the target

- **Small target** (a `file`, or a module < ~2k lines): audit **inline** — read the files yourself, apply the lenses, then do a skeptic pass on each finding (re-check the exact lines; for finding ⑭/① re-verify the named library/API actually exists and does what's claimed — empirically where a cheap test settles it). Then send the full finding list to **one Sonnet batch-skeptic subagent** (plain `Agent` tool, default-to-refuted, same contract as the workflow's verifier) — self-review can't catch your own motivated reasoning. Drop what it refutes into the report's "Refuted / skipped" section. No heavy machinery beyond that single agent.
- **Surface target** (a whole scope, or > ~2k lines): run the fan-out **workflow** — **frugal by design** (1 reviewer + 1 batch-verifier per chunk = ~2 Sonnet agents/chunk, fixed regardless of how much it finds):
  1. Enumerate the file list, group into cohesive **chunks** — each chunk is what ONE reviewer reads in a single pass, so keep it to ≤ ~8 files / ~1.5k lines and split along real submodule seams.
  2. Run it: `Workflow({ scriptPath: "<this-skill-dir>/audit-workflow.js", args: { scope, chunks: [{label, files:[...]}], lang, projectContext, driftGuide, idiomGuide, schemaScope } })` — pass `lang`/`projectContext`/`driftGuide`/`idiomGuide` assembled from §0 (empty strings are fine; the script falls back to language-neutral defaults), and `schemaScope: true` only for a persistence-layer scope.
  3. The workflow returns **confirmed**, **refuted**, and **unverified** findings (unverified = the skeptic returned no verdict — never actioned, but never silently dropped either). Per chunk: one reviewer reads the files once and applies **all** lenses (so the file is read once, not once-per-lens), then one skeptic batch-adjudicates that chunk's whole list in a single adversarial call (default-to-refuted). All agents run on **Sonnet**; ranking/synthesis/conversation happen here in the main (Opus) loop — no Opus agents spawned.
  - **Budget check first — and a hard cap behind you.** ~2 agents × N chunks (a 7-chunk surface ≈ 14 agents). State the agent count *before* launching. The workflow enforces a structural ceiling of **`MAX_CHUNKS = 12`** (≈24 agents): over that it audits the first 12 and loudly logs what it skipped — so a mis-chunked surface can't run away (an early run spun up ~400 agents on one page). If a surface would need >12 chunks, **narrow the scope or batch it across runs** rather than leaning on the truncation. This is a rapid-prototyping triage tool, not a perfectionist gate — bound the slice, take the high-value findings, move on. Never reintroduce per-finding fan-out; that is what blew up before.
  - **Gotcha:** this runtime delivers `args` to the script as a JSON *string*, not an object — the script parses it defensively (`const A = typeof args === 'string' ? JSON.parse(args) : args`). Keep that line if you edit the script.

## 5. Rank & report

Sort confirmed findings by **impact ÷ effort**, with LLM-dev-velocity gains weighted up (a fix that shrinks the build/test loop or de-tangles a hot file beats a cosmetic one of equal LOC). Then:

- **Write the report** to `docs/audits/<scope>-<YYYY-MM-DD>.md` (tracked — lives with the code it judges, re-runnable and diffable). Include: resolved target, file/line count, detected language, and the run's cost (`agents_spawned` from the workflow return — don't eyeball it — plus `tokens_out` as a shared-pool token **ceiling**: `budget.spent()` counts the whole turn, not just this workflow; if `chunks_requested > chunks_reviewed`, note the cap truncated the run and what to re-run). Then each confirmed finding (id · lens · `file:line` · problem · proposed fix · replacement · LOC delta · effort · risk), a separate **"Decisions to revisit"** section for suspect-decision (⑨) findings, and a terse **"Refuted / skipped"** section listing the `refuted` findings with the skeptic's one-line reason and the `unverified` ones marked "(no verdict)" (so a re-run diffs cleanly and you can see what was challenged or left unjudged, not just what survived). Cluster restated findings — present distinct fixes, not raw reviewer output.
- **Present** the ranked list here, then ask via `AskUserQuestion` (multiSelect) which to fix. Decline-all is valid — that's your read-only report.

## 6. Hand off the picks — two gates, no autonomy

- **Code findings** → invoke `/afk-issues` to file each pick as a `ready-for-agent` issue (AC checklist, complexity label, same-surface `## Blocked by` wiring), then tell the user to run `/afk-army` to drain them. Every fix lands as a PR they squash-merge. Reuse that machinery — never edit code directly from here.
- **Suspect-decision findings (⑨)** are **not** afk-army work — revisiting a decision is a doc edit ± a follow-on refactor. Keep them in the "Decisions to revisit" section; the user decides which deserve a doc/ADR rewrite.
- **Doc/skill/config findings** (e.g. auditing a `*.md` skill file or `CLAUDE.md`) are surgical edits — make them directly here, one finding at a time, after the user picks. Same two gates: user picks, user reviews the diff.

## Notes

- **The per-scope invocation is the cost control** — audit one surface at a time, never a whole large tree at once.
- Don't recommend undoing a *deliberate* decision without evidence it was wrong. Challenge them — but with proof, via lens ⑨, not reflexively.
- This skill **finds and proposes**; it does not auto-apply. If you want the diff applied, that's the `/afk-army` PR you merge, or the direct edit you approve.

## Files in this skill

- `SKILL.md` — this file (orchestration, scope/profile resolution, lenses).
- `audit-workflow.js` — the frugal fan-out engine for surface-scale targets (per chunk: 1 all-lens reviewer → 1 batch-verifier, all Sonnet; ~2 agents/chunk, fixed cost, hard-capped at `MAX_CHUNKS = 12` ≈ 24 agents). Language-agnostic: takes `lang`/`projectContext`/`driftGuide`/`idiomGuide`/`schemaScope` from the caller. Returns confirmed, refuted, **and** unverified findings plus the run's real `agents_spawned`/`tokens_out`.
- `profile-format.md` — the `.claude/architect.md` authoring spec. Read on demand (when creating or explaining a profile), not loaded per-run.
