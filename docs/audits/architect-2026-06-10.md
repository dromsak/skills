# Architect audit — `skills/architect/` (self-audit)

- **Date:** 2026-06-10
- **Resolved target:** `skills/architect/SKILL.md` (127 lines) + `skills/architect/audit-workflow.js` (261 lines) — 388 lines total. Plugin-cache copy verified byte-identical to repo (md5).
- **Detected language:** Markdown skill orchestration + JavaScript (Workflow-runtime dialect — no Node APIs, runtime-injected globals).
- **Repo profile:** none (`.claude/architect.md` absent) → zero-config mode, generic lenses.
- **Machinery & real cost:** small target → **inline audit, 0 review subagents**. One zero-agent diagnostic workflow run to empirically verify finding F3 (`agent_count: 0`, `subagent_tokens: 0`, 8 ms).

---

## Confirmed findings (ranked by impact ÷ effort)

### 1. F2 · ⑦ inconsistency · `audit-workflow.js:157`
**Reviewer prompt demands a named replacement for lens ⑭, but the schema and lens guide allow N/A.**
The rule reads: *"For reinvention (①) and lang-idiom (⑭) you MUST name the concrete replacement library/std API and estimate loc_delta."* Many ⑭ findings (swallowed errors, bare throws dropping context) have no library replacement — the schema itself says `replacement: '"" if N/A'`, and SKILL.md §3 uses the softer "where relevant". A hard MUST pushes the Sonnet reviewer to invent a library to satisfy the rule; the verifier then burns its call refuting hallucinated replacements (or worse, confirms one).
**Fix:** scope the MUST to ① only; for ⑭ say "name a replacement where a library/std API applies, else leave `replacement` empty". 1-line prompt edit.
**Replacement:** n/a · **LOC Δ:** 0 · **Effort:** S · **Risk:** low

### 2. F1 · ⑦ inconsistency · `audit-workflow.js:245,249-261`
**Unverified findings are silently dropped — only a count survives.**
A finding the skeptic returns no verdict for becomes `status: 'unverified'` and is then reduced to `const unverified = ….length`; the return object carries `confirmed` and `refuted` arrays but no `unverified` array, so the content is lost. This violates the script's own rule ("LOUDLY log what we skipped — no silent truncation", line 32) and starves SKILL.md §5's "Refuted / **skipped**" report section, which can't list what it never receives.
**Fix:** return the `unverified` array alongside `confirmed`/`refuted`; SKILL.md §5 lists them under "skipped".
**Replacement:** n/a · **LOC Δ:** +3 · **Effort:** S · **Risk:** low

### 3. F5 · ⑨ suspect-decision · `SKILL.md` §4, small-target bullet
**The inline path verifies its own findings — no independent skeptic.**
For targets < ~2k lines, the same model that produced the findings performs the "skeptic pass". Self-review catches hallucinated line numbers but not motivated reasoning — the exact failure mode the fan-out path's adversarial verifier exists to kill. The asymmetry is hard to defend: up to 24 agents of machinery for big surfaces, zero independent eyes for small ones, under a brand of "adversarially verified". The accused's testimony ("no heavy machinery, no subagents") is frugality — but one Sonnet batch-skeptic via the plain Agent tool costs ~1 agent and restores independence.
**Fix:** amend §4's small-target bullet: after the inline audit, spawn one Sonnet subagent to batch-adjudicate the finding list (same default-to-refuted contract as the workflow's verifier).
**Replacement:** n/a · **LOC Δ:** +3 (doc) · **Effort:** S · **Risk:** none

### 4. F4 · ② over-engineering (context cost) · `SKILL.md` Appendix A
**Appendix A (~35 lines) is loaded on every invocation but only needed when authoring a profile.**
SKILL.md is read in full each `/architect` run. The profile *format* spec is authoring documentation — reading an existing profile needs none of it (profiles are self-describing markdown). Progressive disclosure says move it out.
**Fix:** move Appendix A to `skills/architect/profile-format.md`; leave a one-line pointer ("profile format: see profile-format.md in this skill dir — read it when offering to create a profile"). Update "Files in this skill".
**Replacement:** n/a · **LOC Δ:** −30 from the hot path · **Effort:** S · **Risk:** low

### 5. F13 · ⑦ inconsistency · `SKILL.md` §5 vs `audit-workflow.js:255`
**§5 calls `tokens_out` "the run's real cost"; it's the whole turn's shared pool.**
`budget.spent()` counts output tokens across the main loop *and* all workflows this turn — the JS comment gets it right ("ceiling indicator, not exact"); SKILL.md §5 oversells it ("the run's **real cost** … don't eyeball it"). A report quoting it as the audit's cost overstates whenever the turn did anything else first.
**Fix:** reword §5 to "token ceiling (shared-pool output tokens at workflow end)".
**Replacement:** n/a · **LOC Δ:** 0 · **Effort:** S · **Risk:** none

### 6. F7 · ⑦ inconsistency (edge case) · `audit-workflow.js:233-241`
**Dedup keeps the first occurrence regardless of verdict — a refuted duplicate can shadow a confirmed one.**
The dedup loop is first-seen-wins on `file|lens|title` with no status preference. If a reviewer files near-identical findings in one chunk and the skeptic splits the verdicts, the kept copy is whichever came first. Low probability (chunks are disjoint, reviewers are told to report once), low blast radius (one finding misclassified).
**Fix:** iterate confirmed → unverified → refuted when building `deduped` (sort by status priority first).
**Replacement:** n/a · **LOC Δ:** +2 · **Effort:** S · **Risk:** low

## Decisions to revisit (⑨)

- **F5** above is the only ⑨ finding — the "no subagents for small targets" decision trades away the skill's core differentiator (independent adversarial verification) for one agent's worth of frugality.

## Refuted / skipped

- **F3 — "runtime delivers `args` as a JSON string" comment suspected stale** (`audit-workflow.js:21-23`, SKILL.md §4 gotcha) → **REFUTED empirically.** A zero-agent probe workflow run today returned `typeof args === 'string'` for an object payload. The comment is correct, the Workflow tool docs are wrong (or the runtime lags them), and the defensive parse in both `audit-workflow.js` and `afk-workflow.js` is load-bearing. Keep verbatim.
- **F6 — lens prose duplicated** (SKILL.md §3 ↔ `LENS_GUIDE`) → refuted as actionable: both copies are load-bearing (the inline path consumes §3 directly; subagent prompts consume `LENS_GUIDE`), they are currently in sync, and the "edit both" comments at both sites are the right mitigation. Single-sourcing via args would bloat every invocation and add fragility.
- **F12 — `fd` dependency without fallback** (SKILL.md §1) → refuted: the step is prose interpreted by a model, which trivially falls back to `find`/glob on a missing binary; not a real failure mode.
- **Clean lenses:** ① reinvention, ③ duplication (beyond F6), ④ dead code, ⑤ shallow modules, ⑥ navigability (names are descriptive throughout), ⑬ security — nothing found. ⑩–⑫ and ⑮ not applicable to this surface (no tests, no build, no schema).
