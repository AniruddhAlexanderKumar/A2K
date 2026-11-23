import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui';

/**
 * Route-level recovery boundary.
 *
 * Before this existed, any render-time exception (including React error #310)
 * tore down the whole tree and left a blank white page with no way back — the
 * user could not even sign out. React Router renders this component in place of
 * the failed branch instead, so the shell, the navigation and the session stay
 * usable while one screen recovers.
 *
 * Nothing here reads the session on purpose: the boundary must render even when
 * the data layer is the thing that broke.
 */
export function RouteError() {
  const error = useRouteError();

  const status = isRouteErrorResponse(error) ? error.status : null;
  const detail =
    isRouteErrorResponse(error)
      ? error.statusText || error.data
      : error instanceof Error
        ? error.message
        : null;

  // #310 is a bug in a component, not in the user's data: retrying will not fix
  // it, so point them back at a screen that works rather than inviting a reload loop.
  const isHookOrder = typeof detail === 'string' && /hook/i.test(detail) && /render/i.test(detail);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-semibold">
        {status === 404 ? 'That page does not exist' : 'This screen could not be displayed'}
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {isHookOrder
          ? 'A part of this screen failed to load correctly. The rest of the workspace still works — open your Journey to keep going.'
          : 'The rest of the workspace is unaffected. You can try again, or go back to your Journey.'}
      </p>
      {status && <p className="text-xs text-zinc-500">Error {status}</p>}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Link to="/">
          <Button variant="secondary">Back to Journey</Button>
        </Link>
      </div>
      {detail && (
        <details className="w-full text-left">
          <summary className="cursor-pointer text-xs text-zinc-500">Technical details</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-100 p-3 text-left text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {String(detail)}
          </pre>
        </details>
      )}
    </main>
  );
}
