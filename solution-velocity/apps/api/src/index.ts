import { getDb, closeDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { ensureSeed } from './db/seed.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const db = await getDb();
  const applied = await migrate(db);
  if (applied > 0) console.log(`[api] applied ${applied} migration(s)`);

  if (process.env.SV_SKIP_SEED !== '1') {
    await ensureSeed(db);
  }

  const app = createApp(db);
  const server = app.listen(PORT, HOST, () => {
    console.log(`[api] Solution Velocity API listening on http://${HOST}:${PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[api] failed to start', err);
  process.exit(1);
});
