---
name: design-audit
description: Senior design-craft audit of a *rendered* UI surface — drives the live browser to measure what a glance cannot (column voids, redundant chrome decks, stray borders, density drift, off-scale tokens, contrast), diffs sibling pages against each other, and reads every label as a first-time user, then adversarially verifies each finding against the measured numbers, ranks them, and (only on your pick) routes fixes through /afk-issues → /afk-army. Needs the dev stack up + Playwright. Reads an optional per-repo `.claude/design-audit.md` profile for the surface map, brand law, and deliberate-decision exceptions. The rendered-output twin of /architect (which audits source statically). Read-first, never autonomous. Invoke as `/design-audit <surface>`.
user-invocable: true
---

# design-audit

`/design-audit <surface>` — audit a rendered UI surface the way a senior designer with a pixel ruler would, then hand you a ranked, **measured, verified** list of what's wrong. You pick what gets actioned; nothing changes without two human gates (you choose the fixes, you merge the PRs). There is **no autonomous mode** by design.

This is the **rendered-output** twin of `/architect`. `/architect` reads *source* statically — is the code well-built. `/design-audit` brings up the browser, *renders* the surface, and *measures the output* — does the UI actually look and work right. Run both; they catch different bugs.

## Why this exists — the doctrine

It was built after a surface passed `/impeccable critique` **and** `/impeccable audit` clean, then a human eyeballing it found seven real defects in one minute: a 640px dead void inside one table cell, three stacked header bars where the middle one held a single button, a 1px "sticky residue" rule drawn between two columns, rows double the height of their siblings' on a neighbouring page, severity dots at three different offsets across three pages, and a column labelled "PRC" whose every value already started `PRC-`. None were invisible — they were **un-measured**. Heuristic critiques glance; they don't instrument.

So this skill enforces three things a glance cannot do, and every run lives or dies by them:

1. **Instrument, don't glance.** Render the page and read the actual geometry — `getBoundingClientRect` + `getComputedStyle` — not a screenshot impression. A dark dense table just "looks like a table" until you measure that one cell is 894px wide holding 250px of text. The `measure-probe.js` in this directory is that instrument.
2. **Compare siblings.** A two-line row isn't "wrong" in isolation — it's wrong because the other two pages are one-line. Most craft bugs are *consistency* bugs, and they only appear when you diff the same element across the pages that share its DNA. The probe returns named-element geometry precisely so siblings can be diffed.
3. **Read as a first-time user.** A label can pass every automated check (present, contrasting, accessible) and still be incomprehensible jargon. Read every header, label, and unit cold, as someone who's never seen the product.

## Flow (one mode)

```
resolve surface (+ its SIBLING set) → load profile / brand law → bring up the render harness
   → CAPTURE: render each route × viewport × state, inject measure-probe.js → measurement bundles
   → build the sibling digest → audit (lensed, over bundles + source + digest)
   → adversarially verify each finding against the measured numbers → rank
   → write report to docs/audits/ + present here → you multi-select fixes
   → code fixes route to /afk-issues → /afk-army  |  copy/decision fixes handled directly with your approval
```

## 0. Load the profile and bring up the render harness

Before anything else:

1. **Look for `.claude/design-audit.md`** in the target repo. If present it is the profile — it can define a **surface map** (named surface → routes + sibling set + the source files behind them), the **brand law** (where tokens/type rules/color-meaning/elevation live — often a design-system skill, a `DESIGN.md`, a `tailwind.css`), the legal **scale** (spacing/radii/type steps), the **voice/tone** rules, and the **deliberate decisions** the auditor must NOT flag (the founder's intentional choices — full-bleed density, a depth philosophy that overrides a generic "flat is good", domain terms that are load-bearing). Everything is optional and self-describing; parse what's there. The authoring spec is `profile-format.md` in this directory — read it only when creating or explaining a profile. Absent ⇒ zero-config: infer the brand law from the CSS/tokens you find, audit one route at a time, no sibling digest.
2. **Confirm the render harness is live.** This skill cannot work without a running dev server and a connected Playwright. Check the app responds (the profile gives the base URL; e.g. `https://dev.posturermm.dromsak.com`). If the dev stack is down, tell the user the one command to start it (from the profile, e.g. `just up`) and stop — don't fall back to static guessing; that's what `/architect` and `/impeccable` already do, and it's exactly the gap this skill closes.

## 1. Resolve the surface — and its siblings

The arg is a **named surface** (from the profile), a **route/URL**, or a **fuzzy name** — never refused.

- **Named surface** → expand to its route list + sibling set + source files from the profile.
- **A route/URL** → use it; then find its siblings (the pages that share its layout DNA — same template family, same shared macros). The sibling set is what powers the consistency lenses; a surface of one page can't catch a consistency bug, so always pull the siblings in.
- **Fuzzy** (`tables`, `findings`, `settings`) → resolve against the profile's surface map or the route table; if 2+ plausible, ask "did you mean X or Y?".

Print the resolved surface: every route, its viewports/states to capture, and the source files, before capturing.

## 2. Read the intent — as testimony, not law

Skim the brand law (design-system skill / `DESIGN.md` / token CSS), the profile's deliberate-decisions, and any ADRs about the surface, to learn *why* it looks this way. **A documented decision is testimony, not law** — but the bar to challenge one is *measured evidence it backfired*, not taste. The profile's deliberate-decisions list is the founder's intent; respect it. The fastest way to discredit this tool is to "flag" the full-bleed density or the depth choice that the profile explicitly says is intentional.

## 3. Capture — drive the browser, run the probe

This is the step the heuristic tools skip. For **each route × each viewport × each state**:

- **Viewports:** at minimum desktop (≈1440), tablet (≈820), mobile (≈390) — the responsive lenses need them. (Trim per profile if a surface is desktop-only.)
- **States:** populated, empty (filtered-to-zero), and where reachable loading/error — the missing-state lens needs them.
- **Render and probe:** `mcp__playwright__browser_navigate` to the route, `mcp__playwright__browser_resize` to the viewport, drive the page into the state (apply a filter, etc.), then:
  1. set options — `mcp__playwright__browser_evaluate` with `() => { window.__DA_OPTS = { scale:{…}, selectors:{…}, region:"main" } }`, passing the legal **scale** and the **selectors** for the elements whose cross-page consistency matters (severity dot, identity cell, page-head, panel bar — from the profile);
  2. run the probe — `mcp__playwright__browser_evaluate` with the **entire body of `measure-probe.js`** (read it from this skill's directory) as the `function`. It returns the measurement bundle (page overflow, chrome decks, per-table column geometry + voids + stray borders + density drift + trailing gaps, named-selector geometry, off-scale token distribution, measured contrast, font-role smells, small hit targets).
  3. also take one `mcp__playwright__browser_take_screenshot` per route at desktop — the report links it as corroboration, never as the primary evidence.
- **Persist** each bundle (label it `route@viewport/state`). These are the ground truth every reviewer and verifier reasons over.
- **Build the sibling digest:** a compact table of the same probe selectors + key column geometry across all sibling routes (dot offset, row height, identity-cell width, page-head structure, panel-bar deck count). This one artifact is what makes the consistency lenses possible — hand it to every reviewer.

## 4. Audit — the lenses

Every finding cites **the measured evidence** (px / ratio / offset from the bundle, or the exact label/copy — never a vague impression), the **root-cause `file:line`** in the source, and a **concrete fix** with its blast radius. These lenses are mirrored as `LENS_GUIDE` in `audit-workflow.js` — **edit both** when you add or reword one (the JS `LENSES` array is id-only).

**Measured layout** (the probe sees these; a glance can't) — Ⓜ1 **void** (a box far wider/taller than its content — the lone-auto-column-eats-all-slack case) · Ⓜ2 **stacked-chrome** (redundant or near-empty stacked bars/toolbars — the "3 decks, middle one holds one button" case) · Ⓜ3 **edge-crowding** (content flush to a frame edge; asymmetric padding) · Ⓜ4 **stray-border** (a rule/border on something that shouldn't carry one — sticky residue between columns) · Ⓜ5 **density-drift** (rows/records taller or shorter than siblings; double-height cells) · Ⓜ6 **misalignment** (header not over its column; same element at different x across rows) · Ⓜ7 **overflow-clip** (unwanted horizontal scroll; meaning lost to clipping with no tooltip).

**Cross-surface consistency** (the sibling digest sees these; a single-page review can't) — Ⓧ1 **divergent-component** (a shared primitive built structurally differently across siblings) · Ⓧ2 **metric-drift** (same concept, different measured value across siblings) · Ⓧ3 **pattern-n-ways** (a recurring pattern done N ways — name the macro/token to converge on).

**System & token fidelity** (judged against the brand law) — Ⓣ1 **off-token** (a hardcoded value off the legal scale — a 3px radius, a 13px gap) · Ⓣ2 **decorative-color** (chroma outside severity/status/pillar meaning) · Ⓣ3 **type-role** (mono on UI chrome / sans on code-shaped data; wrong tier) · Ⓣ4 **elevation** (a depth breach *as the profile defines depth* — honor the project's stated philosophy, not a generic "flat is good").

**Comprehension & copy** (read cold, as a new user) — Ⓒ1 **jargon-label** (an undecodable abbreviation with no expansion — the "PRC" case) · Ⓒ2 **redundant-label** (a header restating its values; ambiguous/missing units) · Ⓒ3 **tone** (copy that breaks the product voice — gamified where sober is required) · Ⓒ4 **truncation-loss** (clipped meaning with no tooltip/expander).

**State, responsive & interaction** (judged across the captured viewports/states) — Ⓢ1 **responsive-break** (overflow/collision/bad wrap; wrong column-hide priority) · Ⓢ2 **missing-state** (empty/loading/error/zero states absent or divergent) · Ⓢ3 **affordance** (focus-visible missing/chromatic where neutral required; inconsistent hover/selected; undersized hit targets) · Ⓢ4 **contrast** (measured text contrast below 4.5/3) · Ⓢ5 **motion** (no reduced-motion fallback; banned spring/bounce; capture-wedging animation).

## 5. Scale the machinery to the surface

- **One route, or a quick look:** audit **inline** — you captured the bundle, so read it + the source yourself, apply the lenses, then send the finding list to **one Sonnet batch-skeptic** (plain `Agent`, default-to-refuted, re-checks each claim against the bundle numbers). Self-review can't catch your own motivated reasoning.
- **A whole surface (its sibling set):** run the fan-out **workflow** — **frugal by design** (1 reviewer + 1 verifier per route = ~2 Sonnet agents/route, fixed):
  - `Workflow({ scriptPath: "<this-skill-dir>/audit-workflow.js", args: { surface, routes:[{label, bundle, files:[...]}], scale, brandLaw, deliberate, siblingDigest, tone } })` — assemble `scale`/`brandLaw`/`deliberate`/`siblingDigest`/`tone` from §0–§3 (empty strings are fine). Each route's `bundle` is its measurement bundle(s); `files` are the templates/CSS behind it.
  - Per route: one reviewer reads the bundle + source + sibling digest and applies **all** lenses; one skeptic batch-adjudicates that route's whole list against the measured numbers (default-to-refuted). All agents **Sonnet**; ranking/synthesis here on Opus.
  - **Budget first, hard cap behind you.** ~2 agents × N routes. State the count before launching. The workflow enforces `MAX_ROUTES = 12` (≈24 agents): over that it audits the first 12 and loudly logs the rest — narrow the surface or re-run. This is triage, not a perfectionist gate.
  - **Gotcha:** the runtime delivers `args` as a JSON *string* — the script parses defensively (`typeof args === 'string' ? JSON.parse(args) : args`). Keep that line.

## 6. Rank & report

Sort confirmed findings by **impact ÷ effort**, weighting up (a) consistency bugs that touch a shared macro/token (one fix, many pages) and (b) comprehension bugs that block understanding. Then:

- **Write the report** to `docs/audits/design-<surface>-<YYYY-MM-DD>.md` (tracked — lives with the code, re-runnable, diffable). Include: resolved surface, routes × viewports × states captured, the run's cost (`agents_spawned` + `tokens_out` from the workflow return — don't eyeball it; if `routes_requested > routes_reviewed`, note the cap truncated it). Then each confirmed finding (lens · route · where · **measured evidence** · root-cause `file:line` · fix · blast radius · effort · confidence), a **"Deliberate — not flagged"** note for anything you considered but the profile marks intentional, and a terse **"Refuted / skipped"** section (each refuted finding with the skeptic's one-line reason; unverified marked "(no verdict)") so a re-run diffs cleanly.
- **Present** the ranked list here, then ask via `AskUserQuestion` (multiSelect) which to fix. Decline-all is valid — that's your read-only report.

## 7. Hand off the picks — two gates, no autonomy

- **Code findings** → first make sure the report is **committed and pushed to the default branch** (it's the canonical finding store the issues point into), then invoke `/afk-issues`, which **batches by module/page**: one issue per page or per shared-primitive carrying its findings as pointers into the report, shared-macro/token extractions filed first with `## Blocked by` wiring on the pages that consume them (a single consistency fix to a shared macro often closes findings across several pages — file it once, as the blocker). Then tell the user to run `/afk-army` to drain. Every fix lands as a PR they squash-merge. Reuse that machinery — never edit code directly from here.
- **Copy / label findings (Ⓒ)** are usually surgical one-line edits — they can go through afk-army with the rest, or be applied directly here after the user picks, one at a time, same two gates.
- **Deliberate-decision challenges** (a finding that argues a profile-listed intentional choice backfired) are **not** afk-army work — they're a conversation + maybe a profile/ADR edit. Keep them in their own section; the user decides.

## Notes

- **Per-surface invocation is the cost control** — audit one surface (and its siblings) at a time, never the whole app.
- **The render harness is non-negotiable.** No dev server + Playwright ⇒ no run. Static reasoning is what the other tools already do; this one measures.
- This skill **finds and proposes**; it does not auto-apply. The diff is the `/afk-army` PR you merge, or the direct edit you approve.
- For the *code-quality* twin (wheel-reinvention, dead code, layering drift in the same files), run `/architect <surface>`. They're siblings — same profile mechanism, same `docs/audits/` report, same two gates.

## Files in this skill

- `SKILL.md` — this file (orchestration, capture protocol, lenses, doctrine).
- `measure-probe.js` — the in-browser instrumentation. A complete `() => {…}` injected via `browser_evaluate`; returns the measurement bundle (geometry, voids, chrome decks, stray borders, density drift, token distribution, contrast, font-role smells). Parameterized via `window.__DA_OPTS`. The crown jewel — it's what makes the invisible measurable.
- `audit-workflow.js` — the frugal fan-out engine (per route: 1 all-lens reviewer over bundle+source+digest → 1 adversarial verifier that re-checks the numbers, all Sonnet; ~2 agents/route, hard-capped at `MAX_ROUTES = 12`). Returns confirmed, refuted, and unverified findings plus the real `agents_spawned`/`tokens_out`.
- `profile-format.md` — the `.claude/design-audit.md` authoring spec. Read on demand, not per-run.
