import { useEffect, useState } from 'react';
import { progressMessage, statusMessage } from './proofMessages';
import { useProofRun } from './useProofRun';

/** Requirement 9.2: progress is announced no more often than this. */
export const PROGRESS_ANNOUNCE_INTERVAL_MS = 5000;

/**
 * Polite live region for the proof (Requirement 9.2). Status changes are
 * announced at once; while running, the counters are announced every 5 s.
 * The visible counters update at 4 Hz elsewhere and are not in a live region.
 */
export function ProofAnnouncer() {
  const status = useProofRun((s) => s.status);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setMessage(statusMessage(useProofRun.getState()));
    if (status !== 'reanimating') return;
    const timer = setInterval(() => {
      setMessage(progressMessage(useProofRun.getState()));
    }, PROGRESS_ANNOUNCE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [status]);
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="proof-announcer">
      {message}
    </p>
  );
}
