export const meta = {
  name: 'design-audit',
  description: 'Rendered-output design audit: per route, 1 reviewer (all design lenses over the measurement bundle + source + sibling digest) → 1 batch-verifier (adversarial, re-checks the numbers). Frugal: ~2 Sonnet agents/route, fixed cost.',
  phases: [
    { title: 'Review', detail: 'one reviewer per route, all lenses, bundle + source + sibling digest', model: 'sonnet' },
    { title: 'Verify', detail: 'one skeptic per route, re-checks the measured evidence', model: 'sonnet' },
  ],
}

// args = {
//   surface: string,
//   routes: [{ label, bundle:{…measure-probe output, possibly multi-viewport/state…}, files:[source paths] }],
//   scale?: string,          // the project's spacing/radii/type scale, as prose, or ""
//   brandLaw?: string,       // the design-system law (tokens, type rules, color-meaning, elevation) or ""
//   deliberate?: string,     // documented deliberate-decision exceptions NOT to flag, or ""
//   siblingDigest?: string,  // compact cross-route geometry (same probes/columns across siblings) for the consistency lenses
//   tone?: string,           // the product's UI copy/voice rules for the comprehension lenses, or ""
// }
// Review + verify run on Sonnet; the parent (Opus) loop ranks/presents.
//
// Runtime quirk (same as architect): args arrives as a JSON *string*. Normalize defensively.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const SCALE = (A.scale || '').trim()
const BRAND_LAW = (A.brandLaw || '').trim()
const DELIBERATE = (A.deliberate || '').trim()
const SIBLING_DIGEST = (A.siblingDigest || '').trim()
const TONE = (A.tone || '').trim()

// HARD CEILING — structural, not advisory (mirrors architect). ~2 agents/route.
const MAX_ROUTES = 12
const allRoutes = A.routes || []
const routes = allRoutes.slice(0, MAX_ROUTES)
if (allRoutes.length > MAX_ROUTES) {
  const skipped = allRoutes.slice(MAX_ROUTES).map((r) => r.label).join(', ')
  log(`⚠ ${allRoutes.length} routes requested — capping at ${MAX_ROUTES} (≈${MAX_ROUTES * 2} agents). SKIPPED: ${skipped}. Narrow the surface or re-run.`)
}

// Fixed lens vocabulary — an enum, NOT free text, so dedup/ranking/grouping stay
// stable. Authoritative prose lives ONCE in LENS_GUIDE below, mirrored for humans
// in SKILL.md §4. Add/reword a lens? edit LENS_GUIDE + SKILL.md §4 — keep this id-only.
const LENSES = [
  // Measured layout (needs the probe — invisible to a glance)
  'void', 'stacked-chrome', 'edge-crowding', 'stray-border', 'density-drift', 'misalignment', 'overflow-clip',
  // Cross-surface consistency (needs the sibling digest)
  'divergent-component', 'metric-drift', 'pattern-n-ways',
  // System & token fidelity (measured against the brand law)
  'off-token', 'decorative-color', 'type-role', 'elevation',
  // Comprehension & copy (read as a first-time user)
  'jargon-label', 'redundant-label', 'tone', 'truncation-loss',
  // State, responsive & interaction (rendered across viewports/states)
  'responsive-break', 'missing-state', 'affordance', 'contrast', 'motion',
]

const LENS_GUIDE =
  'MEASURED LAYOUT — facts a glance at a dark dense screen cannot see; cite the numbers from the bundle:\n' +
  'Ⓜ1 void — a box far wider/taller than its content (bundle tables[].voids: voidRatio < 0.5 on a cellW > 120). The lone-auto-column-eats-all-slack case: name the column, the cellW, the contentW, the empty px.\n' +
  'Ⓜ2 stacked-chrome — vertically stacked bars/headers/toolbars in one region (bundle decks[]): a near-empty bar (nearEmpty:true) or one that duplicates the deck above it. State the count and which bar is dead weight.\n' +
  'Ⓜ3 edge-crowding — content flush to a container edge or asymmetric padding where symmetry is expected (tables[].trailing.gapToContainer ≈ 0 with a right-aligned last column; padL ≠ padR on the same cell). Give the px.\n' +
  'Ⓜ4 stray-border — a border/rule on an element that should not carry one (tables[].strayBorders, esp. sticky:true residue drawing a line between columns). Name the side + width + the column it sits before.\n' +
  'Ⓜ5 density-drift — rows/records taller or shorter than siblings (tables[].rows.driftRatio > 1.3), or one row spanning more text lines than its peers (the double-height-cell case). Give min/max height.\n' +
  'Ⓜ6 misalignment — a header not aligned to its column body (headerLeft vs cellLeft mismatch), off-grid offsets, or the SAME element sitting at different x across rows.\n' +
  'Ⓜ7 overflow-clip — page or container horizontal overflow (pageOverflow.overflowing), or content clipped with no tooltip/expander.\n\n' +
  'CROSS-SURFACE CONSISTENCY — use the SIBLING DIGEST; these only appear when the same element is compared across pages:\n' +
  'Ⓧ1 divergent-component — the same primitive (table chrome, severity dot, chip, page-head, empty state, pagination) built STRUCTURALLY differently across siblings (e.g. dot folded into a cell on one page, its own column on another).\n' +
  'Ⓧ2 metric-drift — same concept, different measured value across siblings (probes[].offsetInHost / padding / column width differ; one page single-line rows, another double). Cite both numbers.\n' +
  'Ⓧ3 pattern-n-ways — a recurring pattern implemented N divergent ways across the surface; name the shared macro/component/token it should converge on.\n\n' +
  'SYSTEM & TOKEN FIDELITY — judge against the BRAND LAW; the probe gives observed values:\n' +
  'Ⓣ1 off-token — hardcoded value off the scale (scale.offScale[]: a 3px radius, a 7/13px gap, a non-tier font-size) where a token/scale step exists. Name the value and the nearest legal step.\n' +
  'Ⓣ2 decorative-color — chroma used outside severity/status/pillar meaning (a tinted panel/row/button "for branding"), per the brand law.\n' +
  'Ⓣ3 type-role — mono font on UI chrome or sans on code-shaped data (fontRoles[]); wrong type tier; a label not uppercase-tracked-muted where the system requires it.\n' +
  'Ⓣ4 elevation — a depth-rule breach AS DEFINED BY THE BRAND LAW / deliberate decisions (scale.shadows[]). NB: the rule is the profile\'s, not a generic "flat is good" — honor the project\'s stated depth philosophy.\n\n' +
  'COMPREHENSION & COPY — read every label as a brand-new user with no docs:\n' +
  'Ⓒ1 jargon-label — an abbreviation/label a new user cannot decode, with no tooltip/expansion (the "PRC" case).\n' +
  'Ⓒ2 redundant-label — a header restating its own values (a column "PRC" whose every value starts "PRC-"), duplicate labels, or ambiguous/missing units.\n' +
  'Ⓒ3 tone — copy that violates the product voice (gamified/playful where enterprise-sober is required, alarm-fatigue), per the TONE rules.\n' +
  'Ⓒ4 truncation-loss — content clipped with no title/expander, losing meaning the user needs.\n\n' +
  'STATE, RESPONSIVE & INTERACTION — judged across the captured viewports/states:\n' +
  'Ⓢ1 responsive-break — overflow/collision/bad wrap at tablet/mobile, or wrong column-hide priority (a low-value column kept while a high-value one drops).\n' +
  'Ⓢ2 missing-state — empty/loading/error/zero states absent or divergent from siblings.\n' +
  'Ⓢ3 affordance — focus-visible missing or chromatic where neutral is required; inconsistent hover/selected; undersized hit targets (smallTargets[]).\n' +
  'Ⓢ4 contrast — measured text contrast below the bar (contrast[]: body < 4.5, large < 3). Cite the ratio and the sample.\n' +
  'Ⓢ5 motion — animation with no reduced-motion fallback, banned spring/bounce, or an animation that wedges headless capture.\n'

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['lens', 'route', 'title', 'problem', 'evidence', 'proposed_fix', 'effort', 'risk', 'confidence'],
        properties: {
          lens: { type: 'string', enum: LENSES },
          route: { type: 'string', description: 'the route/page this fires on, e.g. /prevention/posture' },
          where: { type: 'string', description: 'the element/column/region, e.g. "Rule (title) column" or "the toolbar bar"' },
          viewport_state: { type: 'string', description: 'viewport + state if relevant, e.g. "390px / populated", else ""' },
          title: { type: 'string' },
          problem: { type: 'string', description: 'what is wrong and why it matters to a user' },
          evidence: { type: 'string', description: 'the MEASURED numbers from the bundle (px, ratios, offsets) or the exact copy/label — never a vague impression' },
          file: { type: 'string', description: 'the source root cause, path:line (the template/CSS to change), or "" if not located' },
          proposed_fix: { type: 'string', description: 'the concrete change' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          risk: { type: 'string', description: 'blast radius — esp. if it touches a shared macro/token used by other pages; "low" if isolated' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICTS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['index', 'refuted', 'reason'],
        properties: {
          index: { type: 'integer' },
          refuted: { type: 'boolean', description: 'true if wrong, overstated, a deliberate decision, or not supported by the measured evidence' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

function reviewPrompt(surface, route) {
  return [
    `You are a senior product-UI designer with an obsessive eye for rendered craft, auditing the "${surface}" surface — specifically the route "${route.label}".`,
    `You are NOT reading screenshots. You are given a MEASUREMENT BUNDLE captured from the live DOM (getBoundingClientRect + getComputedStyle), plus the source files behind it. Your findings must be grounded in those measured numbers — a vague "feels cramped" is banned; cite the px, the ratio, the offset.`,
    BRAND_LAW ? `\nBRAND LAW (the design system this surface must obey):\n${BRAND_LAW}` : ``,
    SCALE ? `\nSCALE (legal spacing / radii / type steps):\n${SCALE}` : ``,
    TONE ? `\nVOICE / TONE rules:\n${TONE}` : ``,
    DELIBERATE ? `\nDELIBERATE DECISIONS — do NOT flag these; they are intentional (testimony you may still challenge ONLY with hard measured evidence it backfired):\n${DELIBERATE}` : ``,
    SIBLING_DIGEST ? `\nSIBLING DIGEST — the same elements measured across the OTHER routes in this surface. Use it for the consistency lenses: if this route renders a shared primitive differently from its siblings, that is a finding.\n${SIBLING_DIGEST}` : ``,
    `\nMEASUREMENT BUNDLE for ${route.label} (may include multiple viewports/states):`,
    '```json',
    JSON.stringify(route.bundle).slice(0, 24000),
    '```',
    `\nSource files behind this route (read them to locate the ROOT CAUSE and propose a concrete fix):`,
    ...(route.files || []).map((f) => `  - ${f}`),
    ``,
    `Apply EVERY lens below. Report every real defect; an empty list is valid if the route is genuinely clean.`,
    ``,
    LENS_GUIDE,
    ``,
    `Rules:`,
    `- Every finding sets exactly one lens from the enum, names the route, and puts the MEASURED evidence (numbers from the bundle, or the exact label/copy) in "evidence".`,
    `- Read the source files and put the root-cause file:line in "file" with a concrete fix. If a fix touches a SHARED macro/component/token, say so in "risk" — blast radius matters.`,
    `- Consistency lenses (Ⓧ) MUST cite both this route's value and the sibling's value from the digest.`,
    `- Do not file the same defect under several lenses; pick the best-fitting one. Report each distinct problem once.`,
    `- Be conservative. If unsure it is real, set confidence:"low" and let the verifier judge. Never invent findings to fill space.`,
    `- Respect the DELIBERATE DECISIONS list — challenge one only with measured proof it hurts users.`,
  ].filter(Boolean).join('\n')
}

function verifyPrompt(surface, route, findings) {
  const list = findings.map((f, i) => [
    `--- FINDING ${i} (lens: ${f.lens}) ---`,
    `Route: ${f.route}  Where: ${f.where || ''}  ${f.viewport_state || ''}`,
    `Title: ${f.title}`,
    `Claim: ${f.problem}`,
    `Evidence cited: ${f.evidence}`,
    `Root cause: ${f.file || '(not located)'}`,
    `Proposed fix: ${f.proposed_fix}`,
  ].join('\n')).join('\n\n')
  return [
    `You are an adversarial design-audit verifier. REFUTE each finding unless the MEASURED evidence independently holds up. Default to refuted:true for anything you cannot confirm from the bundle or the source.`,
    `Surface "${surface}", route "${route.label}". The measurement bundle and source files are your ground truth:`,
    '```json',
    JSON.stringify(route.bundle).slice(0, 24000),
    '```',
    `Source files: ${(route.files || []).join(', ')}`,
    DELIBERATE ? `\nDELIBERATE DECISIONS (refute any finding that just re-litigates one of these without hard evidence it backfired):\n${DELIBERATE}` : ``,
    ``,
    `For EACH finding: do the cited numbers actually appear in the bundle and support the claim? Is the "void"/"drift"/"contrast" real per the data, or overstated? Is the root-cause file plausible? Is it actually a DELIBERATE decision? Would the fix break a shared component used elsewhere (over-broad)?`,
    `Confirm (refuted:false) ONLY when the measured evidence independently reproduces the problem. Return one verdict per finding, index matching.`,
    ``,
    list,
  ].filter(Boolean).join('\n')
}

let verifiersRun = 0
const perRoute = await pipeline(
  routes,
  (route) => agent(reviewPrompt(A.surface, route), { label: `review:${route.label}`, phase: 'Review', model: 'sonnet', schema: FINDINGS_SCHEMA })
    .then((r) => ({ route, findings: (r && r.findings) || [] })),
  async ({ route, findings }) => {
    if (findings.length === 0) return []
    verifiersRun++
    const res = await agent(verifyPrompt(A.surface, route, findings), { label: `verify:${route.label}`, phase: 'Verify', model: 'sonnet', schema: VERDICTS_SCHEMA })
    const byIndex = new Map(((res && res.verdicts) || []).map((v) => [v.index, v]))
    return findings.map((f, i) => {
      const v = byIndex.get(i)
      const status = !v ? 'unverified' : v.refuted ? 'refuted' : 'confirmed'
      return { ...f, status, refutation: v && v.refuted ? v.reason : null }
    })
  },
)

const reviewed = perRoute.filter(Boolean).flat()
log(`Review+verify done across ${routes.length} route(s): ${reviewed.length} findings judged.`)

// Cross-route dedup — consistency findings legitimately surface from both sides;
// keep one. Confirmed-first so a refuted twin can't shadow a confirmed one.
const STATUS_RANK = { confirmed: 0, unverified: 1, refuted: 2 }
const seen = new Set()
const deduped = []
for (const f of [...reviewed].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])) {
  const key = `${f.lens}|${(f.title || '').toLowerCase().slice(0, 50)}`
  if (!seen.has(key)) { seen.add(key); deduped.push(f) }
}

const confirmed = deduped.filter((f) => f.status === 'confirmed')
const refuted = deduped.filter((f) => f.status === 'refuted')
const unverified = deduped.filter((f) => f.status === 'unverified')
const agentsSpawned = routes.length + verifiersRun
log(`Confirmed ${confirmed.length}/${deduped.length} (refuted ${refuted.length}, unverified ${unverified.length}). Spawned ${agentsSpawned} agents.`)

return {
  surface: A.surface,
  routes_reviewed: routes.length,
  routes_requested: allRoutes.length,
  agents_spawned: agentsSpawned,
  tokens_out: budget.spent(),
  raw_findings: reviewed.length,
  confirmed_findings: confirmed.length,
  confirmed,
  refuted,
  unverified,
}
