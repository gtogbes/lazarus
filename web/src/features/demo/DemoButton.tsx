import { Link } from 'react-router';

/**
 * "Run the demo" (graphical-proof Requirement 11.1), on the landing page and the
 * morgue. A plain link, so it ships in the entry chunk without the demo
 * controller: `useDemo` and the script load with the program chunk (15.1).
 * Do not import anything from this folder here.
 */
export const DEMO_PATH = '/program/PAYROLL?demo=1';

export function DemoButton({ className = '' }: { readonly className?: string }) {
  return (
    <Link
      to={DEMO_PATH}
      data-testid="demo-button"
      className={`inline-block rounded border border-amber-300 px-5 py-2.5 font-semibold text-amber-300 hover:bg-amber-300 hover:text-zinc-950 motion-safe:transition-colors ${className}`}
    >
      Run the demo
    </Link>
  );
}
