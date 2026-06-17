# design-audit — run notes & improvement backlog

Findings about the **skill itself**, gathered while dogfooding it. The audit *reports* live in each repo's `docs/audits/`; this file is the skill's own TODO.

## Run 1 — PostureRMM pillars (prevention/patching/performance), 2026-06-17

First live run, on the surface that motivated the skill. Re-caught all 7 known defects **by measurement** and surfaced extras (off-scale tokens, a worse void on /performance, a non-mono hostname). But it also exposed gaps in the instrument:

### Fixed during the run
- **[DONE] Void mismeasurement — the flagship bug.** `contentW` measured the cell's wrapper `<div>` (a `min-w-0` flex child that fills the cell), so a 1374px cell holding 295px of text read as `voidRatio 0.98` — the probe MISSED the dead-space void it was built to catch. Fixed: `contentW` now uses `visualExtent()` = max(rendered text extent via a Range over non-hidden text nodes, painted-leaf width for bars/icons). Also now skips the absolute stretched-link overlay cell. Re-ran: title void = `voidRatio 0.21`, /performance check = `0.14`. ✅

### Backlog (next edits)
1. **Radius false-positive on pills/circles.** `border-radius: 50%` (dots) and `9999px` (pills) report as `radius:50` / huge and get flagged off-scale. Whitelist ≥50% / ≥999px (intentional round) in the off-scale scan.
2. **Off-scale scan is page-wide → hero noise.** The scan mixes table-chrome drift (relevant: `radius:3`, `fontPx:10`) with hero spacing (`gap:28/9/6/11`) that may be deliberate. Either scope the scan to the audited region more tightly, tag each off-scale hit with its region so the reviewer can separate chrome from hero, or let the profile declare hero-spacing exceptions.
3. **`smallTargets` is too blunt for a dense product.** Flags every sort-header link / chip / toggle (10–20/page) — almost all intentional density. Raise the threshold, restrict to genuinely-interactive standalone controls, or drop it to a contextual note instead of a finding.
4. **`monoOnProse` flags intentional mono-data.** The quiet row-count summary (`font-mono-data--quiet`) and sparkline labels trip the heuristic. Exclude known design-system mono-data classes (profile could name them).
5. **Deck count vs the visual "3 bars".** The probe counts 2 *decks* above the `<thead>` (panel-bar + near-empty Columns bar); the human reads 3 (those + the column header row). Consider folding the `<thead>` height into the table's deck inventory so the count matches what the eye sees.
6. **Cross-page density drift needs the digest, not per-table drift.** Per-table `driftRatio` was 1.0 on every page (rows uniform *within* a page); the double-height-row defect only showed in the **sibling digest** (perf rows 53px vs siblings 37px). Confirms the digest is load-bearing — make the inline-mode instructions build it explicitly even for a 3-page surface, and have the probe optionally emit a one-line `rowHeight` summary for easy cross-page diffing.
7. **Probe injection ergonomics.** The probe is large; re-pasting it per navigation is heavy. Document the `window.__daRun` pattern (define once per page load, then resize + tiny call for extra viewports) in SKILL.md §3, and consider a tiny loader that fetches the probe from a data: URL.

### Held up well
- Stacked-chrome deck detection (near-empty "Columns" bar flagged on all 3). ✅
- Stray-border / sticky-residue detection (`severity_dot borderR:1 sticky:true`). ✅
- Named-selector geometry for the sibling diff (dot `offsetInHost` 11 vs 79 vs 73 — the dot-spacing bug, measured). ✅
- Off-scale `radius:3` + `fontPx:10` (real chrome drift). ✅
- `codeNotMono` caught a hostname+hash rendered in Inter (brand type-role). ✅
- Contrast: 0 false positives on the dark theme. ✅
- Deliberate-decisions respected (the one shadow not flagged; full-bleed not flagged).
