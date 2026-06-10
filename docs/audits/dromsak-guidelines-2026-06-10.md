# Architect audit — `skills/dromsak-guidelines/`

- **Date:** 2026-06-10
- **Resolved target:** `skills/dromsak-guidelines/SKILL.md` — 1 file, 67 lines (~7.4 KB dense prose). Plugin-cache copy verified md5-identical to repo.
- **Detected language:** Markdown (behavioral-rails skill, no code).
- **Repo profile:** none → zero-config mode.
- **Machinery & real cost:** small target → inline audit, **1 Sonnet batch-skeptic subagent** (19.7k subagent tokens, 41 s). Skeptic adjudicated 5 findings: 2 confirmed, 2 confirmed-narrowed, 1 refuted, +1 missed item it surfaced.
- **Key context:** the skill serves **two audiences** — dromsak's interactive main loop ("load at session start") and headless afk-army workers (`afk-army/afk-workflow.js:48`, `afk-army/SKILL.md:21`). It is also the public/portable mirror of rails that live privately in `~/.claude/CLAUDE.md`.

---

## Confirmed findings (ranked by impact ÷ effort)

### 1. G2 · ⑨/⑦ audience mismatch · `SKILL.md` §1, §5, §6 (+§2)
**Headless afk-army workers load the whole skill, but several sections are inapplicable or directly conflict with their mandate.**
Workers are told to invoke this skill (`afk-workflow.js:48`, `afk-army/SKILL.md:21`). For them: §1's compact-at-theme-boundaries and subagent fan-out are orchestrator concerns; §6's reply-style is human-facing; §2's model-tiering ("never put the weakest model near a judgement call") is a rule a Sonnet worker can't act on; and — worst — §5's "don't auto-apply consequential changes… two gates: the human picks, the human reviews" (line 58) contradicts the worker's job of autonomously implement→commit→push→PR (`afk-workflow.js:59`). A literal-minded worker could stall waiting for approval the pipeline already granted structurally (the issue is the pick; the PR review is the gate).
**Fix:** add one scoping paragraph near the top: headless subagents take §4 (coding rails) + §3 as their rails; §1/§2/§5/§6 are orchestrator/main-loop concerns, and for workers the two §5 gates are *already satisfied* by the issue they were handed and the PR review ahead.
**Effort:** S · **Risk:** low

### 2. G1 · ③ duplication/drift (⑦) · `SKILL.md` §1–§4 ↔ `~/.claude/CLAUDE.md`
**Seven rails exist in both files, and one pair has already drifted into direct conflict.**
Overlap verified line-by-line by the skeptic: push-back-by-default, suggest-existing-tools, subagent fan-out, compact-at-boundaries, two-strike rule, never-guess-APIs, minimal output. Both copies load into the *same* context when dromsak invokes the skill locally — double cost plus drift risk. Concrete drift already present: CLAUDE.md "always compile/build and run tests **before committing**" vs §3 "run the full gate **once, at the boundary (before a push)**" + calling mid-task re-runs "theatre". In a multi-commit session the model must violate one of them. (Narrowed: conflict is scoped to dromsak's machine; workers see only the skill.)
**Fix:** (a) reconcile the verify rule in both files to one statement — "code must *compile* before each commit; the *full* test gate runs once at the push/handoff boundary" preserves both intents; (b) add a one-line mirror marker in each file ("rails mirrored in <other file> — edit both"), same mitigation pattern as architect's LENS_GUIDE.
**Effort:** S–M (touches private `~/.claude/CLAUDE.md` too) · **Risk:** low

### 3. G3 · ②/⑥ self-violation · `SKILL.md:3` (frontmatter description)
**The 91-word description is always-on context in every session's skill index — violating the skill's own §1 doctrine** ("keep lightweight *pointers* in always-on context… one-line index"). Every session on every machine pays ~530 chars for a pointer whose job is "should I load this skill?".
**Fix:** cut to ~25 words, e.g. "dromsak's operating rails for Claude Code: lean context engineering, frugal delegation, deliberate verification, karpathy coding rails, advisory-lane autonomy. Load at session start."
**Effort:** S · **Risk:** none

### 4. G4 · ① restating harness built-ins (narrowed) · `SKILL.md:61`
**The AskUserQuestion parenthetical duplicates the tool's own built-in instruction** ("recommended option goes first with '(Recommended)'") — redundant in the main loop, unreachable for workers (they never call AskUserQuestion). *Narrowed by the skeptic:* lines 59–60 (look-before-deleting, report-faithfully) superficially duplicate the main-loop system prompt but are **load-bearing for workers**, whose slimmer prompts lack them — keep those.
**Fix:** delete only the line-61 parenthetical sentence.
**Effort:** S · **Risk:** none

## Decisions to revisit (⑨)

- **G2** above is the only ⑨ finding — "one rails doc for every audience" was fine when only dromsak loaded it; the moment afk-army workers started loading it, §5's human-gate language became a latent stall hazard. The fix keeps one doc but scopes it.

## Refuted / skipped

- **G5 — "token-maxxing" alias contradicts the minimalism doctrine** → REFUTED: appears twice, defined inline at first use ("the scarce resource isn't tokens-as-cost… it's latency, quality of working context, clear reasoning"); dropping the user's own pet name reduces discoverability without removing any real confusion.
- **Attribution comment block (lines 7–14) loaded every invocation** → refuted as actionable: MIT notice preservation is load-bearing, README explicitly promises in-body attribution, ~8 lines.
- **Clean lenses:** ④ dead content, ⑤ shallow modules, ⑥ naming (sections descriptive throughout), ⑬ security — nothing found. ⑩–⑫, ⑮ not applicable (no tests, build, or schema).
