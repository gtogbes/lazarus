import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { LandingPage } from '../features/landing/LandingPage';
import { MorguePage } from '../features/morgue/MorguePage';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
import { PANEL } from './surface';
import { RouteError } from './RouteError';

// The program view carries the highlighted sources, so it loads on its route, not up front.
const ProgramPage = lazy(() => import('../features/program/ProgramPage').then((m) => ({ default: m.ProgramPage })));

/** Shared by the browser router (main.tsx) and memory routers in tests. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'morgue', element: <MorguePage /> },
      {
        path: 'program/:id',
        element: (
          <Suspense fallback={<p className={`${PANEL} p-4 text-zinc-300`}>Opening the vault…</p>}>
            <ProgramPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
