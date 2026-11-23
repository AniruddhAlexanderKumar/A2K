import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ProjectSummary, SessionUser } from '@sv/shared';
import { api } from './api';

/**
 * One source of truth for session + the active project.
 *
 * The active project is persisted per user so the whole app (Journey, Assistant,
 * Studio) always agrees on which project is in context. Everything that loads data
 * takes the project id from here, which is what keeps contexts from crossing over.
 */
type Store = {
  user: SessionUser | null;
  loadingSession: boolean;
  projects: ProjectSummary[];
  loadingProjects: boolean;
  activeProjectId: number | null;
  activeProject: ProjectSummary | null;
  setActiveProject: (id: number) => void;
  refreshProjects: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; organizationName?: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

const storageKey = (userId: number) => `sv.activeProject.${userId}`;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: SessionUser }>('/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    setLoadingProjects(true);
    try {
      const res = await api.get<{ projects: ProjectSummary[] }>('/projects');
      setProjects(res.projects);
      setActiveProjectId((current) => {
        if (current && res.projects.some((p) => p.id === current)) return current;
        const stored = Number(localStorage.getItem(storageKey(user.id)));
        if (stored && res.projects.some((p) => p.id === stored)) return stored;
        return res.projects[0]?.id ?? null;
      });
    } finally {
      setLoadingProjects(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void refreshProjects();
    else setProjects([]);
  }, [user, refreshProjects]);

  const setActiveProject = useCallback(
    (id: number) => {
      setActiveProjectId(id);
      if (user) localStorage.setItem(storageKey(user.id), String(id));
    },
    [user],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user: SessionUser }>('/auth/login', { email, password });
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (input: { name: string; email: string; password: string; organizationName?: string }) => {
      const res = await api.post<{ user: SessionUser }>('/auth/register', input);
      setUser(res.user);
    },
    [],
  );

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    setProjects([]);
    setActiveProjectId(null);
  }, []);

  const value = useMemo<Store>(
    () => ({
      user,
      loadingSession,
      projects,
      loadingProjects,
      activeProjectId,
      activeProject: projects.find((p) => p.id === activeProjectId) ?? null,
      setActiveProject,
      refreshProjects,
      signIn,
      register,
      signOut,
    }),
    [user, loadingSession, projects, loadingProjects, activeProjectId, setActiveProject, refreshProjects, signIn, register, signOut],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
