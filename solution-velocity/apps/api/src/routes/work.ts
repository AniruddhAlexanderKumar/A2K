import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { requireProjectAccess, requireUser } from '../lib/access.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { logActivity } from '../lib/journey.js';
import { nextRequirementRef, syncMilestoneForStage } from '../ai/actions.js';

/** Mounted at /api/projects/:projectId — every handler is project-scoped. */
export const workRoutes = Router({ mergeParams: true });

function pid(req: import('express').Request): number {
  const id = Number(req.params.projectId);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Project not found');
  return id;
}

async function ctx(req: import('express').Request, minimum: 'view' | 'write' | 'manage' = 'view') {
  const user = requireUser(req);
  const projectId = pid(req);
  const access = await requireProjectAccess(req.db, user, projectId, minimum);
  return { user, projectId, access, db: req.db };
}

const dateish = z.union([z.string(), z.null()]).optional();

/* ------------------------------------------------------------------ */
/* Activities                                                          */
/* ------------------------------------------------------------------ */

workRoutes.get('/activities', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db
      .selectFrom('activities')
      .leftJoin('users', 'users.id', 'activities.assigneeId')
      .selectAll('activities')
      .select('users.name as assigneeName')
      .where('activities.projectId', '=', projectId)
      .orderBy('activities.stageId', 'asc')
      .orderBy('activities.position', 'asc')
      .execute();
    res.json({ activities: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.get('/activities/:activityId', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const detail = await activityDetail(db, Number(req.params.activityId));
    if (detail.activity.projectId !== projectId) throw notFound('Activity not found');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

const createActivity = z.object({
  stageId: z.number().int().positive(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional().default(''),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueDate: dateish,
  milestoneId: z.number().int().positive().nullable().optional(),
});

workRoutes.post('/activities', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = createActivity.parse(req.body);
    await assertStage(db, projectId, body.stageId);
    if (body.assigneeId) await assertMember(db, projectId, body.assigneeId);
    const max = await db
      .selectFrom('activities')
      .select((eb) => eb.fn.max('position').as('m'))
      .where('stageId', '=', body.stageId)
      .executeTakeFirst();
    const created = await db
      .insertInto('activities')
      .values({
        projectId,
        stageId: body.stageId,
        milestoneId: body.milestoneId ?? null,
        title: body.title,
        description: body.description ?? '',
        priority: body.priority ?? 'medium',
        assigneeId: body.assigneeId ?? null,
        dueDate: parseDate(body.dueDate),
        position: Number(max?.m ?? 0) + 1,
        createdById: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Activity "${body.title}" added`,
      entityType: 'activity',
      entityId: created.id,
    });
    res.status(201).json({ activityId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the activity details', err.issues));
    next(err);
  }
});

const patchActivity = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  status: z.enum(['not_started', 'in_progress', 'blocked', 'in_review', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueDate: dateish,
  blockedReason: z.string().trim().max(1000).nullable().optional(),
  stageId: z.number().int().positive().optional(),
  position: z.number().int().min(0).optional(),
});

workRoutes.patch('/activities/:activityId', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const activityId = Number(req.params.activityId);
    const existing = await assertActivity(db, projectId, activityId);
    const body = patchActivity.parse(req.body);
    if (body.assigneeId) await assertMember(db, projectId, body.assigneeId);
    if (body.stageId) await assertStage(db, projectId, body.stageId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.assigneeId !== undefined) patch.assigneeId = body.assigneeId;
    if (body.dueDate !== undefined) patch.dueDate = parseDate(body.dueDate);
    if (body.stageId !== undefined) patch.stageId = body.stageId;
    if (body.position !== undefined) patch.position = body.position;
    if (body.status !== undefined) {
      patch.status = body.status;
      if (body.status === 'completed') patch.completedAt = new Date();
      if (body.status !== 'completed') patch.completedAt = null;
      if (body.status === 'blocked') {
        patch.blockedReason = body.blockedReason ?? existing.blockedReason ?? 'Blocked — reason not recorded';
      } else {
        patch.blockedReason = null;
      }
    } else if (body.blockedReason !== undefined) {
      patch.blockedReason = body.blockedReason;
    }

    // A blocked activity cannot be completed without clearing the blocker.
    if (body.status === 'completed' && existing.status === 'blocked' && !body.blockedReason) {
      patch.status = 'completed';
      patch.blockedReason = null;
    }

    await db.updateTable('activities').set(patch).where('id', '=', activityId).execute();

    // A dependency gate: an activity whose prerequisites are unmet cannot start.
    if (body.status && body.status !== 'not_started' && body.status !== 'blocked') {
      const unmet = await unmetDependencies(db, projectId, activityId);
      if (unmet.length > 0 && body.status !== 'completed') {
        await db
          .updateTable('activities')
          .set({ status: 'blocked', blockedReason: `Waiting on: ${unmet.join(', ')}`, updatedAt: new Date() })
          .where('id', '=', activityId)
          .execute();
        await logActivity(db, {
          projectId,
          actorId: user.id,
          verb: 'blocked',
          summary: `"${existing.title}" blocked by unmet dependencies`,
          entityType: 'activity',
          entityId: activityId,
        });
        res.json({ ok: true, blocked: true, reason: `Waiting on: ${unmet.join(', ')}` });
        return;
      }
    }

    const stageId = (patch.stageId as number | undefined) ?? existing.stageId;
    await syncMilestoneForStage(db, projectId, stageId, user.id);

    if (body.status) {
      await logActivity(db, {
        projectId,
        actorId: user.id,
        verb: body.status === 'completed' ? 'completed' : 'updated',
        summary:
          body.status === 'completed'
            ? `"${existing.title}" completed`
            : `"${existing.title}" moved to ${body.status.replace(/_/g, ' ')}`,
        entityType: 'activity',
        entityId: activityId,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the activity details', err.issues));
    next(err);
  }
});

workRoutes.delete('/activities/:activityId', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'manage');
    const activityId = Number(req.params.activityId);
    const existing = await assertActivity(db, projectId, activityId);
    if (existing.status === 'completed') {
      throw conflict('Completed work is part of the project record. Archive it instead of deleting.');
    }
    await db.deleteFrom('activities').where('id', '=', activityId).execute();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'deleted',
      summary: `Activity "${existing.title}" removed`,
      entityType: 'activity',
      entityId: activityId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Requirements                                                        */
/* ------------------------------------------------------------------ */

workRoutes.get('/requirements', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db
      .selectFrom('requirements')
      .leftJoin('users', 'users.id', 'requirements.ownerId')
      .selectAll('requirements')
      .select('users.name as ownerName')
      .where('requirements.projectId', '=', projectId)
      .orderBy('requirements.ref', 'asc')
      .execute();
    res.json({ requirements: rows });
  } catch (err) {
    next(err);
  }
});

const requirementBody = z.object({
  title: z.string().trim().min(2).max(200),
  statement: z.string().trim().max(4000).optional().default(''),
  type: z.enum(['functional', 'non_functional', 'constraint', 'interface', 'safety']).optional().default('functional'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  status: z.enum(['draft', 'proposed', 'approved', 'rejected', 'implemented', 'verified']).optional().default('draft'),
  stageId: z.number().int().positive().nullable().optional(),
  activityId: z.number().int().positive().nullable().optional(),
  verificationMethod: z.string().trim().max(400).nullable().optional(),
});

workRoutes.post('/requirements', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = requirementBody.parse(req.body);
    if (body.stageId) await assertStage(db, projectId, body.stageId);
    if (body.activityId) await assertActivity(db, projectId, body.activityId);
    const ref = await nextRequirementRef(db, projectId);
    const created = await db
      .insertInto('requirements')
      .values({
        projectId,
        stageId: body.stageId ?? null,
        activityId: body.activityId ?? null,
        ref,
        title: body.title,
        statement: body.statement ?? '',
        type: body.type ?? 'functional',
        priority: body.priority ?? 'medium',
        status: body.status ?? 'draft',
        ownerId: user.id,
        verificationMethod: body.verificationMethod ?? null,
        source: 'manual',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Requirement ${ref} added`,
      entityType: 'requirement',
      entityId: created.id,
    });
    res.status(201).json({ requirementId: created.id, ref });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the requirement details', err.issues));
    next(err);
  }
});

workRoutes.patch('/requirements/:id', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const id = Number(req.params.id);
    const existing = await assertRequirement(db, projectId, id);
    const body = requirementBody.partial().extend({ stageId: z.number().int().positive().nullable().optional() }).parse(req.body);
    if (body.stageId) await assertStage(db, projectId, body.stageId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['title', 'statement', 'type', 'priority', 'status', 'stageId', 'verificationMethod'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    await db.updateTable('requirements').set(patch).where('id', '=', id).execute();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'updated',
      summary: `Requirement ${existing.ref} updated`,
      entityType: 'requirement',
      entityId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the requirement details', err.issues));
    next(err);
  }
});

workRoutes.delete('/requirements/:id', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'manage');
    const id = Number(req.params.id);
    const existing = await assertRequirement(db, projectId, id);
    await db.deleteFrom('requirements').where('id', '=', id).execute();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'deleted',
      summary: `Requirement ${existing.ref} removed`,
      entityType: 'requirement',
      entityId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

workRoutes.get('/documents', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db
      .selectFrom('documents')
      .leftJoin('users', 'users.id', 'documents.ownerId')
      .selectAll('documents')
      .select('users.name as ownerName')
      .where('documents.projectId', '=', projectId)
      .orderBy('documents.updatedAt', 'desc')
      .execute();
    res.json({ documents: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.get('/documents/:id', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const doc = await db
      .selectFrom('documents')
      .leftJoin('users', 'users.id', 'documents.ownerId')
      .selectAll('documents')
      .select('users.name as ownerName')
      .where('documents.id', '=', Number(req.params.id))
      .where('documents.projectId', '=', projectId)
      .executeTakeFirst();
    if (!doc) throw notFound('Document not found');
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
});

const documentBody = z.object({
  title: z.string().trim().min(2).max(200),
  kind: z.enum(['document', 'specification', 'report', 'test_plan', 'design', 'minutes']).optional().default('document'),
  content: z.string().max(200000).optional().default(''),
  stageId: z.number().int().positive().nullable().optional(),
  activityId: z.number().int().positive().nullable().optional(),
  deliverableId: z.number().int().positive().nullable().optional(),
});

workRoutes.post('/documents', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = documentBody.parse(req.body);
    if (body.stageId) await assertStage(db, projectId, body.stageId);
    if (body.activityId) await assertActivity(db, projectId, body.activityId);
    const created = await db
      .insertInto('documents')
      .values({
        projectId,
        stageId: body.stageId ?? null,
        activityId: body.activityId ?? null,
        title: body.title,
        kind: body.kind ?? 'document',
        content: body.content ?? '',
        ownerId: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (body.deliverableId) {
      const deliverable = await db
        .selectFrom('deliverables')
        .select('id')
        .where('id', '=', body.deliverableId)
        .where('projectId', '=', projectId)
        .executeTakeFirst();
      if (deliverable) {
        await db
          .updateTable('deliverables')
          .set({ documentId: created.id, status: 'in_review', updatedAt: new Date() })
          .where('id', '=', body.deliverableId)
          .execute();
      }
    }
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Document "${body.title}" added`,
      entityType: 'document',
      entityId: created.id,
    });
    res.status(201).json({ documentId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the document details', err.issues));
    next(err);
  }
});

workRoutes.patch('/documents/:id', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const id = Number(req.params.id);
    const existing = await db
      .selectFrom('documents')
      .selectAll()
      .where('id', '=', id)
      .where('projectId', '=', projectId)
      .executeTakeFirst();
    if (!existing) throw notFound('Document not found');
    const body = documentBody.partial().parse(req.body);
    if (body.stageId) await assertStage(db, projectId, body.stageId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.stageId !== undefined) patch.stageId = body.stageId;
    if (body.activityId !== undefined) patch.activityId = body.activityId;
    if (body.content !== undefined) {
      patch.content = body.content;
      patch.version = existing.version + 1;
    }
    await db.updateTable('documents').set(patch).where('id', '=', id).execute();
    if (Object.keys(patch).length > 1) {
      await logActivity(db, {
        projectId,
        actorId: user.id,
        verb: 'updated',
        summary: `Document "${body.title ?? existing.title}" updated`,
        entityType: 'document',
        entityId: id,
      });
    }
    res.json({ ok: true, version: patch.version ?? existing.version });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the document details', err.issues));
    next(err);
  }
});

workRoutes.delete('/documents/:id', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'manage');
    const id = Number(req.params.id);
    await db.deleteFrom('documents').where('id', '=', id).where('projectId', '=', projectId).execute();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'deleted',
      summary: 'Document removed',
      entityType: 'document',
      entityId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Deliverables                                                        */
/* ------------------------------------------------------------------ */

workRoutes.get('/deliverables', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db
      .selectFrom('deliverables')
      .leftJoin('users', 'users.id', 'deliverables.ownerId')
      .selectAll('deliverables')
      .select('users.name as ownerName')
      .where('deliverables.projectId', '=', projectId)
      .execute();
    res.json({ deliverables: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.post('/deliverables', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = z
      .object({
        activityId: z.number().int().positive(),
        title: z.string().trim().min(2).max(200),
        kind: z.enum(['specification', 'design', 'document', 'report', 'test_plan', 'prototype']).optional().default('document'),
        dueDate: dateish,
        ownerId: z.number().int().positive().nullable().optional(),
        documentId: z.number().int().positive().nullable().optional(),
        artifactId: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body);
    const activity = await assertActivity(db, projectId, body.activityId);
    const created = await db
      .insertInto('deliverables')
      .values({
        projectId,
        stageId: activity.stageId,
        activityId: activity.id,
        title: body.title,
        kind: body.kind ?? 'document',
        ownerId: body.ownerId ?? user.id,
        dueDate: parseDate(body.dueDate),
        documentId: body.documentId ?? null,
        artifactId: body.artifactId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Deliverable "${body.title}" added to "${activity.title}"`,
      entityType: 'deliverable',
      entityId: created.id,
    });
    res.status(201).json({ deliverableId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the deliverable details', err.issues));
    next(err);
  }
});

workRoutes.patch('/deliverables/:id', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const id = Number(req.params.id);
    const existing = await db
      .selectFrom('deliverables')
      .selectAll()
      .where('id', '=', id)
      .where('projectId', '=', projectId)
      .executeTakeFirst();
    if (!existing) throw notFound('Deliverable not found');
    const body = z
      .object({
        title: z.string().trim().min(2).max(200).optional(),
        status: z.enum(['draft', 'in_review', 'approved', 'superseded']).optional(),
        kind: z.enum(['specification', 'design', 'document', 'report', 'test_plan', 'prototype']).optional(),
        dueDate: dateish,
        ownerId: z.number().int().positive().nullable().optional(),
        documentId: z.number().int().positive().nullable().optional(),
        artifactId: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['title', 'status', 'kind', 'ownerId', 'documentId', 'artifactId'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.dueDate !== undefined) patch.dueDate = parseDate(body.dueDate);
    await db.updateTable('deliverables').set(patch).where('id', '=', id).execute();
    if (body.status) {
      await logActivity(db, {
        projectId,
        actorId: user.id,
        verb: 'updated',
        summary: `Deliverable "${existing.title}" marked ${body.status.replace('_', ' ')}`,
        entityType: 'deliverable',
        entityId: id,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the deliverable details', err.issues));
    next(err);
  }
});

workRoutes.delete('/deliverables/:id', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req, 'write');
    await db
      .deleteFrom('deliverables')
      .where('id', '=', Number(req.params.id))
      .where('projectId', '=', projectId)
      .where('status', '=', 'draft')
      .execute();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Reviews & approvals                                                 */
/* ------------------------------------------------------------------ */

workRoutes.get('/reviews', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db
      .selectFrom('reviews')
      .leftJoin('users as requester', 'requester.id', 'reviews.requestedById')
      .leftJoin('users as reviewer', 'reviewer.id', 'reviews.reviewerId')
      .selectAll('reviews')
      .select(['requester.name as requestedByName', 'reviewer.name as reviewerName'])
      .where('reviews.projectId', '=', projectId)
      .orderBy('reviews.id', 'desc')
      .execute();
    res.json({ reviews: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.post('/reviews', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = z
      .object({
        title: z.string().trim().min(2).max(200),
        kind: z.enum(['review', 'approval']).optional().default('review'),
        activityId: z.number().int().positive().nullable().optional(),
        deliverableId: z.number().int().positive().nullable().optional(),
        reviewerId: z.number().int().positive().nullable().optional(),
        note: z.string().trim().max(2000).optional().default(''),
      })
      .parse(req.body);
    let stageId: number | null = null;
    if (body.activityId) {
      const activity = await assertActivity(db, projectId, body.activityId);
      stageId = activity.stageId;
    }
    if (body.reviewerId) await assertMember(db, projectId, body.reviewerId);
    const created = await db
      .insertInto('reviews')
      .values({
        projectId,
        stageId,
        activityId: body.activityId ?? null,
        deliverableId: body.deliverableId ?? null,
        title: body.title,
        kind: body.kind ?? 'review',
        requestedById: user.id,
        reviewerId: body.reviewerId ?? null,
        note: body.note ?? '',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (body.activityId) {
      await db
        .updateTable('activities')
        .set({ status: 'in_review', updatedAt: new Date() })
        .where('id', '=', body.activityId)
        .execute();
    }
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'requested',
      summary: `${body.kind === 'approval' ? 'Approval' : 'Review'} requested: "${body.title}"`,
      entityType: 'review',
      entityId: created.id,
    });
    res.status(201).json({ reviewId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the review details', err.issues));
    next(err);
  }
});

workRoutes.post('/reviews/:id/decide', async (req, res, next) => {
  try {
    const { projectId, db, user, access } = await ctx(req, 'write');
    const id = Number(req.params.id);
    const review = await db
      .selectFrom('reviews')
      .selectAll()
      .where('id', '=', id)
      .where('projectId', '=', projectId)
      .executeTakeFirst();
    if (!review) throw notFound('Review not found');
    if (review.status !== 'pending') throw conflict('This review has already been decided');
    if (review.reviewerId && review.reviewerId !== user.id && !access.canManage) {
      throw forbidden('This review is assigned to another reviewer');
    }
    const body = z
      .object({
        decision: z.enum(['approved', 'changes_requested', 'cancelled']),
        note: z.string().trim().max(2000).optional().default(''),
      })
      .parse(req.body);

    await db
      .updateTable('reviews')
      .set({ status: body.decision, decisionNote: body.note ?? '', decidedAt: new Date() })
      .where('id', '=', id)
      .execute();

    if (review.activityId) {
      if (body.decision === 'approved') {
        await db
          .updateTable('activities')
          .set({ status: 'completed', completedAt: new Date(), blockedReason: null, updatedAt: new Date() })
          .where('id', '=', review.activityId)
          .execute();
      } else if (body.decision === 'changes_requested') {
        await db
          .updateTable('activities')
          .set({ status: 'in_progress', blockedReason: null, updatedAt: new Date() })
          .where('id', '=', review.activityId)
          .execute();
      }
    }
    if (review.deliverableId) {
      await db
        .updateTable('deliverables')
        .set({
          status: body.decision === 'approved' ? 'approved' : 'draft',
          updatedAt: new Date(),
        })
        .where('id', '=', review.deliverableId)
        .execute();
    }
    if (review.stageId) await syncMilestoneForStage(db, projectId, review.stageId, user.id);

    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: body.decision === 'approved' ? 'approved' : 'updated',
      summary: `"${review.title}" ${body.decision === 'approved' ? 'approved' : body.decision === 'cancelled' ? 'cancelled' : 'returned for changes'}`,
      entityType: 'review',
      entityId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the decision', err.issues));
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

workRoutes.get('/decisions', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db
      .selectFrom('decisions')
      .leftJoin('users', 'users.id', 'decisions.decidedById')
      .selectAll('decisions')
      .select('users.name as decidedByName')
      .where('decisions.projectId', '=', projectId)
      .orderBy('decisions.id', 'desc')
      .execute();
    res.json({ decisions: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.post('/decisions', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = z
      .object({
        title: z.string().trim().min(2).max(200),
        rationale: z.string().trim().max(4000).optional().default(''),
        activityId: z.number().int().positive().nullable().optional(),
        stageId: z.number().int().positive().nullable().optional(),
        status: z.enum(['approved', 'rejected', 'proposed']).optional().default('approved'),
      })
      .parse(req.body);
    let stageId = body.stageId ?? null;
    if (body.activityId) {
      const activity = await assertActivity(db, projectId, body.activityId);
      stageId = stageId ?? activity.stageId;
    }
    if (stageId) await assertStage(db, projectId, stageId);
    const created = await db
      .insertInto('decisions')
      .values({
        projectId,
        stageId,
        activityId: body.activityId ?? null,
        title: body.title,
        rationale: body.rationale ?? '',
        status: body.status ?? 'approved',
        decidedById: user.id,
        decidedAt: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'decided',
      summary: `Decision recorded: "${body.title}"`,
      entityType: 'decision',
      entityId: created.id,
    });
    res.status(201).json({ decisionId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the decision details', err.issues));
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Risks                                                               */
/* ------------------------------------------------------------------ */

workRoutes.get('/risks', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db
      .selectFrom('risks')
      .leftJoin('users', 'users.id', 'risks.ownerId')
      .selectAll('risks')
      .select('users.name as ownerName')
      .where('risks.projectId', '=', projectId)
      .execute();
    res.json({ risks: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.post('/risks', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = z
      .object({
        title: z.string().trim().min(2).max(200),
        description: z.string().trim().max(4000).optional().default(''),
        severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
        likelihood: z.enum(['low', 'medium', 'high']).optional().default('medium'),
        mitigation: z.string().trim().max(2000).optional().default(''),
        stageId: z.number().int().positive().nullable().optional(),
        activityId: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body);
    if (body.stageId) await assertStage(db, projectId, body.stageId);
    const created = await db
      .insertInto('risks')
      .values({
        projectId,
        stageId: body.stageId ?? null,
        activityId: body.activityId ?? null,
        title: body.title,
        description: body.description ?? '',
        severity: body.severity ?? 'medium',
        likelihood: body.likelihood ?? 'medium',
        mitigation: body.mitigation ?? '',
        ownerId: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Risk logged: "${body.title}"`,
      entityType: 'risk',
      entityId: created.id,
    });
    res.status(201).json({ riskId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the risk details', err.issues));
    next(err);
  }
});

workRoutes.patch('/risks/:id', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = z
      .object({
        status: z.enum(['open', 'mitigating', 'accepted', 'closed']).optional(),
        mitigation: z.string().trim().max(2000).optional(),
        severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      })
      .parse(req.body);
    const id = Number(req.params.id);
    const patch: Record<string, unknown> = {};
    for (const key of ['status', 'mitigation', 'severity'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    await db.updateTable('risks').set(patch).where('id', '=', id).where('projectId', '=', projectId).execute();
    if (body.status) {
      await logActivity(db, {
        projectId,
        actorId: user.id,
        verb: 'updated',
        summary: `Risk moved to ${body.status}`,
        entityType: 'risk',
        entityId: id,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the risk details', err.issues));
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

workRoutes.get('/milestones', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db.selectFrom('milestones').selectAll().where('projectId', '=', projectId).execute();
    res.json({ milestones: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.post('/milestones', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = z
      .object({
        name: z.string().trim().min(2).max(160),
        description: z.string().trim().max(1000).optional().default(''),
        dueDate: dateish,
        stageId: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body);
    if (body.stageId) await assertStage(db, projectId, body.stageId);
    const created = await db
      .insertInto('milestones')
      .values({
        projectId,
        stageId: body.stageId ?? null,
        name: body.name,
        description: body.description ?? '',
        dueDate: parseDate(body.dueDate),
        status: 'open',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Milestone "${body.name}" added`,
      entityType: 'milestone',
      entityId: created.id,
    });
    res.status(201).json({ milestoneId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the milestone details', err.issues));
    next(err);
  }
});

workRoutes.patch('/milestones/:id', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const id = Number(req.params.id);
    const body = z
      .object({
        name: z.string().trim().min(2).max(160).optional(),
        description: z.string().trim().max(1000).optional(),
        dueDate: dateish,
        status: z.enum(['open', 'completed', 'at_risk']).optional(),
      })
      .parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.dueDate !== undefined) patch.dueDate = parseDate(body.dueDate);
    if (body.status !== undefined) {
      patch.status = body.status;
      patch.completedAt = body.status === 'completed' ? new Date() : null;
    }
    await db.updateTable('milestones').set(patch).where('id', '=', id).where('projectId', '=', projectId).execute();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'updated',
      summary: `Milestone updated${body.status ? ` to ${body.status}` : ''}`,
      entityType: 'milestone',
      entityId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the milestone details', err.issues));
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

workRoutes.get('/dependencies', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req);
    const rows = await db.selectFrom('dependencies').selectAll().where('projectId', '=', projectId).execute();
    res.json({ dependencies: rows });
  } catch (err) {
    next(err);
  }
});

workRoutes.post('/dependencies', async (req, res, next) => {
  try {
    const { projectId, db, user } = await ctx(req, 'write');
    const body = z
      .object({
        fromType: z.enum(['activity', 'deliverable', 'milestone']).default('activity'),
        fromId: z.number().int().positive(),
        toType: z.enum(['activity', 'stage', 'milestone']).default('activity'),
        toId: z.number().int().positive(),
        note: z.string().trim().max(500).optional().default(''),
      })
      .parse(req.body);
    if (body.fromType === body.toType && body.fromId === body.toId) {
      throw badRequest('An item cannot depend on itself');
    }

    const resolve = async (type: string, id: number, label: string) => {
      const table = type === 'activity' ? 'activities' : type === 'deliverable' ? 'deliverables' : type === 'milestone' ? 'milestones' : 'journeyStages';
      const row = await db
        .selectFrom(table)
        .select('id')
        .where('id', '=', id)
        .where('projectId', '=', projectId)
        .executeTakeFirst();
      if (!row) throw badRequest(`That ${label} does not belong to this project`);
    };
    await resolve(body.fromType, body.fromId, body.fromType);
    await resolve(body.toType, body.toId, body.toType);

    // Reject dependency cycles between activities.
    if (body.fromType === 'activity' && body.toType === 'activity') {
      const all = await db
        .selectFrom('dependencies')
        .select(['fromId', 'toId'])
        .where('projectId', '=', projectId)
        .where('fromType', '=', 'activity')
        .where('toType', '=', 'activity')
        .execute();
      const graph = new Map<number, number[]>();
      for (const e of all) {
        const list = graph.get(e.fromId) ?? [];
        list.push(e.toId);
        graph.set(e.fromId, list);
      }
      const stack = [body.toId];
      const seen = new Set<number>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === body.fromId) throw conflict('That would create a circular dependency');
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const nextId of graph.get(cur) ?? []) stack.push(nextId);
      }
    }

    const created = await db
      .insertInto('dependencies')
      .values({
        projectId,
        fromType: body.fromType,
        fromId: body.fromId,
        toType: body.toType,
        toId: body.toId,
        note: body.note ?? '',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId,
      actorId: user.id,
      verb: 'linked',
      summary: 'Dependency added to the Journey',
      entityType: 'dependency',
      entityId: created.id,
    });
    res.status(201).json({ dependencyId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the dependency details', err.issues));
    next(err);
  }
});

workRoutes.delete('/dependencies/:id', async (req, res, next) => {
  try {
    const { projectId, db } = await ctx(req, 'write');
    await db
      .deleteFrom('dependencies')
      .where('id', '=', Number(req.params.id))
      .where('projectId', '=', projectId)
      .execute();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function assertStage(db: Database, projectId: number, stageId: number) {
  const stage = await db
    .selectFrom('journeyStages')
    .select(['id', 'name'])
    .where('id', '=', stageId)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  if (!stage) throw badRequest('That stage does not belong to this project');
  return stage;
}

async function assertActivity(db: Database, projectId: number, activityId: number) {
  const activity = await db
    .selectFrom('activities')
    .select(['id', 'title', 'stageId', 'status', 'blockedReason', 'projectId'])
    .where('id', '=', activityId)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  if (!activity) throw notFound('Activity not found in this project');
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
  return member;
}

async function assertRequirement(db: Database, projectId: number, id: number) {
  const req_ = await db
    .selectFrom('requirements')
    .select(['id', 'ref'])
    .where('id', '=', id)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  if (!req_) throw notFound('Requirement not found');
  return req_;
}

export async function unmetDependencies(db: Database, projectId: number, activityId: number): Promise<string[]> {
  const deps = await db
    .selectFrom('dependencies')
    .selectAll()
    .where('projectId', '=', projectId)
    .where('toType', '=', 'activity')
    .where('toId', '=', activityId)
    .execute();
  const unmet: string[] = [];
  for (const dep of deps) {
    if (dep.fromType === 'activity') {
      const a = await db.selectFrom('activities').select(['title', 'status']).where('id', '=', dep.fromId).executeTakeFirst();
      if (a && a.status !== 'completed') unmet.push(a.title);
    } else if (dep.fromType === 'deliverable') {
      const d = await db.selectFrom('deliverables').select(['title', 'status']).where('id', '=', dep.fromId).executeTakeFirst();
      if (d && d.status !== 'approved') unmet.push(d.title);
    } else if (dep.fromType === 'milestone') {
      const m = await db.selectFrom('milestones').select(['name', 'status']).where('id', '=', dep.fromId).executeTakeFirst();
      if (m && m.status !== 'completed') unmet.push(m.name);
    }
  }
  return unmet;
}

function parseDate(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  return d;
}

/** Full detail payload for one activity, including everything linked to it. */
export async function activityDetail(db: Database, activityId: number) {
  const activity = await db
    .selectFrom('activities')
    .leftJoin('users', 'users.id', 'activities.assigneeId')
    .innerJoin('journeyStages', 'journeyStages.id', 'activities.stageId')
    .selectAll('activities')
    .select([
      'users.name as assigneeName',
      'journeyStages.name as stageName',
      'journeyStages.id as stageIdJoin',
    ])
    .where('activities.id', '=', activityId)
    .executeTakeFirst();
  if (!activity) throw notFound('Activity not found');
  const projectId = activity.projectId;
  if (activity.projectId === undefined) throw notFound('Activity not found');

  const project = await db.selectFrom('projects').select(['id']).where('id', '=', projectId).executeTakeFirst();
  if (!project) throw notFound('Activity not found');

  const deliverables = await db
    .selectFrom('deliverables')
    .leftJoin('users', 'users.id', 'deliverables.ownerId')
    .selectAll('deliverables')
    .select('users.name as ownerName')
    .where('deliverables.activityId', '=', activityId)
    .execute();

  const requirements = await db
    .selectFrom('requirements')
    .leftJoin('users', 'users.id', 'requirements.ownerId')
    .selectAll('requirements')
    .select('users.name as ownerName')
    .where('requirements.activityId', '=', activityId)
    .execute();

  const documents = await db
    .selectFrom('documents')
    .leftJoin('users', 'users.id', 'documents.ownerId')
    .selectAll('documents')
    .select('users.name as ownerName')
    .where('documents.activityId', '=', activityId)
    .execute();

  const artifacts = await db
    .selectFrom('designArtifacts')
    .leftJoin('users', 'users.id', 'designArtifacts.ownerId')
    .innerJoin('journeyStages', 'journeyStages.id', 'designArtifacts.stageId')
    .selectAll('designArtifacts')
    .select([
      'users.name as ownerName',
      'journeyStages.name as stageName',
    ])
    .where('designArtifacts.activityId', '=', activityId)
    .execute();

  const reviews = await db
    .selectFrom('reviews')
    .leftJoin('users as requester', 'requester.id', 'reviews.requestedById')
    .leftJoin('users as reviewer', 'reviewer.id', 'reviews.reviewerId')
    .selectAll('reviews')
    .select(['requester.name as requestedByName', 'reviewer.name as reviewerName'])
    .where('reviews.activityId', '=', activityId)
    .execute();

  const decisions = await db
    .selectFrom('decisions')
    .leftJoin('users', 'users.id', 'decisions.decidedById')
    .selectAll('decisions')
    .select('users.name as decidedByName')
    .where('decisions.activityId', '=', activityId)
    .execute();

  const dependencies = await db
    .selectFrom('dependencies')
    .selectAll()
    .where('projectId', '=', projectId)
    .where('toType', '=', 'activity')
    .where('toId', '=', activityId)
    .execute();

  const dependents = await db
    .selectFrom('dependencies')
    .selectAll()
    .where('projectId', '=', projectId)
    .where('fromType', '=', 'activity')
    .where('fromId', '=', activityId)
    .execute();

  const history = await db
    .selectFrom('activityLog')
    .leftJoin('users', 'users.id', 'activityLog.actorId')
    .select([
      'activityLog.id',
      'activityLog.verb',
      'activityLog.summary',
      'activityLog.entityType',
      'activityLog.entityId',
      'activityLog.createdAt',
      'users.name as actorName',
    ])
    .where('activityLog.projectId', '=', projectId)
    .where('activityLog.entityType', '=', 'activity')
    .where('activityLog.entityId', '=', activityId)
    .orderBy('activityLog.id', 'desc')
    .limit(20)
    .execute();

  const names = new Map<string, { title: string; status: string }>();
  const collect = async (type: string, ids: number[]) => {
    if (ids.length === 0) return;
    if (type === 'activity') {
      const rows = await db.selectFrom('activities').select(['id', 'title', 'status']).where('id', 'in', ids).execute();
      for (const r of rows) names.set(`activity:${r.id}`, { title: r.title, status: r.status });
    } else if (type === 'deliverable') {
      const rows = await db.selectFrom('deliverables').select(['id', 'title', 'status']).where('id', 'in', ids).execute();
      for (const r of rows) names.set(`deliverable:${r.id}`, { title: r.title, status: r.status });
    } else if (type === 'milestone') {
      const rows = await db.selectFrom('milestones').select(['id', 'name', 'status']).where('id', 'in', ids).execute();
      for (const r of rows) names.set(`milestone:${r.id}`, { title: r.name, status: r.status });
    }
  };
  await collect('activity', [...dependencies.filter((d) => d.fromType === 'activity').map((d) => d.fromId), ...dependents.filter((d) => d.toType === 'activity').map((d) => d.toId)]);
  await collect('deliverable', dependencies.filter((d) => d.fromType === 'deliverable').map((d) => d.fromId));
  await collect('milestone', dependencies.filter((d) => d.fromType === 'milestone').map((d) => d.fromId));

  const edgeView = (edge: (typeof dependencies)[number]) => {
    const from = names.get(`${edge.fromType}:${edge.fromId}`) ?? { title: `${edge.fromType} #${edge.fromId}`, status: 'unknown' };
    const to = names.get(`${edge.toType}:${edge.toId}`) ?? { title: `${edge.toType} #${edge.toId}`, status: 'unknown' };
    return {
      id: edge.id,
      projectId: edge.projectId,
      fromType: edge.fromType,
      fromId: edge.fromId,
      fromTitle: from.title,
      fromStatus: from.status,
      toType: edge.toType,
      toId: edge.toId,
      toTitle: to.title,
      toStatus: to.status,
      note: edge.note,
      satisfied: from.status === 'completed' || from.status === 'approved',
    };
  };

  const counts = await Promise.all([
    db.selectFrom('deliverables').select((eb) => eb.fn.countAll().as('c')).where('activityId', '=', activityId).executeTakeFirst(),
    db.selectFrom('deliverables').select((eb) => eb.fn.countAll().as('c')).where('activityId', '=', activityId).where('status', '!=', 'approved').executeTakeFirst(),
    db.selectFrom('requirements').select((eb) => eb.fn.countAll().as('c')).where('activityId', '=', activityId).executeTakeFirst(),
    db.selectFrom('documents').select((eb) => eb.fn.countAll().as('c')).where('activityId', '=', activityId).executeTakeFirst(),
    db.selectFrom('designArtifacts').select((eb) => eb.fn.countAll().as('c')).where('activityId', '=', activityId).executeTakeFirst(),
    db.selectFrom('reviews').select((eb) => eb.fn.countAll().as('c')).where('activityId', '=', activityId).executeTakeFirst(),
    db.selectFrom('reviews').select((eb) => eb.fn.countAll().as('c')).where('activityId', '=', activityId).where('status', '=', 'pending').executeTakeFirst(),
  ]);

  const stage = await db
    .selectFrom('journeyStages')
    .select(['id', 'name'])
    .where('id', '=', activity.stageId)
    .executeTakeFirstOrThrow();

  return {
    activity: {
      id: activity.id,
      projectId,
      stageId: activity.stageId,
      milestoneId: activity.milestoneId,
      title: activity.title,
      description: activity.description,
      status: activity.status,
      priority: activity.priority,
      assigneeId: activity.assigneeId,
      assigneeName: activity.assigneeName ?? null,
      dueDate: activity.dueDate ? new Date(activity.dueDate).toISOString() : null,
      position: activity.position,
      completedAt: activity.completedAt ? new Date(activity.completedAt).toISOString() : null,
      deliverableCount: Number(counts[0]?.c ?? 0),
      openDeliverableCount: Number(counts[1]?.c ?? 0),
      requirementCount: Number(counts[2]?.c ?? 0),
      documentCount: Number(counts[3]?.c ?? 0),
      designArtifactCount: Number(counts[4]?.c ?? 0),
      reviewCount: Number(counts[5]?.c ?? 0),
      pendingReviewCount: Number(counts[6]?.c ?? 0),
      blockedReason: activity.blockedReason,
      dependencyCount: dependencies.length,
      unmetDependencyCount: dependencies.filter((d) => {
        const from = names.get(`${d.fromType}:${d.fromId}`);
        return from ? from.status !== 'completed' && from.status !== 'approved' : true;
      }).length,
      createdAt: new Date(activity.createdAt).toISOString(),
    },
    stage,
    deliverables: deliverables.map(serialiseDeliverable),
    requirements: requirements.map(serialiseRequirement),
    documents: documents.map(serialiseDocument),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      stageId: a.stageId,
      activityId: a.activityId,
      name: a.name,
      type: a.type,
      description: a.description,
      version: a.version,
      ownerId: a.ownerId,
      ownerName: a.ownerName ?? null,
      scene: a.scene,
      stageName: a.stageName ?? null,
      activityTitle: activity.title,
      createdAt: new Date(a.createdAt).toISOString(),
      updatedAt: new Date(a.updatedAt).toISOString(),
    })),
    reviews: reviews.map(serialiseReview),
    decisions: decisions.map((d) => ({
      id: d.id,
      projectId: d.projectId,
      stageId: d.stageId,
      activityId: d.activityId,
      title: d.title,
      rationale: d.rationale,
      status: d.status,
      decidedById: d.decidedById,
      decidedByName: d.decidedByName ?? null,
      decidedAt: d.decidedAt ? new Date(d.decidedAt).toISOString() : null,
      createdAt: new Date(d.createdAt).toISOString(),
    })),
    dependencies: dependencies.map(edgeView),
    dependents: dependents.map(edgeView),
    history: history.map((h) => ({
      id: h.id,
      actorName: h.actorName ?? 'Someone',
      verb: h.verb,
      summary: h.summary,
      entityType: h.entityType,
      entityId: h.entityId,
      createdAt: new Date(h.createdAt).toISOString(),
    })),
  };
}

export function serialiseDeliverable(d: {
  id: number;
  projectId: number;
  stageId: number;
  activityId: number | null;
  title: string;
  kind: string;
  status: string;
  ownerId: number | null;
  ownerName?: string | null;
  dueDate: Date | null;
  documentId: number | null;
  artifactId: number | null;
  createdAt: Date;
}) {
  return {
    id: d.id,
    projectId: d.projectId,
    stageId: d.stageId,
    activityId: d.activityId,
    title: d.title,
    kind: d.kind,
    status: d.status,
    ownerId: d.ownerId,
    ownerName: d.ownerName ?? null,
    dueDate: d.dueDate ? new Date(d.dueDate).toISOString() : null,
    documentId: d.documentId,
    artifactId: d.artifactId,
    createdAt: new Date(d.createdAt).toISOString(),
  };
}

export function serialiseRequirement(r: {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  ref: string;
  title: string;
  statement: string;
  type: string;
  priority: string;
  status: string;
  ownerId: number | null;
  ownerName?: string | null;
  verificationMethod: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    projectId: r.projectId,
    stageId: r.stageId,
    activityId: r.activityId,
    ref: r.ref,
    title: r.title,
    statement: r.statement,
    type: r.type,
    priority: r.priority,
    status: r.status,
    ownerId: r.ownerId,
    ownerName: r.ownerName ?? null,
    verificationMethod: r.verificationMethod,
    source: r.source,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

export function serialiseDocument(d: {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  title: string;
  kind: string;
  content: string;
  version: number;
  ownerId: number | null;
  ownerName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: d.id,
    projectId: d.projectId,
    stageId: d.stageId,
    activityId: d.activityId,
    title: d.title,
    kind: d.kind,
    content: d.content,
    version: d.version,
    ownerId: d.ownerId,
    ownerName: d.ownerName ?? null,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

export function serialiseReview(r: {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  deliverableId: number | null;
  title: string;
  kind: string;
  status: string;
  requestedById: number | null;
  requestedByName?: string | null;
  reviewerId: number | null;
  reviewerName?: string | null;
  note: string;
  decisionNote: string;
  createdAt: Date;
  decidedAt: Date | null;
}) {
  return {
    id: r.id,
    projectId: r.projectId,
    stageId: r.stageId,
    activityId: r.activityId,
    deliverableId: r.deliverableId,
    title: r.title,
    kind: r.kind,
    status: r.status,
    requestedById: r.requestedById,
    requestedByName: r.requestedByName ?? null,
    reviewerId: r.reviewerId,
    reviewerName: r.reviewerName ?? null,
    note: r.note,
    decisionNote: r.decisionNote,
    createdAt: new Date(r.createdAt).toISOString(),
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
  };
}

