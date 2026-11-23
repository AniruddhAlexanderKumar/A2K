import { sql, type Kysely } from 'kysely';
import type { DB } from './types.js';

/**
 * Versioned, additive migrations.
 *
 * Migrations only ever add tables, columns, indexes or backfill rows — they never
 * drop or rename existing structures. That keeps existing records intact on upgrade.
 */
export type Migration = {
  version: number;
  name: string;
  up: (db: Kysely<DB>) => Promise<void>;
};

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_journey_first_schema',
    up: async (db) => {
      await db.schema
        .createTable('organizations')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('slug', 'text', (c) => c.notNull().unique())
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();

      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('organizationId', 'integer', (c) => c.notNull().references('organizations.id').onDelete('cascade'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.notNull().unique())
        .addColumn('passwordHash', 'text', (c) => c.notNull())
        .addColumn('role', 'text', (c) => c.notNull().defaultTo('member'))
        .addColumn('avatarColor', 'text', (c) => c.notNull().defaultTo('#2f6f5e'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();

      await db.schema
        .createTable('projects')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('organizationId', 'integer', (c) => c.notNull().references('organizations.id').onDelete('cascade'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('code', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('projectType', 'text', (c) => c.notNull().defaultTo('other'))
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
        .addColumn('templateKey', 'text', (c) => c.notNull().defaultTo('generic'))
        .addColumn('ownerId', 'integer', (c) => c.notNull().references('users.id'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('updatedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('archivedAt', 'timestamptz')
        .execute();
      await db.schema.createIndex('projects_org_idx').on('projects').column('organizationId').execute();
      await db.schema.createIndex('projects_code_idx').on('projects').columns(['organizationId', 'code']).unique().execute();

      await db.schema
        .createTable('projectMembers')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('userId', 'integer', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('role', 'text', (c) => c.notNull().defaultTo('contributor'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('project_members_unique').on('projectMembers').columns(['projectId', 'userId']).unique().execute();

      await db.schema
        .createTable('journeys')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('templateKey', 'text', (c) => c.notNull())
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      // A project has exactly one journey.
      await db.schema.createIndex('journeys_project_unique').on('journeys').column('projectId').unique().execute();

      await db.schema
        .createTable('journeyStages')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('journeyId', 'integer', (c) => c.notNull().references('journeys.id').onDelete('cascade'))
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('key', 'text', (c) => c.notNull())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('objective', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('statusOverride', 'text')
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('journey_stages_project_idx').on('journeyStages').column('projectId').execute();

      await db.schema
        .createTable('milestones')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.references('journeyStages.id').onDelete('set null'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('dueDate', 'timestamptz')
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('open'))
        .addColumn('completedAt', 'timestamptz')
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('milestones_project_idx').on('milestones').column('projectId').execute();

      await db.schema
        .createTable('activities')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.notNull().references('journeyStages.id').onDelete('cascade'))
        .addColumn('milestoneId', 'integer', (c) => c.references('milestones.id').onDelete('set null'))
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('not_started'))
        .addColumn('priority', 'text', (c) => c.notNull().defaultTo('medium'))
        .addColumn('assigneeId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('dueDate', 'timestamptz')
        .addColumn('position', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('blockedReason', 'text')
        .addColumn('completedAt', 'timestamptz')
        .addColumn('createdById', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('updatedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('activities_project_idx').on('activities').column('projectId').execute();
      await db.schema.createIndex('activities_stage_idx').on('activities').column('stageId').execute();

      await db.schema
        .createTable('documents')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.references('journeyStages.id').onDelete('set null'))
        .addColumn('activityId', 'integer', (c) => c.references('activities.id').onDelete('set null'))
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('kind', 'text', (c) => c.notNull().defaultTo('document'))
        .addColumn('content', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('ownerId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('aiGenerated', 'boolean', (c) => c.notNull().defaultTo(false))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('updatedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('documents_project_idx').on('documents').column('projectId').execute();

      await db.schema
        .createTable('designArtifacts')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.references('journeyStages.id').onDelete('set null'))
        .addColumn('activityId', 'integer', (c) => c.references('activities.id').onDelete('set null'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('type', 'text', (c) => c.notNull().defaultTo('diagram'))
        .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('scene', 'jsonb', (c) => c.notNull())
        .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('ownerId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('updatedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('design_artifacts_project_idx').on('designArtifacts').column('projectId').execute();

      await db.schema
        .createTable('deliverables')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.notNull().references('journeyStages.id').onDelete('cascade'))
        .addColumn('activityId', 'integer', (c) => c.references('activities.id').onDelete('cascade'))
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('kind', 'text', (c) => c.notNull().defaultTo('document'))
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
        .addColumn('ownerId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('dueDate', 'timestamptz')
        .addColumn('documentId', 'integer', (c) => c.references('documents.id').onDelete('set null'))
        .addColumn('artifactId', 'integer', (c) => c.references('designArtifacts.id').onDelete('set null'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('updatedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('deliverables_activity_idx').on('deliverables').column('activityId').execute();

      await db.schema
        .createTable('requirements')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.references('journeyStages.id').onDelete('set null'))
        .addColumn('activityId', 'integer', (c) => c.references('activities.id').onDelete('set null'))
        .addColumn('ref', 'text', (c) => c.notNull())
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('statement', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('type', 'text', (c) => c.notNull().defaultTo('functional'))
        .addColumn('priority', 'text', (c) => c.notNull().defaultTo('medium'))
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
        .addColumn('ownerId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('verificationMethod', 'text')
        .addColumn('source', 'text', (c) => c.notNull().defaultTo('manual'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('updatedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('requirements_project_idx').on('requirements').column('projectId').execute();

      await db.schema
        .createTable('reviews')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.references('journeyStages.id').onDelete('set null'))
        .addColumn('activityId', 'integer', (c) => c.references('activities.id').onDelete('cascade'))
        .addColumn('deliverableId', 'integer', (c) => c.references('deliverables.id').onDelete('set null'))
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('kind', 'text', (c) => c.notNull().defaultTo('review'))
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
        .addColumn('requestedById', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('reviewerId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('note', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('decisionNote', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('decidedAt', 'timestamptz')
        .execute();
      await db.schema.createIndex('reviews_project_idx').on('reviews').column('projectId').execute();

      await db.schema
        .createTable('decisions')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.references('journeyStages.id').onDelete('set null'))
        .addColumn('activityId', 'integer', (c) => c.references('activities.id').onDelete('set null'))
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('rationale', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('approved'))
        .addColumn('decidedById', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('decidedAt', 'timestamptz')
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();

      await db.schema
        .createTable('dependencies')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('fromType', 'text', (c) => c.notNull())
        .addColumn('fromId', 'integer', (c) => c.notNull())
        .addColumn('toType', 'text', (c) => c.notNull())
        .addColumn('toId', 'integer', (c) => c.notNull())
        .addColumn('note', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('dependencies_project_idx').on('dependencies').column('projectId').execute();

      await db.schema
        .createTable('risks')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('stageId', 'integer', (c) => c.references('journeyStages.id').onDelete('set null'))
        .addColumn('activityId', 'integer', (c) => c.references('activities.id').onDelete('set null'))
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('severity', 'text', (c) => c.notNull().defaultTo('medium'))
        .addColumn('likelihood', 'text', (c) => c.notNull().defaultTo('medium'))
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('open'))
        .addColumn('mitigation', 'text', (c) => c.notNull().defaultTo(''))
        .addColumn('ownerId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();

      await db.schema
        .createTable('activityLog')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('actorId', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('verb', 'text', (c) => c.notNull())
        .addColumn('summary', 'text', (c) => c.notNull())
        .addColumn('entityType', 'text', (c) => c.notNull())
        .addColumn('entityId', 'integer')
        .addColumn('metadata', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('activity_log_project_idx').on('activityLog').columns(['projectId', 'id']).execute();

      await db.schema
        .createTable('assistantThreads')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('userId', 'integer', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('title', 'text', (c) => c.notNull().defaultTo('New conversation'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('updatedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema.createIndex('assistant_threads_project_idx').on('assistantThreads').columns(['projectId', 'userId']).execute();

      await db.schema
        .createTable('assistantMessages')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('threadId', 'integer', (c) => c.notNull().references('assistantThreads.id').onDelete('cascade'))
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('role', 'text', (c) => c.notNull())
        .addColumn('content', 'text', (c) => c.notNull())
        .addColumn('actions', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();

      await db.schema
        .createTable('assistantActions')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('threadId', 'integer', (c) => c.notNull().references('assistantThreads.id').onDelete('cascade'))
        .addColumn('projectId', 'integer', (c) => c.notNull().references('projects.id').onDelete('cascade'))
        .addColumn('messageId', 'integer', (c) => c.references('assistantMessages.id').onDelete('set null'))
        .addColumn('actionType', 'text', (c) => c.notNull())
        .addColumn('payload', 'jsonb', (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull().defaultTo('proposed'))
        .addColumn('summary', 'text', (c) => c.notNull())
        .addColumn('result', 'jsonb')
        .addColumn('appliedById', 'integer', (c) => c.references('users.id').onDelete('set null'))
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('appliedAt', 'timestamptz')
        .execute();

      await db.schema
        .createTable('sessions')
        .addColumn('id', 'serial', (c) => c.primaryKey())
        .addColumn('userId', 'integer', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('tokenHash', 'text', (c) => c.notNull().unique())
        .addColumn('createdAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('expiresAt', 'timestamptz', (c) => c.notNull())
        .execute();
    },
  },
];

export async function migrate(db: Kysely<DB>): Promise<number> {
  await db.schema
    .createTable('schemaMigrations')
    .ifNotExists()
    .addColumn('version', 'integer', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('appliedAt', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  const applied = await db.selectFrom('schemaMigrations').select('version').execute();
  const appliedVersions = new Set(applied.map((r) => r.version));

  let count = 0;
  for (const m of migrations) {
    if (appliedVersions.has(m.version)) continue;
    await m.up(db);
    await db.insertInto('schemaMigrations').values({ version: m.version, name: m.name }).execute();
    count += 1;
  }
  return count;
}
