import { useEffect, useState } from 'react';
import { useDemo } from '../demo/useDemo';
import { progressMessage, statusMessage } from './proofMessages';
import { useProofRun } from './useProofRun';

/** Requirement 9.2: progress is announced no more often than this. */
export const PROGRESS_ANNOUNCE_INTERVAL_MS = 5000;

/**
 * Polite live region for the proof (Requirement 9.2). Status changes are
 * announced at once; while running, the counters are announced every 5 s.
 * The visible counters update at 4 Hz elsewhere and are not in a live region.
 *
 * Demo_Mode (graphical-proof Requirements 11.9, 11.11, 14.6) uses this region
 * too, and adds none: each new step's caption is announced, and so is the
 * reason the demo stopped. A caption that lands with a status change wins, and
 * the run's result is announced when it arrives.
 */
export function ProofAnnouncer() {
  const status = useProofRun((s) => s.status);
  const demoStep = useDemo((s) => (s.running ? s.stepIndex : -1));
  const demoError = useDemo((s) => s.error?.message ?? null);
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
  // After the status effect, so a caption that lands with a status change wins.
  useEffect(() => {
    const caption = demoStep < 0 ? undefined : useDemo.getState().script[demoStep]?.caption;
    if (caption) setMessage(caption);
  }, [demoStep]);
  useEffect(() => {
    if (demoError) setMessage(demoError);
  }, [demoError]);
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="proof-announcer">
      {message}
    </p>
  );
}
