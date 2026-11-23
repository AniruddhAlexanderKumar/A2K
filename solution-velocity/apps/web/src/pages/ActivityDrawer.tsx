import { useCallback, useEffect, useState } from 'react';
import type { ActivityDetail, ProjectMember } from '@sv/shared';
import { ACTIVITY_STATUS_LABEL, PRIORITY_LABEL, humanize } from '@sv/shared';
import { api, ApiError } from '../lib/api';
import { Badge, Drawer, RichText, Skeleton, StatusBadge, Toast, dateLabel, relativeTime, toInputDate } from '../components/ui';
import { useToast } from '../components/useToast';
import { InlineAsk } from '../components/InlineAsk';

type Tab = 'work' | 'deliverables' | 'requirements' | 'documents' | 'design' | 'reviews' | 'dependencies' | 'history';

/**
 * The activity is the unit of work in the Journey. Everything a team produces for it —
 * deliverables, requirements, documents, designs, reviews, decisions and dependencies —
 * is attached here, so no workflow needs a separate module.
 */
export function ActivityDrawer({
  activityId,
  members,
  canWrite,
  onClose,
  onChanged,
}: {
  activityId: number;
  members: ProjectMember[];
  canWrite: boolean;
  onClose: () => void;
  onChanged: (message?: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [tab, setTab] = useState<Tab>('work');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, show, clear } = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<ActivityDetail>(`/journey/activity/${activityId}`);
      setDetail(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this activity');
    }
  }, [activityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, message: string) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ blocked?: boolean; reason?: string }>(
        `/projects/${detail.activity.projectId}/activities/${activityId}`,
        body,
      );
      await load();
      await onChanged();
      if (res?.blocked) show(res.reason ?? 'Blocked by an unmet dependency', 'error');
      else show(message, 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the change');
    } finally {
      setBusy(false);
    }
  };

  const act = detail?.activity;

  return (
    <Drawer
      onClose={onClose}
      title={
        act ? (
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <Badge tone="info">{detail?.stage.name}</Badge>
              <StatusBadge status={act.status} />
              <Badge tone={act.priority}>{PRIORITY_LABEL[act.priority]} priority</Badge>
            </div>
            <h2 style={{ fontSize: '1.1rem' }}>{act.title}</h2>
          </div>
        ) : (
          <h2 style={{ fontSize: '1.1rem' }}>Loading activity…</h2>
        )
      }
      actions={
        act && canWrite ? (
          <select
            className="status-select"
            value={act.status}
            disabled={busy}
            onChange={(e) => void patch({ status: e.target.value }, `Moved to ${ACTIVITY_STATUS_LABEL[e.target.value as typeof act.status]}`)}
            aria-label="Change activity status"
          >
            {Object.entries(ACTIVITY_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      {!detail || !act ? (
        <Skeleton lines={6} />
      ) : (
        <>
          {act.status === 'blocked' && act.blockedReason ? (
            <div className="form-error" style={{ background: 'var(--danger-soft)', marginBottom: 14 }}>
              Blocked: {act.blockedReason}
            </div>
          ) : null}

          <div className="meta-grid">
            <div className="meta-item">
              <label>Assignee</label>
              <select
                className="status-select"
                value={act.assigneeId ?? ''}
                disabled={!canWrite || busy}
                onChange={(e) =>
                  void patch(
                    { assigneeId: e.target.value ? Number(e.target.value) : null },
                    e.target.value
                      ? `Assigned to ${members.find((m) => m.userId === Number(e.target.value))?.name}`
                      : 'Assignee cleared',
                  )
                }
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="meta-item">
              <label>Due date</label>
              <input
                type="date"
                className="status-select"
                value={toInputDate(act.dueDate)}
                disabled={!canWrite || busy}
                onChange={(e) => void patch({ dueDate: e.target.value || null }, 'Due date updated')}
              />
            </div>
            <div className="meta-item">
              <label>Priority</label>
              <select
                className="status-select"
                value={act.priority}
                disabled={!canWrite || busy}
                onChange={(e) => void patch({ priority: e.target.value }, 'Priority updated')}
              >
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="meta-item">
              <label>Completed</label>
              <span style={{ fontSize: '0.86rem', paddingTop: 5 }}>{act.completedAt ? dateLabel(act.completedAt) : '—'}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="activity-description">Description</label>
            <textarea
              id="activity-description"
              className="textarea"
              defaultValue={act.description}
              disabled={!canWrite}
              placeholder="What does done look like for this activity?"
              onBlur={(e) => {
                if (e.target.value !== act.description) void patch({ description: e.target.value }, 'Description saved');
              }}
              style={{ minHeight: 72 }}
            />
          </div>

          {act.status === 'blocked' && canWrite ? (
            <div className="field">
              <label htmlFor="blocked-reason">What is blocking this?</label>
              <input
                id="blocked-reason"
                className="input"
                defaultValue={act.blockedReason ?? ''}
                placeholder="Name the specific blocker — the Journey surfaces it on the path."
                onBlur={(e) => {
                  if (e.target.value !== (act.blockedReason ?? '')) void patch({ blockedReason: e.target.value }, 'Blocker recorded');
                }}
              />
            </div>
          ) : null}

          <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {act.status !== 'completed' && canWrite ? (
              <button className="btn sm" disabled={busy} onClick={() => void patch({ status: 'completed' }, 'Activity completed')}>
                Mark complete
              </button>
            ) : null}
            {act.status !== 'in_progress' && act.status !== 'completed' && canWrite && act.unmetDependencyCount === 0 ? (
              <button className="btn secondary sm" disabled={busy} onClick={() => void patch({ status: 'in_progress' }, 'Started')}>
                Start work
              </button>
            ) : null}
            <button
              className="btn secondary sm"
              onClick={() => {
                setTab('deliverables');
                if (act.pendingReviewCount === 0 && canWrite) {
                  const deliverable = detail.deliverables.find((d) => d.status !== 'approved');
                  if (deliverable) {
                    void api
                      .post(`/projects/${act.projectId}/reviews`, {
                        title: `${deliverable.title} review`,
                        kind: 'approval',
                        activityId: act.id,
                        deliverableId: deliverable.id,
                      })
                      .then(async () => {
                        await load();
                        await onChanged();
                        show('Approval requested', 'success');
                      })
                      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not request approval'));
                  } else {
                    show('Create a deliverable first, then request its approval', 'error');
                  }
                }
              }}
              disabled={!canWrite}
            >
              Request approval
            </button>
            <InlineAsk projectId={act.projectId} activityId={act.id} label="Ask the Assistant about this activity" />
          </div>

          <div className="tabs" role="tablist">
            {(
              [
                ['work', 'Overview'],
                ['deliverables', `Deliverables (${detail.deliverables.length})`],
                ['requirements', `Requirements (${detail.requirements.length})`],
                ['documents', `Documents (${detail.documents.length})`],
                ['design', `Design (${detail.artifacts.length})`],
                ['reviews', `Reviews (${detail.reviews.length})`],
                ['dependencies', `Dependencies (${detail.dependencies.length + detail.dependents.length})`],
                ['history', 'History'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'work' ? (
            <WorkTab detail={detail} canWrite={canWrite} onChanged={async () => { await load(); await onChanged(); }} show={show} />
          ) : null}
          {tab === 'deliverables' ? (
            <DeliverablesTab detail={detail} canWrite={canWrite} onChanged={async () => { await load(); await onChanged(); }} show={show} setError={setError} />
          ) : null}
          {tab === 'requirements' ? (
            <RequirementsTab detail={detail} canWrite={canWrite} onChanged={async () => { await load(); await onChanged(); }} show={show} setError={setError} />
          ) : null}
          {tab === 'documents' ? (
            <DocumentsTab detail={detail} canWrite={canWrite} onChanged={async () => { await load(); await onChanged(); }} show={show} setError={setError} />
          ) : null}
          {tab === 'design' ? <DesignTab detail={detail} /> : null}
          {tab === 'reviews' ? <ReviewsTab detail={detail} canWrite={canWrite} onChanged={async () => { await load(); await onChanged(); }} show={show} setError={setError} /> : null}
          {tab === 'dependencies' ? (
            <DependenciesTab detail={detail} canWrite={canWrite} onChanged={async () => { await load(); await onChanged(); }} show={show} setError={setError} />
          ) : null}
          {tab === 'history' ? (
            <div className="timeline">
              {detail.history.length === 0 ? <p className="empty-note">No history recorded for this activity yet.</p> : null}
              {detail.history.map((h) => (
                <div key={h.id} className="timeline-item">
                  <span className="dot" />
                  <div>
                    <div>{h.summary}</div>
                    <div className="timeline-time">
                      {h.actorName} · {relativeTime(h.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      {toast ? <Toast {...toast} onDone={clear} /> : null}
    </Drawer>
  );
}

/* ------------------------------- Tabs ------------------------------ */

function WorkTab({
  detail,
  canWrite,
  onChanged,
  show,
}: {
  detail: ActivityDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  show: (m: string, tone?: 'error' | 'success') => void;
}) {
  const [title, setTitle] = useState('');
  const deliverable = detail.deliverables[0];
  return (
    <>
      <div className="section-title">Deliverable expected</div>
      {deliverable ? (
        <div className="item">
          <Badge tone={deliverable.status} dot>
            {humanize(deliverable.status)}
          </Badge>
          <div style={{ minWidth: 0 }}>
            <div className="item-title">{deliverable.title}</div>
            <div className="item-sub">
              {humanize(deliverable.kind)}
              {deliverable.dueDate ? ` · due ${dateLabel(deliverable.dueDate)}` : ''}
              {deliverable.ownerName ? ` · ${deliverable.ownerName}` : ''}
            </div>
          </div>
        </div>
      ) : (
        <p className="empty-note">No deliverable defined yet. Add one in the Deliverables tab so completion has evidence.</p>
      )}

      <div className="section-title" style={{ marginTop: 18 }}>
        Dependencies
      </div>
      {detail.dependencies.length === 0 && detail.dependents.length === 0 ? (
        <p className="empty-note">Nothing blocks this activity, and nothing waits on it.</p>
      ) : (
        <div className="dep-list">
          {detail.dependencies.map((d) => (
            <div key={`in-${d.id}`} className="dep">
              <span className={`dot ${d.satisfied ? 'met' : 'unmet'}`} />
              <span>
                Needs <strong>{d.fromTitle}</strong> ({humanize(d.fromType)})
              </span>
              <span className="muted small" style={{ marginLeft: 'auto' }}>
                {d.satisfied ? 'met' : humanize(d.fromStatus)}
              </span>
            </div>
          ))}
          {detail.dependents.map((d) => (
            <div key={`out-${d.id}`} className="dep">
              <span className={`dot ${d.toStatus === 'completed' ? 'met' : 'unmet'}`} />
              <span>
                Blocks <strong>{d.toTitle}</strong> ({humanize(d.toType)})
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="section-title" style={{ marginTop: 18 }}>
        Decisions recorded
      </div>
      {detail.decisions.length === 0 ? (
        <p className="empty-note">No decisions recorded on this activity.</p>
      ) : (
        <div className="item-list">
          {detail.decisions.map((d) => (
            <div key={d.id} className="item" style={{ alignItems: 'flex-start' }}>
              <Badge tone={d.status}>{humanize(d.status)}</Badge>
              <div>
                <div className="item-title">{d.title}</div>
                {d.rationale ? <div className="item-sub">{d.rationale}</div> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        <form
          className="row" style={{ marginTop: 12, gap: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim().length < 2) return;
            await api.post(`/projects/${detail.activity.projectId}/decisions`, {
              title: title.trim(),
              activityId: detail.activity.id,
            });
            setTitle('');
            await onChanged();
            show('Decision recorded', 'success');
          }}
        >
          <input className="input" placeholder="Record a decision (e.g. 'Select spring-fed propellant feed')" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn secondary" type="submit" disabled={title.trim().length < 2}>
            Record
          </button>
        </form>
      ) : null}
    </>
  );
}

function DeliverablesTab({
  detail,
  canWrite,
  onChanged,
  show,
  setError,
}: {
  detail: ActivityDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  show: (m: string, tone?: 'error' | 'success') => void;
  setError: (m: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('document');
  const projectId = detail.activity.projectId;

  const setStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/projects/${projectId}/deliverables/${id}`, { status });
      await onChanged();
      show(`Deliverable marked ${humanize(status)}`, 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the deliverable');
    }
  };

  return (
    <>
      {detail.deliverables.length === 0 ? <p className="empty-note">No deliverables yet.</p> : null}
      <div className="item-list">
        {detail.deliverables.map((d) => (
          <div key={d.id} className="item">
            <Badge tone={d.status} dot>
              {humanize(d.status)}
            </Badge>
            <div style={{ minWidth: 0 }}>
              <div className="item-title">{d.title}</div>
              <div className="item-sub">
                {humanize(d.kind)}
                {d.documentId ? ' · document attached' : ''}
                {d.artifactId ? ' · design attached' : ''}
              </div>
            </div>
            {canWrite ? (
              <div className="item-actions">
                <select className="status-select" value={d.status} onChange={(e) => void setStatus(d.id, e.target.value)} aria-label={`Status of ${d.title}`}>
                  {['draft', 'in_review', 'approved', 'superseded'].map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {canWrite ? (
        <form
          className="row" style={{ marginTop: 12, gap: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim().length < 2) return;
            try {
              await api.post(`/projects/${projectId}/deliverables`, {
                activityId: detail.activity.id,
                title: title.trim(),
                kind,
              });
              setTitle('');
              await onChanged();
              show('Deliverable added', 'success');
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not add the deliverable');
            }
          }}
        >
          <input className="input" placeholder="Deliverable title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="status-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {['document', 'specification', 'design', 'report', 'test_plan', 'prototype'].map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </select>
          <button className="btn secondary" type="submit" disabled={title.trim().length < 2}>
            Add
          </button>
        </form>
      ) : null}
      <p className="hint" style={{ marginTop: 8 }}>
        A deliverable is the evidence that an activity is genuinely done. Attach a document or a Design Studio artifact
        to it, then request approval.
      </p>
    </>
  );
}

function RequirementsTab({
  detail,
  canWrite,
  onChanged,
  show,
  setError,
}: {
  detail: ActivityDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  show: (m: string, tone?: 'error' | 'success') => void;
  setError: (m: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const projectId = detail.activity.projectId;

  return (
    <>
      {detail.requirements.length === 0 ? (
        <p className="empty-note">No requirements linked to this activity yet.</p>
      ) : (
        <div className="item-list">
          {detail.requirements.map((r) => (
            <div key={r.id} className="item" style={{ alignItems: 'flex-start' }}>
              <span className="mono" style={{ color: 'var(--ink-muted)', paddingTop: 2 }}>
                {r.ref}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="item-title">{r.title}</div>
                {r.statement ? <div className="item-sub">{r.statement}</div> : null}
              </div>
              <div className="item-actions">
                <Badge tone={r.status}>{humanize(r.status)}</Badge>
                {canWrite ? (
                  <select
                    className="status-select"
                    value={r.status}
                    aria-label={`Status of ${r.ref}`}
                    onChange={async (e) => {
                      try {
                        await api.patch(`/projects/${projectId}/requirements/${r.id}`, { status: e.target.value });
                        await onChanged();
                        show('Requirement updated', 'success');
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : 'Could not update the requirement');
                      }
                    }}
                  >
                    {['draft', 'proposed', 'approved', 'rejected', 'implemented', 'verified'].map((s) => (
                      <option key={s} value={s}>
                        {humanize(s)}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        <form
          style={{ marginTop: 12 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim().length < 2) return;
            try {
              await api.post(`/projects/${projectId}/requirements`, {
                title: title.trim(),
                statement: statement.trim(),
                activityId: detail.activity.id,
                stageId: detail.activity.stageId,
              });
              setTitle('');
              setStatement('');
              await onChanged();
              show('Requirement added', 'success');
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not add the requirement');
            }
          }}
        >
          <div className="field">
            <input className="input" placeholder="Requirement title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <textarea className="textarea" placeholder="Shall statement — what must be true, with a number if possible" value={statement} onChange={(e) => setStatement(e.target.value)} style={{ minHeight: 60 }} />
          </div>
          <button className="btn secondary sm" type="submit" disabled={title.trim().length < 2}>
            Add requirement to this activity
          </button>
        </form>
      ) : null}
    </>
  );
}

function DocumentsTab({
  detail,
  canWrite,
  onChanged,
  show,
  setError,
}: {
  detail: ActivityDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  show: (m: string, tone?: 'error' | 'success') => void;
  setError: (m: string | null) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const projectId = detail.activity.projectId;

  return (
    <>
      {detail.documents.length === 0 ? <p className="empty-note">No documentation attached to this activity.</p> : null}
      <div className="item-list">
        {detail.documents.map((d) => (
          <div key={d.id} style={{ border: '1px solid var(--line)', borderRadius: 9 }}>
            <button
              className="item"
              style={{ border: 0, width: '100%', textAlign: 'left', background: 'none', cursor: 'pointer' }}
              onClick={() => setOpen(open === d.id ? null : d.id)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="item-title">{d.title}</div>
                <div className="item-sub">
                  {humanize(d.kind)} · v{d.version} · {d.ownerName ?? 'unowned'} · {relativeTime(d.updatedAt)}
                </div>
              </div>
              <span className="item-actions">
                <span className="link-button">{open === d.id ? 'Hide' : 'Read'}</span>
              </span>
            </button>
            {open === d.id ? (
              <div style={{ padding: '4px 14px 14px', fontSize: '0.88rem' }}>
                <RichText text={d.content || '_This document is empty._'} />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {canWrite ? (
        draftOpen ? (
          <form
            style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (title.trim().length < 2) return;
              try {
                await api.post(`/projects/${projectId}/documents`, {
                  title: title.trim(),
                  content,
                  activityId: detail.activity.id,
                  stageId: detail.activity.stageId,
                });
                setTitle('');
                setContent('');
                setDraftOpen(false);
                await onChanged();
                show('Document created', 'success');
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Could not create the document');
              }
            }}
          >
            <div className="field">
              <label htmlFor="doc-title">Document title</label>
              <input id="doc-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Preliminary analysis report" />
            </div>
            <div className="field">
              <label htmlFor="doc-content">Content</label>
              <textarea id="doc-content" className="textarea" value={content} onChange={(e) => setContent(e.target.value)} style={{ minHeight: 130 }} placeholder="Markdown is supported." />
            </div>
            <div className="row">
              <button className="btn sm" type="submit" disabled={title.trim().length < 2}>
                Create document
              </button>
              <button className="btn ghost sm" type="button" onClick={() => setDraftOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn secondary sm" style={{ marginTop: 12 }} onClick={() => setDraftOpen(true)}>
            + New document for this activity
          </button>
        )
      ) : null}
    </>
  );
}

function DesignTab({ detail }: { detail: ActivityDetail }) {
  return (
    <>
      {detail.artifacts.length === 0 ? (
        <p className="empty-note">
          No Design Studio artifacts are linked to this activity. Open Design Studio, create or open an artifact, and set
          this activity as its Journey link.
        </p>
      ) : (
        <div className="item-list">
          {detail.artifacts.map((a) => (
            <a key={a.id} className="item" href={`/studio?artifact=${a.id}`}>
              <Badge tone="info">{humanize(a.type)}</Badge>
              <div style={{ minWidth: 0 }}>
                <div className="item-title">{a.name}</div>
                <div className="item-sub">
                  v{a.version} · {a.scene?.shapes?.length ?? 0} shapes · {a.ownerName ?? 'unowned'} · updated {relativeTime(a.updatedAt)}
                </div>
              </div>
              <span className="item-actions">
                <span className="link-button">Open in Design Studio →</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function ReviewsTab({
  detail,
  canWrite,
  onChanged,
  show,
  setError,
}: {
  detail: ActivityDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  show: (m: string, tone?: 'error' | 'success') => void;
  setError: (m: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const projectId = detail.activity.projectId;

  const decide = async (id: number, decision: string) => {
    try {
      await api.post(`/projects/${projectId}/reviews/${id}/decide`, { decision });
      await onChanged();
      show(decision === 'approved' ? 'Approved' : 'Changes requested', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the decision');
    }
  };

  return (
    <>
      {detail.reviews.length === 0 ? <p className="empty-note">No reviews or approvals requested for this activity.</p> : null}
      <div className="item-list">
        {detail.reviews.map((r) => (
          <div key={r.id} className="item" style={{ alignItems: 'flex-start' }}>
            <Badge tone={r.status} dot>
              {humanize(r.status)}
            </Badge>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="item-title">{r.title}</div>
              <div className="item-sub">
                {humanize(r.kind)} · requested by {r.requestedByName ?? '—'}
                {r.reviewerName ? ` · reviewer ${r.reviewerName}` : ''}
              </div>
              {r.decisionNote ? <div className="item-sub">“{r.decisionNote}”</div> : null}
            </div>
            {canWrite && r.status === 'pending' ? (
              <div className="item-actions">
                <button className="btn sm" onClick={() => void decide(r.id, 'approved')}>
                  Approve
                </button>
                <button className="btn secondary sm" onClick={() => void decide(r.id, 'changes_requested')}>
                  Changes
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {canWrite ? (
        <form
          className="row" style={{ marginTop: 12, gap: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim().length < 2) return;
            try {
              await api.post(`/projects/${projectId}/reviews`, {
                title: title.trim(),
                kind: 'approval',
                activityId: detail.activity.id,
              });
              setTitle('');
              await onChanged();
              show('Approval requested', 'success');
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not request the approval');
            }
          }}
        >
          <input className="input" placeholder="Approval title (e.g. 'Preliminary mass budget')" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn secondary" type="submit" disabled={title.trim().length < 2}>
            Request
          </button>
        </form>
      ) : null}
    </>
  );
}

function DependenciesTab({
  detail,
  canWrite,
  onChanged,
  show,
  setError,
}: {
  detail: ActivityDetail;
  canWrite: boolean;
  onChanged: () => Promise<void>;
  show: (m: string, tone?: 'error' | 'success') => void;
  setError: (m: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<{ id: number; title: string; stageId: number; status: string }[]>([]);
  const [selected, setSelected] = useState('');
  const projectId = detail.activity.projectId;

  useEffect(() => {
    api
      .get<{ activities: { id: number; title: string; stageId: number; status: string }[] }>(`/projects/${projectId}/activities`)
      .then((res) => setCandidates(res.activities.filter((a) => a.id !== detail.activity.id)))
      .catch(() => undefined);
  }, [projectId, detail.activity.id]);

  const add = async () => {
    if (!selected) return;
    try {
      await api.post(`/projects/${projectId}/dependencies`, {
        fromType: 'activity',
        fromId: Number(selected),
        toType: 'activity',
        toId: detail.activity.id,
        note: 'Depends on a prerequisite activity',
      });
      setSelected('');
      await onChanged();
      show('Dependency added', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the dependency');
    }
  };

  return (
    <>
      <div className="section-title">This activity needs</div>
      {detail.dependencies.length === 0 ? <p className="empty-note">No prerequisites. It can start immediately.</p> : null}
      <div className="dep-list">
        {detail.dependencies.map((d) => (
          <div key={d.id} className="dep">
            <span className={`dot ${d.satisfied ? 'met' : 'unmet'}`} />
            <span>
              <strong>{d.fromTitle}</strong> <span className="muted">({humanize(d.fromType)})</span>
            </span>
            <span className="small muted" style={{ marginLeft: 'auto' }}>
              {d.satisfied ? 'satisfied' : humanize(d.fromStatus)}
            </span>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>
        This activity unblocks
      </div>
      {detail.dependents.length === 0 ? <p className="empty-note">Nothing downstream depends on this yet.</p> : null}
      <div className="dep-list">
        {detail.dependents.map((d) => (
          <div key={d.id} className="dep">
            <span className={`dot ${d.toStatus === 'completed' ? 'met' : 'unmet'}`} />
            <span>
              <strong>{d.toTitle}</strong> <span className="muted">({humanize(d.toType)})</span>
            </span>
          </div>
        ))}
      </div>

      {canWrite ? (
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Choose a prerequisite activity">
            <option value="">Choose a prerequisite activity…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({humanize(c.status)})
              </option>
            ))}
          </select>
          <button className="btn secondary" disabled={!selected} onClick={() => void add()}>
            Add dependency
          </button>
        </div>
      ) : null}
    </>
  );
}
