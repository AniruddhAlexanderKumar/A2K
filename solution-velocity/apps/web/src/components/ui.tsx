import { useEffect, useRef, type ReactNode } from 'react';
import { humanize } from '@sv/shared';

export function Avatar({ name, color, size = '' }: { name: string; color?: string; size?: 'sm' | 'lg' | '' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span className={`avatar ${size}`} style={{ background: color ?? '#31567a' }} title={name} aria-label={name}>
      {initials || '?'}
    </span>
  );
}

export function Badge({
  tone,
  children,
  dot,
  className,
}: {
  tone?: string;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return <span className={`badge ${tone ?? ''}${dot ? ' dot' : ''}${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status} dot>{humanize(status)}</Badge>;
}

export function Progress({
  value,
  tone,
  thin,
}: {
  value: number;
  tone?: 'blocked' | 'complete';
  thin?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className={`progress${thin ? ' thin' : ''}${tone ? ` ${tone}` : ''}`} role="progressbar" aria-valuenow={Math.round(clamped * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="overlay center" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={ref} tabIndex={-1} style={wide ? { width: 'min(820px, 100%)' } : undefined}>
        <div className="modal-head spread">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="muted small" style={{ marginTop: 4 }}>{subtitle}</p> : null}
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  subtitle,
  children,
  onClose,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            {title}
            {subtitle}
          </div>
          <div className="row" style={{ flex: 'none' }}>
            {actions}
            <button className="close-button" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message, tone, onDone }: { message: string; tone?: 'error' | 'success'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, tone === 'error' ? 5200 : 2900);
    return () => clearTimeout(t);
  }, [message, tone, onDone]);
  return (
    <div className={`toast ${tone ?? ''}`} role="status">
      {message}
    </div>
  );
}

export function Skeleton({ lines = 3, block = true }: { lines?: number; block?: boolean }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {block ? <div className="skeleton skeleton-block" /> : null}
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ width: `${94 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="center-page">
      <div style={{ maxWidth: 420 }}>
        <h2 style={{ marginBottom: 8 }}>{title}</h2>
        <p className="muted" style={{ marginBottom: 18 }}>
          {body}
        </p>
        {action}
      </div>
    </div>
  );
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return dateLabel(value);
}

export function toInputDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Escape-safe tiny markdown renderer for assistant replies and document previews. */
export function RichText({ text }: { text: string }) {
  const blocks = text.split('\n');
  return (
    <div>
      {blocks.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <div
              key={i}
              style={{
                fontWeight: 680,
                fontSize: level === 1 ? '1.02rem' : level === 2 ? '0.94rem' : '0.88rem',
                margin: '8px 0 4px',
              }}
            >
              {inline(heading[2])}
            </div>
          );
        }
        if (line.startsWith('> ')) {
          return (
            <div
              key={i}
              style={{ borderLeft: '3px solid #dde5ea', paddingLeft: 10, color: 'var(--ink-muted)', margin: '4px 0' }}
            >
              {inline(line.slice(2))}
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet) {
          const nested = /^\s{2,}/.test(line);
          return (
            <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: nested ? 18 : 2, margin: '2px 0' }}>
              <span style={{ color: 'var(--ink-muted)' }}>•</span>
              <span>{inline(bullet[1])}</span>
            </div>
          );
        }
        const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, margin: '2px 0' }}>
              <span style={{ color: 'var(--ink-muted)', minWidth: 14 }}>{numbered[1]}.</span>
              <span>{inline(numbered[2])}</span>
            </div>
          );
        }
        return <div key={i}>{inline(line)}</div>;
      })}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} style={{ fontFamily: 'var(--mono)', fontSize: '0.86em', background: 'rgba(16,32,43,0.06)', padding: '1px 4px', borderRadius: 4 }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <span key={i}>{part}</span>;
  });
}
