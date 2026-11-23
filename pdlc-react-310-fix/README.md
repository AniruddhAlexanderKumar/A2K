# Fix for the `pdlc-platform.onrender.com` crash (React #310)

**Status: fix is complete, verified, and sitting in one patch — it could not be
pushed to `AniruddhAlexanderKumar/pdlc` from this session.** The GitHub
credential available here is read-only for that repository (`git push` → 403,
GitHub API ref creation → `Resource not accessible by integration`), so the
commit is delivered as `0001-fix-react-310-product-screen-hook-order.patch`
instead of a branch.

## Root cause

`apps/web/src/pages/product/ProductPage.tsx` rendered a spinner while the
workspace was still loading, and returned early when the product was missing.
Then, once the product arrived, it called three more hooks:

```tsx
if (isLoading || !data) return <Spinner />;   // render 1: 12 hooks
if (!product) return <EmptyState />;
const [celebrated, setCelebrated] = useState(null);   // render 2: 15 hooks
const [celebrating, setCelebrating] = useState(null);
useEffect(() => { /* … */ });
```

React counts hooks per component and per position. The second render executed
more hooks than the first, so React threw error **#310, "Rendered more hooks than
during the previous render"**. Because `createBrowserRouter` had no
`errorElement`, the throw unmounted the entire tree and the user was left on a
blank white page with no way to recover — not even to sign out.

It fires whenever a product screen is opened cold: loading first, data second.
That is most visits in production, which matches "the app is crashing".

Introduced in `270c46d` ("Redesign the PLM workflow as a Duolingo-style guided
journey"), not by the Journey-first merge as first suspected.

## Reproduction (before the fix)

Mounting the real component in jsdom, rendering while loading, then supplying the
data, reproduces it exactly:

```
renderedProduct: false
hookErrors: ["React has detected a change in the order of Hooks called by %s. …"]
```

Nothing renders — the blank page. After the fix the same harness prints
`renderedProduct: true` with no hook errors.

## What the patch changes

| File | Change |
| --- | --- |
| `apps/web/src/pages/product/ProductPage.tsx` | Guards move into a thin route shell; hooks live in `<ProductContent key={product.id} />` and always run |
| `apps/web/src/components/RouteError.tsx` | New recovery boundary: offers reload and "Back to Journey", shows the status and details |
| `apps/web/src/main.tsx` | `errorElement` on the root route **and** the authenticated `Layout` route |
| `apps/web/src/pages/product/ProductPage.test.tsx` | Render coverage for all three states, plus a jsdom mount test that fails on the old code |
| `tools/react-lint/**` | Isolated ESLint toolchain enforcing `react-hooks/rules-of-hooks` over `apps/web/src` |
| `.github/workflows/ci.yml` | Runs the hook-order check on every push and PR |
| `apps/web/scripts/project-workflow-smoke.mjs` | Browser assertion that the product screen renders without a hook-order error |
| `HOOK_ORDER_AND_RECOVERY.md` | Why it happened and the two guards that prevent a repeat |

Two notes on the toolchain: the linter lives outside the npm workspaces because
it pins TypeScript 5 — `typescript-eslint` cannot parse with the workspace's
TypeScript 7 yet — and `react-hooks/exhaustive-deps` stays off so the hook-order
signal is not buried under pre-existing warnings.

## Verified

- `npm run typecheck` — clean (all four packages)
- `npm test` — 43 + 99 + 57 + 58 tests pass
- `npm run lint:hooks` — clean; fails with 3 errors when the old `ProductPage` is
  restored (checked both ways)
- `npm run build` — web and server build
- The new jsdom test fails on the old code and passes on the fix

## Applying it

```bash
git clone https://github.com/AniruddhAlexanderKumar/pdlc.git
cd pdlc
git checkout -b fix/react-310-hook-order
git am /path/to/0001-fix-react-310-product-screen-hook-order.patch
npm ci
npm run typecheck && npm test && npm run lint:hooks && npm run build
git push -u origin fix/react-310-hook-order
```

Then open a PR; Render redeploys `pdlc-platform` from `main` on merge.

## Remaining "market ready" gaps worth a follow-up

The crash is fixed, but this session could not reach the deployed instance
(outbound requests to `pdlc-platform.onrender.com` returned `status:000`) and
could not run the full browser smoke suite here (no Chromium binary and no
PostgreSQL client library for the embedded dev database). Two things I would
check next on the deployment itself:

1. **`errorElement` coverage is now the safety net, not the fix.** Confirm no
   other screen throws on cold load by watching the browser console for
   `change in the order of Hooks` while clicking through Journey, AI Assistant,
   Design Studio, a project and a product.
2. **Free-tier cold starts.** The service sleeps when idle; the first request
   after a sleep can take ~50s. If "crashing" also meant visible timeouts rather
   than the blank page, that is a plan/hosting issue rather than a code defect.
