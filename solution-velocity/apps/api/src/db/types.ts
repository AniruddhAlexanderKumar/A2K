/**
 * Database schema types for Solution Velocity.
 *
 * Ownership chain: organization → project → journey → stage → activity → everything else.
 * Every journey-scoped entity carries projectId so isolation can be enforced in one place.
 */
import type { Generated, ColumnType } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** A column with a database default: optional on insert. */
type Def<T> = ColumnType<T, T | undefined, T>;
/** A nullable column: optional on insert. */
type Nullable<T> = ColumnType<T, T | null | undefined, T | null>;
type Json<T> = ColumnType<T, T | string, T | string>;
/** JSON column with a database default: optional on insert, accepts a pre-serialised string. */
type JsonDef<T> = ColumnType<T, T | string | undefined, T | string>;

export interface OrganizationsTable {
  id: Generated<number>;
  name: Def<string>;
  slug: string;
  createdAt: Def<Date>;
}

export interface UsersTable {
  id: Generated<number>;
  organizationId: number;
  name: Def<string>;
  email: string;
  passwordHash: string;
  role: 'owner' | 'admin' | 'member';
  avatarColor: Def<string>;
  createdAt: Def<Date>;
}

export interface ProjectsTable {
  id: Generated<number>;
  organizationId: number;
  name: Def<string>;
  code: Def<string>;
  description: Def<string>;
  projectType: Def<string>;
  status: Def<string>;
  templateKey: Def<string>;
  ownerId: number;
  createdAt: Def<Date>;
  updatedAt: Def<Date>;
  archivedAt: Nullable<Date>;
}

export interface ProjectMembersTable {
  id: Generated<number>;
  projectId: number;
  userId: number;
  role: 'lead' | 'contributor' | 'viewer';
  createdAt: Def<Date>;
}

export interface JourneysTable {
  id: Generated<number>;
  projectId: number;
  name: Def<string>;
  templateKey: Def<string>;
  createdAt: Def<Date>;
}

export interface JourneyStagesTable {
  id: Generated<number>;
  journeyId: number;
  projectId: number;
  key: string;
  name: Def<string>;
  description: Def<string>;
  objective: string;
  position: Def<number>;
  statusOverride: string | null;
  createdAt: Def<Date>;
}

export interface MilestonesTable {
  id: Generated<number>;
  projectId: number;
  stageId: number | null;
  name: Def<string>;
  description: Def<string>;
  dueDate: Nullable<Date>;
  status: Def<string>;
  completedAt: Nullable<Date>;
  createdAt: Def<Date>;
}

export interface ActivitiesTable {
  id: Generated<number>;
  projectId: number;
  stageId: number;
  milestoneId: number | null;
  title: Def<string>;
  description: Def<string>;
  status: Def<string>;
  priority: Def<string>;
  assigneeId: number | null;
  dueDate: Nullable<Date>;
  position: Def<number>;
  blockedReason: string | null;
  completedAt: Nullable<Date>;
  createdById: number | null;
  createdAt: Def<Date>;
  updatedAt: Def<Date>;
}

export interface DeliverablesTable {
  id: Generated<number>;
  projectId: number;
  stageId: number;
  activityId: number | null;
  title: Def<string>;
  kind: Def<string>;
  status: Def<string>;
  ownerId: number | null;
  dueDate: Nullable<Date>;
  documentId: number | null;
  artifactId: number | null;
  createdAt: Def<Date>;
  updatedAt: Def<Date>;
}

export interface RequirementsTable {
  id: Generated<number>;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  ref: string;
  title: Def<string>;
  statement: Def<string>;
  type: Def<string>;
  priority: Def<string>;
  status: Def<string>;
  ownerId: number | null;
  verificationMethod: string | null;
  source: Def<string>;
  createdAt: Def<Date>;
  updatedAt: Def<Date>;
}

export interface DocumentsTable {
  id: Generated<number>;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  title: Def<string>;
  kind: Def<string>;
  content: Def<string>;
  version: Def<number>;
  ownerId: number | null;
  aiGenerated: Def<boolean>;
  createdAt: Def<Date>;
  updatedAt: Def<Date>;
}

export interface DesignArtifactsTable {
  id: Generated<number>;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  name: Def<string>;
  type: Def<string>;
  description: Def<string>;
  scene: JsonDef<unknown>;
  version: Def<number>;
  ownerId: number | null;
  createdAt: Def<Date>;
  updatedAt: Def<Date>;
}

export interface ReviewsTable {
  id: Generated<number>;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  deliverableId: number | null;
  title: Def<string>;
  kind: Def<string>;
  status: Def<string>;
  requestedById: number | null;
  reviewerId: number | null;
  note: Def<string>;
  decisionNote: Def<string>;
  createdAt: Def<Date>;
  decidedAt: Nullable<Date>;
}

export interface DecisionsTable {
  id: Generated<number>;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  title: Def<string>;
  rationale: Def<string>;
  status: Def<string>;
  decidedById: number | null;
  decidedAt: Nullable<Date>;
  createdAt: Def<Date>;
}

export interface DependenciesTable {
  id: Generated<number>;
  projectId: number;
  fromType: string;
  fromId: number;
  toType: string;
  toId: number;
  note: Def<string>;
  createdAt: Def<Date>;
}

export interface RisksTable {
  id: Generated<number>;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  title: Def<string>;
  description: Def<string>;
  severity: string;
  likelihood: Def<string>;
  status: Def<string>;
  mitigation: Def<string>;
  ownerId: number | null;
  createdAt: Def<Date>;
}

export interface ActivityLogTable {
  id: Generated<number>;
  projectId: number;
  actorId: number | null;
  verb: string;
  summary: Def<string>;
  entityType: string;
  entityId: number | null;
  metadata: Json<Record<string, unknown>>;
  createdAt: Def<Date>;
}

export interface AssistantThreadsTable {
  id: Generated<number>;
  projectId: number;
  userId: number;
  title: Def<string>;
  createdAt: Def<Date>;
  updatedAt: Def<Date>;
}

export interface AssistantMessagesTable {
  id: Generated<number>;
  threadId: number;
  projectId: number;
  role: Def<string>;
  content: Def<string>;
  actions: JsonDef<unknown>;
  createdAt: Def<Date>;
}

export interface AssistantActionsTable {
  id: Generated<number>;
  threadId: number;
  projectId: number;
  messageId: number | null;
  actionType: string;
  payload: Json<Record<string, unknown>>;
  status: Def<string>;
  summary: Def<string>;
  result: Json<Record<string, unknown>> | null;
  appliedById: number | null;
  createdAt: Def<Date>;
  appliedAt: Nullable<Date>;
}

export interface SessionsTable {
  id: Generated<number>;
  userId: number;
  tokenHash: string;
  createdAt: Def<Date>;
  expiresAt: Timestamp;
}

export interface SchemaMigrationsTable {
  version: Def<number>;
  name: Def<string>;
  appliedAt: Def<Date>;
}

export interface DB {
  schemaMigrations: SchemaMigrationsTable;
  organizations: OrganizationsTable;
  users: UsersTable;
  projects: ProjectsTable;
  projectMembers: ProjectMembersTable;
  journeys: JourneysTable;
  journeyStages: JourneyStagesTable;
  milestones: MilestonesTable;
  activities: ActivitiesTable;
  deliverables: DeliverablesTable;
  requirements: RequirementsTable;
  documents: DocumentsTable;
  designArtifacts: DesignArtifactsTable;
  reviews: ReviewsTable;
  decisions: DecisionsTable;
  dependencies: DependenciesTable;
  risks: RisksTable;
  activityLog: ActivityLogTable;
  assistantThreads: AssistantThreadsTable;
  assistantMessages: AssistantMessagesTable;
  assistantActions: AssistantActionsTable;
  sessions: SessionsTable;
}
