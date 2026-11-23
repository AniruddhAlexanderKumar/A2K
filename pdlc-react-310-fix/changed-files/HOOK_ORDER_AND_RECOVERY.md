# Hook order and crash recovery

Two things protect the browser app from the class of failure that took production
down with **React error #310, "Rendered more hooks than during the previous
render."**

## What happened

`apps/web/src/pages/product/ProductPage.tsx` rendered a spinner while the
workspace was loading and returned early when the product was missing, then
called three more hooks (`useState`, `useState`, `useEffect`) once the product
arrived:

```tsx
if (isLoading || !data) return <Spinner />;   // render 1: 12 hooks
if (!product) return <EmptyState />;
const [celebrated, setCelebrated] = useState(null);   // render 2: 15 hooks
```

React counts hooks per component and per position, so the second render saw more
hooks than the first. React threw, `createBrowserRouter` had no `errorElement`,
the whole tree unmounted, and the user got a blank page with no way back — not
even to sign out. It reproduced whenever a product screen was opened cold
(loading first, data second), which in production is most visits.

The fix moves the guards into a thin `ProductPage` route shell that returns
either the spinner, the not-found state, or `<ProductContent … />`. The
component that owns hooks now always runs all of them, and it is keyed by product
id so per-product state resets when the user navigates between products.

## The two guards

1. **`npm run lint:hooks`** — `tools/react-lint` runs
   `react-hooks/rules-of-hooks` over `apps/web/src`. CI runs it on every push and
   pull request. It fails on the old `ProductPage` (verified) and passes now.
   The toolchain lives outside the npm workspaces on purpose: it pins TypeScript
   5, because `typescript-eslint` cannot parse with the workspace's TypeScript 7
   yet.
2. **`apps/web/src/pages/product/ProductPage.test.tsx`** — the last test mounts
   the real component in jsdom, renders the loading state, then supplies the
   data. That is the only kind of test that can observe hook order across
   renders; it fails on the old code and passes on the fix.

## Recovery boundary

`apps/web/src/components/RouteError.tsx` is wired as `errorElement` on both the
root route and the authenticated `Layout` route. A render throw inside a page now
replaces just that page: the sidebar, project switcher, navigation and session
stay usable, and the boundary offers a reload and a link back to Journey. Any
future bug of this shape degrades one screen instead of the whole app.

## Working on this

- Never place a hook below an early `return`, or inside an `if`/loop. Move the
  guard into a wrapper component instead, as `ProductPage` does.
- Run `npm run lint:hooks` before pushing; CI runs it too.
- After changing anything under `tools/react-lint`, run
  `npm --prefix tools/react-lint install` once locally.
