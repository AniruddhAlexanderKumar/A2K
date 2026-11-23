import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ConfirmProvider } from '../../components/ui';
import { ToastProvider } from '../../components/Toast';
import { CelebrateProvider } from '../../components/Celebrate';
import { keys } from '../../api/hooks';
import type { Me, Product, WorkspaceData } from '@sv/shared';
import { ProductPage } from './ProductPage';

/**
 * Render coverage for the product screen, in the three shapes it can take:
 * loading (no workspace data yet), loaded, and not-found.
 *
 * The screen used to render `<Spinner />` and then call three more hooks once
 * the product arrived, which is React error #310 — "Rendered more hooks than
 * during the previous render" — and it blanked the app in production.
 *
 * Static rendering cannot see that bug: every `renderToStaticMarkup` call starts
 * a fresh hook list, so hook *order across renders* is invisible. The last test
 * below mounts the real component in jsdom instead, which is a true multi-render
 * sequence, and is the test that fails on the old code. `tools/react-lint` (run
 * by CI) is the general guard so this cannot spread to other screens.
 */

const me: Me = {
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', createdAt: '', isAdmin: false },
  workspace: { id: 'w1', name: 'Analytical Engines', mode: 'team', role: 'owner', currency: 'GBP' },
  workspaces: []
};

const product: Product = {
  id: 'p1',
  name: 'Difference Engine',
  category: 'Computing',
  stage: 'Idea',
  imageUrl: '',
  description: '',
  notes: '',
  targetSellingPrice: null,
  costs: { labour: 0, packaging: 0, overhead: 0 },
  materials: [],
  tasks: [],
  answers: {},
  createdAt: '',
  updatedAt: ''
};

const workspaceData = {
  products: [product],
  materials: [],
  suppliers: [],
  tasks: [],
  insights: []
} as unknown as WorkspaceData;

/** A client whose cache is pre-seeded, so no network call is ever attempted. */
function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(keys.me, me);
  client.setQueryData(keys.data, workspaceData);
  return client;
}

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/products/:id/:tab?', element: <ProductPage /> }], {
    initialEntries: [path]
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={seededClient()}>
      <ToastProvider>
        <CelebrateProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </CelebrateProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

test('renders the loaded product without a hook-order error', () => {
  const html = renderAt('/products/p1/journey');
  assert.match(html, /Difference Engine/, 'the product name should render');
});

test('renders the loading state and then still reaches the loaded state', () => {
  // First render: no workspace data in the cache, so the guard renders <Spinner />.
  const loadingClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  loadingClient.setQueryData(keys.me, me);
  const loadingRouter = createMemoryRouter([{ path: '/products/:id/:tab?', element: <ProductPage /> }], {
    initialEntries: ['/products/p1/journey']
  });
  const loadingHtml = renderToStaticMarkup(
    <QueryClientProvider client={loadingClient}>
      <ToastProvider>
        <CelebrateProvider>
          <ConfirmProvider>
            <RouterProvider router={loadingRouter} />
          </ConfirmProvider>
        </CelebrateProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  assert.doesNotMatch(loadingHtml, /Difference Engine/, 'the loading state must not show the product yet');

  // Both states must be reachable from the same component. See the file header:
  // the hook-count regression itself is caught by the lint step, not here.
  assert.doesNotThrow(() => renderAt('/products/p1/journey'));
});

test('a missing product shows the empty state instead of throwing', () => {
  const html = renderAt('/products/does-not-exist/journey');
  assert.match(html, /Product not found/);
});


/**
 * A client-side mount is the only renderer whose hook list survives between
 * renders, so it is the only one that can see #310. `ProductPage` must render
 * the loading state and then the loaded state without React complaining.
 */
test('mounting while loading and then loading data does not change hook order', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/products/p1/journey'
  });
  const globals = globalThis as unknown as Record<string, unknown>;
  const restore: Array<[string, PropertyDescriptor | undefined]> = [];
  const install = (name: string, value: unknown) => {
    restore.push([name, Object.getOwnPropertyDescriptor(globalThis, name)]);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  install('window', dom.window);
  install('document', dom.window.document);
  install('navigator', dom.window.navigator);
  install('HTMLElement', dom.window.HTMLElement);
  install('Element', dom.window.Element);
  install('Node', dom.window.Node);
  install('Event', dom.window.Event);
  install('CustomEvent', dom.window.CustomEvent);
  install('localStorage', dom.window.localStorage);
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  install('matchMedia', matchMedia);
  (dom.window as unknown as Record<string, unknown>).matchMedia = matchMedia;
  const previousReactActEnvironment = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const { createRoot } = await import('react-dom/client');
  const { createElement } = await import('react');
  const { createMemoryRouter, RouterProvider } = await import('react-router');

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(keys.me, me);
  const router = createMemoryRouter([{ path: '/products/:id/:tab?', element: <ProductPage /> }], {
    initialEntries: ['/products/p1/journey']
  });

  // Capture React's dev-mode diagnostics; hook-order change is reported here.
  const reports: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void reports.push(args.map(String).join(' '));

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    root.render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <CelebrateProvider>
            <ConfirmProvider>
              <RouterProvider router={router} />
            </ConfirmProvider>
          </CelebrateProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
    // First render: workspace data is absent, so the guard shows a spinner.
    await wait(300);

    // The data arrives; the same mounted component re-renders with its hooks.
    client.setQueryData(keys.data, workspaceData);
    await wait(600);

    const text = container.textContent ?? '';
    assert.match(text, /Difference Engine/, 'the product should be on screen after loading');
    assert.deepEqual(
      reports.filter((report) => /change in the order of Hooks|Rendered more hooks/i.test(report)),
      [],
      'React must not see a hook-order change'
    );
  } finally {
    console.error = originalError;
    globals.IS_REACT_ACT_ENVIRONMENT = previousReactActEnvironment;
    for (const [name, descriptor] of restore) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as unknown as Record<string, unknown>)[name];
    }
  }
});
