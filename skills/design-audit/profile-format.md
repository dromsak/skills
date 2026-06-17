# `.claude/design-audit.md` profile format (optional, per target repo)

Drop this in any repo to give `/design-audit` its surface map, brand law, legal scale, voice rules, and — most importantly — the **deliberate decisions it must not flag**. Every section is optional; omit what doesn't apply. Read this file only when authoring a profile or explaining the format — *parsing* an existing profile needs no spec (it's self-describing markdown).

The single highest-value section is **Deliberate decisions**: without it, the auditor reflexively "flags" the founder's intentional choices (a full-bleed density, a depth philosophy that overrides a generic brand doc, a load-bearing domain term) and discredits itself. List them.

```markdown
# design-audit profile

## Render harness
- Base URL: https://dev.example.com           <!-- where the live app answers -->
- Start command: just up                       <!-- told to the user if the stack is down -->
- Login: admin@localhost / dev-password         <!-- if the surface is behind auth -->
- Viewports: 1440, 820, 390                      <!-- override the default desktop/tablet/mobile -->

## Brand law
<!-- WHERE the design system lives — the auditor reads these as the law to judge against -->
- Tokens + type rules + color-meaning + elevation: .claude/skills/<design-skill>/ and DESIGN.md
- Compiled tokens: assets/tailwind.css
- One-line creed: color carries MEANING only (severity / status / pillar); Inter for UI, mono for code-shaped data only.

## Scale
<!-- the legal steps — passed to the probe as window.__DA_OPTS.scale so it flags off-scale values -->
- spacing (4px base): 4 8 12 16 20 24 32 40 48 64 80
- radii: 2 (tags) · 4 (panels/tables/inputs) · 6 (buttons) · 10 · 16 (cards/dialogs)
- type px: 11 12 13 14 15 18 22 24 36 56 72

## Surfaces
| Surface | Routes | Siblings (share DNA) | Source files |
|---|---|---|---|
| pillars | /prevention/posture, /patching, /performance | each other | backend/templates/pages/{prevention/posture_v3,patching,performance}/, assets/components/findings-panel.css, backend/templates/components/v3_list_table.j2 |
| endpoints | /endpoints | — | backend/templates/pages/endpoints/, ... |

## Consistency selectors
<!-- the elements whose cross-page geometry matters — passed to the probe as window.__DA_OPTS.selectors,
     returned per page so the sibling digest can diff them -->
- severity-dot: .dot, [data-col$="_dot"] > span
- identity-cell: [data-col="cve"], [data-col="prc"], [data-col="check"]
- page-head: .page-head
- panel-bar: .findings-panel .panel-bar

## Voice / tone
<!-- the comprehension lenses judge copy against this -->
- Enterprise-professional, sober. "Worst endpoints" not "Hall of shame". No gamification, no emoji, no alarm-fatigue.
- Domain terms that ARE load-bearing (don't flag as jargon, but DO flag if unexplained to a new user): PRC (Posture Rule Code), KEV, EPSS.

## Deliberate decisions — do NOT flag (testimony; challenge only with measured proof it backfired)
- **Full-bleed density is intentional** — dense MSP-tech surfaces (Datadog/Linear model). Do not flag "use a max-width / too dense".
- **Depth over flat** — the founder OVERRIDES the design system's "flat by default": strong tonal/shadow depth to separate surfaces is wanted. Do not flag drop-shadows-on-surfaces as an elevation violation here.
- **Pillar color token NAMES invert the words** (token `policy` renders blue, `patches` renders green) — intentional; judge the rendered color, not the token name.
- **No keyboard shortcuts** (a TUI comes later) — not a missing affordance.
```

When this file is absent, `/design-audit` infers the brand law from the CSS/tokens it finds, audits one route at a time with no sibling digest, and applies generic craft + WCAG judgment — far weaker than a profiled run. The profile is what turns it from a generic linter into an auditor that knows this product.
