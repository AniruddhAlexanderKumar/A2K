import type { Database } from '../db/client.js';
import {
  activityWeight,
  deriveStageStatus,
  getTemplate,
  progressFromActivities,
  type ActivityStatus,
  type Blocker,
  type JourneyMilestone,
  type JourneyPayload,
  type NextAction,
  type PendingApproval,
  type Priority,
  type ProjectMember,
  type ProjectRole,
  type ProjectSummary,
  type StageStatus,
  type StageView,
} from '@sv/shared';
import { notFound } from './errors.js';

/* ------------------------------------------------------------------ */
/* Journey creation                                                    */
/* ------------------------------------------------------------------ */

export type CreateJourneyInput = {
  projectId: number;
  templateKey: string;
  startDate?: string;
};

/**
 * Materialises a lifecycle template into rows: stages, a milestone per stage,
 * activities under each stage and the deliverable each activity is expected to produce.
 */
export async function instantiateJourney(db: Database, input: CreateJourneyInput): Promise<number> {
  const template = getTemplate(input.templateKey);
  const project = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where('id', '=', input.projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project not found');

  const journey = await db
    .insertInto('journeys')
    .values({ projectId: input.projectId, name: `${project.name} Journey`, templateKey: template.key })
    .returning('id')
    .executeTakeFirstOrThrow();

  const start = input.startDate ? new Date(input.startDate) : new Date();
  let prevMilestoneId: number | null = null;

  for (let s = 0; s < template.stages.length; s += 1) {
    const seed = template.stages[s];
    const stage = await db
      .insertInto('journeyStages')
      .values({
        journeyId: journey.id,
        projectId: input.projectId,
        key: seed.key,
        name: seed.name,
        description: seed.description,
        objective: seed.objective,
        position: s,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const dueDate = new Date(start);
    dueDate.setDate(dueDate.getDate() + (s + 1) * 21);

    const milestone = await db
      .insertInto('milestones')
      .values({
        projectId: input.projectId,
        stageId: stage.id,
        name: seed.milestone,
        description: seed.objective,
        dueDate,
        status: 'open',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    for (let a = 0; a < seed.activities.length; a += 1) {
      const act = seed.activities[a];
      const activity = await db
        .insertInto('activities')
        .values({
          projectId: input.projectId,
          stageId: stage.id,
          milestoneId: milestone.id,
          title: act.title,
          description: act.description,
          priority: act.priority,
          position: a,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (act.deliverable) {
        await db
          .insertInto('deliverables')
          .values({
            projectId: input.projectId,
            stageId: stage.id,
            activityId: activity.id,
            title: act.deliverable.title,
            kind: act.deliverable.kind,
            status: 'draft',
          })
          .execute();
      }
    }

    // Sequential stage dependency: a stage is unlocked by the previous stage's milestone.
    if (prevMilestoneId !== null) {
      await db
        .insertInto('dependencies')
        .values({
          projectId: input.projectId,
          fromType: 'milestone',
          fromId: prevMilestoneId,
          toType: 'stage',
          toId: stage.id,
          note: 'Previous stage milestone must complete',
        })
        .execute();
    }
    prevMilestoneId = milestone.id;
  }

  return journey.id;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listProjectsForUser(db: Database, userId: number, organizationId: number) {
  const projects = await db
    .selectFrom('projects')
    .innerJoin('users', 'users.id', 'projects.ownerId')
    .select([
      'projects.id',
      'projects.name',
      'projects.code',
      'projects.description',
      'projects.projectType',
      'projects.status',
      'projects.templateKey',
      'projects.ownerId',
      'users.name as ownerName',
      'projects.updatedAt',
      'projects.createdAt',
    ])
    .where('projects.organizationId', '=', organizationId)
    .where('projects.archivedAt', 'is', null)
    .orderBy('projects.updatedAt', 'desc')
    .execute();

  if (projects.length === 0) return [] as ProjectSummary[];

  const ids = projects.map((p) => p.id);
  const memberships = await db
    .selectFrom('projectMembers')
    .select(['projectId', 'userId', 'role'])
    .where('projectId', 'in', ids)
    .execute();
  const myMembership = new Map(memberships.filter((m) => m.userId === userId).map((m) => [m.projectId, m.role]));
  const memberCounts = new Map<number, number>();
  for (const m of memberships) memberCounts.set(m.projectId, (memberCounts.get(m.projectId) ?? 0) + 1);

  const activities = await db
    .selectFrom('activities')
    .select(['projectId', 'stageId', 'status', 'priority'])
    .where('projectId', 'in', ids)
    .execute();
  const stages = await db
    .selectFrom('journeyStages')
    .select(['id', 'projectId', 'position', 'name'])
    .where('projectId', 'in', ids)
    .orderBy('position', 'asc')
    .execute();
  const pendingReviews = await db
    .selectFrom('reviews')
    .select(['projectId'])
    .where('projectId', 'in', ids)
    .where('status', '=', 'pending')
    .execute();
  const templateNames = new Map<string, string>();

  return projects.map((p): ProjectSummary => {
    const acts = activities.filter((a) => a.projectId === p.id);
    const projectStages = stages.filter((s) => s.projectId === p.id);
    const progress = progressFromActivities(
      acts.map((a) => ({ status: a.status as ActivityStatus, priority: a.priority as Priority })),
    );
    const byStage = new Map<number, typeof acts>();
    for (const a of acts) {
      const list = byStage.get(a.stageId) ?? [];
      list.push(a);
      byStage.set(a.stageId, list);
    }
    const current = projectStages.find((s) => {
      const list = byStage.get(s.id) ?? [];
      return list.length === 0 || !list.every((a) => a.status === 'completed');
    });
    if (!templateNames.has(p.templateKey)) {
      templateNames.set(p.templateKey, getTemplate(p.templateKey).name);
    }
    const role: ProjectRole =
      myMembership.get(p.id) ??
      (projects.find((x) => x.id === p.id)?.ownerId === userId ? 'lead' : 'viewer');
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      projectType: p.projectType,
      status: p.status,
      templateKey: p.templateKey,
      templateName: templateNames.get(p.templateKey) ?? 'Flexible',
      ownerId: p.ownerId,
      ownerName: p.ownerName,
      memberCount: memberCounts.get(p.id) ?? 0,
      myRole: role,
      progress,
      currentStageName: current?.name ?? null,
      currentStageId: current?.id ?? null,
      openBlockers: acts.filter((a) => a.status === 'blocked').length,
      pendingApprovals: pendingReviews.filter((r) => r.projectId === p.id).length,
      updatedAt: new Date(p.updatedAt).toISOString(),
      createdAt: new Date(p.createdAt).toISOString(),
    };
  });
}

export async function loadJourney(db: Database, projectId: number, userId: number): Promise<JourneyPayload> {
  const projectRow = await db
    .selectFrom('projects')
    .innerJoin('users', 'users.id', 'projects.ownerId')
    .leftJoin('journeys', 'journeys.projectId', 'projects.id')
    .select([
      'projects.id',
      'projects.name',
      'projects.code',
      'projects.description',
      'projects.projectType',
      'projects.status',
      'projects.templateKey',
      'projects.ownerId',
      'projects.updatedAt',
      'projects.createdAt',
      'users.name as ownerName',
      'journeys.id as journeyId',
      'journeys.name as journeyName',
      'journeys.templateKey as journeyTemplateKey',
      'journeys.createdAt as journeyCreatedAt',
    ])
    .where('projects.id', '=', projectId)
    .executeTakeFirst();
  if (!projectRow) throw notFound('Project not found');
  if (projectRow.journeyId == null) throw notFound('This project has no journey yet');

  const stages = await db
    .selectFrom('journeyStages')
    .selectAll()
    .where('projectId', '=', projectId)
    .orderBy('position', 'asc')
    .execute();

  const activities = await db
    .selectFrom('activities')
    .leftJoin('users', 'users.id', 'activities.assigneeId')
    .selectAll('activities')
    .select(['users.name as assigneeName'])
    .where('activities.projectId', '=', projectId)
    .orderBy('activities.position', 'asc')
    .execute();

  const milestones = await db
    .selectFrom('milestones')
    .selectAll()
    .where('projectId', '=', projectId)
    .orderBy('dueDate', 'asc')
    .execute();

  const reviews = await db
    .selectFrom('reviews')
    .selectAll()
    .where('projectId', '=', projectId)
    .execute();

  const dependencyRows = await db
    .selectFrom('dependencies')
    .selectAll()
    .where('projectId', '=', projectId)
    .execute();

  const deliverables = await db
    .selectFrom('deliverables')
    .selectAll()
    .where('projectId', '=', projectId)
    .execute();

  const requirements = await db.selectFrom('requirements').selectAll().where('projectId', '=', projectId).execute();
  const documents = await db.selectFrom('documents').selectAll().where('projectId', '=', projectId).execute();
  const artifacts = await db.selectFrom('designArtifacts').selectAll().where('projectId', '=', projectId).execute();
  const risks = await db.selectFrom('risks').selectAll().where('projectId', '=', projectId).execute();
  const decisions = await db.selectFrom('decisions').selectAll().where('projectId', '=', projectId).execute();
  const members = await loadMembers(db, projectId);

  const stageDeps = dependencyRows.filter((d) => d.toType === 'stage');
  const stageBlocked = new Map<number, string>();
  for (const dep of stageDeps) {
    if (dep.fromType === 'milestone') {
      const m = milestones.find((x) => x.id === dep.fromId);
      if (m && m.status !== 'completed') {
        stageBlocked.set(dep.toId, `Waiting on milestone: ${m.name}`);
      }
    }
  }

  const activityDeps = dependencyRows.filter((d) => d.toType === 'activity');
  const unmetForActivity = new Map<number, string[]>();
  for (const dep of activityDeps) {
    let satisfied = false;
    let label = '';
    if (dep.fromType === 'activity') {
      const a = activities.find((x) => x.id === dep.fromId);
      satisfied = a?.status === 'completed';
      label = a?.title ?? `Activity #${dep.fromId}`;
    } else if (dep.fromType === 'deliverable') {
      const d = deliverables.find((x) => x.id === dep.fromId);
      satisfied = d?.status === 'approved';
      label = d?.title ?? `Deliverable #${dep.fromId}`;
    } else if (dep.fromType === 'milestone') {
      const m = milestones.find((x) => x.id === dep.fromId);
      satisfied = m?.status === 'completed';
      label = m?.name ?? `Milestone #${dep.fromId}`;
    }
    if (!satisfied) {
      const list = unmetForActivity.get(dep.toId) ?? [];
      list.push(label);
      unmetForActivity.set(dep.toId, list);
    }
  }

  const firstIncompleteStageId = (() => {
    for (const stage of stages) {
      const list = activities.filter((a) => a.stageId === stage.id);
      if (list.length === 0) return stage.id;
      if (!list.every((a) => a.status === 'completed')) return stage.id;
    }
    return null;
  })();

  const stageViews: StageView[] = stages.map((stage) => {
    const acts = activities.filter((a) => a.stageId === stage.id);
    const stageReviews = reviews.filter((r) => r.stageId === stage.id && r.status === 'pending');
    const progress = progressFromActivities(
      acts.map((a) => ({ status: a.status as ActivityStatus, priority: a.priority as Priority })),
    );
    const milestone = milestones.find((m) => m.stageId === stage.id) ?? null;
    // Only a genuine impediment marks a stage blocked; a not-yet-unlocked stage is
    // simply upcoming, with the gate explained in its hint.
    const blocked = acts.some((a) => a.status === 'blocked');
    const status = deriveStageStatus({
      activities: acts.map((a) => ({ status: a.status as ActivityStatus, priority: a.priority as Priority })),
      blocked,
      approvalPending: stageReviews.length > 0 || (!!milestone && milestone.status !== 'completed' && progress >= 1),
      isFirstIncomplete: stage.id === firstIncompleteStageId,
      gated: stageBlocked.has(stage.id),
    });
    const hint = stageHint(
      status,
      acts.length,
      acts.filter((a) => a.status === 'completed').length,
      blocked ? undefined : stageBlocked.get(stage.id),
      milestone,
    );
    return {
      id: stage.id,
      key: stage.key,
      name: stage.name,
      description: stage.description,
      objective: stage.objective,
      position: stage.position,
      status: (stage.statusOverride as StageStatus | null) ?? status,
      progress,
      activityCount: acts.length,
      completedCount: acts.filter((a) => a.status === 'completed').length,
      blockedCount: acts.filter((a) => a.status === 'blocked').length,
      pendingApprovals: stageReviews.length,
      milestone: milestone
        ? {
            id: milestone.id,
            name: milestone.name,
            description: milestone.description,
            dueDate: milestone.dueDate ? new Date(milestone.dueDate).toISOString() : null,
            status: milestone.status,
            stageId: milestone.stageId,
            completedAt: milestone.completedAt ? new Date(milestone.completedAt).toISOString() : null,
          }
        : null,
      hint,
    };
  });

  const overallProgress = progressFromActivities(
    activities.map((a) => ({ status: a.status as ActivityStatus, priority: a.priority as Priority })),
  );

  const currentStage = stageViews.find((s) => s.id === firstIncompleteStageId) ?? null;

  // Gates that are currently stopping work — only surfaced for the next stage in line.
  const phaseBlocked: Blocker[] = [...stageBlocked.entries()]
    .filter(([stageId]) => stageId === firstIncompleteStageId)
    .map(([stageId, reason], idx) => ({
      id: -(idx + 1),
      title: stages.find((s) => s.id === stageId)?.name ?? 'Stage',
      reason,
      stageName: stages.find((s) => s.id === stageId)?.name ?? '',
      owner: null,
      entity: 'activity' as const,
    }));

  const activityBlockers: Blocker[] = activities
    .filter((a) => a.status === 'blocked')
    .map((a) => ({
      id: a.id,
      title: a.title,
      reason: a.blockedReason || 'Marked as blocked',
      stageName: stages.find((s) => s.id === a.stageId)?.name ?? '',
      owner: a.assigneeName ?? null,
      entity: 'activity' as const,
    }));

  const riskBlockers: Blocker[] = risks
    .filter((r) => r.status === 'open' && (r.severity === 'critical' || r.severity === 'high'))
    .map((r) => ({
      id: r.id,
      title: r.title,
      reason: r.description || `Open ${r.severity} risk`,
      stageName: stages.find((s) => s.id === r.stageId)?.name ?? '',
      owner: null,
      entity: 'risk' as const,
    }));

  const memberNames = new Map(members.map((m) => [m.userId, m.name]));
  const pendingApprovals: PendingApproval[] = reviews
    .filter((r) => r.status === 'pending')
    .map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      stageName: stages.find((s) => s.id === r.stageId)?.name ?? 'Project',
      requestedBy: memberNames.get(r.requestedById ?? -1) ?? 'Team',
      reviewer: r.reviewerId ? (memberNames.get(r.reviewerId) ?? null) : null,
      createdAt: new Date(r.createdAt).toISOString(),
    }));

  const nextActions = buildNextActions({
    activities,
    stages,
    stageViews,
    pendingApprovals,
    activityBlockers,
    currentStageId: currentStage?.id ?? null,
    userId,
    milestones,
  });

  const now = Date.now();
  const summary: ProjectSummary = {
    id: projectRow.id,
    name: projectRow.name,
    code: projectRow.code,
    description: projectRow.description,
    projectType: projectRow.projectType,
    status: projectRow.status,
    templateKey: projectRow.templateKey,
    templateName: getTemplate(projectRow.templateKey).name,
    ownerId: projectRow.ownerId,
    ownerName: projectRow.ownerName,
    memberCount: members.length,
    myRole: (members.find((m) => m.userId === userId)?.role ?? 'lead') as ProjectRole,
    progress: overallProgress,
    currentStageName: currentStage?.name ?? null,
    currentStageId: currentStage?.id ?? null,
    openBlockers: activityBlockers.length,
    pendingApprovals: pendingApprovals.length,
    updatedAt: new Date(projectRow.updatedAt).toISOString(),
    createdAt: new Date(projectRow.createdAt).toISOString(),
  };

  return {
    project: summary,
    journey: {
      id: projectRow.journeyId,
      name: projectRow.journeyName ?? `${projectRow.name} Journey`,
      templateKey: projectRow.journeyTemplateKey ?? projectRow.templateKey,
      createdAt: projectRow.journeyCreatedAt
        ? new Date(projectRow.journeyCreatedAt).toISOString()
        : new Date(projectRow.createdAt).toISOString(),
    },
    stages: stageViews,
    milestones: milestones.map(
      (m): JourneyMilestone => ({
        id: m.id,
        name: m.name,
        description: m.description,
        dueDate: m.dueDate ? new Date(m.dueDate).toISOString() : null,
        status: m.status,
        stageId: m.stageId,
        completedAt: m.completedAt ? new Date(m.completedAt).toISOString() : null,
      }),
    ),
    members,
    nextActions,
    blockers: [...activityBlockers, ...phaseBlocked, ...riskBlockers],
    pendingApprovals,
    stats: {
      activities: activities.length,
      completed: activities.filter((a) => a.status === 'completed').length,
      inProgress: activities.filter((a) => a.status === 'in_progress').length,
      blocked: activityBlockers.length,
      overdue: activities.filter(
        (a) => a.dueDate && new Date(a.dueDate).getTime() < now && a.status !== 'completed',
      ).length,
      requirements: requirements.length,
      documents: documents.length,
      artifacts: artifacts.length,
      deliverables: deliverables.length,
      openRisks: risks.filter((r) => r.status === 'open' || r.status === 'mitigating').length,
      decisions: decisions.length,
    },
  };
}

function stageHint(
  status: StageStatus,
  total: number,
  completed: number,
  blockedReason: string | undefined,
  milestone: { name: string; status: string; dueDate: Date | null } | null,
): string {
  if (blockedReason) return blockedReason;
  if (status === 'completed') return 'Complete — milestone achieved';
  if (status === 'active') {
    if (total > 0) return `${completed} of ${total} activities complete`;
    return 'Ready to start';
  }
  if (milestone?.dueDate) {
    const days = Math.ceil((new Date(milestone.dueDate).getTime() - Date.now()) / 86400000);
    if (days >= 0) return `Next up · ${milestone.name} target in ${days} day${days === 1 ? '' : 's'}`;
    return `Next up · ${milestone.name} target passed ${Math.abs(days)} days ago`;
  }
  return 'Next up · unlocks when the previous milestone completes';
}

function buildNextActions(input: {
  activities: {
    id: number;
    title: string;
    status: string;
    stageId: number;
    priority: string;
    assigneeId: number | null;
    dueDate: Date | null;
  }[];
  stages: { id: number; name: string; position: number }[];
  stageViews: StageView[];
  pendingApprovals: PendingApproval[];
  activityBlockers: Blocker[];
  currentStageId: number | null;
  userId: number;
  milestones: { id: number; name: string; stageId: number | null; dueDate: Date | null; status: string }[];
}): NextAction[] {
  const actions: NextAction[] = [];
  const stageName = (id: number) => input.stages.find((s) => s.id === id)?.name ?? null;

  for (const approval of input.pendingApprovals.slice(0, 2)) {
    actions.push({
      kind: 'approval',
      id: approval.id,
      title: `Decision needed: ${approval.title}`,
      detail: `${approval.stageName} · requested by ${approval.requestedBy}`,
      stageId: null,
      stageName: approval.stageName,
      href: `/journey?approval=${approval.id}`,
    });
  }

  for (const blocker of input.activityBlockers.slice(0, 2)) {
    actions.push({
      kind: 'blocked',
      id: blocker.id,
      title: `Unblock: ${blocker.title}`,
      detail: blocker.reason,
      stageId: null,
      stageName: blocker.stageName,
      href: `/journey?activity=${blocker.id}`,
    });
  }

  const currentStageActivities = input.activities
    .filter((a) => a.stageId === input.currentStageId)
    .sort((a, b) => {
      const rank = { in_progress: 0, not_started: 1, blocked: 2, in_review: 3, completed: 4 } as Record<string, number>;
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    });

  for (const act of currentStageActivities) {
    if (actions.filter((a) => a.kind === 'activity').length >= 3) break;
    if (act.status === 'completed' || act.status === 'blocked') continue;
    const mine = act.assigneeId === input.userId;
    actions.push({
      kind: 'activity',
      id: act.id,
      title: act.status === 'in_progress' ? `Continue: ${act.title}` : `Start: ${act.title}`,
      detail: `${stageName(act.stageId) ?? ''}${mine ? ' · assigned to you' : ''}${
        act.dueDate ? ` · due ${new Date(act.dueDate).toLocaleDateString()}` : ''
      }`,
      stageId: act.stageId,
      stageName: stageName(act.stageId),
      href: `/journey?activity=${act.id}`,
    });
  }

  if (actions.length === 0) {
    const nextUpcoming = input.stageViews.find((s) => s.status === 'upcoming');
    if (nextUpcoming) {
      actions.push({
        kind: 'milestone',
        id: nextUpcoming.milestone?.id ?? nextUpcoming.id,
        title: `Prepare ${nextUpcoming.name}`,
        detail: nextUpcoming.objective,
        stageId: nextUpcoming.id,
        stageName: nextUpcoming.name,
        href: `/journey?stage=${nextUpcoming.id}`,
      });
    } else {
      actions.push({
        kind: 'milestone',
        id: 0,
        title: 'Every activity is complete',
        detail: 'Review completed deliverables and record decisions before closing the project.',
        stageId: null,
        stageName: null,
        href: '/journey',
      });
    }
  }
  return actions.slice(0, 5);
}

export async function loadMembers(db: Database, projectId: number): Promise<ProjectMember[]> {
  const rows = await db
    .selectFrom('projectMembers')
    .innerJoin('users', 'users.id', 'projectMembers.userId')
    .select([
      'users.id as userId',
      'users.name',
      'users.email',
      'users.avatarColor',
      'projectMembers.role',
    ])
    .where('projectMembers.projectId', '=', projectId)
    .orderBy('projectMembers.role', 'asc')
    .execute();
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    role: r.role as ProjectRole,
    avatarColor: r.avatarColor,
  }));
}

/** Progress recalculated from real state, used after any mutation that could change it. */
export async function projectProgress(db: Database, projectId: number): Promise<number> {
  const rows = await db
    .selectFrom('activities')
    .select(['status', 'priority'])
    .where('projectId', '=', projectId)
    .execute();
  return progressFromActivities(rows.map((r) => ({ status: r.status as ActivityStatus, priority: r.priority as Priority })));
}

export async function activityWeightOf(db: Database, activityId: number): Promise<number> {
  const activity = await db
    .selectFrom('activities')
    .select(['priority'])
    .where('id', '=', activityId)
    .executeTakeFirst();
  if (!activity) return 1;
  const d = await db
    .selectFrom('deliverables')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('activityId', '=', activityId)
    .executeTakeFirst();
  const r = await db
    .selectFrom('reviews')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('activityId', '=', activityId)
    .executeTakeFirst();
  return activityWeight({
    status: 'not_started',
    priority: activity.priority as Priority,
    hasDeliverable: Number(d?.c ?? 0) > 0,
    hasApproval: Number(r?.c ?? 0) > 0,
  });
}

export async function logActivity(
  db: Database,
  input: {
    projectId: number;
    actorId: number | null;
    verb: string;
    summary: string;
    entityType: string;
    entityId?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  await db
    .insertInto('activityLog')
    .values({
      projectId: input.projectId,
      actorId: input.actorId,
      verb: input.verb,
      summary: input.summary,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    })
    .execute();
  await db.updateTable('projects').set({ updatedAt: new Date() }).where('id', '=', input.projectId).execute();
}
