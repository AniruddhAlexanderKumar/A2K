// @vitest-environment jsdom
/**
 * UI smoke tests. These render the real React app against the real API (started in-process
 * on a random port) with a real database, so they assert on what a user would actually see.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ui-'));
process.env.SV_DATA_DIR = path.join(tmpDir, 'pg');
process.env.NODE_ENV = 'test';
process.env.SV_SKIP_SEED = '1';
process.env.SV_ASSISTANT_ENDPOINT = '';

let server: Server;
let base = '';

beforeAll(async () => {
  const { getDb } = await import('../apps/api/src/db/client.js');
  const { migrate } = await import('../apps/api/src/db/migrate.js');
  const { ensureSeed } = await import('../apps/api/src/db/seed.js');
  const { createApp } = await import('../apps/api/src/app.js');

  const db = await getDb();
  await migrate(db);
  await ensureSeed(db);
  const app = createApp(db);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Note: window.location is left alone; replacing it breaks history and routing in jsdom.

  // jsdom does not persist cookies, so the harness carries a cookie jar exactly as a
  // browser would. This is test plumbing only — the app itself uses credentials: same-origin.
  const realFetch = globalThis.fetch;
  let jar = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input;
    const headers = new Headers(init.headers ?? {});
    if (jar) headers.set('cookie', jar);
    const res = await realFetch(url as RequestInfo, { ...init, headers });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) jar = setCookie.map((c) => c.split(';')[0]).join('; ');
    return res;
  }) as typeof fetch;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  const { closeDb } = await import('../apps/api/src/db/client.js');
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function signInThroughUi() {
  const { App } = await import('../apps/web/src/App.js');
  render(<App />);

  const email = await screen.findByLabelText('Email');
  await userEvent.type(email, 'aniruddh@solutionvelocity.dev');
  await userEvent.type(screen.getByLabelText('Password'), 'JourneyFirst1');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('application shell', () => {
  it('shows only the three primary destinations and no legacy modules', async () => {
    await signInThroughUi();
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(labels).toEqual(['Journey', 'AI Assistant', 'Design Studio']);
    for (const legacy of ['Dashboard', 'Projects', 'Tasks', 'Requirements', 'Documents', 'Roadmap', 'Milestones', 'Reports', 'Workflows', 'Teamwork Graph']) {
      expect(nav.textContent).not.toContain(legacy);
    }
    cleanup();
  }, 60_000);

  it('lands on Journey and renders the development path from real data', async () => {
    await signInThroughUi();
    await waitFor(() => expect(screen.getByText('Development path')).toBeTruthy(), { timeout: 20_000 });
    // Whatever project is active, its own stages are what the path shows.
    expect(screen.getAllByText(/Discovery/).length).toBeGreaterThan(0);
    // Project switching lives in the shell, so the active project is always visible.
    const switcher = screen.getByTitle('Active project — used by Journey, AI Assistant and Design Studio');
    expect(switcher.textContent).toMatch(/PPT|VC/);
    await userEvent.click(switcher);
    await userEvent.click(await screen.findByRole('option', { name: /Pulsed Plasma Thruster/ }));
    // The Journey now shows the other project's path and its own completion state.
    await waitFor(() => expect(screen.getByText('Discovery & Feasibility')).toBeTruthy(), { timeout: 20_000 });
    expect(screen.getByText('Preliminary Design')).toBeTruthy();
    expect(screen.getByText('Build & Verification')).toBeTruthy();
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0);
    expect(screen.getByText('Where to focus next')).toBeTruthy();
    cleanup();
  }, 60_000);

  it('opens an activity from its stage and shows the real linked work', async () => {
    await signInThroughUi();
    await waitFor(() => expect(screen.getByText('Development path')).toBeTruthy(), { timeout: 20_000 });
    // Clicking a stage opens it in place — no navigation to another module.
    (document.querySelector('.node-card') as HTMLElement).click();
    const addInput = await screen.findByLabelText('Add an activity to this stage');
    expect(addInput).toBeTruthy();
    const drawer = document.querySelector('.drawer-body')!;
    const activityButtons = Array.from(drawer.querySelectorAll('button.item')) as HTMLButtonElement[];
    expect(activityButtons.length).toBeGreaterThan(0);
    await userEvent.click(activityButtons[0]);
    await waitFor(() => expect(screen.getByText('Description')).toBeTruthy());
    // The activity drawer exposes the full set of work attached to that activity.
    for (const tab of ['Deliverables', 'Requirements', 'Documents', 'Reviews', 'Dependencies', 'History']) {
      expect(screen.getByRole('tab', { name: new RegExp(tab) })).toBeTruthy();
    }
    cleanup();
  }, 60_000);
});

describe('assistant', () => {
  it('states which project is in context and answers from it', async () => {
    await signInThroughUi();
    await waitFor(() => expect(screen.getByText('Development path')).toBeTruthy(), { timeout: 20_000 });
    // Switch to the hardware project, then open the Assistant for that project.
    await userEvent.click(screen.getByTitle('Active project — used by Journey, AI Assistant and Design Studio'));
    await userEvent.click(await screen.findByRole('option', { name: /Pulsed Plasma Thruster/ }));
    await waitFor(() => expect(screen.getAllByText('Preliminary Design').length).toBeGreaterThan(0), { timeout: 20_000 });
    await userEvent.click(screen.getAllByRole('link', { name: /AI Assistant/ })[0]);

    // Visible context indicator naming the active project.
    await waitFor(() => expect(screen.getAllByText(/PPT · Pulsed Plasma Thruster/).length).toBeGreaterThan(0), {
      timeout: 20_000,
    });
    await userEvent.click(await screen.findByRole('button', { name: /What is blocking progress right now\?/ }));
    await waitFor(() => expect(screen.getByText(/Subsystem mass budget from propulsion supplier/)).toBeTruthy(), {
      timeout: 20_000,
    });
    cleanup();
  }, 60_000);
});
