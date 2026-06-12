export const meta = {
  name: 'architect-audit',
  description: 'Senior-architect audit of a code surface: 1 reviewer/chunk (all lenses, one read) → 1 batch-verifier/chunk (adversarial, one call) → confirmed findings. Language-agnostic; fixed cost ~2 agents/chunk.',
  phases: [
    { title: 'Review', detail: 'one reviewer per chunk, all lenses, single read', model: 'sonnet' },
    { title: 'Verify', detail: 'one skeptic per chunk, batch-adjudicates that chunk', model: 'sonnet' },
  ],
}

// args = {
//   scope: string,
//   chunks: [{label, files:[paths]}],
//   lang?: string,            // e.g. "Rust", "TypeScript/Node"; "" = let the reviewer infer
//   projectContext?: string,  // one-paragraph framing + constraints, or ""
//   driftGuide?: string,      // repo-specific layering invariants for lens ⑧, or "" = generic
//   idiomGuide?: string,      // language-idiom checklist for lens ⑭, or "" = language default
//   uiGuide?: string,         // repo UI conventions (design system, token source) for lens ⑯, or "" = generic
//   schemaScope?: bool,       // true ⇒ add the schema lens ⑮ (persistence-layer scope)
//   uiScope?: bool,           // true ⇒ force the frontend lens ⑯ on every chunk; otherwise it
//                             //   auto-enables per chunk when files have UI extensions
// }
// Review + verify agents run on Sonnet; the parent (Opus) loop ranks/presents the result.
//
// This runtime delivers the `args` payload to the script as a JSON *string* (not the
// parsed object the Workflow tool docs imply), so normalize defensively before use.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const LANG = (A.lang || '').trim()
const PROJECT_CONTEXT = (A.projectContext || '').trim()
const DRIFT_GUIDE = (A.driftGuide || '').trim()
const IDIOM_GUIDE = (A.idiomGuide || '').trim()
const UI_GUIDE = (A.uiGuide || '').trim()

// Frontend lens gate: forced via uiScope, else auto-detected per chunk from file extensions.
// Frontend-in-plain-.js repos won't match — that is what the explicit uiScope flag is for.
const UI_FILE_RE = /\.(tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|styl)$/i
const chunkHasUI = (chunk) => A.uiScope === true || (chunk.files || []).some((f) => UI_FILE_RE.test(f))

// HARD CEILING — structural, not advisory. This is a rapid-prototyping triage tool, not a
// perfectionist gate: an early run spun up ~400 agents on one surface. Cost is ~2 agents/chunk,
// so 12 chunks ≈ 24 agents is the ceiling. Over the cap we audit the first MAX_CHUNKS and LOUDLY
// log what we skipped (no silent truncation) — narrow the scope or re-run for the rest. Never
// reintroduce per-finding fan-out; that is what blew up before.
const MAX_CHUNKS = 12
const allChunks = A.chunks || []
const chunks = allChunks.slice(0, MAX_CHUNKS)
if (allChunks.length > MAX_CHUNKS) {
  const skipped = allChunks.slice(MAX_CHUNKS).map((c) => c.label).join(', ')
  log(`⚠ ${allChunks.length} chunks requested — capping at ${MAX_CHUNKS} (≈${MAX_CHUNKS * 2} agents). SKIPPED: ${skipped}. Narrow the scope or re-run for the rest.`)
}

// Fixed lens vocabulary — an enum, NOT free text, so dedup/ranking/grouping stay stable
// (an early run drifted: "test signal" / "test signal ⑩" / "test signal (⑩)" all coexisted).
// The authoritative prose for each id lives ONCE in LENS_GUIDE below, mirrored for humans
// in SKILL.md §3. Add/reword a lens? edit LENS_GUIDE + SKILL.md §3 — keep this list id-only.
const LENSES = [
  'reinvention',      // ①
  'over-engineering', // ②
  'duplication',      // ③
  'dead-code',        // ④
  'shallow-module',   // ⑤
  'navigability',     // ⑥
  'inconsistency',    // ⑦
  'drift-watch',      // ⑧
  'suspect-decision', // ⑨
  'test-signal',      // ⑩
  'build-time',       // ⑪
  'async',            // ⑫
  'security',         // ⑬
  'lang-idiom',       // ⑭
  'schema',           // ⑮ persistence-only
  'frontend',         // ⑯ UI chunks only (uiScope / auto-detected)
]

// Language-neutral prose. Language-specific colour for ⑧ and ⑭ is injected from args
// (driftGuide / idiomGuide); when those are empty the lines below carry a generic fallback.
const DEFAULT_DRIFT =
  'business logic in the wrong layer, reaching past the data-access/repository layer instead of going through it, illegal upward module dependencies, framework/IO concerns leaking into pure-domain code'
const DEFAULT_IDIOM =
  'floating-point for money (use a decimal type or integer cents); panicking on fallible paths in library code (unwrap/expect, unchecked non-null assertions, bare throws that drop context); swallowed errors or stringly-typed errors where an enum/union belongs'

const LENS_GUIDE =
  '① reinvention — bespoke code a maintained library or the std lib already does (you MUST name the replacement library/API + estimate loc_delta).\n' +
  '② over-engineering — abstractions with one impl, generics/type-params used once, unused config knobs, speculative flexibility.\n' +
  '③ duplication — the same logic in N places, drifted apart.\n' +
  '④ dead-code — functions/types/flags/routes/templates nothing references (verify it is not reached via macro/reflection/DI/trait-impl/re-export/route before reporting).\n' +
  '⑤ shallow-module — pass-through wrappers that add a layer but no value; abstractions that leak internals.\n' +
  '⑥ navigability — imprecise names (the standard is descriptive: userSessionStore / order_repository, not store / repo); one concept scattered; high coupling. NOT raw line count.\n' +
  '⑦ inconsistency — the same thing done multiple ways; divergent error handling/naming across the surface.\n' +
  `⑧ drift-watch — layering / boundary violations: ${DRIFT_GUIDE || DEFAULT_DRIFT}.\n` +
  '⑨ suspect-decision — a documented decision (ADR, design doc, code comment) the code reveals as wrong or obsolete (docs are testimony, not law — challenge with evidence).\n' +
  '⑩ test-signal — tests asserting mocks, over-mocked setups, duplicated fixtures, tests of trivial glue, slow tests dominating the suite.\n' +
  '⑪ build-time — compile/build bloat that slows the inner loop: monomorphization/proc-macro overuse, barrel-file or type-graph blowups, crates/packages that should split, unused/duplicate-version deps.\n' +
  '⑫ async — needless locking (Arc<Mutex> and friends), over-spawned tasks, blocking calls in async code, sequential awaits that should run concurrently.\n' +
  '⑬ security — auth/authz boundary soundness, secret handling, trust boundaries AT THE DESIGN LEVEL (not dependency CVEs).\n' +
  `⑭ lang-idiom — ONLY what the linter (-D warnings / eslint / mypy / vet) does not already catch: ${IDIOM_GUIDE || DEFAULT_IDIOM}.\n`

const SCHEMA_LENS_GUIDE =
  '⑮ schema — data-model/schema shape (over/under-normalization, redundant/derivable columns, collapsible migrations). Higher-uncertainty: only report what you are confident of, with the exact table/column.\n'

const DEFAULT_UI =
  'bespoke one-off components where an existing shared component or the component library already provides the primitive (a hand-styled <button> next to an existing <Button>); hardcoded colors/spacing/font sizes where theme tokens, CSS variables, or the Tailwind scale exist; the same UI pattern (modal, form, table, toast) implemented divergent ways across pages; copy-pasted page markup that should be one shared component; hand-rolled form/fetch/format logic a dependency already in the package manifest covers'

const FRONTEND_LENS_GUIDE =
  `⑯ frontend — UI built outside the project primitives (the signature smell of pages grown one prompt at a time, each in isolation): ${UI_GUIDE || DEFAULT_UI}. FIRST discover what the repo already has (shared components dir, theme/token files, UI deps in the manifest), then name the existing primitive that should have been used — or, where none exists and the pattern repeats, the proposed fix is the shared component/token to extract.\n`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lens', 'file', 'lines', 'title', 'problem', 'proposed_fix', 'effort', 'risk', 'confidence'],
        properties: {
          lens: { type: 'string', enum: LENSES, description: 'the single lens id that fired' },
          file: { type: 'string', description: 'path:line, e.g. src/server/handlers/checkout.ts:120' },
          lines: { type: 'string', description: 'line range or count of the offending code' },
          title: { type: 'string', description: 'one-line summary' },
          problem: { type: 'string', description: 'what is wrong and why it matters; quote the offending code' },
          proposed_fix: { type: 'string', description: 'the concrete change' },
          replacement: { type: 'string', description: 'named library/std API that replaces bespoke code, or "" if N/A' },
          loc_delta: { type: 'integer', description: 'estimated net line change (negative = removed); 0 if unknown' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          risk: { type: 'string', description: 'what could break; "low" if trivial' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'refuted', 'reason'],
        properties: {
          index: { type: 'integer', description: 'the 0-based index of the finding being judged' },
          refuted: { type: 'boolean', description: 'true if the finding is wrong, overstated, or unverifiable' },
          reason: { type: 'string', description: 'one or two sentences of evidence for the verdict' },
        },
      },
    },
  },
}

function langLine() {
  return LANG ? `You are a senior ${LANG} architect.` : `You are a senior software architect; infer the language(s) from the files.`
}

function reviewPrompt(scope, chunk, schemaScope, uiScope) {
  return [
    `${langLine()} You are auditing the "${scope}" surface.`,
    PROJECT_CONTEXT ? `Project context — ${PROJECT_CONTEXT}` : ``,
    `Read each file below IN FULL exactly once, then report every finding across ALL of these lenses:`,
    ``,
    LENS_GUIDE + (schemaScope ? SCHEMA_LENS_GUIDE : '') + (uiScope ? FRONTEND_LENS_GUIDE : ''),
    ``,
    `Files to review:`,
    ...chunk.files.map((f) => `  - ${f}`),
    ``,
    `Rules:`,
    `- Each finding cites file:line, quotes the offending code in "problem", and sets exactly one "lens" from the enum.`,
    `- For reinvention (①) you MUST name the concrete replacement library/std API and estimate loc_delta. For lang-idiom (⑭), name a replacement only where a library/std API genuinely applies — otherwise leave "replacement" empty; never invent one to satisfy this rule.`,
    uiScope ? `- For frontend (⑯) "replacement" MUST name the existing in-repo component/token/dependency that should have been used — or, where the repo has no primitive and the pattern repeats across files, the new shared component/token to extract. A single one-off with no existing primitive and no repetition is NOT a ⑯ finding.` : ``,
    `- Skim CONTEXT.md/README, CLAUDE.md, the .claude/architect.md profile, and relevant docs/adr/ first to understand intent — but a deliberate decision can still be a finding (lens suspect-decision).`,
    `- Before reporting dead-code (④), confirm the symbol is not reached via a macro, reflection, DI, trait impl, re-export, or template/route — use grep/Explore to check.`,
    `- Report each distinct problem ONCE. Do not file the same issue under several lenses; pick the best-fitting lens.`,
    `- Be specific and conservative — no vague "consider refactoring". If unsure it is real, set confidence:"low" and let the verifier judge.`,
    `- If a file is clean, say nothing about it. Do not invent findings to fill space. An empty findings array is a valid result.`,
  ].filter(Boolean).join('\n')
}

function batchVerifyPrompt(scope, chunk, findings, schemaScope, uiScope) {
  const list = findings
    .map((f, i) =>
      [
        `--- FINDING ${i} (lens: ${f.lens}) ---`,
        `Title: ${f.title}`,
        `Location: ${f.file} (${f.lines})`,
        `Problem claimed: ${f.problem}`,
        `Proposed fix: ${f.proposed_fix}`,
        f.replacement ? `Named replacement: ${f.replacement}` : ``,
      ].filter(Boolean).join('\n'),
    )
    .join('\n\n')
  return [
    `You are an adversarial verifier. Your job is to REFUTE each architecture finding below, not to agree with it. Default to refuted:true for any finding you cannot INDEPENDENTLY confirm by reading the actual code.`,
    `These findings all concern the "${scope}" surface, in/around these files:`,
    ...chunk.files.map((f) => `  - ${f}`),
    schemaScope ? `Several findings may be database schema-shape (lens "schema") — be EXTRA skeptical of those; schema judgments are easy to get wrong.` : ``,
    uiScope ? `Some findings may be frontend (lens "frontend") — verify the named component/token/library actually exists in THIS repo (check the shared components dir, theme/token files, package manifest) and genuinely covers the case; for proposed extractions, verify the duplicated markup/pattern is real and not divergent-on-purpose.` : ``,
    ``,
    `For EACH finding, read the relevant file(s) yourself and check: does the quoted code actually exist as claimed? If a replacement library/API is named, does it exist and genuinely do what is claimed (check the real library, not your memory)? Is "dead" code actually reached via a macro/reflection/DI/trait/re-export/route? Is a "duplicate" actually divergent-on-purpose? Would the fix break the build or tests?`,
    `Refute (refuted:true) if the finding is wrong, overstated, unverifiable, or names a library/API that does not do what is claimed. Confirm (refuted:false) ONLY if you independently reproduced the problem.`,
    `Return one verdict object per finding, with its "index" matching the FINDING number below.`,
    ``,
    list,
  ].filter(Boolean).join('\n')
}

// ---- Frugal fan-out: per chunk, ONE reviewer then ONE batch-verifier. ~2 agents/chunk, fixed. ----
// pipeline() runs each chunk through both stages independently — no barrier, no per-finding fan-out.
let verifiersRun = 0 // reviewers always = chunks.length; verifiers only run on chunks with findings
const perChunk = await pipeline(
  chunks,
  // Stage 1: single reviewer, reads files once, applies every lens.
  (chunk) =>
    agent(reviewPrompt(A.scope, chunk, A.schemaScope, chunkHasUI(chunk)), {
      label: `review:${chunk.label}`,
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }).then((r) => ({ chunk, findings: (r && r.findings) || [] })),
  // Stage 2: single skeptic, adjudicates this chunk's whole list in one call.
  async ({ chunk, findings }) => {
    if (findings.length === 0) return []
    verifiersRun++
    const res = await agent(batchVerifyPrompt(A.scope, chunk, findings, A.schemaScope, chunkHasUI(chunk)), {
      label: `verify:${chunk.label}`,
      phase: 'Verify',
      model: 'sonnet',
      schema: VERDICTS_SCHEMA,
    })
    const verdicts = (res && res.verdicts) || []
    const byIndex = new Map(verdicts.map((v) => [v.index, v]))
    return findings.map((f, i) => {
      const v = byIndex.get(i)
      // No verdict ⇒ unverified (skeptic default = not actioned). refuted ⇒ kept WITH its
      // reason so the report can show what was challenged and why (trust + diffability).
      const status = !v ? 'unverified' : v.refuted ? 'refuted' : 'confirmed'
      return { ...f, status, refutation: v && v.refuted ? v.reason : null }
    })
  },
)

const reviewed = perChunk.filter(Boolean).flat()
const all = reviewed.length
log(`Review+verify done across ${chunks.length} chunk(s): ${all} findings judged.`)

// ---- Light cross-chunk dedup (chunks are disjoint files, so this is rarely needed) ----
// Confirmed-first order so a refuted/unverified duplicate can never shadow a confirmed twin.
const STATUS_RANK = { confirmed: 0, unverified: 1, refuted: 2 }
const seen = new Set()
const deduped = []
for (const f of [...reviewed].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])) {
  const key = `${(f.file || '').split(':')[0]}|${f.lens}|${(f.title || '').toLowerCase().slice(0, 50)}`
  if (!seen.has(key)) {
    seen.add(key)
    deduped.push(f)
  }
}

const confirmed = deduped.filter((f) => f.status === 'confirmed')
const refuted = deduped.filter((f) => f.status === 'refuted')
const unverified = deduped.filter((f) => f.status === 'unverified')
const agentsSpawned = chunks.length + verifiersRun
log(`Confirmed ${confirmed.length}/${deduped.length} (refuted ${refuted.length}, unverified ${unverified.length}). Spawned ${agentsSpawned} agents.`)

return {
  scope: A.scope,
  lang: LANG || '(inferred)',
  chunks_reviewed: chunks.length,
  chunks_requested: allChunks.length, // > chunks_reviewed means the MAX_CHUNKS cap truncated the run
  agents_spawned: agentsSpawned, // reviewers + verifiers actually run — the real cost line for the report
  tokens_out: budget.spent(), // shared-pool output tokens spent so far this turn (ceiling indicator, not exact)
  raw_findings: all,
  deduped_findings: deduped.length,
  confirmed_findings: confirmed.length,
  confirmed,
  refuted, // each carries `refutation` (the skeptic's reason) — surface these in the report's "Refuted / skipped" section
  unverified, // skeptic returned no verdict — not actioned, but list them in "Refuted / skipped" (no silent drops)
}
