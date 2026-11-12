import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { LabSceneSlot } from '../scene/LabSceneSlot';
import { BAR } from './surface';

export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  // Move focus to the new page on client-side navigation so screen readers
  // and keyboard users start at the content, not the link they just used.
  // Compared with the previous path rather than a first-render flag: StrictMode
  // runs mount effects twice, which spent the flag and focused <main> on the
  // initial load, so the first Tab skipped the skip link.
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <>
      {/* One scene for the whole app, behind the content: it persists across routes. */}
      <LabSceneSlot />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:rounded focus:bg-zinc-100 focus:px-3 focus:py-2 focus:text-zinc-950"
        >
          Skip to content
        </a>
        <header className={BAR}>
          <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link to="/" className="font-semibold tracking-wide">
              Lazarus
            </Link>
            <NavLink
              to="/morgue"
              className={({ isActive }) => (isActive ? 'text-amber-300 underline underline-offset-4' : 'text-zinc-300 hover:text-zinc-100')}
            >
              Morgue
            </NavLink>
          </nav>
        </header>
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 focus:outline-none"
        >
          <Outlet />
        </main>
      </div>
    </>
  );
}
