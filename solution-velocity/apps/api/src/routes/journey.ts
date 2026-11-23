import { Router } from 'express';
import { z } from 'zod';
import { JOURNEY_TEMPLATES } from '@sv/shared';
import { requireProjectAccess, requireUser } from '../lib/access.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { instantiateJourney, loadJourney, logActivity } from '../lib/journey.js';
import { activityDetail } from './work.js';

export const journeyRoutes = Router();

async function projectIdFrom(req: import('express').Request): Promise<number> {
  const raw = req.query.projectId ?? req.params.projectId ?? req.body?.projectId;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('A project is required');
  return id;
}

/** Full journey payload: everything the Journey screen renders, for one project only. */
journeyRoutes.get('/', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = await projectIdFrom(req);
    await requireProjectAccess(req.db, user, projectId);
    const payload = await loadJourney(req.db, projectId, user.id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

journeyRoutes.get('/stage/:stageId', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const stageId = Number(req.params.stageId);
    const stage = await req.db.selectFrom('journeyStages').selectAll().where('id', '=', stageId).executeTakeFirst();
    if (!stage) throw notFound('Stage not found');
    await requireProjectAccess(req.db, user, stage.projectId);
    const activities = await req.db
      .selectFrom('activities')
      .leftJoin('users', 'users.id', 'activities.assigneeId')
      .selectAll('activities')
      .select('users.name as assigneeName')
      .where('activities.stageId', '=', stageId)
      .orderBy('activities.position', 'asc')
      .execute();
    const milestones = await req.db
      .selectFrom('milestones')
      .selectAll()
      .where('projectId', '=', stage.projectId)
      .execute();
    const deliverables = await req.db
      .selectFrom('deliverables')
      .selectAll()
      .where('projectId', '=', stage.projectId)
      .execute();
    const requirements = await req.db
      .selectFrom('requirements')
      .selectAll()
      .where('projectId', '=', stage.projectId)
      .execute();
    const documents = await req.db
      .selectFrom('documents')
      .selectAll()
      .where('projectId', '=', stage.projectId)
      .execute();
    const reviews = await req.db
      .selectFrom('reviews')
      .selectAll()
      .where('projectId', '=', stage.projectId)
      .execute();
    const artifacts = await req.db
      .selectFrom('designArtifacts')
      .selectAll()
      .where('projectId', '=', stage.projectId)
      .execute();
    res.json({
      stage,
      milestone: milestones.find((m) => m.stageId === stageId) ?? null,
      activities,
      deliverables: deliverables.filter((d) => d.stageId === stageId),
      requirements: requirements.filter((r) => r.stageId === stageId),
      documents: documents.filter((d) => d.stageId === stageId),
      reviews: reviews.filter((r) => r.stageId === stageId),
      artifacts: artifacts.filter((a) => a.stageId === stageId),
    });
  } catch (err) {
    next(err);
  }
});

journeyRoutes.get('/activity/:activityId', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const activityId = Number(req.params.activityId);
    const detail = await activityDetail(req.db, activityId);
    await requireProjectAccess(req.db, user, detail.activity.projectId);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

/** History feed for the project, shown in the Journey's activity trail. */
journeyRoutes.get('/history', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = await projectIdFrom(req);
    await requireProjectAccess(req.db, user, projectId);
    const rows = await req.db
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
      .orderBy('activityLog.id', 'desc')
      .limit(60)
      .execute();
    res.json({
      history: rows.map((r) => ({
        id: r.id,
        actorName: r.actorName ?? 'Someone',
        verb: r.verb,
        summary: r.summary,
        entityType: r.entityType,
        entityId: r.entityId,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Change the Journey shape: rename a stage, add a stage, reorder, or add
 * an activity to a stage. Customisation is per project.
 */
journeyRoutes.patch('/stage/:stageId', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const stageId = Number(req.params.stageId);
    const stage = await req.db.selectFrom('journeyStages').selectAll().where('id', '=', stageId).executeTakeFirst();
    if (!stage) throw notFound('Stage not found');
    await requireProjectAccess(req.db, user, stage.projectId, 'manage');
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().trim().max(1000).optional(),
        objective: z.string().trim().max(500).optional(),
        statusOverride: z.enum(['upcoming', 'active', 'completed', 'blocked']).nullable().optional(),
      })
      .parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.objective !== undefined) patch.objective = body.objective;
    if (body.statusOverride !== undefined) patch.statusOverride = body.statusOverride;
    if (Object.keys(patch).length > 0) {
      await req.db.updateTable('journeyStages').set(patch).where('id', '=', stageId).execute();
      await logActivity(req.db, {
        projectId: stage.projectId,
        actorId: user.id,
        verb: 'updated',
        summary: `Stage "${body.name ?? stage.name}" updated`,
        entityType: 'stage',
        entityId: stageId,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the stage details', err.issues));
    next(err);
  }
});

journeyRoutes.post('/stages', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const body = z
      .object({
        projectId: z.number().int().positive(),
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(1000).optional().default(''),
        objective: z.string().trim().max(500).optional().default(''),
        milestone: z.string().trim().max(160).optional(),
        afterStageId: z.number().int().positive().optional(),
        activities: z
          .array(
            z.object({
              title: z.string().trim().min(2).max(200),
              description: z.string().trim().max(1000).optional().default(''),
              priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
            }),
          )
          .optional()
          .default([]),
      })
      .parse(req.body);

    await requireProjectAccess(req.db, user, body.projectId, 'manage');
    const journey = await req.db
      .selectFrom('journeys')
      .select('id')
      .where('projectId', '=', body.projectId)
      .executeTakeFirst();
    if (!journey) throw notFound('This project has no journey');

    const stages = await req.db
      .selectFrom('journeyStages')
      .select(['id', 'position'])
      .where('projectId', '=', body.projectId)
      .orderBy('position', 'asc')
      .execute();
    let position = stages.length;
    if (body.afterStageId) {
      const anchor = stages.find((s) => s.id === body.afterStageId);
      if (!anchor) throw badRequest('Anchor stage not found in this project');
      position = anchor.position + 1;
      await req.db
        .updateTable('journeyStages')
        .set((eb) => ({ position: eb('position', '+', 1) }))
        .where('projectId', '=', body.projectId)
        .where('position', '>=', position)
        .execute();
    }

    const key = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '').slice(0, 40) || 'stage';
    const stage = await req.db
      .insertInto('journeyStages')
      .values({
        journeyId: journey.id,
        projectId: body.projectId,
        key,
        name: body.name,
        description: body.description ?? '',
        objective: body.objective ?? '',
        position,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (body.milestone) {
      await req.db
        .insertInto('milestones')
        .values({ projectId: body.projectId, stageId: stage.id, name: body.milestone, status: 'open' })
        .execute();
    }

    const created = [];
    for (let i = 0; i < body.activities.length; i += 1) {
      const a = body.activities[i];
      const inserted = await req.db
        .insertInto('activities')
        .values({
          projectId: body.projectId,
          stageId: stage.id,
          title: a.title,
          description: a.description ?? '',
          priority: a.priority ?? 'medium',
          position: i,
          createdById: user.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      created.push(inserted.id);
    }

    await logActivity(req.db, {
      projectId: body.projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Stage "${body.name}" added to the Journey`,
      entityType: 'stage',
      entityId: stage.id,
    });

    res.status(201).json({ stageId: stage.id, activityIds: created });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the stage details', err.issues));
    next(err);
  }
});

journeyRoutes.delete('/stage/:stageId', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const stageId = Number(req.params.stageId);
    const stage = await req.db.selectFrom('journeyStages').selectAll().where('id', '=', stageId).executeTakeFirst();
    if (!stage) throw notFound('Stage not found');
    await requireProjectAccess(req.db, user, stage.projectId, 'manage');
    const count = await req.db
      .selectFrom('journeyStages')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('projectId', '=', stage.projectId)
      .executeTakeFirst();
    if (Number(count?.c ?? 0) <= 1) throw conflict('A Journey needs at least one stage');
    const withWork = await req.db
      .selectFrom('activities')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('stageId', '=', stageId)
      .where('status', '!=', 'not_started')
      .executeTakeFirst();
    if (Number(withWork?.c ?? 0) > 0) {
      throw conflict('This stage has work in progress. Complete or move it before removing the stage.');
    }
    await req.db.deleteFrom('journeyStages').where('id', '=', stageId).execute();
    await logActivity(req.db, {
      projectId: stage.projectId,
      actorId: user.id,
      verb: 'removed',
      summary: `Stage "${stage.name}" removed from the Journey`,
      entityType: 'stage',
      entityId: stageId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Re-plan the Journey onto a different lifecycle template (new stages, work preserved). */
journeyRoutes.post('/retemplate', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const body = z
      .object({ projectId: z.number().int().positive(), templateKey: z.string().trim() })
      .parse(req.body);
    await requireProjectAccess(req.db, user, body.projectId, 'manage');
    if (!JOURNEY_TEMPLATES.some((t) => t.key === body.templateKey)) throw badRequest('Unknown template');

    const activityCount = await req.db
      .selectFrom('activities')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('projectId', '=', body.projectId)
      .executeTakeFirst();
    if (Number(activityCount?.c ?? 0) > 0) {
      throw conflict('This Journey already has work. Add stages individually to keep existing progress.');
    }

    await req.db.deleteFrom('journeys').where('projectId', '=', body.projectId).execute();
    await req.db
      .updateTable('projects')
      .set({ templateKey: body.templateKey, updatedAt: new Date() })
      .where('id', '=', body.projectId)
      .execute();
    const journeyId = await instantiateJourney(req.db, { projectId: body.projectId, templateKey: body.templateKey });
    res.json({ journeyId });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the template selection', err.issues));
    next(err);
  }
});
