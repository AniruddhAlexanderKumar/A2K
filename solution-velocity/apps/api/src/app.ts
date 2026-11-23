import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from './db/client.js';
import { authenticate } from './lib/access.js';
import { HttpError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { journeyRoutes } from './routes/journey.js';
import { workRoutes } from './routes/work.js';
import { assistantRoutes } from './routes/assistant.js';
import { studioRoutes } from './routes/studio.js';

export function createApp(db: Database) {
  const app = express();
  const allowedOrigins = (process.env.SV_WEB_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.set('trust proxy', 1);
  app.use(
    cors({
      // Same-origin in production (the API serves the built SPA). In development the
      // Vite proxy forwards requests, so an explicit allowlist is only for extra hosts.
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));

  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.db = db;
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'solution-velocity', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/journey', authenticate, journeyRoutes);
  app.use('/api/projects/:projectId', authenticate, workRoutes);
  app.use('/api/assistant', authenticate, assistantRoutes);
  app.use('/api/studio', authenticate, studioRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Serve the built SPA when it exists (single-origin deployment).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[api] ${req.method} ${req.originalUrl} -> ${message}`);
    }
    res.status(500).json({ error: 'Something went wrong on our side', code: 'internal' });
  });

  return app;
}

export { authenticate };
