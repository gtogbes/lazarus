import { Link } from 'react-router';
import { PANEL } from '../../app/surface';
import { DemoButton } from '../demo/DemoButton';

/**
 * Full-screen hero over the lab scene (AppShell's background layer). The 2D
 * headline and link render first; the scene loads later in its own chunk
 * (Requirement 7.1), behind this panel, so it never shifts the layout.
 */
export function LandingPage() {
  return (
    <section aria-labelledby="landing-title" className="flex flex-1 items-center justify-center py-8 sm:py-16">
      <div className={`${PANEL} max-w-xl px-6 py-8 text-center sm:px-10 sm:py-12`}>
        <h1 id="landing-title" className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Reanimation lab
        </h1>
        <p className="mx-auto mt-4 max-w-prose text-lg text-zinc-300">
          Legacy COBOL, ported to TypeScript and proven equivalent against real GnuCOBOL.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/morgue"
            className="inline-block rounded bg-amber-300 px-6 py-3 text-lg font-semibold text-zinc-950 hover:bg-amber-200 motion-safe:transition-colors"
          >
            Enter the morgue
          </Link>
          <DemoButton className="py-3 text-lg" />
        </div>
      </div>
    </section>
  );
}
