import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword, newSessionToken, hashToken, pickAvatarColor } from '../lib/security.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { sessionCookieName, requireUser, type AuthUser } from '../lib/access.js';

export const authRoutes = Router();

const SESSION_DAYS = 30;

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  organizationName: z.string().trim().min(2).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function toSessionUser(u: {
  id: number;
  name: string;
  email: string;
  role: AuthUser['role'];
  organizationId: number;
  avatarColor: string;
}, organizationName: string) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    organizationId: u.organizationId,
    organizationName,
    avatarColor: u.avatarColor,
  };
}

async function createSession(db: import('../db/client.js').Database, userId: number): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db
    .insertInto('sessions')
    .values({ userId, tokenHash: hashToken(token), expiresAt })
    .execute();
  return token;
}

function setSessionCookie(res: import('express').Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${sessionCookieName()}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${
      SESSION_DAYS * 86400
    }${secure}`,
  );
}

authRoutes.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const db = req.db;
    const existing = await db.selectFrom('users').select('id').where('email', '=', body.email).executeTakeFirst();
    if (existing) throw conflict('An account with that email already exists');

    const orgName = body.organizationName ?? `${body.name.split(' ')[0]}'s Team`;
    const slugBase = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'team';
    let slug = slugBase;
    let attempt = 1;
    while (await db.selectFrom('organizations').select('id').where('slug', '=', slug).executeTakeFirst()) {
      attempt += 1;
      slug = `${slugBase}-${attempt}`;
    }

    const org = await db.insertInto('organizations').values({ name: orgName, slug }).returning('id').executeTakeFirstOrThrow();
    const user = await db
      .insertInto('users')
      .values({
        organizationId: org.id,
        name: body.name,
        email: body.email,
        passwordHash: hashPassword(body.password),
        role: 'owner',
        avatarColor: pickAvatarColor(body.email),
      })
      .returning(['id', 'name', 'email', 'role', 'organizationId', 'avatarColor'])
      .executeTakeFirstOrThrow();

    const token = await createSession(db, user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user: toSessionUser(user, orgName) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Check the details you entered', err.issues));
    next(err);
  }
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const row = await req.db
      .selectFrom('users')
      .innerJoin('organizations', 'organizations.id', 'users.organizationId')
      .select([
        'users.id',
        'users.name',
        'users.email',
        'users.role',
        'users.organizationId',
        'users.avatarColor',
        'users.passwordHash',
        'organizations.name as organizationName',
      ])
      .where('users.email', '=', body.email)
      .executeTakeFirst();
    if (!row || !verifyPassword(body.password, row.passwordHash)) {
      throw unauthorized('Email or password is incorrect');
    }
    const token = await createSession(req.db, row.id);
    setSessionCookie(res, token);
    res.json({ user: toSessionUser(row, row.organizationName) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest('Enter a valid email and password', err.issues));
    next(err);
  }
});

authRoutes.post('/logout', async (req, res) => {
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${sessionCookieName()}=`));
    if (match) {
      const token = decodeURIComponent(match.split('=')[1]);
      await req.db.deleteFrom('sessions').where('tokenHash', '=', hashToken(token)).execute();
    }
  }
  res.setHeader('Set-Cookie', `${sessionCookieName()}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

authRoutes.get('/me', async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  const org = await req.db
    .selectFrom('organizations')
    .select('name')
    .where('id', '=', req.user.organizationId)
    .executeTakeFirst();
  res.json({ user: toSessionUser(req.user, org?.name ?? '') });
});

authRoutes.get('/team', async (req, res) => {
  const user = requireUser(req);
  const members = await req.db
    .selectFrom('users')
    .select(['id', 'name', 'email', 'role', 'avatarColor'])
    .where('organizationId', '=', user.organizationId)
    .orderBy('name', 'asc')
    .execute();
  res.json({ members });
});
