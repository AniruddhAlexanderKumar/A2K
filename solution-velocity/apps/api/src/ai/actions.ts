/**
 * Applying assistant-proposed actions.
 *
 * Every action is re-validated against the project (IDs must belong to the same
 * project) and against the caller's project role. An action can only ever write
 * into the project it was proposed for.
 */
import type { Database } from '../db/client.js';
import type { AuthUser } from '../lib/access.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logActivity } from '../lib/journey.js';
import type { AssistantActionType } from '@sv/shared';

export type ApplyResult = { entityType: string; entityId: number; summary: string };

type Payload = Record<string, unknown>;

const str = (v: unknown, field: string, max = 400): string => {
  if (typeof v !== 'string' || v.trim().length === 0) throw badRequest(`"${field}" is required`);
  if (v.length > max) throw badRequest(`"${field}" is too long`);
  return v.trim();
};
const optionalStr = (v: unknown, field: string, max = 4000): string => {
  if (v == null) return '';
  if (typeof v !== 'string') throw badRequest(`"${field}" must be text`);
  return v.slice(0, max);
};
const optionalId = (v: unknown, field: string): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`"${field}" must be a valid id`);
  return n;
};
const requiredId = (v: unknown, field: string): number => {
  const id = optionalId(v, field);
  if (id == null) throw badRequest(`"${field}" is required`);
  return id;
};

async function assertStageInProject(db: Database, projectId: number, stageId: number | null) {
  if (stageId == null) return;
  const stage = await db
    .selectFrom('journeyStages')
    .select('id')
    .where('id', '=', stageId)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  if (!stage) throw badRequest('That stage does not belong to this project');
}

async function assertActivityInProject(db: Database, projectId: number, activityId: number) {
  const activity = await db
    .selectFrom('activities')
    .select(['id', 'stageId', 'title'])
    .where('id', '=', activityId)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  if (!activity) throw badRequest('That activity does not belong to this project');
  return activity;
}

async function assertMember(db: Database, projectId: number, userId: number) {
  const member = await db
    .selectFrom('projectMembers')
    .select('userId')
    .where('projectId', '=', projectId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (!member) throw badRequest('That person is not a member of this project');
}

export async function applyAssistantAction(
  db: Database,
  input: {
    projectId: number;
    actor: AuthUser;
    actionType: string;
    payload: Payload;
  },
): Promise<ApplyResult> {
  const { projectId, actor } = input;
  const payload = input.payload ?? {};
  const type = input.actionType as AssistantActionType;

  switch (type) {
    case 'create_activity': {
      const title = str(payload.title, 'title', 200);
      const stageId = optionalId(payload.stageId, 'stageId');
      await assertStageInProject(db, projectId, stageId);
      const resolvedStage =
        stageId ??
        (
          await db
            .selectFrom('journeyStages')
            .select('id')
            .where('projectId', '=', projectId)
            .orderBy('position', 'asc')
            .executeTakeFirst()
        )?.id;
      if (!resolvedStage) throw badRequest('This project has no stages to add an activity to');
      const maxPos = await db
        .selectFrom('activities')
        .select((eb) => eb.fn.max('position').as('m'))
        .where('stageId', '=', resolvedStage)
        .executeTakeFirst();
      const inserted = await db
        .insertInto('activities')
        .values({
          projectId,
          stageId: resolvedStage,
          title,
          description: optionalStr(payload.description, 'description', 2000),
          priority: normalizeEnum(payload.priority, ['low', 'medium', 'high', 'critical'], 'medium'),
          dueDate: optionalDate(payload.dueDate),
          position: Number(maxPos?.m ?? 0) + 1,
          createdById: actor.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `Assistant added activity "${title}"`,
        entityType: 'activity',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'activity', entityId: inserted.id, summary: `Activity "${title}" created` };
    }

    case 'create_requirement': {
      const title = str(payload.title, 'title', 200);
      const stageId = optionalId(payload.stageId, 'stageId');
      const activityId = optionalId(payload.activityId, 'activityId');
      await assertStageInProject(db, projectId, stageId);
      if (activityId) await assertActivityInProject(db, projectId, activityId);
      const ref = await nextRequirementRef(db, projectId);
      const inserted = await db
        .insertInto('requirements')
        .values({
          projectId,
          stageId,
          activityId,
          ref,
          title,
          statement: optionalStr(payload.statement, 'statement', 4000) || title,
          type: normalizeEnum(payload.type, ['functional', 'non_functional', 'constraint', 'interface', 'safety'], 'functional'),
          priority: normalizeEnum(payload.priority, ['low', 'medium', 'high', 'critical'], 'medium'),
          status: normalizeEnum(payload.status, ['draft', 'proposed', 'approved', 'rejected', 'implemented', 'verified'], 'draft'),
          verificationMethod: payload.verificationMethod == null ? null : optionalStr(payload.verificationMethod, 'verificationMethod', 400),
          ownerId: actor.id,
          source: 'assistant',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `Assistant added requirement ${ref} "${title}"`,
        entityType: 'requirement',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'requirement', entityId: inserted.id, summary: `Requirement ${ref} created` };
    }

    case 'create_document': {
      const title = str(payload.title, 'title', 200);
      const stageId = optionalId(payload.stageId, 'stageId');
      const activityId = optionalId(payload.activityId, 'activityId');
      await assertStageInProject(db, projectId, stageId);
      if (activityId) await assertActivityInProject(db, projectId, activityId);
      const inserted = await db
        .insertInto('documents')
        .values({
          projectId,
          stageId,
          activityId,
          title,
          kind: normalizeEnum(payload.kind, ['document', 'specification', 'report', 'test_plan', 'design', 'minutes'], 'document'),
          content: optionalStr(payload.content, 'content', 200000),
          ownerId: actor.id,
          aiGenerated: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `Assistant drafted document "${title}"`,
        entityType: 'document',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'document', entityId: inserted.id, summary: `Document "${title}" created` };
    }

    case 'create_milestone': {
      const name = str(payload.name ?? payload.title, 'name', 200);
      const stageId = optionalId(payload.stageId, 'stageId');
      await assertStageInProject(db, projectId, stageId);
      const inserted = await db
        .insertInto('milestones')
        .values({
          projectId,
          stageId,
          name,
          description: optionalStr(payload.description, 'description', 2000),
          dueDate: optionalDate(payload.dueDate),
          status: 'open',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `Assistant added milestone "${name}"`,
        entityType: 'milestone',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'milestone', entityId: inserted.id, summary: `Milestone "${name}" created` };
    }

    case 'create_deliverable': {
      const title = str(payload.title, 'title', 200);
      const activityId = requiredId(payload.activityId, 'activityId');
      const activity = await assertActivityInProject(db, projectId, activityId);
      const inserted = await db
        .insertInto('deliverables')
        .values({
          projectId,
          stageId: activity.stageId,
          activityId,
          title,
          kind: normalizeEnum(payload.kind, ['specification', 'design', 'document', 'report', 'test_plan', 'prototype'], 'document'),
          status: 'draft',
          ownerId: optionalId(payload.ownerId, 'ownerId') ?? actor.id,
          dueDate: optionalDate(payload.dueDate),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `Assistant added deliverable "${title}"`,
        entityType: 'deliverable',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'deliverable', entityId: inserted.id, summary: `Deliverable "${title}" created` };
    }

    case 'create_risk': {
      const title = str(payload.title, 'title', 200);
      const stageId = optionalId(payload.stageId, 'stageId');
      const activityId = optionalId(payload.activityId, 'activityId');
      await assertStageInProject(db, projectId, stageId);
      if (activityId) await assertActivityInProject(db, projectId, activityId);
      const inserted = await db
        .insertInto('risks')
        .values({
          projectId,
          stageId,
          activityId,
          title,
          description: optionalStr(payload.description, 'description', 4000),
          severity: normalizeEnum(payload.severity, ['low', 'medium', 'high', 'critical'], 'medium'),
          likelihood: normalizeEnum(payload.likelihood, ['low', 'medium', 'high'], 'medium'),
          status: 'open',
          mitigation: optionalStr(payload.mitigation, 'mitigation', 2000),
          ownerId: actor.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'created',
        summary: `Assistant logged risk "${title}"`,
        entityType: 'risk',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'risk', entityId: inserted.id, summary: `Risk "${title}" logged` };
    }

    case 'assign_activity': {
      const activityId = requiredId(payload.activityId, 'activityId');
      const assigneeId = requiredId(payload.assigneeId ?? payload.userId, 'assigneeId');
      const activity = await assertActivityInProject(db, projectId, activityId);
      await assertMember(db, projectId, assigneeId);
      await db.updateTable('activities').set({ assigneeId, updatedAt: new Date() }).where('id', '=', activityId).execute();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'assigned',
        summary: `Assistant assigned "${activity.title}"`,
        entityType: 'activity',
        entityId: activityId,
        metadata: { via: 'assistant', assigneeId },
      });
      return { entityType: 'activity', entityId: activityId, summary: `"${activity.title}" reassigned` };
    }

    case 'add_dependency': {
      const fromActivityId = requiredId(payload.fromActivityId ?? payload.activityId, 'fromActivityId');
      const toActivityId = requiredId(payload.toActivityId ?? payload.dependsOnActivityId, 'toActivityId');
      if (fromActivityId === toActivityId) throw badRequest('An activity cannot depend on itself');
      const from = await assertActivityInProject(db, projectId, fromActivityId);
      const to = await assertActivityInProject(db, projectId, toActivityId);
      const existing = await db
        .selectFrom('dependencies')
        .select('id')
        .where('projectId', '=', projectId)
        .where('fromType', '=', 'activity')
        .where('fromId', '=', fromActivityId)
        .where('toType', '=', 'activity')
        .where('toId', '=', toActivityId)
        .executeTakeFirst();
      if (existing) return { entityType: 'dependency', entityId: existing.id, summary: 'Dependency already exists' };
      const inserted = await db
        .insertInto('dependencies')
        .values({
          projectId,
          fromType: 'activity',
          fromId: fromActivityId,
          toType: 'activity',
          toId: toActivityId,
          note: optionalStr(payload.note, 'note', 500) || 'Added from the AI Assistant',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'linked',
        summary: `Assistant linked "${to.title}" as a dependency of "${from.title}"`,
        entityType: 'dependency',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'dependency', entityId: inserted.id, summary: `"${to.title}" now blocks "${from.title}"` };
    }

    case 'request_approval': {
      const title = str(payload.title, 'title', 200);
      const activityId = optionalId(payload.activityId, 'activityId');
      let stageId = optionalId(payload.stageId, 'stageId');
      if (activityId) {
        const activity = await assertActivityInProject(db, projectId, activityId);
        stageId = stageId ?? activity.stageId;
      }
      await assertStageInProject(db, projectId, stageId);
      const reviewerId = optionalId(payload.reviewerId, 'reviewerId');
      if (reviewerId) await assertMember(db, projectId, reviewerId);
      const inserted = await db
        .insertInto('reviews')
        .values({
          projectId,
          stageId,
          activityId,
          title,
          kind: normalizeEnum(payload.kind, ['review', 'approval'], 'approval'),
          status: 'pending',
          requestedById: actor.id,
          reviewerId,
          note: optionalStr(payload.note, 'note', 2000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (activityId) {
        await db
          .updateTable('activities')
          .set({ status: 'in_review', updatedAt: new Date() })
          .where('id', '=', activityId)
          .where('projectId', '=', projectId)
          .execute();
      }
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'requested',
        summary: `Assistant requested approval "${title}"`,
        entityType: 'review',
        entityId: inserted.id,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'review', entityId: inserted.id, summary: `Approval "${title}" requested` };
    }

    case 'link_document_to_stage': {
      const documentId = requiredId(payload.documentId, 'documentId');
      const stageId = optionalId(payload.stageId, 'stageId');
      const activityId = optionalId(payload.activityId, 'activityId');
      await assertStageInProject(db, projectId, stageId);
      if (activityId) await assertActivityInProject(db, projectId, activityId);
      const doc = await db
        .selectFrom('documents')
        .select(['id', 'title'])
        .where('id', '=', documentId)
        .where('projectId', '=', projectId)
        .executeTakeFirst();
      if (!doc) throw notFound('Document not found in this project');
      await db
        .updateTable('documents')
        .set({ stageId, activityId, updatedAt: new Date() })
        .where('id', '=', documentId)
        .where('projectId', '=', projectId)
        .execute();
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'linked',
        summary: `Assistant linked document "${doc.title}" into the Journey`,
        entityType: 'document',
        entityId: documentId,
        metadata: { via: 'assistant', stageId, activityId },
      });
      return { entityType: 'document', entityId: documentId, summary: `"${doc.title}" linked` };
    }

    case 'complete_activity': {
      const activityId = requiredId(payload.activityId, 'activityId');
      const activity = await assertActivityInProject(db, projectId, activityId);
      await db
        .updateTable('activities')
        .set({ status: 'completed', completedAt: new Date(), blockedReason: null, updatedAt: new Date() })
        .where('id', '=', activityId)
        .execute();
      await syncMilestoneForStage(db, projectId, activity.stageId, actor.id);
      await logActivity(db, {
        projectId,
        actorId: actor.id,
        verb: 'completed',
        summary: `Assistant completed "${activity.title}"`,
        entityType: 'activity',
        entityId: activityId,
        metadata: { via: 'assistant' },
      });
      return { entityType: 'activity', entityId: activityId, summary: `"${activity.title}" completed` };
    }

    default:
      throw badRequest(`Unsupported action type: ${input.actionType}`);
  }
}

export async function nextRequirementRef(db: Database, projectId: number): Promise<string> {
  const project = await db.selectFrom('projects').select('code').where('id', '=', projectId).executeTakeFirst();
  const count = await db
    .selectFrom('requirements')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  const n = Number(count?.c ?? 0) + 1;
  return `${project?.code ?? 'REQ'}-REQ-${String(n).padStart(3, '0')}`;
}

/**
 * Milestones complete when every activity in their stage is complete. This is what
 * makes the Journey's progression reflect real completion rather than manual ticking.
 */
export async function syncMilestoneForStage(db: Database, projectId: number, stageId: number, actorId: number | null) {
  const milestone = await db
    .selectFrom('milestones')
    .select(['id', 'name', 'status'])
    .where('projectId', '=', projectId)
    .where('stageId', '=', stageId)
    .executeTakeFirst();
  if (!milestone) return;
  const counts = await db
    .selectFrom('activities')
    .select((eb) => [
      eb.fn.countAll().as('total'),
      eb.fn.count('id').filterWhere('status', '=', 'completed').as('done'),
    ])
    .where('projectId', '=', projectId)
    .where('stageId', '=', stageId)
    .executeTakeFirst();
  const total = Number(counts?.total ?? 0);
  const done = Number(counts?.done ?? 0);
  const pendingApprovals = await db
    .selectFrom('reviews')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('projectId', '=', projectId)
    .where('stageId', '=', stageId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  const approvalsPending = Number(pendingApprovals?.c ?? 0) > 0;

  if (total > 0 && done === total && !approvalsPending && milestone.status !== 'completed') {
    await db
      .updateTable('milestones')
      .set({ status: 'completed', completedAt: new Date() })
      .where('id', '=', milestone.id)
      .execute();
    await logActivity(db, {
      projectId,
      actorId,
      verb: 'achieved',
      summary: `Milestone "${milestone.name}" achieved`,
      entityType: 'milestone',
      entityId: milestone.id,
    });
  } else if ((done < total || approvalsPending) && milestone.status === 'completed') {
    await db
      .updateTable('milestones')
      .set({ status: 'open', completedAt: null })
      .where('id', '=', milestone.id)
      .execute();
  }
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function optionalDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  return d;
}
