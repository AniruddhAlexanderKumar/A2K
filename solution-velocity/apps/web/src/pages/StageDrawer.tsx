import { useEffect, useState } from 'react';
import type { JourneyPayload, Requirement, DocumentRecord, Review, DesignArtifactSummary, StageView } from '@sv/shared';
import { ACTIVITY_STATUS_LABEL, PRIORITY_LABEL, humanize } from '@sv/shared';
import { api, ApiError } from '../lib/api';
import { Badge, Drawer, Progress, RichText, Skeleton, StatusBadge, Toast, dateLabel, relativeTime } from '../components/ui';
import { useToast } from '../components/useToast';
import { InlineAsk } from '../components/InlineAsk';

type StagePayload = {
  stage: { id: number; name: string; description: string; objective: string; position: number };
  milestone: { id: number; name: string; description: string; dueDate: string | null; status: string } | null;
  activities: {
    id: number;
    title: string;
    description: string;
    status: string;
    priority: string;
    assigneeName: string | null;
    assigneeId: number | null;
    dueDate: string | null;
    blockedReason: string | null;
  }[];
  deliverables: { id: number; title: string; status: string; kind: string; activityId: number | null }[];
  requirements: Requirement[];
  documents: DocumentRecord[];
  reviews: Review[];
  artifacts: DesignArtifactSummary[];
};

/**
 * A stage is the chapter of the Journey. Opening it shows the activities that make it up
 * plus everything the stage owns — requirements, documents, deliverables, reviews and
 * linked design artifacts — in one place.
 */
export function StageDrawer({
  stageId,
  data,
  canManage,
  canWrite,
  onClose,
  onChanged,
  onOpenActivity,
}: {
  stageId: number;
  data: JourneyPayload;
  canManage: boolean;
  canWrite: boolean;
  onClose: () => void;
  onChanged: (message?: string) => Promise<void>;
  onOpenActivity: (id: number) => void;
}) {
  const [payload, setPayload] = useState<StagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newActivity, setNewActivity] = useState('');
  const [addingRequirement, setAddingRequirement] = useState(false);
  const [reqTitle, setReqTitle] = useState('');
  const { toast, show, clear } = useToast();

  const stageView: StageView | undefined = data.stages.find((s) => s.id === stageId);

  const load = async () => {
    try {
      const res = await api.get<StagePayload>(`/journey/stage/${stageId}`);
      setPayload(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this stage');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  const patchStage = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await api.patch(`/journey/stage/${stageId}`, body);
      await load();
      await onChanged();
      show(message, 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the stage');
    } finally {
      setBusy(false);
    }
  };

  const addActivity = async () => {
    if (newActivity.trim().length < 2) return;
    setBusy(true);
    try {
      await api.post(`/projects/${data.project.id}/activities`, {
        stageId,
        title: newActivity.trim(),
      });
      setNewActivity('');
      await load();
      await onChanged();
      show('Activity added to this stage', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the activity');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      onClose={onClose}
      title={
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span className="small muted">
              Stage {stageView ? stageView.position + 1 : ''} of {data.stages.length}
            </span>
            {stageView ? <Badge tone={stageView.status}>{stageView.status}</Badge> : null}
            {stageView?.progress === 1 ? <Badge tone="complete">Complete</Badge> : null}
          </div>
          <h2 style={{ fontSize: '1.12rem' }}>{stageView?.name}</h2>
        </div>
      }
      actions={<InlineAsk projectId={data.project.id} label="Ask about this stage" />}
    >
      {error ? <div className="form-error">{error}</div> : null}
      {!payload || !stageView ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <p style={{ fontSize: '0.92rem', color: 'var(--ink-soft)' }}>{stageView.description}</p>
          <div className="card card-pad" style={{ marginTop: 14, background: 'var(--surface-alt)', border: '1px solid var(--line-soft)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>
              Stage objective
            </div>
            <p style={{ fontSize: '0.9rem' }}>{stageView.objective}</p>
            <div className="row" style={{ marginTop: 12, gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Progress value={stageView.progress} thin />
              </div>
              <span className="small muted nowrap">
                {stageView.completedCount}/{stageView.activityCount} activities · {Math.round(stageView.progress * 100)}%
              </span>
            </div>
            {stageView.milestone ? (
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                <span style={{ fontSize: '0.85rem' }}>
                  <strong>Milestone:</strong> {stageView.milestone.name}
                </span>
                <Badge tone={stageView.milestone.status === 'completed' ? 'complete' : 'upcoming'}>
                  {stageView.milestone.status === 'completed'
                    ? `Achieved ${dateLabel(stageView.milestone.completedAt)}`
                    : `Target ${dateLabel(stageView.milestone.dueDate)}`}
                </Badge>
              </div>
            ) : null}
            <p className="hint" style={{ marginTop: 8 }}>
              {stageView.hint}
            </p>
          </div>

          <div className="section-title" style={{ marginTop: 20 }}>
            Activities
          </div>
          {payload.activities.length === 0 ? <p className="empty-note">No activities in this stage yet.</p> : null}
          <div className="item-list">
            {payload.activities.map((a) => {
              const nextAction = data.nextActions.find((x) => x.kind === 'activity' && x.id === a.id);
              return (
                <button
                  key={a.id}
                  className="item"
                  style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', width: '100%' }}
                  onClick={() => onOpenActivity(a.id)}
                  aria-label={`Open activity: ${a.title}`}
                >
                  <StatusBadge status={a.status} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="item-title">{a.title}</div>
                    <div className="item-sub">
                      {a.assigneeName ? a.assigneeName : 'Unassigned'} · {PRIORITY_LABEL[a.priority as keyof typeof PRIORITY_LABEL]} priority
                      {a.dueDate ? ` · due ${dateLabel(a.dueDate)}` : ''}
                      {a.status === 'blocked' && a.blockedReason ? ` · ${a.blockedReason}` : ''}
                    </div>
                  </div>
                  {nextAction ? <Badge tone="active">Next</Badge> : null}
                  <span className="link-button">Open</span>
                </button>
              );
            })}
          </div>

          {canWrite ? (
            <form
              className="row"
              style={{ marginTop: 10, gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                void addActivity();
              }}
            >
              <input
                className="input"
                aria-label="Add an activity to this stage"
                placeholder="Add an activity to this stage"
                value={newActivity}
                onChange={(e) => setNewActivity(e.target.value)}
              />
              <button className="btn secondary" type="submit" disabled={busy || newActivity.trim().length < 2}>
                Add
              </button>
            </form>
          ) : null}

          <div className="section-title" style={{ marginTop: 22 }}>
            Requirements in this stage ({payload.requirements.length})
          </div>
          {payload.requirements.length === 0 ? <p className="empty-note">No requirements captured for this stage.</p> : null}
          <div className="item-list">
            {payload.requirements.slice(0, 8).map((r) => (
              <div key={r.id} className="item">
                <span className="mono muted">{r.ref}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="item-title">{r.title}</div>
                  <div className="item-sub">{humanize(r.type)} · {humanize(r.status)}</div>
                </div>
              </div>
            ))}
          </div>
          {canWrite && addingRequirement ? (
            <form
              className="row"
              style={{ marginTop: 8, gap: 8 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (reqTitle.trim().length < 2) return;
                try {
                  await api.post(`/projects/${data.project.id}/requirements`, {
                    title: reqTitle.trim(),
                    stageId,
                  });
                  setReqTitle('');
                  setAddingRequirement(false);
                  await load();
                  await onChanged();
                  show('Requirement added to this stage', 'success');
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Could not add the requirement');
                }
              }}
            >
              <input className="input" placeholder="Requirement title" value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} autoFocus />
              <button className="btn secondary" type="submit">
                Add
              </button>
            </form>
          ) : canWrite ? (
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setAddingRequirement(true)}>
              + Requirement for this stage
            </button>
          ) : null}

          <div className="section-title" style={{ marginTop: 22 }}>
            Documents ({payload.documents.length})
          </div>
          {payload.documents.length === 0 ? <p className="empty-note">No documentation linked to this stage.</p> : null}
          <div className="item-list">
            {payload.documents.map((d) => (
              <details key={d.id} className="item" style={{ display: 'block' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.88rem', fontWeight: 570 }}>
                  {d.title} <span className="small muted">· {humanize(d.kind)} · v{d.version}</span>
                </summary>
                <div style={{ marginTop: 10, fontSize: '0.88rem' }}>
                  <RichText text={d.content || '_Empty document._'} />
                </div>
              </details>
            ))}
          </div>

          <div className="section-title" style={{ marginTop: 22 }}>
            Deliverables ({payload.deliverables.length})
          </div>
          {payload.deliverables.length === 0 ? <p className="empty-note">No deliverables in this stage.</p> : null}
          <div className="item-list">
            {payload.deliverables.map((d) => (
              <div key={d.id} className="item">
                <Badge tone={d.status} dot>
                  {humanize(d.status)}
                </Badge>
                <div style={{ minWidth: 0 }}>
                  <div className="item-title">{d.title}</div>
                  <div className="item-sub">{humanize(d.kind)}</div>
                </div>
                {d.activityId ? (
                  <button className="link-button item-actions" onClick={() => onOpenActivity(d.activityId!)}>
                    Activity
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="section-title" style={{ marginTop: 22 }}>
            Reviews & approvals ({payload.reviews.length})
          </div>
          {payload.reviews.length === 0 ? <p className="empty-note">No reviews requested in this stage.</p> : null}
          <div className="item-list">
            {payload.reviews.map((r) => (
              <div key={r.id} className="item">
                <Badge tone={r.status} dot>
                  {humanize(r.status)}
                </Badge>
                <div style={{ minWidth: 0 }}>
                  <div className="item-title">{r.title}</div>
                  <div className="item-sub">
                    {humanize(r.kind)} · requested by {r.requestedByName ?? '—'} · {relativeTime(r.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-title" style={{ marginTop: 22 }}>
            Design artifacts ({payload.artifacts.length})
          </div>
          {payload.artifacts.length === 0 ? <p className="empty-note">No Design Studio artifacts linked to this stage.</p> : null}
          <div className="item-list">
            {payload.artifacts.map((a) => (
              <a key={a.id} href={`/studio?artifact=${a.id}`} className="item">
                <Badge tone="info">{humanize(a.type)}</Badge>
                <div style={{ minWidth: 0 }}>
                  <div className="item-title">{a.name}</div>
                  <div className="item-sub">
                    v{a.version} · {a.scene?.shapes?.length ?? 0} shapes · updated {relativeTime(a.updatedAt)}
                  </div>
                </div>
                <span className="link-button item-actions">Open in Design Studio →</span>
              </a>
            ))}
          </div>

          {canManage ? (
            <div style={{ marginTop: 26, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <div className="section-title">Customise this stage</div>
              <div className="field">
                <label htmlFor="stage-name">Stage name</label>
                <input
                  id="stage-name"
                  className="input"
                  defaultValue={stageView.name}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== stageView.name) {
                      void patchStage({ name: e.target.value.trim() }, 'Stage renamed');
                    }
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="stage-objective">Objective</label>
                <textarea
                  id="stage-objective"
                  className="textarea"
                  defaultValue={stageView.objective}
                  style={{ minHeight: 64 }}
                  onBlur={(e) => {
                    if (e.target.value !== stageView.objective) {
                      void patchStage({ objective: e.target.value }, 'Objective updated');
                    }
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="stage-status">Stage state</label>
                <select
                  id="stage-status"
                  className="select"
                  value={stageView.status}
                  disabled={busy}
                  onChange={(e) => void patchStage({ statusOverride: e.target.value }, 'Stage state overridden')}
                >
                  {['upcoming', 'active', 'completed', 'blocked'].map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  By default the stage state is derived from its activities: {ACTIVITY_STATUS_LABEL.in_progress.toLowerCase()} or
                  complete work makes it active, any blocker makes it blocked, and all-complete makes it done. Set it
                  explicitly only when you need to override that.
                </span>
              </div>
            </div>
          ) : null}
        </>
      )}
      {toast ? <Toast {...toast} onDone={clear} /> : null}
    </Drawer>
  );
}
