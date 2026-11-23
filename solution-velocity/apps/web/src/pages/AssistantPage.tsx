import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AssistantAction, AssistantMessage, AssistantThread } from '@sv/shared';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Badge, EmptyState, RichText, Skeleton, Toast, relativeTime } from '../components/ui';
import { useToast } from '../components/useToast';

type ThreadView = {
  thread: { id: number; projectId: number; title: string };
  messages: AssistantMessage[];
  actions: AssistantAction[];
};

/**
 * The Assistant always operates on the project selected in the app shell. The context
 * chip is the visible proof of that; switching project switches thread and context.
 */
export function AssistantPage() {
  const { activeProject, activeProjectId, projects, loadingProjects } = useStore();
  const [params, setParams] = useSearchParams();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast, show, clear } = useToast();

  const threadId = params.get('thread');

  const loadThreads = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await api.get<{ threads: AssistantThread[] }>(`/assistant/threads?projectId=${activeProjectId}`);
      setThreads(res.threads);
      return res.threads;
    } catch {
      setThreads([]);
      return [];
    }
  }, [activeProjectId]);

  const loadThread = useCallback(async (id: number) => {
    try {
      const res = await api.get<ThreadView>(`/assistant/threads/${id}`);
      setThread(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this conversation');
    }
  }, []);

  useEffect(() => {
    setThread(null);
    setSuggestions([]);
    void loadThreads().then((list) => {
      if (threadId && list?.some((t) => t.id === Number(threadId))) void loadThread(Number(threadId));
    });
  }, [activeProjectId, loadThreads, loadThread, threadId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [thread?.messages.length, busy]);

  const ensureThread = async (): Promise<number> => {
    if (thread) return thread.thread.id;
    if (!activeProjectId) throw new Error('No project selected');
    const res = await api.post<{ threadId: number }>('/assistant/threads', { projectId: activeProjectId });
    await loadThreads();
    return res.threadId;
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !activeProjectId) return;
    setBusy(true);
    setError(null);
    try {
      const id = await ensureThread();
      // Optimistic user bubble keeps the conversation responsive.
      setThread((prev) =>
        prev && prev.thread.id === id
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                { id: Date.now(), threadId: id, role: 'user', content: message, actions: [], createdAt: new Date().toISOString() },
              ],
            }
          : prev,
      );
      setInput('');
      const res = await api.post<{
        message: AssistantMessage;
        actions: AssistantAction[];
        suggestedPrompts: string[];
        contextProject: { id: number; name: string };
      }>(`/assistant/threads/${id}/messages`, { message });
      setSuggestions(res.suggestedPrompts);
      await loadThread(id);
      setParams({ thread: String(id) }, { replace: true });
      await loadThreads();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The Assistant could not respond');
    } finally {
      setBusy(false);
    }
  };

  const applyAction = async (action: AssistantAction) => {
    try {
      const res = await api.post<{ result: { summary: string } }>(`/assistant/actions/${action.id}/apply`, {});
      show(res.result.summary, 'success');
      if (thread) await loadThread(thread.thread.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply the change');
      if (thread) await loadThread(thread.thread.id);
    }
  };

  const dismissAction = async (action: AssistantAction) => {
    try {
      await api.post(`/assistant/actions/${action.id}/dismiss`, {});
      if (thread) await loadThread(thread.thread.id);
    } catch {
      setError('Could not dismiss the change');
    }
  };

  const groupedActions = useMemo(() => {
    const map = new Map<number, AssistantAction[]>();
    for (const a of thread?.actions ?? []) {
      const key = a.messageId ?? 0;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [thread]);

  if (loadingProjects && projects.length === 0) {
    return (
      <main className="main">
        <Skeleton lines={3} />
      </main>
    );
  }

  if (!activeProject) {
    return (
      <main className="main">
        <EmptyState
          title="Select a project first"
          body="The Assistant works inside one project's Journey at a time, so its answers and proposed changes always belong to a specific project."
          action={
            <a className="btn" href="/journey">
              Go to Journey
            </a>
          }
        />
      </main>
    );
  }

  return (
    <main className="main">
      <div className="assistant-layout">
        <aside className="card assistant-threads" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="card-header">
            <h3>Conversations</h3>
            <button
              className="link-button"
              onClick={() => {
                setThread(null);
                setParams({}, { replace: true });
              }}
            >
              New
            </button>
          </div>
          <div style={{ overflowY: 'auto', padding: 8, flex: 1 }}>
            {threads.length === 0 ? (
              <p className="empty-note" style={{ padding: 8 }}>
                No conversations in this project yet.
              </p>
            ) : null}
            {threads.map((t) => (
              <button
                key={t.id}
                className={`thread-item${thread?.thread.id === t.id ? ' active' : ''}`}
                onClick={() => setParams({ thread: String(t.id) })}
              >
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <span className="small muted">{relativeTime(t.updatedAt)}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: 12, borderTop: '1px solid var(--line-soft)' }}>
            <p className="hint">
              Every conversation is scoped to <strong>{activeProject.name}</strong>. Switch project in the header to change
              context.
            </p>
          </div>
        </aside>

        <section className="chat">
          <div className="chat-head">
            <span className="context-chip">{activeProject.code} · {activeProject.name}</span>
            <span className="small muted">
              {Math.round(activeProject.progress * 100)}% · {activeProject.currentStageName ?? 'Complete'}
            </span>
            <div className="grow" />
            <a className="link-button" href="/journey">
              Open Journey →
            </a>
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {error ? <div className="form-error">{error}</div> : null}
            {!thread && !busy ? (
              <div style={{ margin: 'auto 0', maxWidth: 560 }}>
                <h2 style={{ fontSize: '1.06rem', marginBottom: 6 }}>Your project companion</h2>
                <p className="muted" style={{ fontSize: '0.9rem', marginBottom: 14 }}>
                  I read this project's Journey — {activeProject.name} — including its stages, activities, requirements,
                  documents, designs, risks and approvals. Ask for a summary, for blockers, or ask me to draft a requirement,
                  document, risk or milestone. I propose changes; you confirm them.
                </p>
                <div className="col" style={{ gap: 8 }}>
                  {[
                    'Summarise everything outstanding in this project',
                    'What is blocking progress right now?',
                    'What should we work on next?',
                    'Create a requirement for the thermal margin of the propulsion system',
                    'Draft a progress report for the current stage',
                  ].map((p) => (
                    <button key={p} className="item" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => void send(p)}>
                      <span style={{ color: 'var(--accent)' }}>›</span>
                      <span style={{ fontSize: '0.87rem' }}>{p}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {thread?.messages.map((m) => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div className={`msg ${m.role}`}>
                  {m.role === 'assistant' ? <RichText text={m.content} /> : m.content}
                </div>
                {m.role === 'assistant' ? (
                  <div style={{ width: '100%', maxWidth: '100%' }}>
                    {(groupedActions.get(m.id) ?? []).map((action) => (
                      <ActionCard
                        key={action.id}
                        action={action}
                        onApply={() => void applyAction(action)}
                        onDismiss={() => void dismissAction(action)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {busy ? (
              <div className="msg assistant" aria-live="polite">
                <span className="muted">Reading this project's Journey…</span>
              </div>
            ) : null}
          </div>

          {suggestions.length > 0 && thread ? (
            <div className="suggested">
              {suggestions.slice(0, 3).map((s) => (
                <button key={s} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about ${activeProject.name}, or ask for a change…`}
              aria-label="Message the assistant"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <button className="btn" type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </section>
      </div>
      {toast ? <Toast {...toast} onDone={clear} /> : null}
    </main>
  );
}

function ActionCard({
  action,
  onApply,
  onDismiss,
}: {
  action: AssistantAction;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const done = action.status !== 'proposed';
  return (
    <div className={`proposal${done ? ' done' : ''}`}>
      <div className="proposal-head">
        {done ? <span>✓</span> : <span>⚡</span>}
        {done ? `Change ${action.status}` : 'Proposed change — needs your confirmation'}
      </div>
      <div className="proposal-title">{action.summary}</div>
      {!done ? <pre>{JSON.stringify(action.payload, null, 2)}</pre> : null}
      {action.result ? <div className="small muted">{(action.result as { summary?: string }).summary}</div> : null}
      {!done ? (
        <div className="proposal-actions">
          <button className="btn sm" onClick={onApply}>
            Apply to Journey
          </button>
          <button className="btn ghost sm" onClick={onDismiss}>
            Dismiss
          </button>
          <span className="small muted" style={{ alignSelf: 'center' }}>
            Nothing is saved until you apply.
          </span>
        </div>
      ) : null}
      {action.status === 'proposed' ? null : (
        <div style={{ marginTop: 6 }}>
          <Badge tone={action.status === 'applied' ? 'complete' : 'upcoming'}>{action.status}</Badge>
        </div>
      )}
    </div>
  );
}
