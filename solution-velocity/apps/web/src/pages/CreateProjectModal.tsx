import { useEffect, useMemo, useState } from 'react';
import { JOURNEY_TEMPLATES, PROJECT_TYPES } from '@sv/shared';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Modal } from '../components/ui';

/**
 * Creating a project is how a Journey comes into being. The lifecycle is recommended
 * from the project type, and the recommendation is visible and changeable — stage
 * previews show exactly what will be created before anything is written.
 */
export function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (projectId: number) => Promise<void> | void;
}) {
  const { user } = useStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState('hardware');
  const [templateKey, setTemplateKey] = useState('hardware_product');
  const [templateTouched, setTemplateTouched] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [team, setTeam] = useState<{ id: number; name: string; email: string }[]>([]);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateTouched) {
      const recommended = PROJECT_TYPES.find((p) => p.key === projectType)?.template;
      if (recommended) setTemplateKey(recommended);
    }
  }, [projectType, templateTouched]);

  useEffect(() => {
    api
      .get<{ members: { id: number; name: string; email: string }[] }>('/auth/team')
      .then((res) => setTeam(res.members.filter((m) => m.email !== user?.email)))
      .catch(() => undefined);
  }, [user?.email]);

  const template = useMemo(
    () => JOURNEY_TEMPLATES.find((t) => t.key === templateKey) ?? JOURNEY_TEMPLATES[JOURNEY_TEMPLATES.length - 1],
    [templateKey],
  );
  const recommended = PROJECT_TYPES.find((p) => p.key === projectType)?.template;
  const activityCount = template.stages.reduce((sum, s) => sum + s.activities.length, 0);

  const submit = async () => {
    if (name.trim().length < 2) {
      setError('Give the project a name first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ projectId: number }>('/projects', {
        name: name.trim(),
        description: description.trim(),
        projectType,
        templateKey,
        startDate,
        memberIds,
      });
      await onCreated(res.projectId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New project"
      subtitle="Solution Velocity creates a dedicated Journey for every project — its own stages, activities, milestones and deliverables."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating Journey…' : 'Create project & Journey'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}

      <div className="field">
        <label htmlFor="project-name">Project name</label>
        <input
          id="project-name"
          className="input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pulsed Plasma Thruster — Flight Unit"
        />
      </div>

      <div className="field">
        <label htmlFor="project-desc">What is being developed?</label>
        <textarea
          id="project-desc"
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A sentence on the goal and the main constraint. This becomes the project's shared context."
          style={{ minHeight: 70 }}
        />
      </div>

      <div className="field">
        <label>What kind of work is this?</label>
        <div className="template-grid">
          {PROJECT_TYPES.map((type) => (
            <button
              key={type.key}
              type="button"
              className={`template-option${projectType === type.key ? ' selected' : ''}`}
              onClick={() => setProjectType(type.key)}
            >
              <strong>{type.label}</strong>
              <span>{JOURNEY_TEMPLATES.find((t) => t.key === type.template)?.summary}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>
          Journey lifecycle{' '}
          {recommended === templateKey && !templateTouched ? (
            <span className="badge active" style={{ marginLeft: 6 }}>
              Recommended
            </span>
          ) : null}
        </label>
        <select
          className="select"
          value={templateKey}
          onChange={(e) => {
            setTemplateKey(e.target.value);
            setTemplateTouched(true);
          }}
        >
          {JOURNEY_TEMPLATES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="hint" style={{ marginTop: 4 }}>
          {template.summary} Best for {template.bestFor.toLowerCase()}
        </p>
        <div className="stage-preview">
          {template.stages.map((s) => (
            <span key={s.key} className="stage-pill">
              {s.name}
            </span>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          This creates {template.stages.length} stages, {template.stages.length} milestones and {activityCount} activities.
          Stages, activities and milestones can all be customised afterwards, and every activity can carry its own
          deliverables, requirements, reviews and dependencies.
        </p>
      </div>

      <div className="field-inline">
        <div className="field">
          <label htmlFor="start-date">Journey start</label>
          <input id="start-date" type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="hint">Milestone targets are spaced from this date.</span>
        </div>
        <div className="field">
          <label htmlFor="team">Invite teammates (optional)</label>
          <select
            id="team"
            className="select"
            multiple
            value={memberIds.map(String)}
            onChange={(e) => setMemberIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
            style={{ minHeight: 78 }}
          >
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.email}
              </option>
            ))}
          </select>
          <span className="hint">Hold Cmd/Ctrl to select more than one. You are added as project lead.</span>
        </div>
      </div>
    </Modal>
  );
}
