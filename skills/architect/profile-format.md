# `.claude/architect.md` profile format (optional, per target repo)

Drop this in any repo to give `/architect` named surfaces and project-specific rules. Every section is optional; omit what doesn't apply. Read this file only when authoring a profile or explaining the format — *parsing* an existing profile needs no spec (it's self-describing markdown).

```markdown
# architect profile

## Language
TypeScript/Node            <!-- overrides auto-detection if set -->

## Project context
Single-deploy web app; deliberately a modular monolith — do NOT recommend
microservices / horizontal-scaling / service-mesh, they do not apply.

## Surfaces
| Scope | Paths |
|---|---|
| frontend (alias ui) | src/components/, src/pages/, public/ |
| api   | src/server/routes/, src/server/handlers/ |
| core  | src/domain/ |
| db (alias database) | src/db/, src/db/migrations/ |

## Drift rules
<!-- lens ⑧ — the layering invariants for THIS repo -->
- logic in src/types/ (types-only) is a violation
- DB queries outside src/db/ instead of going through the repository layer
- illegal upward imports: src/domain/ must not import from src/server/
- reaching past the repository/API layer

## Language idioms
<!-- lens ⑭ — what the linter can't catch in THIS stack -->
- floating-point Number for money (use integer cents / a decimal library)
- swallowed promise rejections; unhandled async errors on fallible paths
- stringly-typed errors / `any` leaking past a module boundary where a union belongs
```

When this file is absent, lens ⑧ falls back to generic layering judgment and lens ⑭ to the detected language's default idiom checklist.
