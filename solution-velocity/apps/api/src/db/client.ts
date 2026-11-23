import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PGliteDialect, PostgresDialect, sql } from 'kysely';
import type { DB } from './types.js';

export type Database = Kysely<DB>;

const DATA_DIR = process.env.SV_DATA_DIR ?? path.resolve(process.cwd(), '.data', 'pg');

let instance: Database | null = null;
let pglite: PGlite | null = null;

/**
 * Fail loudly in production if no durable Postgres is configured, rather than
 * silently running against an ephemeral embedded instance.
 */
function assertConfig() {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set in production. The embedded Postgres (PGlite) database is for development only.',
    );
  }
}

export async function getDb(): Promise<Database> {
  if (instance) return instance;
  assertConfig();
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    instance = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: url, max: 10 }),
      }),
    });
    return instance;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  pglite = new PGlite(DATA_DIR);
  instance = new Kysely<DB>({ dialect: new PGliteDialect({ pglite }) });
  return instance;
}

export async function closeDb(): Promise<void> {
  // Idempotent: destroying Kysely already closes the underlying PGlite instance.
  const current = instance;
  const currentPglite = pglite;
  instance = null;
  pglite = null;
  try {
    if (current) await current.destroy();
  } catch {
    /* already closed */
  }
  try {
    if (currentPglite && !currentPglite.closed) await currentPglite.close();
  } catch {
    /* already closed */
  }
}

export async function resetDatabase(db: Database): Promise<void> {
  await sql`DROP SCHEMA public CASCADE`.execute(db);
  await sql`CREATE SCHEMA public`.execute(db);
}
