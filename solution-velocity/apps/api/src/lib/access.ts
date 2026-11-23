import type { NextFunction, Request, Response } from 'express';
import type { Database } from '../db/client.js';
import type { ProjectRole } from '@sv/shared';
import { forbidden, notFound, unauthorized } from './errors.js';
import { hashToken } from './security.js';

export type AuthUser = {
  id: number;
  organizationId: number;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  avatarColor: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      db: Database;
    }
  }
}

const COOKIE_NAME = 'sv_session';

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookieName() {
  return COOKIE_NAME;
}

export async function userFromRequest(req: Request, db: Database): Promise<AuthUser | null> {
  const token = readCookie(req, COOKIE_NAME) ?? bearer(req);
  if (!token) return null;
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.userId')
    .select([
      'users.id',
      'users.organizationId',
      'users.name',
      'users.email',
      'users.role',
      'users.avatarColor',
      'sessions.expiresAt',
    ])
    .where('sessions.tokenHash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarColor: row.avatarColor,
  };
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export type ProjectAccess = {
  projectId: number;
  role: ProjectRole;
  isLead: boolean;
  canWrite: boolean;
  canManage: boolean;
};

/**
 * Single choke point for project isolation: every project-scoped route resolves
 * access through here, and the project must belong to the caller's organization.
 */
export async function requireProjectAccess(
  db: Database,
  user: AuthUser,
  projectId: number,
  minimum: 'view' | 'write' | 'manage' = 'view',
): Promise<ProjectAccess> {
  if (!Number.isInteger(projectId) || projectId <= 0) throw notFound('Project not found');
  const project = await db
    .selectFrom('projects')
    .select(['id', 'organizationId', 'ownerId'])
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project not found');
  if (project.organizationId !== user.organizationId) throw notFound('Project not found');

  const membership = await db
    .selectFrom('projectMembers')
    .select(['role'])
    .where('projectId', '=', projectId)
    .where('userId', '=', user.id)
    .executeTakeFirst();

  const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
  const role: ProjectRole | null = membership?.role ?? (isOrgAdmin || project.ownerId === user.id ? 'lead' : null);
  if (!role) throw forbidden();

  const isLead = role === 'lead';
  const canWrite = isLead || role === 'contributor';
  const canManage = isLead || isOrgAdmin;

  if (minimum === 'write' && !canWrite) throw forbidden('Your project role is view-only');
  if (minimum === 'manage' && !canManage) throw forbidden('Only project leads can do this');
  return { projectId, role, isLead, canWrite, canManage };
}

export async function projectIdParam(req: Request): Promise<number> {
  const raw = req.params.projectId ?? req.query.projectId;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Project not found');
  return id;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await userFromRequest(req, req.db);
    if (user) req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
