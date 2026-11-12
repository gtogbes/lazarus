import { Link } from 'react-router';
import { PANEL } from './surface';

export function NotFoundPage() {
  return (
    <div className={`${PANEL} p-4 sm:p-6`}>
      <h1 className="text-2xl font-semibold">Nothing buried here</h1>
      <p className="mt-2 text-zinc-300">
        That page does not exist. <Link to="/morgue" className="text-amber-300 underline">Go to the morgue</Link>.
      </p>
    </div>
  );
}
