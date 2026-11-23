import type { Database } from '../db/client.js';
import { loadJourney } from '../lib/journey.js';
import type { JourneyPayload } from '@sv/shared';

export type ProjectContext = {
  journey: JourneyPayload;
  requirements: {
    id: number;
    ref: string;
    title: string;
    statement: string;
    type: string;
    status: string;
    priority: string;
    stageId: number | null;
  }[];
  documents: { id: number; title: string; kind: string; stageId: number | null; excerpt: string; aiGenerated: boolean }[];
  artifacts: {
    id: number;
    name: string;
    type: string;
    stageId: number | null;
    activityId: number | null;
    description: string;
    shapes: number;
  }[];
  decisions: { id: number; title: string; rationale: string; stageId: number | null }[];
  risks: { id: number; title: string; description: string; severity: string; status: string; mitigation: string }[];
  recentHistory: { verb: string; summary: string; createdAt: string }[];
};

const EXCERPT_LIMIT = 600;

/**
 * Builds the context for one project only. Every query is scoped by projectId,
 * so switching projects can never mix context between them.
 */
export async function buildProjectContext(db: Database, projectId: number, userId: number): Promise<ProjectContext> {
  const journey = await loadJourney(db, projectId, userId);

  const requirements = await db
    .selectFrom('requirements')
    .select(['id', 'ref', 'title', 'statement', 'type', 'status', 'priority', 'stageId'])
    .where('projectId', '=', projectId)
    .orderBy('id', 'asc')
    .execute();

  const documents = await db
    .selectFrom('documents')
    .select(['id', 'title', 'kind', 'stageId', 'content', 'aiGenerated'])
    .where('projectId', '=', projectId)
    .orderBy('updatedAt', 'desc')
    .execute();

  const artifacts = await db
    .selectFrom('designArtifacts')
    .select(['id', 'name', 'type', 'stageId', 'activityId', 'description', 'scene'])
    .where('projectId', '=', projectId)
    .execute();

  const decisions = await db
    .selectFrom('decisions')
    .select(['id', 'title', 'rationale', 'stageId'])
    .where('projectId', '=', projectId)
    .execute();

  const risks = await db
    .selectFrom('risks')
    .select(['id', 'title', 'description', 'severity', 'status', 'mitigation'])
    .where('projectId', '=', projectId)
    .execute();

  const history = await db
    .selectFrom('activityLog')
    .select(['verb', 'summary', 'createdAt'])
    .where('projectId', '=', projectId)
    .orderBy('id', 'desc')
    .limit(12)
    .execute();

  return {
    journey,
    requirements,
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      stageId: d.stageId,
      aiGenerated: d.aiGenerated,
      excerpt: d.content.slice(0, EXCERPT_LIMIT),
    })),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      stageId: a.stageId,
      activityId: a.activityId,
      description: a.description,
      shapes: Array.isArray((a.scene as unknown as { shapes?: unknown[] })?.shapes)
        ? ((a.scene as unknown as { shapes: unknown[] }).shapes.length ?? 0)
        : 0,
    })),
    decisions,
    risks,
    recentHistory: history.map((h) => ({
      verb: h.verb,
      summary: h.summary,
      createdAt: new Date(h.createdAt).toISOString(),
    })),
  };
}
