/**
 * Demo org + two projects so the platform can be evaluated immediately.
 *
 * This seeds *real* records through the same code paths the UI uses. It only runs once
 * (guarded by an existing-user check) and never fabricates progress that the Journey
 * could not reach itself. Set SV_SKIP_SEED=1 to start with an empty workspace and
 * register your own account.
 */
import type { Database } from './client.js';
import { getDb } from './client.js';
import { migrate } from './migrate.js';
import { hashPassword, pickAvatarColor } from '../lib/security.js';
import { instantiateJourney, logActivity } from '../lib/journey.js';
import { nextRequirementRef, syncMilestoneForStage } from '../ai/actions.js';

export const DEMO_EMAIL = 'aniruddh@solutionvelocity.dev';
export const DEMO_PASSWORD = 'JourneyFirst1';

export async function ensureSeed(db: Database): Promise<void> {
  const existing = await db.selectFrom('users').select('id').limit(1).executeTakeFirst();
  if (existing) return;

  const org = await db
    .insertInto('organizations')
    .values({ name: 'Solution Velocity', slug: 'solution-velocity' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const people = [
    { name: 'Aniruddh Alexander Kumar', email: DEMO_EMAIL, role: 'owner' as const, password: DEMO_PASSWORD },
    { name: 'Alex Mercer', email: 'alex@solutionvelocity.dev', role: 'member' as const, password: 'JourneyFirst1' },
    { name: 'Priya Raman', email: 'priya@solutionvelocity.dev', role: 'member' as const, password: 'JourneyFirst1' },
    { name: 'Tomas Vidal', email: 'tomas@solutionvelocity.dev', role: 'member' as const, password: 'JourneyFirst1' },
  ];

  const ids: Record<string, number> = {};
  for (const p of people) {
    const row = await db
      .insertInto('users')
      .values({
        organizationId: org.id,
        name: p.name,
        email: p.email,
        passwordHash: hashPassword(p.password),
        role: p.role,
        avatarColor: pickAvatarColor(p.email),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids[p.email] = row.id;
  }
  const owner = ids[DEMO_EMAIL];

  /* ---------------- Project 1: hardware ---------------- */
  const p1 = await db
    .insertInto('projects')
    .values({
      organizationId: org.id,
      name: 'Pulsed Plasma Thruster — Flight Unit',
      code: 'PPT',
      description:
        'Non-nuclear pulsed plasma propulsion unit for a 6U CubeSat. Target: 120 s specific impulse with a 1.8 kg dry mass.',
      projectType: 'hardware',
      templateKey: 'hardware_product',
      status: 'active',
      ownerId: owner,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  for (const [email, role] of [
    [DEMO_EMAIL, 'lead'],
    ['alex@solutionvelocity.dev', 'contributor'],
    ['priya@solutionvelocity.dev', 'contributor'],
    ['tomas@solutionvelocity.dev', 'viewer'],
  ] as const) {
    await db.insertInto('projectMembers').values({ projectId: p1.id, userId: ids[email], role }).execute();
  }

  await instantiateJourney(db, { projectId: p1.id, templateKey: 'hardware_product' });
  await logActivity(db, {
    projectId: p1.id,
    actorId: owner,
    verb: 'created',
    summary: 'Project "Pulsed Plasma Thruster — Flight Unit" created with the Physical Product Development journey',
    entityType: 'project',
    entityId: p1.id,
  });

  const p1Stages = await db
    .selectFrom('journeyStages')
    .selectAll()
    .where('projectId', '=', p1.id)
    .orderBy('position', 'asc')
    .execute();
  const stage = (key: string) => p1Stages.find((s) => s.key === key)!;

  const p1Activities = await db
    .selectFrom('activities')
    .selectAll()
    .where('projectId', '=', p1.id)
    .orderBy('position', 'asc')
    .execute();
  const act = (title: string) => p1Activities.find((a) => a.title.startsWith(title))!;

  // Stage 1 complete, stage 2 in flight, stage 3 has a blocker. The Journey's own
  // rules (not this script) decide what that means for progress and stage status.
  for (const title of ['Capture customer', 'Assess technical', 'Draft system-level']) {
    await db
      .updateTable('activities')
      .set({ status: 'completed', completedAt: new Date(), assigneeId: owner })
      .where('id', '=', act(title).id)
      .execute();
  }
  await syncMilestoneForStage(db, p1.id, stage('discovery').id, owner);

  await db
    .updateTable('activities')
    .set({ status: 'completed', completedAt: new Date(), assigneeId: ids['alex@solutionvelocity.dev'] })
    .where('id', '=', act('Run architecture').id)
    .execute();
  await db
    .updateTable('activities')
    .set({ status: 'in_progress', assigneeId: owner })
    .where('id', '=', act('Allocate requirements').id)
    .execute();
  await db
    .updateTable('activities')
    .set({ status: 'blocked', blockedReason: 'Subsystem mass budget from propulsion supplier is still unconfirmed', assigneeId: ids['priya@solutionvelocity.dev'] })
    .where('id', '=', act('Define preliminary interfaces').id)
    .execute();

  await db
    .updateTable('activities')
    .set({ status: 'in_progress', assigneeId: ids['alex@solutionvelocity.dev'] })
    .where('id', '=', act('Produce preliminary').id)
    .execute();

  // Requirements
  const reqSeeds = [
    { title: 'Thrust output', statement: 'The thruster shall produce a minimum of 40 µN steady-state thrust at 1 AU.', type: 'functional', priority: 'critical', status: 'approved', stageKey: 'concept' },
    { title: 'Specific impulse', statement: 'The thruster shall achieve a specific impulse of at least 120 s with PTFE propellant.', type: 'functional', priority: 'critical', status: 'approved', stageKey: 'concept' },
    { title: 'Dry mass', statement: 'The flight unit shall not exceed 1.8 kg dry mass including mounting interface.', type: 'constraint', priority: 'high', status: 'approved', stageKey: 'concept' },
    { title: 'Power interface', statement: 'The thruster shall operate from a 28 V ± 4 V bus with peak draw under 12 W.', type: 'interface', priority: 'high', status: 'proposed', stageKey: 'preliminary_design' },
    { title: 'Contamination control', statement: 'PTFE erosion products shall not impinge on adjacent solar array surfaces.', type: 'safety', priority: 'high', status: 'draft', stageKey: 'preliminary_design' },
    { title: 'Operating life', statement: 'The unit shall demonstrate 4,000 hours of cumulative operation without thrust degradation beyond 5%.', type: 'functional', priority: 'critical', status: 'draft', stageKey: 'detailed_design' },
  ];
  for (const r of reqSeeds) {
    const ref = await nextRequirementRef(db, p1.id);
    const inserted = await db
      .insertInto('requirements')
      .values({
        projectId: p1.id,
        stageId: stage(r.stageKey).id,
        ref,
        title: r.title,
        statement: r.statement,
        type: r.type,
        priority: r.priority,
        status: r.status,
        ownerId: owner,
        verificationMethod: r.type === 'functional' ? 'Test' : 'Analysis',
        source: 'manual',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (r.stageKey === 'concept') {
      await db
        .updateTable('requirements')
        .set({ activityId: act('Allocate requirements').id })
        .where('id', '=', inserted.id)
        .execute();
    }
  }

  // A real document
  await db
    .insertInto('documents')
    .values({
      projectId: p1.id,
      stageId: stage('concept').id,
      activityId: act('Run architecture').id,
      title: 'Architecture Decision Record — PPT-001',
      kind: 'specification',
      content: [
        '# ADR-001 — Propellant feed architecture',
        '',
        '**Status:** Accepted',
        '',
        '## Context',
        'Two feed architectures were considered for the flight unit: a spring-loaded PTFE bar feed and a motorised screw feed.',
        '',
        '## Decision',
        'The spring-loaded bar feed is selected for the flight unit.',
        '',
        '## Rationale',
        '- Eliminates 140 g of motor and gearbox mass against a 1.8 kg budget.',
        '- Removes a single-point electrical failure in the feed path.',
        '- Both options meet the 4,000 hour life target in analysis; the spring feed has fewer moving parts.',
        '',
        '## Consequences',
        'Feed rate cannot be adjusted in flight. The propellant bar length is therefore a fixed design variable and must be validated in the vibration test campaign.',
      ].join('\n'),
      ownerId: owner,
    })
    .execute();

  // A pending approval on the blocked stage boundary
  await db
    .insertInto('reviews')
    .values({
      projectId: p1.id,
      stageId: stage('preliminary_design').id,
      activityId: act('Produce preliminary').id,
      title: 'Preliminary mass budget approval',
      kind: 'approval',
      status: 'pending',
      requestedById: ids['alex@solutionvelocity.dev'],
      reviewerId: owner,
      note: 'Mass budget closes with 6% margin. Requesting approval before proceeding to preliminary analysis.',
    })
    .execute();

  await db
    .insertInto('risks')
    .values({
      projectId: p1.id,
      stageId: stage('preliminary_design').id,
      title: 'Capacitor supplier lead time',
      description: 'The 2 kV discharge capacitor has a 22 week lead time, which sits on the critical path to the PDR.',
      severity: 'high',
      likelihood: 'high',
      status: 'open',
      mitigation: 'Place a long-lead order before CDR and qualify a second source.',
      ownerId: owner,
    })
    .execute();

  // A design artifact linked into the Journey
  await db
    .insertInto('designArtifacts')
    .values({
      projectId: p1.id,
      stageId: stage('preliminary_design').id,
      activityId: act('Produce preliminary').id,
      name: 'PPT-001 System Layout',
      type: 'system_sketch',
      description: 'Preliminary packaging of thruster head, capacitor bank and propellant feed within the 6U envelope.',
      scene: JSON.stringify({
        width: 1200,
        height: 800,
        shapes: [
          { id: 's1', kind: 'rect', x: 80, y: 120, w: 300, h: 180, label: 'Thruster head', color: '#31567a' },
          { id: 's2', kind: 'rect', x: 460, y: 120, w: 260, h: 180, label: 'Capacitor bank', color: '#2f6f5e' },
          { id: 's3', kind: 'rect', x: 800, y: 120, w: 240, h: 180, label: 'Propellant feed', color: '#7a4a2f' },
          { id: 's4', kind: 'arrow', x: 380, y: 210, w: 80, h: 0, label: 'HV', color: '#5b6b7a' },
          { id: 's5', kind: 'arrow', x: 720, y: 210, w: 80, h: 0, label: 'PTFE', color: '#5b6b7a' },
          { id: 's6', kind: 'note', x: 80, y: 400, w: 560, h: 220, label: 'Constraint: total mass ≤ 1.8 kg. Current estimate 1.69 kg (6% margin). Mounting interface at 4× M4 on 60 mm square pattern.', color: '#8a7a3f' },
          { id: 's7', kind: 'ellipse', x: 760, y: 420, w: 300, h: 200, label: 'Radiator surface', color: '#5b4a8a' },
        ],
      }),
      ownerId: owner,
    })
    .execute();

  /* ---------------- Project 2: software ---------------- */
  const p2 = await db
    .insertInto('projects')
    .values({
      organizationId: org.id,
      name: 'Velocity Console',
      code: 'VC',
      description: 'Customer-facing console where engineering teams track requirement traceability across a development journey.',
      projectType: 'software',
      templateKey: 'software_product',
      status: 'active',
      ownerId: owner,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  for (const [email, role] of [
    [DEMO_EMAIL, 'lead'],
    ['priya@solutionvelocity.dev', 'contributor'],
  ] as const) {
    await db.insertInto('projectMembers').values({ projectId: p2.id, userId: ids[email], role }).execute();
  }
  await instantiateJourney(db, { projectId: p2.id, templateKey: 'software_product' });
  await logActivity(db, {
    projectId: p2.id,
    actorId: owner,
    verb: 'created',
    summary: 'Project "Velocity Console" created with the Software Product Development journey',
    entityType: 'project',
    entityId: p2.id,
  });

  const p2Stages = await db
    .selectFrom('journeyStages')
    .selectAll()
    .where('projectId', '=', p2.id)
    .orderBy('position', 'asc')
    .execute();
  const p2Acts = await db
    .selectFrom('activities')
    .selectAll()
    .where('projectId', '=', p2.id)
    .orderBy('position', 'asc')
    .execute();
  const p2Discovery = p2Stages.find((s) => s.key === 'discovery')!;
  for (const a of p2Acts.filter((x) => x.stageId === p2Discovery.id)) {
    await db
      .updateTable('activities')
      .set({ status: 'completed', completedAt: new Date(), assigneeId: owner })
      .where('id', '=', a.id)
      .execute();
  }
  await syncMilestoneForStage(db, p2.id, p2Discovery.id, owner);

  const p2Arch = p2Stages.find((s) => s.key === 'architecture')!;
  const archFirst = p2Acts.find((a) => a.stageId === p2Arch.id);
  if (archFirst) {
    await db
      .updateTable('activities')
      .set({ status: 'in_progress', assigneeId: ids['priya@solutionvelocity.dev'] })
      .where('id', '=', archFirst.id)
      .execute();
  }

  console.log(`[seed] demo workspace ready — sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

// Allow `npm run seed` from the workspace.
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const db = await getDb();
  await migrate(db);
  await ensureSeed(db);
  process.exit(0);
}
