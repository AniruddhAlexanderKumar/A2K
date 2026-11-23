import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  JOURNEY_TEMPLATES,
  PROJECT_TYPES,
  type JourneyPayload,
  type StageView,
} from '@sv/shared';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Badge, EmptyState, Modal, Progress, Skeleton, Toast, dateLabel } from '../components/ui';
import { ActivityDrawer } from './ActivityDrawer';
import { StageDrawer } from './StageDrawer';
import { CreateProjectModal } from './CreateProjectModal';
import { useToast } from '../components/useToast';

export function JourneyPage() {
  const { activeProjectId, projects, loadingProjects, setActiveProject, refreshProjects, user } = useStore();
  const [data, setData] = useState<JourneyPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast, show, clear } = useToast();
  const [newProjectOpen, setNewProjectOpen] = useState(params.get('new') === 'project');

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get<JourneyPayload>(`/journey?projectId=${activeProjectId}`);
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : 'Could not load this Journey');
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (params.get('new') === 'project') setNewProjectOpen(true);
  }, [params]);

  const closeNewProject = () => {
    setNewProjectOpen(false);
    if (params.get('new')) {
      params.delete('new');
      setParams(params, { replace: true });
    }
  };

  const openActivity = params.get('activity');
  const openStage = params.get('stage');
  const openApproval = params.get('approval');

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: false });
  };

  const afterMutation = async (message?: string) => {
    await load();
    await refreshProjects();
    if (message) show(message, 'success');
  };

  if (loadingProjects && projects.length === 0) {
    return (
      <main className="main">
        <Skeleton lines={2} />
        <Skeleton lines={4} />
      </main>
    );
  }

  if (projects.length === 0) {
    return (
      <main className="main">
        <EmptyState
          title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}
          body="Every project has its own Journey. Create your first project and Solution Velocity will build a development path for it — stages, milestones, activities and the deliverables each one needs."
          action={
            <button className="btn" onClick={() => setNewProjectOpen(true)}>
              Create your first project
            </button>
          }
        />
        {newProjectOpen ? (
          <CreateProjectModal
            onClose={closeNewProject}
            onCreated={async (projectId) => {
              await refreshProjects();
              setActiveProject(projectId);
              closeNewProject();
              navigate('/journey');
            }}
          />
        ) : null}
        {toast ? <Toast {...toast} onDone={clear} /> : null}
      </main>
    );
  }

  return (
    <main className="main">
      <JourneyHeader
        data={data}
        activeProjectId={activeProjectId}
        projects={projects.slice()}
        onSwitch={(id) => {
          setActiveProject(id);
          setData(null);
        }}
        onNew={() => setNewProjectOpen(true)}
        loading={loading}
      />

      {error ? (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="form-error" style={{ marginBottom: 10 }}>
            {error}
          </div>
          <button className="btn secondary sm" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      {!data && loading ? (
        <div className="card card-pad">
          <Skeleton lines={6} />
        </div>
      ) : null}

      {data ? (
        <div className="journey-layout">
          <div>
            <div className="spread" style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.02em' }}>Development path</h2>
              <span className="small muted">
                {data.stages.filter((s) => s.status === 'completed').length} of {data.stages.length} stages complete
              </span>
            </div>
            <div className={`path${data.stages.every((s) => s.status === 'completed') ? ' done' : ''}`}>
              {data.stages.map((stage, index) => (
                <StageNode
                  key={stage.id}
                  stage={stage}
                  index={index}
                  nextActionForStage={data.nextActions.find((a) => a.stageId === stage.id)}
                  onClick={() => setParam('stage', String(stage.id))}
                  onOpenAction={(href) => {
                    const target = new URLSearchParams(href.split('?')[1] ?? '');
                    const activity = target.get('activity');
                    if (activity) setParam('activity', activity);
                    else setParam('stage', String(stage.id));
                  }}
                />
              ))}
            </div>
          </div>

          <aside className="side-stack">
            <div className="card next-card">
              <div className="card-body">
                <h3>Where to focus next</h3>
                {data.nextActions.map((action) => (
                  <button
                    key={`${action.kind}-${action.id}`}
                    className="next-action"
                    onClick={() => {
                      if (action.href.includes('activity=')) setParam('activity', action.href.split('activity=')[1]);
                      else if (action.href.includes('approval=')) setParam('approval', action.href.split('approval=')[1]);
                      else if (action.stageId) setParam('stage', String(action.stageId));
                    }}
                  >
                    <strong>{action.title}</strong>
                    <span>{action.detail}</span>
                  </button>
                ))}
              </div>
            </div>

            <AttentionPanel
              title="Needs attention"
              items={[
                ...data.blockers.map((b) => ({
                  key: `b-${b.entity}-${b.id}`,
                  tone: 'danger' as const,
                  icon: '!',
                  title: b.title,
                  detail: b.reason,
                  onClick: () => {
                    if (b.entity === 'activity' && b.id > 0) setParam('activity', String(b.id));
                    else if (b.entity === 'risk') navigate('/assistant');
                  },
                })),
                ...data.pendingApprovals.map((a) => ({
                  key: `a-${a.id}`,
                  tone: 'warn' as const,
                  icon: '✓',
                  title: `Approval: ${a.title}`,
                  detail: `${a.stageName} · requested by ${a.requestedBy}`,
                  onClick: () => setParam('approval', String(a.id)),
                })),
                ...data.stats.overdue > 0
                  ? [
                      {
                        key: 'overdue',
                        tone: 'warn' as const,
                        icon: '⏱',
                        title: `${data.stats.overdue} overdue ${data.stats.overdue === 1 ? 'activity' : 'activities'}`,
                        detail: 'Past their due date and not complete',
                        onClick: () => navigate('/assistant'),
                      },
                    ]
                  : [],
              ]}
            />

            <div className="card">
              <div className="card-header">
                <h3>Milestones</h3>
              </div>
              <div className="card-body">
                {data.milestones.slice(0, 5).map((m) => (
                  <div key={m.id} className="attention-item">
                    <span
                      className="attention-icon"
                      style={
                        m.status === 'completed'
                          ? { background: 'var(--complete-soft)', color: 'var(--complete)' }
                          : { background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }
                      }
                    >
                      {m.status === 'completed' ? '✓' : '◦'}
                    </span>
                    <div>
                      <div className="attention-title">{m.name}</div>
                      <div className="attention-detail">
                        {m.status === 'completed' ? `Achieved ${dateLabel(m.completedAt)}` : `Target ${dateLabel(m.dueDate)}`}
                      </div>
                    </div>
                  </div>
                ))}
                {data.milestones.length === 0 ? <p className="empty-note">No milestones on this Journey yet.</p> : null}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Team</h3>
                <span className="small muted">{data.members.length}</span>
              </div>
              <div className="card-body">
                {data.members.map((m) => (
                  <div key={m.userId} className="row" style={{ padding: '5px 0' }}>
                    <span className="avatar sm" style={{ background: m.avatarColor }}>
                      {m.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                    </span>
                    <span style={{ fontSize: '0.85rem' }}>{m.name}</span>
                    <span className="small muted" style={{ marginLeft: 'auto' }}>
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {data && openActivity ? (
        <ActivityDrawer
          activityId={Number(openActivity)}
          members={data.members}
          canWrite={data.project.myRole !== 'viewer'}
          onClose={() => setParam('activity', null)}
          onChanged={afterMutation}
        />
      ) : null}

      {data && openStage ? (
        <StageDrawer
          stageId={Number(openStage)}
          data={data}
          canManage={data.project.myRole === 'lead'}
          canWrite={data.project.myRole !== 'viewer'}
          onClose={() => setParam('stage', null)}
          onChanged={afterMutation}
          onOpenActivity={(id) => setParam('activity', String(id))}
        />
      ) : null}

      {data && openApproval ? (
        <ApprovalModal
          projectId={data.project.id}
          reviewId={Number(openApproval)}
          canDecide={data.project.myRole !== 'viewer'}
          onClose={() => setParam('approval', null)}
          onChanged={afterMutation}
        />
      ) : null}

      {newProjectOpen ? (
        <CreateProjectModal
          onClose={closeNewProject}
          onCreated={async (projectId) => {
            await refreshProjects();
            setActiveProject(projectId);
            closeNewProject();
            navigate('/journey');
          }}
        />
      ) : null}

      {toast ? <Toast {...toast} onDone={clear} /> : null}
    </main>
  );
}

/* ------------------------------------------------------------------ */

function JourneyHeader({
  data,
  projects,
  activeProjectId,
  onSwitch,
  onNew,
  loading,
}: {
  data: JourneyPayload | null;
  projects: JourneyPayload['project'][];
  activeProjectId: number | null;
  onSwitch: (id: number) => void;
  onNew: () => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const project = data?.project ?? projects.find((p) => p.id === activeProjectId) ?? null;
  if (!project) return null;

  return (
    <section className="journey-head" aria-label="Current project">
      <div className="project-switcher">
        <div className="dropdown">
          <button className="project-select" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox">
            <span className="project-code">{project.code}</span>
            <span className="project-name">{project.name}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open ? (
            <div className="dropdown-panel" role="listbox">
              <div className="dropdown-list">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    role="option"
                    aria-selected={p.id === project.id}
                    className={`dropdown-item${p.id === project.id ? ' selected' : ''}`}
                    onClick={() => {
                      onSwitch(p.id);
                      setOpen(false);
                    }}
                  >
                    <span className="project-code">{p.code}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600 }}>{p.name}</span>
                      <span className="small muted">
                        {Math.round(p.progress * 100)}% · {p.currentStageName ?? 'Complete'} · {p.memberCount} members
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="dropdown-footer">
                <button
                  className="btn secondary sm block"
                  onClick={() => {
                    setOpen(false);
                    onNew();
                  }}
                >
                  + New project
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <Badge tone="info">{project.templateName}</Badge>
        <Badge tone={project.myRole === 'lead' ? 'active' : 'upcoming'}>
          {project.myRole === 'lead' ? 'You lead this project' : `You are ${project.myRole}`}
        </Badge>
        <div className="grow" />
        <button className="btn secondary sm" onClick={onNew}>
          + New project
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <h1 style={{ fontSize: '1.34rem' }}>{project.name}</h1>
        <p className="muted small" style={{ marginTop: 4, maxWidth: '70ch' }}>
          {project.description || 'No description yet.'}
        </p>
      </div>

      <div className="journey-summary">
        <div className="stat">
          <div className="stat-value">{Math.round(project.progress * 100)}%</div>
          <div className="stat-label">Journey complete</div>
          <div style={{ marginTop: 8 }}>
            <Progress value={project.progress} thin />
          </div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ fontSize: '1rem', lineHeight: 1.4 }}>
            {project.currentStageName ?? 'All stages complete'}
          </div>
          <div className="stat-label">Current stage</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {data ? `${data.stats.completed}/${data.stats.activities}` : '—'}
          </div>
          <div className="stat-label">Activities done</div>
        </div>
        <div className={`stat${project.openBlockers > 0 ? ' alert' : ''}`}>
          <div className="stat-value">{loading && !data ? '—' : project.openBlockers}</div>
          <div className="stat-label">Blockers</div>
        </div>
        <div className={`stat${project.pendingApprovals > 0 ? ' attention' : ''}`}>
          <div className="stat-value">{loading && !data ? '—' : project.pendingApprovals}</div>
          <div className="stat-label">Approvals pending</div>
        </div>
      </div>
    </section>
  );
}

function StageNode({
  stage,
  index,
  nextActionForStage,
  onClick,
  onOpenAction,
}: {
  stage: StageView;
  index: number;
  nextActionForStage?: { title: string; detail: string; href: string };
  onClick: () => void;
  onOpenAction: (href: string) => void;
}) {
  const statusClass = stage.status;
  const dotContent =
    stage.status === 'completed' ? '✓' : stage.status === 'blocked' ? '!' : stage.status === 'active' ? '▶' : index + 1;
  return (
    <div className="node">
      <div className="node-rail">
        <span className={`node-dot ${statusClass}`} aria-hidden="true">
          {dotContent}
        </span>
      </div>
      <div
        className={`node-card ${statusClass}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        aria-label={`${stage.name}, ${stage.status}. Open stage.`}
      >
        <div className="node-top">
          <div style={{ minWidth: 0 }}>
            <div className="node-title">{stage.name}</div>
            <div className="node-hint">{stage.hint}</div>
          </div>
          <Badge tone={stage.status === 'completed' ? 'complete' : stage.status}>{stage.status}</Badge>
        </div>

        {stage.status !== 'upcoming' ? <p className="node-objective">{stage.objective}</p> : null}

        <div className="node-meta">
          <div className="node-progress">
            <Progress
              value={stage.progress}
              tone={stage.status === 'blocked' ? 'blocked' : stage.status === 'completed' ? 'complete' : undefined}
              thin
            />
            <span className="pct">{Math.round(stage.progress * 100)}%</span>
          </div>
          <span className="small muted nowrap">
            {stage.completedCount}/{stage.activityCount} activities
          </span>
          {stage.blockedCount > 0 ? <Badge tone="blocked">{stage.blockedCount} blocked</Badge> : null}
          {stage.pendingApprovals > 0 ? <Badge tone="pending">{stage.pendingApprovals} approval</Badge> : null}
          {stage.milestone ? (
            <span className={`milestone-chip${stage.milestone.status === 'completed' ? ' complete' : ''}`}>
              {stage.milestone.status === 'completed' ? '✓' : '◇'} {stage.milestone.name}
              {stage.milestone.status !== 'completed' ? ` · ${dateLabel(stage.milestone.dueDate)}` : ''}
            </span>
          ) : null}
        </div>

        {nextActionForStage ? (
          <div className="node-nudge">
            <span className="nudge-text">
              <strong>Next:</strong> {nextActionForStage.title}
            </span>
            <button
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAction(nextActionForStage.href);
              }}
            >
              Continue
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AttentionPanel({
  title,
  items,
}: {
  title: string;
  items: { key: string; tone: 'danger' | 'warn' | 'info'; icon: string; title: string; detail: string; onClick: () => void }[];
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>{title}</h3>
        {items.length > 0 ? <Badge tone={items.some((i) => i.tone === 'danger') ? 'blocked' : 'pending'}>{items.length}</Badge> : null}
      </div>
      <div className="card-body">
        {items.length === 0 ? (
          <p className="empty-note">Nothing is blocked and no approvals are waiting. Keep going.</p>
        ) : (
          items.slice(0, 6).map((item) => (
            <button
              key={item.key}
              className="attention-item"
              style={{ border: 0, background: 'none', textAlign: 'left', padding: '10px 0', cursor: 'pointer', width: '100%' }}
              onClick={item.onClick}
            >
              <span className={`attention-icon ${item.tone}`}>{item.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span className="attention-title" style={{ display: 'block' }}>
                  {item.title}
                </span>
                <span className="attention-detail" style={{ display: 'block' }}>
                  {item.detail}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ApprovalModal({
  projectId,
  reviewId,
  canDecide,
  onClose,
  onChanged,
}: {
  projectId: number;
  reviewId: number;
  canDecide: boolean;
  onClose: () => void;
  onChanged: (msg?: string) => Promise<void>;
}) {
  const [review, setReview] = useState<{
    title: string;
    kind: string;
    note: string;
    status: string;
    requestedByName: string | null;
    reviewerName: string | null;
  } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ reviews: (NonNullable<typeof review> & { id: number })[] }>(`/projects/${projectId}/reviews`)
      .then((res) => setReview(res.reviews.find((r) => r.id === reviewId) ?? null))
      .catch(() => setError('Could not load this approval'));
  }, [projectId, reviewId]);

  const decide = async (decision: 'approved' | 'changes_requested') => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/reviews/${reviewId}/decide`, { decision, note });
      await onChanged(decision === 'approved' ? 'Approved — the Journey advanced' : 'Returned for changes');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the decision');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Approval requested"
      subtitle="Approvals gate stage completion. Deciding them is the fastest way to move the Journey forward."
      onClose={onClose}
      footer={
        canDecide && review?.status === 'pending' ? (
          <>
            <button className="btn secondary" disabled={busy} onClick={() => void decide('changes_requested')}>
              Request changes
            </button>
            <button className="btn" disabled={busy} onClick={() => void decide('approved')}>
              Approve
            </button>
          </>
        ) : (
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      {!review ? (
        <Skeleton lines={2} block={false} />
      ) : (
        <>
          <h3 style={{ marginBottom: 6 }}>{review.title}</h3>
          <p className="small muted" style={{ marginBottom: 14 }}>
            {review.kind === 'approval' ? 'Approval' : 'Review'} · requested by {review.requestedByName ?? 'a teammate'}
            {review.reviewerName ? ` · assigned to ${review.reviewerName}` : ''}
          </p>
          {review.note ? <p style={{ fontSize: '0.9rem', marginBottom: 14 }}>{review.note}</p> : null}
          {review.status !== 'pending' ? (
            <Badge tone={review.status}>{review.status.replace('_', ' ')}</Badge>
          ) : (
            <div className="field">
              <label htmlFor="decision-note">Decision note (optional)</label>
              <textarea
                id="decision-note"
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Record the rationale so the decision is traceable later."
              />
            </div>
          )}
          {!canDecide ? <p className="hint">Your project role is view-only, so you cannot decide this approval.</p> : null}
        </>
      )}
    </Modal>
  );
}

/** Kept for template previews in the create-project flow. */
export function templatePreview(templateKey: string) {
  const template = JOURNEY_TEMPLATES.find((t) => t.key === templateKey) ?? JOURNEY_TEMPLATES[JOURNEY_TEMPLATES.length - 1];
  return { template, projectType: PROJECT_TYPES.find((p) => p.template === templateKey) };
}

export const money = (n: number) => n.toFixed(2);
