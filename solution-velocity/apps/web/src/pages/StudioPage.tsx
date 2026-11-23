import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DesignArtifactSummary, DesignScene, DesignShape, JourneyPayload } from '@sv/shared';
import { humanize } from '@sv/shared';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Badge, EmptyState, Modal, Skeleton, Toast, relativeTime } from '../components/ui';
import { useToast } from '../components/useToast';
import { InlineAsk } from '../components/InlineAsk';

const PALETTE = ['#31567a', '#2f6f5e', '#7a4a2f', '#5b4a8a', '#8a3f52', '#3f6d8a', '#6a6a2f'];
const SHAPE_KINDS: { key: DesignShape['kind']; label: string }[] = [
  { key: 'rect', label: 'Block' },
  { key: 'ellipse', label: 'Component' },
  { key: 'note', label: 'Note' },
  { key: 'arrow', label: 'Interface' },
];

const emptyScene = (): DesignScene => ({ width: 1200, height: 800, shapes: [] });

/**
 * Design Studio is the creation workspace for the project selected in the shell.
 * Artifacts belong to a project and can be linked to a Journey stage and activity, so
 * design work is traceable to the activity it supports.
 */
export function StudioPage() {
  const { activeProject, activeProjectId, projects } = useStore();
  const [params, setParams] = useSearchParams();
  const [artifacts, setArtifacts] = useState<DesignArtifactSummary[] | null>(null);
  const [journey, setJourney] = useState<JourneyPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, show, clear } = useToast();

  const selected = artifacts?.find((a) => a.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!activeProjectId) return;
    setError(null);
    try {
      const [a, j] = await Promise.all([
        api.get<{ artifacts: DesignArtifactSummary[] }>(`/studio/artifacts?projectId=${activeProjectId}`),
        api.get<JourneyPayload>(`/journey?projectId=${activeProjectId}`),
      ]);
      setArtifacts(a.artifacts);
      setJourney(j);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Design Studio');
      setArtifacts([]);
    }
  }, [activeProjectId]);

  useEffect(() => {
    setArtifacts(null);
    setSelectedId(null);
    void load();
  }, [load]);

  useEffect(() => {
    const fromQuery = params.get('artifact');
    if (fromQuery) setSelectedId(Number(fromQuery));
    else if (artifacts && artifacts.length > 0 && selectedId === null) setSelectedId(artifacts[0].id);
  }, [params, artifacts, selectedId]);

  const select = (id: number | null) => {
    setSelectedId(id);
    const next = new URLSearchParams(params);
    if (id) next.set('artifact', String(id));
    else next.delete('artifact');
    setParams(next, { replace: true });
  };

  if (!activeProject) {
    return (
      <main className="main">
        <EmptyState
          title="Design Studio needs a project"
          body="Design artifacts belong to a project. Create a project from Journey and its designs will be tracked against its Journey stages and activities."
          action={
            <a className="btn" href="/journey?new=project">
              Create a project
            </a>
          }
        />
      </main>
    );
  }

  return (
    <main className="main wide">
      <div className="studio-layout">
        <aside className="studio-side">
          <div className="studio-side-head">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 650 }}>
                  {activeProject.code}
                </div>
                <strong style={{ fontSize: '0.94rem' }}>{activeProject.name}</strong>
              </div>
              <button className="btn sm" onClick={() => setCreating(true)} aria-label="New design artifact">
                +
              </button>
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              Designs are saved to this project and can be linked to its Journey.
            </p>
          </div>
          <div className="studio-list">
            {artifacts === null ? (
              <div style={{ padding: 8 }}>
                <Skeleton lines={4} block={false} />
              </div>
            ) : artifacts.length === 0 ? (
              <p className="empty-note" style={{ padding: 10 }}>
                No artifacts yet. Create one to start designing.
              </p>
            ) : (
              artifacts.map((a) => (
                <button
                  key={a.id}
                  className={`artifact-item${a.id === selectedId ? ' active' : ''}`}
                  onClick={() => select(a.id)}
                >
                  <div className="artifact-name">{a.name}</div>
                  <div className="artifact-meta">
                    {humanize(a.type)} · v{a.version}
                  </div>
                  <div className="artifact-meta">
                    {a.stageName ? `${a.stageName}` : 'Not linked to a stage'}
                    {a.activityTitle ? ` · ${a.activityTitle}` : ''}
                  </div>
                </button>
              ))
            )}
          </div>
          {projects.length > 1 ? (
            <div style={{ padding: 12, borderTop: '1px solid var(--line-soft)' }}>
              <p className="hint">
                Working on {activeProject.name}. Switch project in the header to see another project's designs.
              </p>
            </div>
          ) : null}
        </aside>

        <section className="studio-main">
          {error ? (
            <div style={{ padding: 16 }}>
              <div className="form-error">{error}</div>
            </div>
          ) : null}

          {!selected ? (
            <div className="studio-empty">
              <div style={{ maxWidth: 420 }}>
                <h2 style={{ marginBottom: 8 }}>Design the product inside its project</h2>
                <p className="muted" style={{ marginBottom: 16 }}>
                  Create a system sketch, wireframe or diagram. Every artifact is stored against{' '}
                  <strong>{activeProject.name}</strong>, keeps its version history, and can be attached to the Journey
                  activity it supports — then sent to the Assistant for review.
                </p>
                <button className="btn" onClick={() => setCreating(true)}>
                  Create an artifact
                </button>
              </div>
            </div>
          ) : (
            <CanvasEditor
              key={selected.id}
              artifact={selected}
              projectId={activeProject.id}
              onSaved={async (message) => {
                await load();
                show(message, 'success');
              }}
              onLink={() => setLinking(true)}
              onDelete={async () => {
                if (!confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
                try {
                  await api.del(`/studio/artifacts/${selected.id}`);
                  select(null);
                  await load();
                  show('Artifact deleted', 'success');
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Could not delete the artifact');
                }
              }}
            />
          )}
        </section>
      </div>

      {creating ? (
        <NewArtifactModal
          projectId={activeProject.id}
          journey={journey}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await load();
            select(id);
            show('Artifact created', 'success');
          }}
        />
      ) : null}

      {linking && selected && journey ? (
        <LinkModal
          artifact={selected}
          journey={journey}
          onClose={() => setLinking(false)}
          onSaved={async () => {
            setLinking(false);
            await load();
            show('Artifact linked into the Journey', 'success');
          }}
        />
      ) : null}

      {toast ? <Toast {...toast} onDone={clear} /> : null}
    </main>
  );
}

/* ------------------------------------------------------------------ */

function CanvasEditor({
  artifact,
  projectId,
  onSaved,
  onLink,
  onDelete,
}: {
  artifact: DesignArtifactSummary;
  projectId: number;
  onSaved: (message: string) => Promise<void>;
  onLink: () => void;
  onDelete: () => Promise<void>;
}) {
  const [scene, setScene] = useState<DesignScene>(artifact.scene ?? emptyScene());
  const [shapeId, setShapeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(artifact.name);
  const [description, setDescription] = useState(artifact.description);
  const [askOpen, setAskOpen] = useState(false);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const shape = scene.shapes.find((s) => s.id === shapeId) ?? null;

  const addShape = (kind: DesignShape['kind']) => {
    const id = `s${Date.now().toString(36)}`;
    const next: DesignShape = {
      id,
      kind,
      x: 120 + Math.random() * 200,
      y: 120 + Math.random() * 160,
      w: kind === 'arrow' ? 120 : kind === 'note' ? 240 : 180,
      h: kind === 'arrow' ? 0 : kind === 'note' ? 110 : 100,
      label: kind === 'arrow' ? 'interface' : 'New ' + (kind === 'ellipse' ? 'component' : 'block'),
      color: PALETTE[scene.shapes.length % PALETTE.length],
    };
    setScene({ ...scene, shapes: [...scene.shapes, next] });
    setShapeId(id);
    setDirty(true);
  };

  const updateShape = (id: string, patch: Partial<DesignShape>) => {
    setScene((prev) => ({ ...prev, shapes: prev.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    setDirty(true);
  };

  const removeShape = () => {
    if (!shape) return;
    setScene((prev) => ({ ...prev, shapes: prev.shapes.filter((s) => s.id !== shape.id) }));
    setShapeId(null);
    setDirty(true);
  };

  const save = async (bumpVersion: boolean) => {
    setBusy(true);
    try {
      await api.patch(`/studio/artifacts/${artifact.id}`, {
        name,
        description,
        scene,
        bumpVersion,
      });
      setDirty(false);
      await onSaved(bumpVersion ? `Saved as v${artifact.version + 1}` : 'Saved');
    } finally {
      setBusy(false);
    }
  };

  const pointFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = scene.width / rect.width;
    const scaleY = scene.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  return (
    <>
      <div className="studio-toolbar">
        <div className="row" style={{ gap: 6 }}>
          {SHAPE_KINDS.map((k) => (
            <button key={k.key} className="tool" onClick={() => addShape(k.key)}>
              + {k.label}
            </button>
          ))}
        </div>
        <div className="grow" />
        {artifact.stageName ? <Badge tone="info">{artifact.stageName}</Badge> : <Badge tone="upcoming">Not linked</Badge>}
        {artifact.activityTitle ? <Badge tone="active">{artifact.activityTitle}</Badge> : null}
        <span className="small muted">v{artifact.version}</span>
        <button className="tool" onClick={onLink}>
          Journey link
        </button>
        <button className="tool" onClick={() => setAskOpen(true)}>
          Ask Assistant
        </button>
        <button className="tool" onClick={() => void onDelete()}>
          Delete
        </button>
        <button className="btn secondary sm" disabled={busy || !dirty} onClick={() => void save(false)}>
          {dirty ? 'Save' : 'Saved'}
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void save(true)}>
          Save as new version
        </button>
      </div>

      <div className="canvas-wrap">
        <div className="canvas" style={{ width: 'min(1200px, 100%)', aspectRatio: `${scene.width} / ${scene.height}` }}>
          <svg
            ref={svgRef}
            className="canvas-svg"
            viewBox={`0 0 ${scene.width} ${scene.height}`}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const p = pointFromEvent(e);
              updateShape(dragRef.current.id, {
                x: Math.round(p.x - dragRef.current.offsetX),
                y: Math.round(p.y - dragRef.current.offsetY),
              });
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onPointerLeave={() => {
              dragRef.current = null;
            }}
          >
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                <path d="M0,0 L10,4 L0,8 z" fill="#64798a" />
              </marker>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#eef3f5" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={scene.width} height={scene.height} fill="url(#grid)" />
            {scene.shapes.map((s) => {
              const isSelected = s.id === shapeId;
              const common = {
                key: s.id,
                className: 'shape',
                onPointerDown: (e: React.PointerEvent) => {
                  e.stopPropagation();
                  const p = pointFromEvent(e);
                  dragRef.current = { id: s.id, offsetX: p.x - s.x, offsetY: p.y - s.y };
                  setShapeId(s.id);
                },
                style: { cursor: 'move' as const },
              };
              if (s.kind === 'arrow') {
                return (
                  <g {...common}>
                    <line
                      x1={s.x}
                      y1={s.y || 40}
                      x2={s.x + s.w}
                      y2={s.y || 40}
                      stroke={isSelected ? '#0f766e' : '#64798a'}
                      strokeWidth={isSelected ? 3 : 2}
                      markerEnd="url(#arrowhead)"
                    />
                    <text x={s.x + 6} y={(s.y || 40) - 8} fontSize="14" fill="#5d7383">
                      {s.label}
                    </text>
                  </g>
                );
              }
              if (s.kind === 'ellipse') {
                return (
                  <g {...common}>
                    <ellipse
                      cx={s.x + s.w / 2}
                      cy={s.y + s.h / 2}
                      rx={s.w / 2}
                      ry={s.h / 2}
                      fill={`${s.color}1f`}
                      stroke={isSelected ? '#0f766e' : s.color}
                      strokeWidth={isSelected ? 3 : 1.8}
                    />
                    <text x={s.x + 14} y={s.y + 26} fontSize="15" fill="#10202b" fontWeight="600">
                      {s.label}
                    </text>
                  </g>
                );
              }
              return (
                <g {...common}>
                  <rect
                    x={s.x}
                    y={s.y}
                    width={s.w}
                    height={s.h}
                    rx={10}
                    fill={s.kind === 'note' ? '#fdf9ee' : `${s.color}14`}
                    stroke={isSelected ? '#0f766e' : s.color}
                    strokeWidth={isSelected ? 3 : 1.8}
                    strokeDasharray={s.kind === 'note' ? '6 5' : undefined}
                  />
                  <text x={s.x + 14} y={s.y + 26} fontSize="15" fill="#10202b" fontWeight="600">
                    {s.label.length > 30 ? `${s.label.slice(0, 30)}…` : s.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="studio-inspector">
        <div className="field" style={{ margin: 0, minWidth: 200, flex: 1 }}>
          <label htmlFor="artifact-name">Artifact name</label>
          <input id="artifact-name" className="input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </div>
        <div className="field" style={{ margin: 0, minWidth: 220, flex: 1.4 }}>
          <label htmlFor="artifact-desc">Description</label>
          <input id="artifact-desc" className="input" value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} placeholder="What this design shows" />
        </div>
        {shape ? (
          <>
            <div className="field" style={{ margin: 0, minWidth: 160, flex: 1 }}>
              <label htmlFor="shape-label">Selected label</label>
              <input id="shape-label" className="input" value={shape.label} onChange={(e) => updateShape(shape.id, { label: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0, width: 130 }}>
              <label htmlFor="shape-color">Colour</label>
              <input id="shape-color" type="color" className="input" style={{ padding: 3, height: 38 }} value={shape.color} onChange={(e) => updateShape(shape.id, { color: e.target.value })} />
            </div>
            <button className="btn ghost sm" onClick={removeShape}>
              Remove shape
            </button>
          </>
        ) : (
          <span className="hint">Select a shape to edit it. Drag to move.</span>
        )}
      </div>

      {askOpen ? (
        <Modal
          title="Ask the Assistant about this design"
          subtitle={`It reads ${artifact.name} alongside the project's Journey.`}
          onClose={() => setAskOpen(false)}
          footer={
            <button className="btn secondary" onClick={() => setAskOpen(false)}>
              Close
            </button>
          }
        >
          <p className="small muted" style={{ marginBottom: 12 }}>
            The artifact is {artifact.type.replace(/_/g, ' ')}, version {artifact.version}, with {scene.shapes.length} shapes,
            linked to {artifact.stageName ?? 'no stage'} {artifact.activityTitle ? `· ${artifact.activityTitle}` : ''}.
          </p>
          <InlineAsk projectId={projectId} artifactId={artifact.id} label="Ask about this design" variant="secondary" />
          <p className="hint" style={{ marginTop: 10 }}>
            Use the Assistant destination for a full conversation with proposed changes.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

function NewArtifactModal({
  projectId,
  journey,
  onClose,
  onCreated,
}: {
  projectId: number;
  journey: JourneyPayload | null;
  onClose: () => void;
  onCreated: (id: number) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState('system_sketch');
  const [description, setDescription] = useState('');
  const [stageId, setStageId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activities = journey
    ? journey.stages.find((s) => String(s.id) === stageId)
      ? journey.nextActions.filter((a) => a.stageId === Number(stageId) && a.kind === 'activity')
      : []
    : [];

  return (
    <Modal
      title="New design artifact"
      subtitle="Saved to this project. Linking it to a Journey stage and activity keeps the design traceable."
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={busy || name.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await api.post<{ artifactId: number }>('/studio/artifacts', {
                  projectId,
                  name: name.trim(),
                  type,
                  description: description.trim(),
                  stageId: stageId ? Number(stageId) : null,
                  activityId: activityId ? Number(activityId) : null,
                });
                await onCreated(res.artifactId);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Could not create the artifact');
                setBusy(false);
              }
            }}
          >
            Create
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <label htmlFor="new-artifact-name">Name</label>
        <input id="new-artifact-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PPT-001 System Layout" />
      </div>
      <div className="field">
        <label htmlFor="new-artifact-type">Type</label>
        <select id="new-artifact-type" className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {['system_sketch', 'wireframe', 'diagram', 'specification_board'].map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="new-artifact-desc">Description</label>
        <textarea id="new-artifact-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 62 }} />
      </div>
      <div className="field-inline">
        <div className="field">
          <label htmlFor="new-artifact-stage">Journey stage (optional)</label>
          <select id="new-artifact-stage" className="select" value={stageId} onChange={(e) => { setStageId(e.target.value); setActivityId(''); }}>
            <option value="">Not linked</option>
            {(journey?.stages ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-artifact-activity">Activity (optional)</label>
          <select id="new-artifact-activity" className="select" value={activityId} onChange={(e) => setActivityId(e.target.value)} disabled={!stageId}>
            <option value="">{stageId ? 'Not linked to an activity' : 'Choose a stage first'}</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <span className="hint">Only outstanding activities in that stage are offered.</span>
        </div>
      </div>
    </Modal>
  );
}

function LinkModal({
  artifact,
  journey,
  onClose,
  onSaved,
}: {
  artifact: DesignArtifactSummary;
  journey: JourneyPayload;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [stageId, setStageId] = useState(artifact.stageId ? String(artifact.stageId) : '');
  const [activityId, setActivityId] = useState(artifact.activityId ? String(artifact.activityId) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageActivities = journey.nextActions.filter((a) => a.kind === 'activity' && a.stageId === Number(stageId));

  return (
    <Modal
      title="Link to the Journey"
      subtitle="A linked artifact appears on the stage and activity it supports, and in the Assistant's project context."
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.patch(`/studio/artifacts/${artifact.id}`, {
                  stageId: stageId ? Number(stageId) : null,
                  activityId: activityId ? Number(activityId) : null,
                });
                await onSaved();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Could not update the link');
                setBusy(false);
              }
            }}
          >
            Save link
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <label htmlFor="link-stage">Journey stage</label>
        <select id="link-stage" className="select" value={stageId} onChange={(e) => { setStageId(e.target.value); setActivityId(''); }}>
          <option value="">Not linked</option>
          {journey.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.status})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="link-activity">Activity</label>
        <select id="link-activity" className="select" value={activityId} onChange={(e) => setActivityId(e.target.value)} disabled={!stageId}>
          <option value="">Not linked to an activity</option>
          {stageActivities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <span className="hint">Outstanding activities in the chosen stage.</span>
      </div>
      <p className="hint">
        Current: {artifact.stageName ?? 'no stage'} {artifact.activityTitle ? `· ${artifact.activityTitle}` : ''} · updated{' '}
        {relativeTime(artifact.updatedAt)}
      </p>
    </Modal>
  );
}
