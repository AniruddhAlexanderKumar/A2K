import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Avatar } from './ui';

const icons = {
  journey: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="nav-icon" aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.4 6h6.1a3 3 0 0 1 0 6H9.5a3 3 0 0 0 0 6h6.1" strokeLinecap="round" />
    </svg>
  ),
  assistant: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="nav-icon" aria-hidden="true">
      <path d="M4 5.5h16v10H9l-4.2 3.4V5.5Z" strokeLinejoin="round" />
      <path d="M8.5 9.5h7M8.5 12.5h4.5" strokeLinecap="round" />
    </svg>
  ),
  studio: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="nav-icon" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12.5" rx="1.6" />
      <path d="M12 17v3M8.5 20h7" strokeLinecap="round" />
      <path d="M7 13.5 9.8 9l2.3 3 1.6-2 2.3 3.5H7Z" strokeLinejoin="round" />
    </svg>
  ),
};

export function AppShell() {
  const { user, signOut, activeProject, projects, setActiveProject } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) setProjectMenu(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/journey" className="brand" aria-label="Solution Velocity home">
          <span className="brand-mark">SV</span>
          <span className="brand-text">
            Solution Velocity
            <small>Product development</small>
          </span>
        </NavLink>

        <nav className="nav" aria-label="Primary">
          <NavLink to="/journey" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {icons.journey}
            <span className="nav-label">Journey</span>
          </NavLink>
          <NavLink to="/assistant" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {icons.assistant}
            <span className="nav-label">AI Assistant</span>
          </NavLink>
          <NavLink to="/studio" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            {icons.studio}
            <span className="nav-label">Design Studio</span>
          </NavLink>
        </nav>

        <div className="topbar-right">
          {projects.length > 0 ? (
            <div className="dropdown" ref={projectRef}>
              <button
                className="project-select"
                style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.16)', color: '#eaf1f4' }}
                onClick={() => setProjectMenu((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={projectMenu}
                title="Active project — used by Journey, AI Assistant and Design Studio"
              >
                <span className="project-code">{activeProject?.code ?? '—'}</span>
                <span className="project-name" style={{ maxWidth: 190 }}>
                  {activeProject?.name ?? 'Select project'}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {projectMenu ? (
                <div className="dropdown-panel" role="listbox">
                  <div className="dropdown-list">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        role="option"
                        aria-selected={p.id === activeProject?.id}
                        className={`dropdown-item${p.id === activeProject?.id ? ' selected' : ''}`}
                        onClick={() => {
                          setActiveProject(p.id);
                          setProjectMenu(false);
                        }}
                      >
                        <span className="project-code">{p.code}</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, color: 'var(--ink)' }}>{p.name}</span>
                          <span className="small muted">
                            {Math.round(p.progress * 100)}% · {p.currentStageName ?? 'Complete'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="dropdown-footer">
                    <button
                      className="btn secondary sm block"
                      onClick={() => {
                        setProjectMenu(false);
                        navigate('/journey?new=project');
                      }}
                    >
                      + New project
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {user ? (
            <div className="user-menu" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                style={{ background: 'none', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: 'inherit' }}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
              >
                <Avatar name={user.name} color={user.avatarColor} />
              </button>
              {menuOpen ? (
                <div className="menu-panel" role="menu">
                  <div className="menu-header">
                    <div style={{ fontWeight: 620 }}>{user.name}</div>
                    <div className="small muted">{user.email}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {user.organizationName} · {user.role}
                    </div>
                  </div>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/journey?new=project');
                    }}
                  >
                    New project
                  </button>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void signOut();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      <Outlet />
    </div>
  );
}
