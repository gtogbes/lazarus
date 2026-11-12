import { useEffect, useState } from 'react';
import { fetchRecordedProof, type RecordedProof } from './recordedProof';

/** Per program id: undefined while loading, null when there is no recorded proof. */
export type RecordedProofs = Readonly<Record<string, RecordedProof | null | undefined>>;

/** Loads each program's recorded proof independently, so one slow file does not hold up the rest. */
export function useRecordedProofs(programIds: readonly string[]): RecordedProofs {
  const [proofs, setProofs] = useState<RecordedProofs>({});
  const key = programIds.join('\n');

  useEffect(() => {
    if (key === '') return;
    const controller = new AbortController();
    for (const id of key.split('\n')) {
      fetchRecordedProof(id, controller.signal).then(
        (proof) => {
          setProofs((current) => ({ ...current, [id]: proof }));
        },
        () => {
          // Only an abort rejects, and then the component has gone or the ids changed.
        },
      );
    }
    return () => {
      controller.abort();
    };
  }, [key]);

  return proofs;
}
