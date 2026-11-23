import { Router } from 'express';
import { z } from 'zod';
import { JOURNEY_TEMPLATES, getTemplate, PROJECT_TYPES } from '@sv/shared';
import { authenticate, requireUser, requireProjectAccess } from '../lib/access.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { instantiateJourney, listProjectsForUser, logActivity } from '../lib/journey.js';
import { hashPassword, pickAvatarColor } from '../lib/security.js';

export const projectRoutes = Router();

// Project APIs are authenticated; register it here so mounting order cannot bypass it.
projectRoutes.use(authenticate);

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().default(''),
  projectType: z.string().trim().default('other'),
  templateKey: z.string().trim().optional(),
  code: z.string().trim().max(12).optional(),
  startDate: z.string().optional(),
  /** Optional team members to add as contributors by user id. */
  memberIds: z.array(z.number().int().positive()).optional().default([]),
});

export function defaultTemplateFor(projectType: string): string {
  return PROJECT_TYPES.find((t) => t.key === projectType)?.template ?? 'generic';
}

export function makeCode(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.slice(0, 3).map((w) => w[0].toUpperCase());
  return (letters.join('') || 'PRJ').slice(0, 4);
}

projectRoutes.get('/', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projects = await listProjectsForUser(req.db, user.id, user.organizationId);
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

projectRoutes.get('/templates', (_req, res) => {
  res.json({ templates: JOURNEY_TEMPLATES, projectTypes: PROJECT_TYPES });
});

projectRoutes.post('/', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const body = createSchema.parse(req.body);
    const db = req.db;
    const templateKey = body.templateKey ?? defaultTemplateFor(body.projectType);
    if (!JOURNEY_TEMPLATES.some((t) => t.key === templateKey)) throw badRequest('Unknown Journey template');

    let code = (body.code ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, '') : makeCode(body.name)) || 'PRJ';
    const clash = await db
      .selectFrom('projects')
      .select('id')
      .where('organizationId', '=', user.organizationId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (clash) {
      let n = 2;
      const base = code;
      // eslint-disable-next-line no-await-in-loop
      while (await db.selectFrom('projects').select('id').where('organizationId', '=', user.organizationId).where('code', '=', code).executeTakeFirst()) {
        code = `${base}${n}`;
        n += 1;
      }
    }

    const project = await db
      .insertInto('projects')
      .values({
        organizationId: user.organizationId,
        name: body.name,
        code,
        description: body.description ?? '',
        projectType: body.projectType,
        templateKey,
        ownerId: user.id,
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db.insertInto('projectMembers').values({ projectId: project.id, userId: user.id, role: 'lead' }).execute();

    for (const memberId of body.memberIds) {
      if (memberId === user.id) continue;
      const exists = await db
        .selectFrom('users')
        .select('id')
        .where('id', '=', memberId)
        .where('organizationId', '=', user.organizationId)
        .executeTakeFirst();
      if (exists) {
        await db
          .insertInto('projectMembers')
          .values({ projectId: project.id, userId: memberId, role: 'contributor' })
          .execute();
      }
    }

    await instantiateJourney(db, { projectId: project.id, templateKey, startDate: body.startDate });
    await logActivity(db, {
      projectId: project.id,
      actorId: user.id,
      verb: 'created',
      summary: `Project "${body.name}" created with the ${getTemplate(templateKey).name} journey`,
      entityType: 'project',
      entityId: project.id,
    });

    res.status(201).json({ projectId: project.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the project details', err.issues));
    next(err);
  }
});

projectRoutes.patch('/:projectId', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(req.db, user, projectId, 'manage');
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().trim().max(2000).optional(),
        status: z.enum(['planning', 'active', 'on_hold', 'completed', 'archived']).optional(),
      })
      .parse(req.body);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status) patch.status = body.status;
    await req.db.updateTable('projects').set(patch).where('id', '=', projectId).execute();
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the project details', err.issues));
    next(err);
  }
});

projectRoutes.post('/:projectId/archive', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(req.db, user, projectId, 'manage');
    await req.db
      .updateTable('projects')
      .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', projectId)
      .execute();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

projectRoutes.get('/:projectId/members', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(req.db, user, projectId);
    const db = req.db;
    const members = await db
      .selectFrom('projectMembers')
      .innerJoin('users', 'users.id', 'projectMembers.userId')
      .select(['users.id', 'users.name', 'users.email', 'users.avatarColor', 'projectMembers.role'])
      .where('projectMembers.projectId', '=', projectId)
      .orderBy('projectMembers.role', 'asc')
      .execute();
    const orgUsers = await db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'avatarColor'])
      .where('organizationId', '=', user.organizationId)
      .orderBy('name', 'asc')
      .execute();
    const memberIds = new Set(members.map((m) => m.id));
    res.json({ members, available: orgUsers.filter((u) => !memberIds.has(u.id)) });
  } catch (err) {
    next(err);
  }
});

projectRoutes.post('/:projectId/members', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = Number(req.params.projectId);
    const access = await requireProjectAccess(req.db, user, projectId, 'manage');
    if (!access.canManage) throw forbidden();
    const body = z
      .object({
        userId: z.number().int().positive().optional(),
        email: z.string().email().optional(),
        name: z.string().trim().min(2).max(120).optional(),
        role: z.enum(['lead', 'contributor', 'viewer']).default('contributor'),
      })
      .parse(req.body);

    let userId = body.userId;
    if (!userId && body.email) {
      const existing = await req.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', body.email.toLowerCase())
        .where('organizationId', '=', user.organizationId)
        .executeTakeFirst();
      if (existing) userId = existing.id;
      else if (body.name) {
        const created = await req.db
          .insertInto('users')
          .values({
            organizationId: user.organizationId,
            name: body.name,
            email: body.email.toLowerCase(),
            // Invited teammates get a random password and must reset before use.
            passwordHash: hashPassword(`invite-${Math.random().toString(36).slice(2)}-${Date.now()}`),
            role: 'member',
            avatarColor: pickAvatarColor(body.email),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        userId = created.id;
      }
    }
    if (!userId) throw badRequest('Provide a teammate to add');

    const target = await req.db
      .selectFrom('users')
      .select(['id', 'name'])
      .where('id', '=', userId)
      .where('organizationId', '=', user.organizationId)
      .executeTakeFirst();
    if (!target) throw notFound('That person is not in your organization');

    const already = await req.db
      .selectFrom('projectMembers')
      .select('id')
      .where('projectId', '=', projectId)
      .where('userId', '=', userId)
      .executeTakeFirst();
    if (already) throw conflict('Already a member of this project');

    await req.db.insertInto('projectMembers').values({ projectId, userId, role: body.role }).execute();
    await logActivity(req.db, {
      projectId,
      actorId: user.id,
      verb: 'added',
      summary: `${target.name} joined the project as ${body.role}`,
      entityType: 'member',
      entityId: userId,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the member details', err.issues));
    next(err);
  }
});

projectRoutes.delete('/:projectId/members/:userId', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = Number(req.params.projectId);
    await requireProjectAccess(req.db, user, projectId, 'manage');
    const targetId = Number(req.params.userId);
    const project = await req.db.selectFrom('projects').select('ownerId').where('id', '=', projectId).executeTakeFirst();
    if (project?.ownerId === targetId) throw conflict('The project owner cannot be removed');
    await req.db
      .deleteFrom('projectMembers')
      .where('projectId', '=', projectId)
      .where('userId', '=', targetId)
      .execute();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
