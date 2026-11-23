import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Modal, RichText } from './ui';

/**
 * Contextual assistant: ask about the current activity without leaving Journey.
 * The conversation is saved so it can be continued in the Assistant destination.
 */
export function InlineAsk({
  projectId,
  activityId,
  artifactId,
  label = 'Ask the Assistant',
  variant = 'ghost',
}: {
  projectId: number;
  activityId?: number;
  artifactId?: number;
  label?: string;
  variant?: 'ghost' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ content: string; threadId: number | null }>('/assistant/context-ask', {
        projectId,
        activityId,
        artifactId,
        message: question.trim(),
      });
      setAnswer(res.content);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The Assistant could not answer right now');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className={`btn ${variant} sm`} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <Modal
          title="Ask the AI Assistant"
          subtitle="It reads this project's Journey — stages, activities, requirements, documents and designs — not other projects."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setOpen(false)}>
                Close
              </button>
              {answer ? (
                <a className="btn" href="/assistant">
                  Continue in Assistant
                </a>
              ) : (
                <button className="btn" onClick={() => void ask()} disabled={busy || !question.trim()}>
                  {busy ? 'Thinking…' : 'Ask'}
                </button>
              )}
            </>
          }
        >
          {error ? <div className="form-error">{error}</div> : null}
          {!answer ? (
            <div className="field">
              <label htmlFor="inline-ask">Your question</label>
              <textarea
                id="inline-ask"
                className="textarea"
                autoFocus
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. What is missing before this is ready for review?"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask();
                }}
              />
              <span className="hint">Cmd/Ctrl + Enter to ask.</span>
            </div>
          ) : (
            <div className="msg assistant" style={{ maxWidth: '100%' }}>
              <RichText text={answer} />
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}
