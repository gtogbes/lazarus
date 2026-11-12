import { isRouteErrorResponse, useRouteError } from 'react-router';

/** Last-resort boundary for render errors in any route. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : 'Something went wrong.';
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">The lab hit a fault</h1>
      <p className="mt-2 text-zinc-300">{message}</p>
      <a href="/" className="mt-4 inline-block text-amber-300 underline">
        Reload the lab
      </a>
    </main>
  );
}
