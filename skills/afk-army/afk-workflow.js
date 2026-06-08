export const meta = {
  name: 'afk-army-drain',
  description: 'Parallel issue-drain: one worker subagent per unblocked issue, each in a runtime-managed git worktree, implements → pushes → opens a PR. Returns the PR list + escalations. Merge is NOT done here — the orchestrator runs a single batch-verify merge-train afterwards.',
  phases: [{ title: 'Implement', detail: 'one worker per issue, isolated worktree, implement+push+PR' }],
}

// args = {
//   issues: [{ number, title, body, comments, model, slug }],
//   repo: "owner/name",
//   branchPrefix: "army/",          // default "army/"
//   workerVerify: "npm run lint" (or "cargo clippy", "ruff check", …)  // optional cheap worker gate; omit/empty = no worker gate
// }
// The runtime delivers args as a JSON *string* on some paths — normalize defensively.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const ISSUES = A.issues || []
const REPO = A.repo
const PREFIX = A.branchPrefix || 'army/'
const WORKER_VERIFY = (A.workerVerify || '').trim()

// What each worker returns. result drives orchestrator handling.
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'result'],
  properties: {
    number: { type: 'integer', description: 'the issue number this worker handled' },
    result: { type: 'string', enum: ['success', 'needs-info', 'escalate'] },
    pr_url: { type: 'string', description: 'PR URL when result=success; "" otherwise' },
    branch: { type: 'string', description: 'the branch pushed when result=success; "" otherwise' },
    reason: { type: 'string', description: 'one-line reason for needs-info / escalate; "" for success' },
  },
}

function workerPrompt(issue) {
  const verifyBlock = WORKER_VERIFY
    ? `# Cheap verify (one foreground command — NOT the full suite)\n${WORKER_VERIFY}\nIf it fails: read the error, fix at source, retry up to 3× total, then return result=escalate reason="verify-red-x3".`
    : `# Verification\nSkip local verification — the orchestrator runs the full gate against your PR before merge. Do NOT run the full test suite (it's expensive and redundant here).`
  return [
    `You are an autonomous worker resolving GitHub issue #${issue.number} on ${REPO}.`,
    ``,
    `The runtime has placed you in your OWN git worktree — a clean checkout on a fresh branch off main.`,
    `You are isolated: siblings can't see your changes and you can't see theirs. Do ALL work here; never`,
    `cd elsewhere. Confirm your root first: \`git rev-parse --show-toplevel\`.`,
    ``,
    `# Read before editing`,
    `- CLAUDE.md, README, and any docs/ the repo has (project conventions).`,
    `- Any file the issue references.`,
    `- If it's in your skill list, invoke Skill(skill="dromsak-guidelines") for behavioural rails; if not, continue.`,
    ``,
    `# Issue`,
    `Title: ${issue.title}`,
    ``,
    `${issue.body || '(no body)'}`,
    ``,
    `Recent comments:`,
    `${issue.comments || '(none)'}`,
    ``,
    `# Implement`,
    `End-to-end, MINIMUM surface — do not refactor adjacent code, do not add speculative abstractions.`,
    `Commit small, sensible chunks. Rename your branch once, early:`,
    `  git branch -m ${PREFIX}${issue.number}-${issue.slug}`,
    ``,
    verifyBlock,
    ``,
    `# Before pushing`,
    `Re-read the issue's acceptance criteria. Your final commit message must list each AC item with a`,
    `\`<file>:<line>\` or test name that satisfies it — that's the orchestrator's only AC review.`,
    ``,
    `# Push + open PR — do NOT merge, do NOT rebase, do NOT force-push`,
    `  git push -u origin ${PREFIX}${issue.number}-${issue.slug}`,
    `  gh pr create --repo ${REPO} --base main \\`,
    `    --title "<verb>(<scope>): <short>" \\`,
    `    --body "Closes #${issue.number}` + '\\n\\n<short summary>\\n\\n## AC attest\\n<bulleted attest list>"',
    `If your branch falls behind main, leave it — the orchestrator rebases at merge time.`,
    ``,
    `# Return your result`,
    `After the PR is open, return result=success with its pr_url and branch.`,
    `If a spec ambiguity blocks you and you pushed nothing, return result=needs-info with a one-line reason.`,
    `If you hit a non-recoverable error (or the cheap verify stays red), return result=escalate with a reason.`,
  ].join('\n')
}

// Single stage, fully parallel: the runtime paces concurrency (cap ~min(16, cores-2)) and
// drains the rest as slots free — so passing every unblocked issue here is correct.
const results = await parallel(
  ISSUES.map((issue) => () =>
    agent(workerPrompt(issue), {
      label: `#${issue.number} ${(issue.title || '').slice(0, 40)}`,
      phase: 'Implement',
      model: issue.model,
      isolation: 'worktree',
      schema: RESULT_SCHEMA,
    }),
  ),
)

const ok = results.filter(Boolean)
const prs = ok.filter((r) => r.result === 'success' && r.pr_url)
const escalated = ok.filter((r) => r.result === 'escalate')
const needs_info = ok.filter((r) => r.result === 'needs-info')
// A null (agent crashed / skipped) or a success with no PR is its own escalation class.
const lost = ISSUES.filter((i) => !ok.some((r) => r.number === i.number)).map((i) => ({ number: i.number, reason: 'worker returned no result' }))

log(`drain: ${prs.length} PRs, ${escalated.length} escalated, ${needs_info.length} needs-info, ${lost.length} lost (of ${ISSUES.length})`)

return {
  prs: prs.map((r) => ({ number: r.number, pr_url: r.pr_url, branch: r.branch })),
  escalated: escalated.map((r) => ({ number: r.number, reason: r.reason })),
  needs_info: needs_info.map((r) => ({ number: r.number, reason: r.reason })),
  lost,
  counts: { issues: ISSUES.length, prs: prs.length, escalated: escalated.length, needs_info: needs_info.length, lost: lost.length },
}
