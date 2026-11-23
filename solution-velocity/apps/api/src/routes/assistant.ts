import { Router } from 'express';
import { z } from 'zod';
import { requireProjectAccess, requireUser } from '../lib/access.js';
import { badRequest, notFound } from '../lib/errors.js';
import { buildProjectContext } from '../ai/context.js';
import { runAssistant } from '../ai/engine.js';
import { applyAssistantAction } from '../ai/actions.js';
import { logActivity, projectProgress } from '../lib/journey.js';

export const assistantRoutes = Router();

/**
 * Threads are per project *and* per user. Switching projects in the UI switches the
 * thread, so context can never leak between projects.
 */
assistantRoutes.get('/threads', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw badRequest('A project is required');
    await requireProjectAccess(req.db, user, projectId);
    const threads = await req.db
      .selectFrom('assistantThreads')
      .innerJoin('projects', 'projects.id', 'assistantThreads.projectId')
      .select([
        'assistantThreads.id',
        'assistantThreads.projectId',
        'assistantThreads.title',
        'assistantThreads.createdAt',
        'assistantThreads.updatedAt',
        'projects.name as projectName',
      ])
      .where('assistantThreads.projectId', '=', projectId)
      .where('assistantThreads.userId', '=', user.id)
      .orderBy('assistantThreads.updatedAt', 'desc')
      .execute();
    res.json({
      threads: threads.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        projectName: t.projectName,
        title: t.title,
        createdAt: new Date(t.createdAt).toISOString(),
        updatedAt: new Date(t.updatedAt).toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

assistantRoutes.get('/threads/:id', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const thread = await req.db
      .selectFrom('assistantThreads')
      .selectAll()
      .where('id', '=', id)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    if (!thread) throw notFound('Conversation not found');
    await requireProjectAccess(req.db, user, thread.projectId);

    const messages = await req.db
      .selectFrom('assistantMessages')
      .selectAll()
      .where('threadId', '=', id)
      .orderBy('id', 'asc')
      .execute();
    const actions = await req.db
      .selectFrom('assistantActions')
      .selectAll()
      .where('threadId', '=', id)
      .orderBy('id', 'asc')
      .execute();
    res.json({
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        createdAt: new Date(thread.createdAt).toISOString(),
        updatedAt: new Date(thread.updatedAt).toISOString(),
      },
      messages: messages.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        actions: [],
        createdAt: new Date(m.createdAt).toISOString(),
      })),
      actions: actions.map((a) => ({
        id: a.id,
        threadId: a.threadId,
        messageId: a.messageId,
        projectId: a.projectId,
        actionType: a.actionType,
        payload: a.payload,
        status: a.status,
        summary: a.summary,
        result: a.result,
        createdAt: new Date(a.createdAt).toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

assistantRoutes.post('/threads', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const body = z
      .object({ projectId: z.number().int().positive(), title: z.string().trim().max(160).optional() })
      .parse(req.body);
    await requireProjectAccess(req.db, user, body.projectId);
    const created = await req.db
      .insertInto('assistantThreads')
      .values({ projectId: body.projectId, userId: user.id, title: body.title ?? 'New conversation' })
      .returning('id')
      .executeTakeFirstOrThrow();
    res.status(201).json({ threadId: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the conversation details', err.issues));
    next(err);
  }
});

/** Send a message: builds project-scoped context, gets a grounded reply and proposed actions. */
assistantRoutes.post('/threads/:id/messages', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const body = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);
    const thread = await req.db
      .selectFrom('assistantThreads')
      .selectAll()
      .where('id', '=', id)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    if (!thread) throw notFound('Conversation not found');
    await requireProjectAccess(req.db, user, thread.projectId, 'write');

    const db = req.db;
    const context = await buildProjectContext(db, thread.projectId, user.id);
    const history = await db
      .selectFrom('assistantMessages')
      .select(['role', 'content'])
      .where('threadId', '=', id)
      .orderBy('id', 'asc')
      .limit(20)
      .execute();

    await db
      .insertInto('assistantMessages')
      .values({ threadId: id, projectId: thread.projectId, role: 'user', content: body.message, actions: '[]' })
      .execute();

    const result = await runAssistant({ message: body.message, context, history });

    const assistantMessage = await db
      .insertInto('assistantMessages')
      .values({
        threadId: id,
        projectId: thread.projectId,
        role: 'assistant',
        content: result.content,
        actions: '[]',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const createdActions = [];
    for (const action of result.actions) {
      const inserted = await db
        .insertInto('assistantActions')
        .values({
          threadId: id,
          projectId: thread.projectId,
          messageId: assistantMessage.id,
          actionType: action.actionType,
          payload: JSON.stringify(action.payload),
          status: 'proposed',
          summary: action.summary,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      createdActions.push({
        id: inserted.id,
        threadId: id,
        messageId: assistantMessage.id,
        projectId: thread.projectId,
        actionType: action.actionType,
        payload: action.payload,
        status: 'proposed' as const,
        summary: action.summary,
        result: null,
        createdAt: new Date().toISOString(),
      });
    }

    // Keep the thread titled after its first message so the list is meaningful.
    const count = await db
      .selectFrom('assistantMessages')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('threadId', '=', id)
      .executeTakeFirst();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (Number(count?.c ?? 0) <= 2) patch.title = body.message.slice(0, 80);
    await db.updateTable('assistantThreads').set(patch).where('id', '=', id).execute();

    res.json({
      threadId: id,
      message: {
        id: assistantMessage.id,
        threadId: id,
        role: 'assistant',
        content: result.content,
        actions: createdActions,
        createdAt: new Date().toISOString(),
      },
      actions: createdActions,
      suggestedPrompts: result.suggestedPrompts,
      contextProject: { id: context.journey.project.id, name: context.journey.project.name },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Write a message first', err.issues));
    next(err);
  }
});

/** Apply a proposed action after explicit user confirmation. */
assistantRoutes.post('/actions/:id/apply', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const db = req.db;
    const action = await db.selectFrom('assistantActions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!action) throw notFound('Proposed change not found');
    const thread = await db
      .selectFrom('assistantThreads')
      .select(['id', 'projectId', 'userId'])
      .where('id', '=', action.threadId)
      .executeTakeFirst();
    if (!thread || thread.userId !== user.id) throw notFound('Proposed change not found');
    if (action.status !== 'proposed') throw badRequest(`This change is already ${action.status}`);

    await requireProjectAccess(db, user, action.projectId, 'write');

    // The user may adjust the proposed payload before applying it, in which case the
    // server still validates every field and every referenced id.
    const overrides = z.object({ payload: z.record(z.string(), z.unknown()).optional() }).parse(req.body ?? {});
    const payload = { ...(action.payload as Record<string, unknown>), ...(overrides.payload ?? {}) };

    try {
      const result = await applyAssistantAction(db, {
        projectId: action.projectId,
        actor: user,
        actionType: action.actionType,
        payload,
      });
      await db
        .updateTable('assistantActions')
        .set({
          status: 'applied',
          result: JSON.stringify(result),
          appliedById: user.id,
          appliedAt: new Date(),
          payload: JSON.stringify(payload),
        })
        .where('id', '=', id)
        .execute();
      res.json({ ok: true, result, progress: await projectProgress(db, action.projectId) });
    } catch (applyErr) {
      await db
        .updateTable('assistantActions')
        .set({ status: 'failed', result: JSON.stringify({ error: (applyErr as Error).message }) })
        .where('id', '=', id)
        .execute();
      throw applyErr;
    }
  } catch (err) {
    next(err);
  }
});

assistantRoutes.post('/actions/:id/dismiss', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const db = req.db;
    const action = await db.selectFrom('assistantActions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!action) throw notFound('Proposed change not found');
    const thread = await db
      .selectFrom('assistantThreads')
      .select(['userId', 'projectId'])
      .where('id', '=', action.threadId)
      .executeTakeFirst();
    if (!thread || thread.userId !== user.id) throw notFound('Proposed change not found');
    await db.updateTable('assistantActions').set({ status: 'dismissed' }).where('id', '=', id).execute();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Contextual assistant: used from Journey and Design Studio to ask about a specific
 * activity or artifact without leaving the workspace. Returns a single answer and
 * (optionally) a thread so the conversation can continue in the Assistant.
 */
assistantRoutes.post('/context-ask', async (req, res, next) => {
  try {
    const user = requireUser(req);
    const body = z
      .object({
        projectId: z.number().int().positive(),
        message: z.string().trim().min(1).max(2000),
        activityId: z.number().int().positive().optional(),
        artifactId: z.number().int().positive().optional(),
        createThread: z.boolean().optional().default(true),
      })
      .parse(req.body);
    await requireProjectAccess(req.db, user, body.projectId, 'write');
    const db = req.db;

    let scoped = body.message;
    if (body.activityId) {
      const activity = await db
        .selectFrom('activities')
        .select(['id', 'title', 'status', 'description'])
        .where('id', '=', body.activityId)
        .where('projectId', '=', body.projectId)
        .executeTakeFirst();
      if (!activity) throw notFound('Activity not found');
      scoped = `[Context: activity #${activity.id} "${activity.title}", currently ${activity.status}. ${activity.description}]\n${body.message}`;
    }
    if (body.artifactId) {
      const artifact = await db
        .selectFrom('designArtifacts')
        .select(['id', 'name', 'type', 'description'])
        .where('id', '=', body.artifactId)
        .where('projectId', '=', body.projectId)
        .executeTakeFirst();
      if (!artifact) throw notFound('Design artifact not found');
      scoped = `[Context: design artifact #${artifact.id} "${artifact.name}" (${artifact.type}). ${artifact.description}]\n${scoped}`;
    }

    const context = await buildProjectContext(db, body.projectId, user.id);
    const result = await runAssistant({ message: scoped, context, history: [] });

    let threadId: number | null = null;
    if (body.createThread) {
      const thread = await db
        .insertInto('assistantThreads')
        .values({
          projectId: body.projectId,
          userId: user.id,
          title: body.message.slice(0, 80),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      threadId = thread.id;
      await db
        .insertInto('assistantMessages')
        .values({ threadId, projectId: body.projectId, role: 'user', content: scoped, actions: '[]' })
        .execute();
      const msg = await db
        .insertInto('assistantMessages')
        .values({ threadId, projectId: body.projectId, role: 'assistant', content: result.content, actions: '[]' })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const action of result.actions) {
        await db
          .insertInto('assistantActions')
          .values({
            threadId,
            projectId: body.projectId,
            messageId: msg.id,
            actionType: action.actionType,
            payload: JSON.stringify(action.payload),
            summary: action.summary,
            status: 'proposed',
          })
          .execute();
      }
      await logActivity(db, {
        projectId: body.projectId,
        actorId: user.id,
        verb: 'asked',
        summary: 'Asked the AI Assistant from the workspace',
        entityType: 'assistant',
        entityId: threadId,
      });
    }

    res.json({ content: result.content, threadId, actionCount: result.actions.length, suggestedPrompts: result.suggestedPrompts });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check your question', err.issues));
    next(err);
  }
});
