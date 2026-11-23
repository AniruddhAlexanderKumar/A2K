# Solution Velocity

**One connected product development environment.** Solution Velocity is AI-powered Product
Development Lifecycle Management, built around a single principle:

> Everything belongs to a project. Every project has its own Journey. Everything related to
> that project is managed through that Journey.

There are exactly three primary destinations:

| Destination | Role |
| --- | --- |
| **Journey** | Tells users what needs to happen, and manages the work. Default landing page. |
| **AI Assistant** | Helps users understand, plan and execute the work — inside one project's context. |
| **Design Studio** | Gives users the environment to create and refine the product, linked back to the Journey. |

Everything else — tasks, requirements, documents, milestones, reviews, approvals, risks,
decisions, dependencies, design artifacts, activity history — lives **inside** the Journey
of the project it belongs to. There is no separate Projects, Tasks, Requirements, Documents,
Roadmap, Milestones, Workflows or Reports module to navigate to.

---

## Quick start

```bash
cd solution-velocity
npm install
npm run dev          # API on :4000, web on :5173
```

Open <http://localhost:5173>. The first start creates the schema and seeds a demo
organisation with two real projects:

```
aniruddh@solutionvelocity.dev / JourneyFirst1
```

Set `SV_SKIP_SEED=1` to start with an empty workspace and create your own project from
Journey instead.

Other scripts:

```bash
npm test             # 46 tests: API end-to-end, progress model, UI smoke tests
npm run typecheck    # strict TypeScript across API and web
npm run build        # production web build
npm start            # API serving the built SPA (single origin)
```

---

## Architecture

```
solution-velocity/
├── packages/shared/         Domain model shared by both apps
│   └── src/index.ts         Journey templates, progress maths, API contract types
├── apps/api/                Express 5 + Kysely + PostgreSQL
│   └── src/
│       ├── db/              Schema types, versioned migrations, client, seed
│       ├── lib/             Access control, security, Journey service
│       ├── ai/              Assistant context, engine, confirmed actions
│       └── routes/          auth · projects · journey · work · assistant · studio
├── apps/web/                React 19 + Vite
│   └── src/
│       ├── lib/             API client, active-project store
│       ├── components/      Shell, design-system primitives, contextual ask
│       └── pages/           Journey, Assistant, Studio, drawers, modals
└── tests/                   Real API + real database + jsdom UI tests
```

**Stack.** TypeScript monorepo (npm workspaces) · React 19 + Vite · Express 5 · Kysely ·
PostgreSQL. In development the API runs against an embedded PostgreSQL (`@electric-sql/pglite`)
so no database server is required; set `DATABASE_URL` for a real server. The Vite dev server
proxies `/api` so the browser only ever talks to one origin, and in production the API serves
the built SPA.

---

## How the redesign maps onto the platform

| Former module | Where it lives now |
| --- | --- |
| Dashboard | Journey header: progress, current stage, next actions, attention panel |
| Projects | Project switcher and "New project" inside Journey (no separate module) |
| Tasks | Journey **activities**, grouped by stage, opened in the activity drawer |
| Requirements | Requirements tab of the activity, plus the stage's requirement list |
| Documents | Documents tab of the activity and the stage's document list |
| Roadmap / Milestones | The Journey path itself: ordered stages, each with a milestone |
| Workflows | Stage dependencies and activity dependencies (gates are enforced) |
| Reports | Generated as documents through the Assistant, linked to the stage |
| Reviews / Approvals | Reviews tab of the activity; pending approvals surface on the Journey |
| Product Management | Risks, decisions and deliverables attached to the stage/activity |
| Teamwork Graph | Project members with roles, shown on the Journey and used for assignment |
| Design Studio | Retained as a destination, now project-scoped and Journey-linked |

Nothing was deleted: the same records, in the same database, are now reached through the
project's Journey instead of through a parallel navigation tree.

---

## The Journey

A Journey is created with a project and consists of:

- **Stages** — major lifecycle phases, ordered and connected into a visible path.
- **Milestones** — one objective per stage, achieved automatically when its work completes.
- **Activities** — the unit of work; each has an owner, priority, due date and status.
- **Deliverables** — the evidence an activity produces (document, specification, design…).
- **Dependencies** — activity→activity gates (enforced) and milestone→stage gates.
- **Approvals** — reviews that hold a stage open until decided.

Four lifecycle templates are provided and recommended from the project type:

| Template | Used for |
| --- | --- |
| Physical Product Development | Hardware, robotics, aerospace, electromechanical |
| Software Product Development | SaaS, web/mobile, internal platforms |
| Research Programme | Research, advanced development, experiments |
| Flexible Product Journey | Anything else |

Stages, activities and milestones are all customisable per project:

- rename a stage or change its objective (`PATCH /api/journey/stage/:id`)
- add a stage with its own milestone and activities (`POST /api/journey/stages`)
- add activities to any stage (`POST /api/projects/:id/activities`)
- the stage's **state** is derived from its activities — it is not a manual tick-box; a lead
  can override it only when the derived state is wrong.

### Progress is computed, never stored as a vanity number

`progress_from_activities` weights each activity by priority, by whether it must produce a
deliverable, and by whether it needs an approval. Activity completion is graduated:

| Status | Contribution |
| --- | --- |
| completed | 100% |
| in review | 75% |
| in progress | 45% |
| blocked | 20% |
| not started | 0% |

Project progress, stage progress, stage state, the "current stage" and the next-action list
are all derived from this on read, so they can never drift from the actual work.

---

## The three destinations

### 1. Journey (`/journey`) — default landing page

A Duolingo-inspired path, adapted for engineering: a connected vertical progression of stage
nodes with distinguishable completed / active / upcoming / blocked states, compact milestone
chips, per-stage progress, and a plain-language hint on every node ("Complete — milestone
achieved", "2 of 3 activities complete", "Waiting on milestone: Concept baseline locked").

Each node carries one contextual next step. Below the path:

- **Where to focus next** — up to five concrete actions derived from real state.
- **Needs attention** — blockers with their reason, pending approvals, overdue work.
- **Milestones** — achieved and approaching.
- **Team** — members and roles.

Opening a stage shows its activities plus everything the stage owns. Opening an activity gives
the whole workflow a home: description, owner, priority, due date, blocker reason, deliverables,
requirements, documents, linked designs, reviews, decisions, dependencies and history. Requesting
an approval, recording a decision, creating a requirement or drafting a document all happen here
without leaving the Journey.

### 2. AI Assistant (`/assistant`)

The Assistant is **project-scoped by construction**:

- The context chip always names the project in use (`PPT · Pulsed Plasma Thruster — Flight Unit`).
- Threads are stored per project *and* per user; switching project switches the thread.
- The context builder queries only `projectId = activeProject`; there is no cross-project read.
- Every proposed action is re-validated on apply: it can only write into the project it was
  proposed for, and every referenced stage/activity/member must belong to that project.

It can summarise progress, explain blockers and dependencies, read requirements and documents,
and propose changes: create activity, requirement, document, milestone, deliverable, risk,
assign an activity, add a dependency, request an approval, link a document, complete an activity.

**Nothing is written until the user confirms.** The proposal shows the exact payload; applying
it is a separate, authorised request. Approved changes are logged to the project's activity trail.

The Assistant is also reachable contextually from Journey (activity and stage drawers) and from
Design Studio, without leaving the workspace.

With no model provider configured, the engine answers deterministically from the project's own
records — every figure and title comes from the database. Set `SV_ASSISTANT_ENDPOINT` to route
the identical context to any OpenAI-compatible endpoint; provider failures fall back to the
grounded engine, so the Assistant is never unavailable and never answers without context.

### 3. Design Studio (`/studio`)

A working canvas editor — blocks, components, notes and interfaces, draggable and editable —
not a mock. Artifacts are project-scoped, keep a version number, and can be linked to a Journey
stage and activity. Linked artifacts appear on the stage and activity they support, and are part
of the Assistant's project context. From the Studio you can ask the Assistant about the artifact,
or attach it as the evidence for a deliverable.

---

## Data model

Ownership chain: `organization → project → journey → stage → activity → everything else`.

```
organizations ─┬─ users ─┬─ sessions
               │         └─ projectMembers ──┐
               └─ projects ──────────────────┴─ journeys (one per project, unique)
                                ├─ journeyStages ─┬─ activities ─┬─ deliverables
                                │                 │                ├─ requirements
                                │                 │                ├─ documents
                                │                 │                ├─ designArtifacts
                                │                 │                ├─ reviews
                                │                 │                └─ decisions
                                │                 └─ milestones
                                ├─ dependencies (activity/deliverable/milestone → activity/stage)
                                ├─ risks
                                ├─ activityLog
                                └─ assistantThreads ─┬─ assistantMessages
                                                     └─ assistantActions
```

Every journey-scoped table carries `projectId`, which is what makes isolation a single check
rather than a per-query guess.

### Migrations

Versioned migrations in `apps/api/src/db/migrate.ts`, applied automatically at startup and
recorded in `schemaMigrations`. They are **additive only** — no table, column or record is
dropped or renamed. A project has exactly one journey, enforced by a unique index, so a project
can never exist without one.

---

## Access control

| Role | Scope | Can |
| --- | --- | --- |
| owner / admin | organisation | manage every project in the organisation |
| lead | project | everything in the project, including members and Journey shape |
| contributor | project | create and edit work, request reviews, apply assistant changes |
| viewer | project | read only |

`requireProjectAccess()` is the single gate used by every project-scoped route: it resolves the
project, verifies it belongs to the caller's organisation, resolves the caller's project role and
enforces the minimum role. A project in another organisation returns **404**, not 403, so it does
not confirm existence. Sessions are httpOnly cookies backed by a hashed token with a 30-day
expiry; passwords are scrypt-hashed with a per-user salt.

---

## Tests

`npm test` runs against the real Express app, the real migrations and a real (in-process)
PostgreSQL — no mocking of the data layer:

- **progress model** — weighting, graduated completion, stage-state derivation, template integrity.
- **API end-to-end** — registration/login, project creation materialising a Journey, requirements,
  activity lifecycle driving progress, dependency gates (including rejection of cycles), approvals
  holding a stage open, assistant propose→apply with cross-project protection, Studio versioning
  and cross-project link rejection, and role-based permissions.
- **UI smoke tests** — jsdom renders the real app against the real API and asserts that only three
  primary destinations exist, that Journey renders the path from real data, that a stage opens its
  activities in place, and that the Assistant shows and answers from the active project's context.

```
Test Files  3 passed (3)
     Tests  46 passed (46)
```

---

## Configuration

See `.env.example`. Production requires `DATABASE_URL`; the embedded database refuses to start in
production so a misconfigured deploy fails loudly instead of writing to ephemeral storage.
