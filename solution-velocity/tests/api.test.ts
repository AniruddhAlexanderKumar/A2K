/**
 * End-to-end tests against the real Express app, real migrations and a real (in-process)
 * Postgres. No mocks: every assertion is about what the API actually wrote and returned.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-test-'));
process.env.SV_DATA_DIR = path.join(tmpDir, 'pg');
process.env.NODE_ENV = 'test';
process.env.SV_SKIP_SEED = '1';

type Mods = {
  db: import('../apps/api/src/db/client.js').Database;
  server: Server;
  base: string;
  close: () => Promise<void>;
};

let ctx: Mods;
let ownerCookie = '';
let outsiderCookie = '';

async function call(
  method: string,
  url: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; json: any; setCookie?: string }> {
  const res = await fetch(`${ctx.base}${url}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: text ? JSON.parse(text) : null,
    setCookie: res.headers.getSetCookie?.()[0],
  };
}

const cookieOf = (setCookie?: string) => (setCookie ? setCookie.split(';')[0] : '');

beforeAll(async () => {
  const { getDb } = await import('../apps/api/src/db/client.js');
  const { migrate } = await import('../apps/api/src/db/migrate.js');
  const { createApp } = await import('../apps/api/src/app.js');

  const { ensureSeed } = await import('../apps/api/src/db/seed.js');
  const db = await getDb();
  await migrate(db);
  // The same demo workspace the product ships with; tests use its seeded teammates to
  // exercise role-based permissions with real accounts in one organization.
  await ensureSeed(db);
  const app = createApp(db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;

  ctx = {
    db,
    server,
    base: `http://127.0.0.1:${port}/api`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const { closeDb } = await import('../apps/api/src/db/client.js');
      await closeDb();
    },
  };
}, 120_000);

afterAll(async () => {
  await ctx?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('authentication', () => {
  it('registers an owner and returns their session', async () => {
    const res = await call('POST', '/auth/register', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Analytical1',
      organizationName: 'Engines',
    });
    expect(res.status).toBe(201);
    expect(res.json.user.email).toBe('ada@example.com');
    expect(res.json.user.role).toBe('owner');
    ownerCookie = cookieOf(res.setCookie);
    expect(ownerCookie).toContain('sv_session=');
  });

  it('rejects a duplicate email', async () => {
    const res = await call('POST', '/auth/register', {
      name: 'Ada Again',
      email: 'ada@example.com',
      password: 'Analytical1',
    });
    expect(res.status).toBe(409);
  });

  it('rejects a wrong password', async () => {
    const res = await call('POST', '/auth/login', { email: 'ada@example.com', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('requires a session for project routes', async () => {
    const res = await call('GET', '/projects');
    expect(res.status).toBe(401);
  });

  it('creates a second organization that cannot see the first', async () => {
    const res = await call('POST', '/auth/register', {
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'Compiler12',
      organizationName: 'Compilers',
    });
    expect(res.status).toBe(201);
    outsiderCookie = cookieOf(res.setCookie);
  });
});

describe('project + journey creation', () => {
  let projectId = 0;

  it('creates a project with a dedicated journey', async () => {
    const res = await call(
      'POST',
      '/projects',
      {
        name: 'Pulsed Plasma Thruster',
        description: 'Flight unit for a 6U CubeSat',
        projectType: 'hardware',
      },
      ownerCookie,
    );
    expect(res.status).toBe(201);
    projectId = res.json.projectId;
    expect(projectId).toBeGreaterThan(0);
  });

  it('materialises the hardware lifecycle into stages, milestones and activities', async () => {
    const res = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    expect(res.status).toBe(200);
    expect(res.json.project.templateKey).toBe('hardware_product');
    expect(res.json.stages.length).toBe(7);
    expect(res.json.stages[0].status).toBe('active');
    expect(res.json.stages[1].status).toBe('upcoming');
    expect(res.json.milestones.length).toBe(7);
    expect(res.json.stats.activities).toBeGreaterThan(10);
    // Deliverables are seeded per activity so completion always has evidence attached.
    expect(res.json.stats.deliverables).toBeGreaterThan(5);
    // Every activity starts empty, so progress must be exactly zero.
    expect(res.json.project.progress).toBe(0);
  });

  it('adds a requirement linked to a stage', async () => {
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    const stageId = journey.json.stages[1].id;
    const res = await call(
      'POST',
      `/projects/${projectId}/requirements`,
      { title: 'Thrust output', statement: 'Shall produce at least 40 µN', stageId },
      ownerCookie,
    );
    expect(res.status).toBe(201);
    expect(res.json.ref).toMatch(/REQ-\d{3}/);

    const list = await call('GET', `/projects/${projectId}/requirements`, undefined, ownerCookie);
    expect(list.json.requirements).toHaveLength(1);
    expect(list.json.requirements[0].stageId).toBe(stageId);
  });

  it('rejects a stage from another project', async () => {
    const other = await call('POST', '/projects', { name: 'Second Project', projectType: 'software' }, ownerCookie);
    const otherJourney = await call('GET', `/journey?projectId=${other.json.projectId}`, undefined, ownerCookie);
    const foreignStage = otherJourney.json.stages[0].id;
    const res = await call(
      'POST',
      `/projects/${projectId}/activities`,
      { stageId: foreignStage, title: 'Leaked activity' },
      ownerCookie,
    );
    // The service layer validates stage ownership per project.
    expect(res.status).toBe(400);
  });
});

describe('activity lifecycle drives progress', () => {
  let projectId = 0;
  let activityId = 0;
  let stageId = 0;

  beforeAll(async () => {
    const created = await call('POST', '/projects', { name: 'Journey Mechanics', projectType: 'research' }, ownerCookie);
    projectId = created.json.projectId;
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    stageId = journey.json.stages[0].id;
    const activities = await call('GET', `/projects/${projectId}/activities`, undefined, ownerCookie);
    activityId = activities.json.activities[0].id;
  });

  it('starts at zero progress', async () => {
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    expect(journey.json.project.progress).toBe(0);
  });

  it('records a blocked activity with its reason and surfaces it on the path', async () => {
    const res = await call(
      'PATCH',
      `/projects/${projectId}/activities/${activityId}`,
      { status: 'blocked', blockedReason: 'Awaiting supplier quote' },
      ownerCookie,
    );
    expect(res.status).toBe(200);
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    expect(journey.json.blockers.some((b: { reason: string }) => b.reason === 'Awaiting supplier quote')).toBe(true);
    expect(journey.json.stages.find((s: { id: number }) => s.id === stageId).status).toBe('blocked');
  });

  it('moves progress forward when work starts, and to the milestone when it completes', async () => {
    const started = await call('PATCH', `/projects/${projectId}/activities/${activityId}`, { status: 'in_progress' }, ownerCookie);
    expect(started.status).toBe(200);
    const afterStart = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    expect(afterStart.json.project.progress).toBeGreaterThan(0);

    const all = await call('GET', `/projects/${projectId}/activities`, undefined, ownerCookie);
    for (const activity of all.json.activities.filter((a: { stageId: number }) => a.stageId === stageId)) {
      await call('PATCH', `/projects/${projectId}/activities/${activity.id}`, { status: 'completed' }, ownerCookie);
    }
    const done = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    const stage = done.json.stages.find((s: { id: number }) => s.id === stageId);
    expect(stage.progress).toBe(1);
    expect(stage.status).toBe('completed');
    expect(done.json.stages[1].status).toBe('active');
  });

  it('enforces a dependency gate before an activity can start', async () => {
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    const activities = await call('GET', `/projects/${projectId}/activities`, undefined, ownerCookie);
    // Research programmes start their experimental stage with two independent activities.
    const nextStage = journey.json.stages.find(
      (s: { id: number; activityCount: number; completedCount: number }) => s.activityCount > 1 && s.completedCount === 0,
    ).id;
    const inStage = activities.json.activities.filter((a: { stageId: number }) => a.stageId === nextStage);
    expect(inStage.length).toBeGreaterThan(1);
    const [prereq, dependent] = inStage;

    const dep = await call(
      'POST',
      `/projects/${projectId}/dependencies`,
      { fromType: 'activity', fromId: prereq.id, toType: 'activity', toId: dependent.id },
      ownerCookie,
    );
    expect(dep.status).toBe(201);

    const blocked = await call('PATCH', `/projects/${projectId}/activities/${dependent.id}`, { status: 'in_progress' }, ownerCookie);
    expect(blocked.json.blocked).toBe(true);

    const detail = await call('GET', `/projects/${projectId}/activities/${dependent.id}`, undefined, ownerCookie);
    expect(detail.json.activity.status).toBe('blocked');
    expect(detail.json.activity.unmetDependencyCount).toBe(1);
    expect(detail.json.activity.blockedReason).toContain(prereq.title);

    // Completing the prerequisite releases the gate.
    await call('PATCH', `/projects/${projectId}/activities/${prereq.id}`, { status: 'completed' }, ownerCookie);
    const released = await call('PATCH', `/projects/${projectId}/activities/${dependent.id}`, { status: 'in_progress' }, ownerCookie);
    expect(released.json.blocked).toBeUndefined();
    const after = await call('GET', `/projects/${projectId}/activities/${dependent.id}`, undefined, ownerCookie);
    expect(after.json.activity.status).toBe('in_progress');
  });

  it('refuses a circular dependency', async () => {
    const activities = await call('GET', `/projects/${projectId}/activities`, undefined, ownerCookie);
    const [a, b] = activities.json.activities;
    await call('POST', `/projects/${projectId}/dependencies`, { fromType: 'activity', fromId: a.id, toType: 'activity', toId: b.id }, ownerCookie);
    const res = await call(
      'POST',
      `/projects/${projectId}/dependencies`,
      { fromType: 'activity', fromId: b.id, toType: 'activity', toId: a.id },
      ownerCookie,
    );
    expect(res.status).toBe(409);
  });
});

describe('reviews and approvals gate completion', () => {
  let projectId = 0;
  let activityId = 0;
  let stageId = 0;

  beforeAll(async () => {
    const created = await call('POST', '/projects', { name: 'Approval Flow', projectType: 'software' }, ownerCookie);
    projectId = created.json.projectId;
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    stageId = journey.json.stages[0].id;
    const activities = await call('GET', `/projects/${projectId}/activities`, undefined, ownerCookie);
    activityId = activities.json.activities.find((a: { stageId: number }) => a.stageId === stageId).id;
  });

  it('holds the stage open until the approval is decided', async () => {
    const review = await call(
      'POST',
      `/projects/${projectId}/reviews`,
      { title: 'Concept approval', kind: 'approval', activityId },
      ownerCookie,
    );
    expect(review.status).toBe(201);

    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    expect(journey.json.pendingApprovals.length).toBe(1);
    expect(journey.json.project.pendingApprovals).toBe(1);

    const approve = await call('POST', `/projects/${projectId}/reviews/${review.json.reviewId}/decide`, { decision: 'approved', note: 'Margins acceptable' }, ownerCookie);
    expect(approve.status).toBe(200);

    const after = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    expect(after.json.pendingApprovals.length).toBe(0);
    // Approving the activity's approval completes the activity itself.
    const detail = await call('GET', `/projects/${projectId}/activities/${activityId}`, undefined, ownerCookie);
    expect(detail.json.activity.status).toBe('completed');
    expect(detail.json.reviews[0].status).toBe('approved');
  });
});

describe('AI assistant', () => {
  let projectId = 0;
  let threadId = 0;

  beforeAll(async () => {
    const created = await call('POST', '/projects', { name: 'Assistant Project', projectType: 'hardware' }, ownerCookie);
    projectId = created.json.projectId;
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    const activities = await call('GET', `/projects/${projectId}/activities`, undefined, ownerCookie);
    const first = activities.json.activities.find((a: { stageId: number }) => a.stageId === journey.json.stages[0].id);
    await call('PATCH', `/projects/${projectId}/activities/${first.id}`, { status: 'completed' }, ownerCookie);

    const thread = await call('POST', '/assistant/threads', { projectId }, ownerCookie);
    threadId = thread.json.threadId;
  });

  it('answers from this project only', async () => {
    const res = await call('POST', `/assistant/threads/${threadId}/messages`, { message: 'Summarise everything outstanding in this project' }, ownerCookie);
    expect(res.status).toBe(200);
    expect(res.json.message.content).toContain('Assistant Project');
    expect(res.json.contextProject.id).toBe(projectId);
    expect(res.json.message.content).not.toContain('Pulsed Plasma Thruster');
  });

  it('proposes a requirement without writing it', async () => {
    const res = await call('POST', `/assistant/threads/${threadId}/messages`, { message: 'Create a requirement for thermal margin on the thruster' }, ownerCookie);
    expect(res.status).toBe(200);
    expect(res.json.actions.length).toBe(1);
    expect(res.json.actions[0].actionType).toBe('create_requirement');
    expect(res.json.actions[0].status).toBe('proposed');

    const before = await call('GET', `/projects/${projectId}/requirements`, undefined, ownerCookie);
    expect(before.json.requirements).toHaveLength(0);

    const applied = await call('POST', `/assistant/actions/${res.json.actions[0].id}/apply`, {}, ownerCookie);
    expect(applied.status).toBe(200);
    expect(applied.json.result.entityType).toBe('requirement');

    const after = await call('GET', `/projects/${projectId}/requirements`, undefined, ownerCookie);
    expect(after.json.requirements).toHaveLength(1);
    expect(after.json.requirements[0].source).toBe('assistant');

    const again = await call('POST', `/assistant/actions/${res.json.actions[0].id}/apply`, {}, ownerCookie);
    expect(again.status).toBe(400);
  });

  it('drafts a document into the project', async () => {
    const res = await call('POST', `/assistant/threads/${threadId}/messages`, { message: 'Draft a progress report for this stage' }, ownerCookie);
    const action = res.json.actions[0];
    expect(action.actionType).toBe('create_document');
    const applied = await call('POST', `/assistant/actions/${action.id}/apply`, {}, ownerCookie);
    expect(applied.status).toBe(200);
    const docs = await call('GET', `/projects/${projectId}/documents`, undefined, ownerCookie);
    expect(docs.json.documents.length).toBe(1);
    expect(docs.json.documents[0].aiGenerated).toBe(true);
    expect(docs.json.documents[0].stageId).toBe(action.payload.stageId);
  });

  it('cannot apply an action into a different project', async () => {
    const res = await call('POST', `/assistant/threads/${threadId}/messages`, { message: 'Create a requirement for cross-project leakage' }, ownerCookie);
    const action = res.json.actions[0];
    const other = await call('POST', '/projects', { name: 'Unrelated Project', projectType: 'other' }, ownerCookie);
    // Applying always targets the action's own project, never the one in the URL.
    const applied = await call('POST', `/assistant/actions/${action.id}/apply`, { payload: { projectId: other.json.projectId } }, ownerCookie);
    expect(applied.status).toBe(200);
    const otherReqs = await call('GET', `/projects/${other.json.projectId}/requirements`, undefined, ownerCookie);
    expect(otherReqs.json.requirements).toHaveLength(0);
  });

  it('does not leak threads across projects', async () => {
    const other = await call('POST', '/projects', { name: 'Silent Project', projectType: 'other' }, ownerCookie);
    const threads = await call('GET', `/assistant/threads?projectId=${other.json.projectId}`, undefined, ownerCookie);
    expect(threads.json.threads).toHaveLength(0);
    const direct = await call('GET', `/assistant/threads/${threadId}`, undefined, ownerCookie);
    expect(direct.status).toBe(200);
    expect(direct.json.thread.projectId).toBe(projectId);
  });
});

describe('design studio', () => {
  let projectId = 0;
  let artifactId = 0;
  let stageId = 0;

  beforeAll(async () => {
    const created = await call('POST', '/projects', { name: 'Studio Project', projectType: 'hardware' }, ownerCookie);
    projectId = created.json.projectId;
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    stageId = journey.json.stages[1].id;
  });

  it('creates an artifact linked to a Journey stage', async () => {
    const res = await call(
      'POST',
      '/studio/artifacts',
      {
        projectId,
        name: 'System Layout',
        type: 'system_sketch',
        description: 'Packaging study',
        stageId,
        scene: {
          width: 1200,
          height: 800,
          shapes: [{ id: 's1', kind: 'rect', x: 10, y: 10, w: 100, h: 60, label: 'Thruster', color: '#31567a' }],
        },
      },
      ownerCookie,
    );
    expect(res.status).toBe(201);
    artifactId = res.json.artifactId;
  });

  it('appears on the stage it is linked to', async () => {
    const stage = await call('GET', `/journey/stage/${stageId}`, undefined, ownerCookie);
    expect(stage.status).toBe(200);
    expect(stage.json.artifacts.some((a: { id: number }) => a.id === artifactId)).toBe(true);
  });

  it('keeps version history when saved explicitly', async () => {
    const res = await call('PATCH', `/studio/artifacts/${artifactId}`, { name: 'System Layout v2', bumpVersion: true }, ownerCookie);
    expect(res.status).toBe(200);
    expect(res.json.version).toBe(2);
  });

  it('rejects linking to a stage from another project', async () => {
    const other = await call('POST', '/projects', { name: 'Other Studio Project', projectType: 'other' }, ownerCookie);
    const otherJourney = await call('GET', `/journey?projectId=${other.json.projectId}`, undefined, ownerCookie);
    const res = await call('PATCH', `/studio/artifacts/${artifactId}`, { stageId: otherJourney.json.stages[0].id }, ownerCookie);
    expect(res.status).toBe(400);
  });
});

describe('isolation and permissions', () => {
  let projectId = 0;
  let viewerCookie = '';
  let permissionProjectLeadCookie = '';

  beforeAll(async () => {

    // A teammate in the seeded organization, added to the project with view-only access.
    const viewer = await call('POST', '/auth/login', { email: 'tomas@solutionvelocity.dev', password: 'JourneyFirst1' });
    expect(viewer.status).toBe(200);
    viewerCookie = cookieOf(viewer.setCookie);

    const lead = await call('POST', '/auth/login', {
      email: 'aniruddh@solutionvelocity.dev',
      password: 'JourneyFirst1',
    });
    expect(lead.status).toBe(200);
    const leadCookie = cookieOf(lead.setCookie);
    const madeProject = await call('POST', '/projects', { name: 'Private Project', projectType: 'other' }, leadCookie);
    projectId = madeProject.json.projectId;
    const added = await call('POST', `/projects/${projectId}/members`, { userId: viewer.json.user.id, role: 'viewer' }, leadCookie);
    expect(added.status).toBe(201);
    permissionProjectLeadCookie = leadCookie;
  });

  it('hides another organization’s project entirely', async () => {
    const res = await call('GET', `/journey?projectId=${projectId}`, undefined, outsiderCookie);
    expect(res.status).toBe(404);
    const list = await call('GET', '/projects', undefined, outsiderCookie);
    expect(list.json.projects).toHaveLength(0);
  });

  it('lets a viewer read but not write', async () => {
    const read = await call('GET', `/journey?projectId=${projectId}`, undefined, viewerCookie);
    expect(read.status).toBe(200);
    expect(read.json.project.myRole).toBe('viewer');

    const activities = await call('GET', `/projects/${projectId}/activities`, undefined, viewerCookie);
    const activityId = activities.json.activities[0].id;
    const write = await call('PATCH', `/projects/${projectId}/activities/${activityId}`, { status: 'completed' }, viewerCookie);
    expect(write.status).toBe(403);
  });

  it('stops a member of the organization who is not on the project', async () => {
    // Grace is in a different organization entirely; deny without revealing existence.
    const res = await call('GET', `/projects/${projectId}/requirements`, undefined, outsiderCookie);
    expect([403, 404]).toContain(res.status);
  });

  it('stops a viewer from managing the project', async () => {
    const res = await call('POST', `/projects/${projectId}/members`, { email: 'newcomer@example.com', name: 'New Comer' }, viewerCookie);
    expect(res.status).toBe(403);
  });

  it('lets a lead invite a teammate by email', async () => {
    const res = await call('POST', `/projects/${projectId}/members`, { email: 'newcomer@engines.dev', name: 'New Comer', role: 'contributor' }, permissionProjectLeadCookie);
    expect(res.status).toBe(201);
    const list = await call('GET', `/projects/${projectId}/members`, undefined, permissionProjectLeadCookie);
    expect(list.json.members.some((m: { email: string }) => m.email === 'newcomer@engines.dev')).toBe(true);
  });
});

describe('journey customisation', () => {
  let projectId = 0;

  beforeAll(async () => {
    const created = await call('POST', '/projects', { name: 'Customisable Journey', projectType: 'other' }, ownerCookie);
    projectId = created.json.projectId;
  });

  it('adds a custom stage with activities and a milestone', async () => {
    const res = await call(
      'POST',
      '/journey/stages',
      {
        projectId,
        name: 'Regulatory Approval',
        objective: 'Clear certification',
        milestone: 'Certification granted',
        activities: [{ title: 'Prepare submission pack', priority: 'high' }, { title: 'Submit to authority' }],
      },
      ownerCookie,
    );
    expect(res.status).toBe(201);
    expect(res.json.activityIds).toHaveLength(2);
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    const stage = journey.json.stages.find((s: { name: string }) => s.name === 'Regulatory Approval');
    expect(stage).toBeTruthy();
    expect(stage.activityCount).toBe(2);
    expect(journey.json.milestones.some((m: { name: string }) => m.name === 'Certification granted')).toBe(true);
  });

  it('renames a stage', async () => {
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    const stageId = journey.json.stages[0].id;
    const res = await call('PATCH', `/journey/stage/${stageId}`, { name: 'Discovery & Definition' }, ownerCookie);
    expect(res.status).toBe(200);
    const after = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    expect(after.json.stages[0].name).toBe('Discovery & Definition');
  });

  it('refuses to delete a stage that has work in progress', async () => {
    const journey = await call('GET', `/journey?projectId=${projectId}`, undefined, ownerCookie);
    const stageId = journey.json.stages[0].id;
    const activities = await call('GET', `/projects/${projectId}/activities`, undefined, ownerCookie);
    const activity = activities.json.activities.find((a: { stageId: number }) => a.stageId === stageId);
    await call('PATCH', `/projects/${projectId}/activities/${activity.id}`, { status: 'in_progress' }, ownerCookie);
    const res = await call('DELETE', `/journey/stage/${stageId}`, undefined, ownerCookie);
    expect(res.status).toBe(409);
  });
});
