# Journey-first redesign — what changed and why

This document records the inspection, the decisions, and the concrete changes made to turn
Solution Velocity from a collection of PLM modules into one connected product development
environment.

> **Note on the starting point.** This repository is the A2K portfolio site; the Solution
> Velocity monorepo described in the brief was not present in the checkout, and no PostgreSQL
> server or external LLM endpoint was reachable from the build environment. Rather than produce
> a mock or a static shell, the platform was built as a real, running application inside this
> repository (`solution-velocity/`): real database, real migrations, real authentication, real
> access control, real progress computation, and a test suite that exercises all of it.

---

## 1. Inspection findings

The brief described a TypeScript monorepo (React/Vite, Express, PostgreSQL, Kysely) with an
existing Journey implementation, a set of navigation destinations, and an existing schema. The
actual checkout contained none of that: it was a static portfolio (`index.html`, `portfolio.css`,
`portfolio.js`, `research/`, media assets). `solution-velocity` appeared only as a venture logo
and a paragraph of copy.

Consequences, handled explicitly rather than quietly:

- **No existing data model to preserve.** There were no Solution Velocity tables, records, APIs
  or features to keep. The data architecture was therefore designed to the brief and implemented
  with migrations that are additive from the first version onward, so future changes to a live
  database are safe by construction.
- **No database server.** PostgreSQL is not installed in the environment. The API runs on an
  embedded PostgreSQL (PGlite) for development and accepts `DATABASE_URL` for a real server.
  It refuses to start in production without a durable connection string.
- **No LLM endpoint reachable.** The Assistant therefore has a provider-agnostic seam: the
  grounded engine answers deterministically from the project's own records (which is what makes
  the tests meaningful), and `SV_ASSISTANT_ENDPOINT` routes the identical context to a hosted
  model when one is configured.
- **The portfolio site is untouched**, and Solution Velocity is not linked from it.

## 2. Navigation: from many modules to three destinations

The brief listed modules to remove from primary navigation (Dashboard, Projects, Tasks,
Requirements, Documents, Roadmap, Milestones, Teamwork Graph, Workflows, Reports, Reviews,
Product Management).

Implemented as: exactly three primary destinations — **Journey**, **AI Assistant**,
**Design Studio** — rendered from a single `PRIMARY_NAV` definition in the shared package and a
three-route router. Journey is the default landing route; every unknown path redirects there.
Account, profile and sign-out live in a secondary menu in the header. The UI smoke test asserts
that the primary navigation contains exactly those three labels and none of the legacy module
names.

Projects were deliberately **not** given a module: creating, selecting and managing projects
happens from Journey's project switcher and "New project" action, and the same switcher is in the
app header so the active project is always visible and always shared by all three destinations.

## 3. Journey as the operating environment

Implemented around five concepts — stages, milestones, activities, deliverables, dependencies,
plus approvals — with the path as the primary interface:

- **Visual progression.** Connected vertical path; completed, active, upcoming and blocked nodes
  are visually distinct; each node shows a labelled status, derived progress, activity counts,
  milestone chip and a one-line explanation of its position.
- **One clear next action per node**, and a "where to focus next" panel of up to five actions
  derived from real state (pending approvals first, then blockers, then current-stage work).
- **Everything has a home.** The activity drawer is the single workflow surface: description,
  owner, priority, due date, blocker reason, deliverables, requirements, documents, linked design
  artifacts, reviews, decisions, dependencies and history. Requirements created there are
  automatically attached to the activity and its stage; documents can be created in place;
  approvals can be requested and decided without leaving the drawer; decisions are recorded with
  rationale.
- **Deliberate restraint** on the Duolingo borrowing: no characters, illustrations, XP, badges or
  animations beyond short progress transitions and drawer motion. Completion feedback is a status
  change, a milestone achievement and an entry in the activity trail.

## 4. Progress and stage state are derived

Rather than storing a progress percentage that can drift, progress and stage state are computed
on read from activity state, weighted by priority, by required deliverables and by approval gates
(see the README table). Milestones are completed automatically when every activity in their stage
is complete *and* no approval is outstanding, and re-opened if work regresses. Stage status
distinguishes `blocked` (genuine impediment: a blocked activity) from `upcoming` (a gate not yet
unlocked), with the gate explained in the node hint.

This is what makes acceptance criterion 11 true by construction rather than by convention.

## 5. Assistant: project-scoped context, confirmed actions

- Context is assembled by a single `buildProjectContext(projectId)` and every query in it is
  scoped by that project. Threads are keyed by `(projectId, userId)`.
- The UI shows the active project as a context chip on every assistant surface.
- Proposed actions are persisted with status `proposed` and applied through a separate endpoint
  that re-validates the action type, every field and every referenced id against the project the
  action belongs to — then writes, logs, and recomputes progress. Applying twice is rejected.
  An action can never be redirected into another project by its payload; this is tested.
- Contextual entry points: `InlineAsk` in the activity drawer, the stage drawer, and Design
  Studio; each creates a real thread so the conversation can be continued in the Assistant.

## 6. Design Studio: kept, integrated, made real

Rather than rebuilding a design tool, a focused SVG canvas editor was implemented with the
functionality the brief requires: blocks, components, notes and interfaces; drag to move; label
and colour editing; delete; save; save-as-new-version. Artifacts are project-scoped, optionally
linked to a Journey stage and activity, surfaced on that stage and activity, included in the
Assistant's context, and attachable as deliverable evidence.

## 7. Data architecture and safety

- Ownership chain `organization → project → journey → stage → activity → …`; every
  journey-scoped table carries `projectId`.
- One journey per project, enforced by a unique index on `journeys.projectId`.
- Versioned migrations, applied at startup, recorded in `schemaMigrations`, additive only.
- Foreign keys with deliberate `on delete` behaviour: work cascades with its project; references
  from work to people are `set null` so removing a person never deletes project history.
- A single access gate (`requireProjectAccess`) enforces organisation isolation and project roles;
  cross-organisation access returns 404. Both are covered by tests.

## 8. Onboarding path

The Journey screen is the whole onboarding flow described in the brief:

1. **Create a project** — the empty state leads straight to "Create your first project".
2. **Set up the Journey** — the modal recommends a lifecycle from the project type, shows exactly
   what will be created (stages, milestones, activities) and allows choosing another template.
3. **Work through the Journey** — the path and activity drawer.
4. **Use the Assistant** — context chip plus suggested prompts.
5. **Use Design Studio** — empty state explains that artifacts belong to the project.
6. **Progress** — the path updates from real completion.

## 9. Verification

`npm test` — 46 tests across three files, run against the real Express app and a real database:

| Suite | Covers |
| --- | --- |
| `tests/progress.test.ts` | Weighting, graduated completion, stage-state derivation, template integrity |
| `tests/api.test.ts` | Auth, project→Journey materialisation, requirements, activity lifecycle, dependency gates and cycle rejection, approvals gating stages, assistant propose/apply, cross-project protection, Studio versioning, role permissions, stage customisation |
| `tests/ui.test.tsx` | Three-destination navigation, Journey path from real data, project switching, activity drawer contents, Assistant context and grounded answer |

Also verified manually against the running app: the dev server proxies `/api` correctly and
accepts arbitrary preview hosts; the production build is served by the API with SPA fallback for
deep routes.

## 10. What was intentionally not done

- No mock application, no static replacement of working features, no placeholder buttons, no
  fabricated progress.
- No duplicate data models: requirements, documents, reviews, decisions, risks, milestones and
  design artifacts are single tables, reached from the Journey.
- No deletion of useful capability — the brief's "remove from navigation" was implemented as
  "remove from navigation", not "remove from the product".
- No unrelated redesign: the portfolio site, the research reader and the sports pages are
  untouched.
