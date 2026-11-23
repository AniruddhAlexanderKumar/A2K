import { Router } from 'express';
import { z } from 'zod';
import { requireProjectAccess, requireUser } from '../lib/access.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logActivity } from '../lib/journey.js';

export const studioRoutes = Router();

const shapeSchema = z.object({
  id: z.string().max(64),
  kind: z.enum(['rect', 'ellipse', 'note', 'arrow']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  label: z.string().max(400).default(''),
  color: z.string().max(32).default('#31567a'),
});

const sceneSchema = z.object({
  width: z.number().min(200).max(6000),
  height: z.number().min(200).max(6000),
  shapes: z.array(shapeSchema).max(400),
});

const EMPTY_SCENE = { width: 1200, height: 800, shapes: [] as unknown[] };

studioRoutes.get('/artifacts', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw badRequest('Select a project to open Design Studio');
    await requireProjectAccess(req.db, user, projectId);
    const rows = await req.db
      .selectFrom('designArtifacts')
      .leftJoin('users', 'users.id', 'designArtifacts.ownerId')
      .leftJoin('journeyStages', 'journeyStages.id', 'designArtifacts.stageId')
      .leftJoin('activities', 'activities.id', 'designArtifacts.activityId')
      .selectAll('designArtifacts')
      .select([
        'users.name as ownerName',
        'journeyStages.name as stageName',
        'activities.title as activityTitle',
      ])
      .where('designArtifacts.projectId', '=', projectId)
      .orderBy('designArtifacts.updatedAt', 'desc')
      .execute();
    res.json({
      artifacts: rows.map((a) => ({
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
        activityTitle: a.activityTitle ?? null,
        createdAt: new Date(a.createdAt).toISOString(),
        updatedAt: new Date(a.updatedAt).toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

studioRoutes.post('/artifacts', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const body = z
      .object({
        projectId: z.number().int().positive(),
        name: z.string().trim().min(2).max(160),
        type: z.enum(['wireframe', 'diagram', 'specification_board', 'system_sketch']).default('diagram'),
        description: z.string().trim().max(2000).optional().default(''),
        stageId: z.number().int().positive().nullable().optional(),
        activityId: z.number().int().positive().nullable().optional(),
        scene: sceneSchema.optional(),
      })
      .parse(req.body);
    await requireProjectAccess(req.db, user, body.projectId, 'write');
    const db = req.db;
    if (body.stageId) {
      const stage = await db
        .selectFrom('journeyStages')
        .select('id')
        .where('id', '=', body.stageId)
        .where('projectId', '=', body.projectId)
        .executeTakeFirst();
      if (!stage) throw badRequest('That stage does not belong to this project');
    }
    if (body.activityId) {
      const activity = await db
        .selectFrom('activities')
        .select('id')
        .where('id', '=', body.activityId)
        .where('projectId', '=', body.projectId)
        .executeTakeFirst();
      if (!activity) throw badRequest('That activity does not belong to this project');
    }
    const created = await db
      .insertInto('designArtifacts')
      .values({
        projectId: body.projectId,
        stageId: body.stageId ?? null,
        activityId: body.activityId ?? null,
        name: body.name,
        type: body.type ?? 'diagram',
        description: body.description ?? '',
        scene: JSON.stringify(body.scene ?? EMPTY_SCENE),
        ownerId: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await logActivity(db, {
      projectId: body.projectId,
      actorId: user.id,
      verb: 'created',
      summary: `Design artifact "${body.name}" created in Design Studio`,
      entityType: 'design_artifact',
      entityId: created.id,
    });
    res.status(201).json({ artifactId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the artifact details', err.issues));
    next(err);
  }
});

studioRoutes.get('/artifacts/:id', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const row = await req.db.selectFrom('designArtifacts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Artifact not found');
    await requireProjectAccess(req.db, user, row.projectId);
    const stage = row.stageId
      ? await req.db.selectFrom('journeyStages').select(['name']).where('id', '=', row.stageId).executeTakeFirst()
      : null;
    res.json({ artifact: { ...row, stageName: stage?.name ?? null } });
  } catch (err) {
    next(err);
  }
});

studioRoutes.patch('/artifacts/:id', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const existing = await req.db.selectFrom('designArtifacts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw notFound('Artifact not found');
    await requireProjectAccess(req.db, user, existing.projectId, 'write');
    const body = z
      .object({
        name: z.string().trim().min(2).max(160).optional(),
        type: z.enum(['wireframe', 'diagram', 'specification_board', 'system_sketch']).optional(),
        description: z.string().trim().max(2000).optional(),
        stageId: z.number().int().positive().nullable().optional(),
        activityId: z.number().int().positive().nullable().optional(),
        scene: sceneSchema.optional(),
        bumpVersion: z.boolean().optional().default(false),
      })
      .parse(req.body);
    const db = req.db;
    if (body.stageId) {
      const stage = await db
        .selectFrom('journeyStages')
        .select('id')
        .where('id', '=', body.stageId)
        .where('projectId', '=', existing.projectId)
        .executeTakeFirst();
      if (!stage) throw badRequest('That stage does not belong to this project');
    }
    if (body.activityId) {
      const activity = await db
        .selectFrom('activities')
        .select('id')
        .where('id', '=', body.activityId)
        .where('projectId', '=', existing.projectId)
        .executeTakeFirst();
      if (!activity) throw badRequest('That activity does not belong to this project');
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.type !== undefined) patch.type = body.type;
    if (body.description !== undefined) patch.description = body.description;
    if (body.stageId !== undefined) patch.stageId = body.stageId;
    if (body.activityId !== undefined) patch.activityId = body.activityId;
    if (body.scene !== undefined) patch.scene = JSON.stringify(body.scene);
    if (body.bumpVersion) patch.version = existing.version + 1;

    await db.updateTable('designArtifacts').set(patch).where('id', '=', id).execute();

    if (body.stageId !== undefined || body.activityId !== undefined) {
      await logActivity(db, {
        projectId: existing.projectId,
        actorId: user.id,
        verb: 'linked',
        summary: `Design artifact "${existing.name}" linked into the Journey`,
        entityType: 'design_artifact',
        entityId: id,
      });
    }
    res.json({ ok: true, version: patch.version ?? existing.version });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the artifact details', err.issues));
    next(err);
  }
});

studioRoutes.delete('/artifacts/:id', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const existing = await req.db.selectFrom('designArtifacts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw notFound('Artifact not found');
    await requireProjectAccess(req.db, user, existing.projectId, 'write');
    await req.db.deleteFrom('designArtifacts').where('id', '=', id).execute();
    await logActivity(req.db, {
      projectId: existing.projectId,
      actorId: user.id,
      verb: 'deleted',
      summary: `Design artifact "${existing.name}" removed`,
      entityType: 'design_artifact',
      entityId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Attach an artifact as the evidence for an existing deliverable. */
studioRoutes.post('/artifacts/:id/attach', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const existing = await req.db.selectFrom('designArtifacts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw notFound('Artifact not found');
    await requireProjectAccess(req.db, user, existing.projectId, 'write');
    const body = z.object({ deliverableId: z.number().int().positive() }).parse(req.body);
    const deliverable = await req.db
      .selectFrom('deliverables')
      .select(['id', 'title', 'status'])
      .where('id', '=', body.deliverableId)
      .where('projectId', '=', existing.projectId)
      .executeTakeFirst();
    if (!deliverable) throw notFound('Deliverable not found in this project');
    await req.db
      .updateTable('deliverables')
      .set({ artifactId: id, status: deliverable.status === 'draft' ? 'in_review' : deliverable.status, updatedAt: new Date() })
      .where('id', '=', body.deliverableId)
      .execute();
    await logActivity(req.db, {
      projectId: existing.projectId,
      actorId: user.id,
      verb: 'linked',
      summary: `Artifact "${existing.name}" attached to deliverable "${deliverable.title}"`,
      entityType: 'design_artifact',
      entityId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the attachment details', err.issues));
    next(err);
  }
});
