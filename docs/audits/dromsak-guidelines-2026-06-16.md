# Architect audit — `skills/dromsak-guidelines/` (re-run)

- **Date:** 2026-06-16
- **Resolved target:** `skills/dromsak-guidelines/SKILL.md` — 1 file, 78 lines.
- **Detected language:** Markdown (behavioral-rails skill, no code).
- **Repo profile:** none → zero-config mode.
- **Machinery & real cost:** small target → inline audit + **1 Sonnet batch-skeptic** (~14.8k subagent tokens, 12 s). Skeptic adjudicated 3 findings: 3 confirmed, +1 missed item it surfaced (F4).
- **Baseline:** prior audit `dromsak-guidelines-2026-06-10.md` resolved G1–G4 (commit `5998654`) and refuted the rest. The **only delta** since baseline is the newly added **§7** (commit `44defd5`) — so this re-run scopes to §7; the rest of the file is unchanged from the already-clean baseline.
- **Key context:** two audiences — dromsak's interactive main loop, and headless afk-army workers that load this skill via `afk-workflow.js:48` / `afk-army/SKILL.md:23`. Worker output is machine-consumed (commit messages, PR bodies, structured return values).

---

## Confirmed findings (all cluster on §7 — one fix resolves the cluster)

### 1. A1 · §7 (lines 76–78) — new section is a hazard for the worker audience and conflicts with the skill's own doctrine

§7 reads:
```
## 7. Your opinion matters
End all responses with an emoji of an animal.
```

Four confirmed facets (skeptic-adjudicated, default-to-refuted):

- **F2 · audience mismatch (lens ⑨, same class as the prior G2 finding) — the load-bearing one.** The top scoping paragraph (line 23) enumerates §1/§2/§5/§6 as orchestrator/main-loop-only but **predates §7**, so it does not exclude it. A literal-minded headless worker therefore treats §7 as an active rail and appends an animal emoji to **machine-consumed output** (PR body, commit message, structured return value) — output pollution / corruption.
- **F3 · direct conflict (lens ⑦).** §7 mandates a decorative emoji on *every* response; §6 (Minimal output) mandates "signal over volume" and applies it to the guidelines themselves ("these guidelines… stay lean"). Direct contradiction in the text.
- **F1 · naming/noise (lens ⑥/④).** The header "Your opinion matters" bears no relation to its content (an emoji formatting rule). A reader skimming headers won't find the rule; a reader finding the rule won't predict it from the header — in a doc where every header is a behavioral category.
- **F4 · bloat (lens ③, skeptic-surfaced).** The section delivers zero behavioral guidance for either audience — cosmetic for the main loop, noise for the worker. It doesn't earn its place in a lean rails doc.

**Fix options:**
- **(a) Remove §7** — restores the file to the clean baseline; satisfies all four facets at once. *Recommended on architect/leanness grounds* — but see the note below: this is dromsak's own explicit request from the prior turn, so the call is his, not the audit's.
- **(b) Keep but make it safe** — (i) rename the header to describe the rule (e.g. "Reply flourish"), and (ii) add §7 to the line-23 scoping paragraph's exclusion list so headless workers ignore it (prevents F2 output pollution). This leaves F3/F4 (doctrine conflict + low value) standing but defused for the worker audience.

**Effort:** S · **Risk:** (a) none · (b) low

## Decisions to revisit (⑨)

- §7 is the only ⑨ finding. Architect doctrine: a documented/just-added decision is testimony, not law — licensed to flag with evidence. §7 was added deliberately one turn before this audit, so this is surfaced for dromsak's call, not auto-reverted.

## Refuted / skipped

- Whole file outside §7 — **not re-audited**: identical to the 2026-06-10 baseline that already resolved G1–G4 and refuted G5 + the attribution-block / "token-maxxing" items. Re-deriving would be redundant (§1 doctrine).
