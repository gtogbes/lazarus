/**
 * The morgue's view of a program's recorded proof (Requirement 1.2): the summary
 * of `recorded/<PROG>.json`, the real port's recording. The file format and its
 * validation live in ../proof/recording.ts (written by scripts/record-proofs.ts).
 */
import { parseRecording, recordingUrl } from '../proof/recording';

export interface RecordedProof {
  readonly status: 'equivalent' | 'diverged';
  readonly cases: number;
  readonly durationMs: number;
  /** ISO 8601 timestamp of the recording. */
  readonly generatedAt: string;
}

/**
 * The summary of a recorded proof, or null if the value is not a valid recording
 * (of the real port of `programId`, when given).
 */
export function parseRecordedProof(value: unknown, programId?: string): RecordedProof | null {
  const recording = parseRecording(value, programId === undefined ? undefined : { program: programId });
  if (!recording || recording.started.mutant !== undefined) return null;
  const { status, cases, durationMs, generatedAt } = recording.result;
  return { status, cases, durationMs, generatedAt };
}

export function recordedProofUrl(programId: string): string {
  return recordingUrl({ program: programId });
}

/**
 * The recorded proof for a program, or null when there is none. A missing file,
 * a non-JSON body (the dev server answers unknown paths with index.html) or an
 * invalid shape all mean "no recorded proof"; the morgue still lists the program.
 * Aborts propagate so callers can tell a cancelled load from a missing proof.
 */
export async function fetchRecordedProof(programId: string, signal?: AbortSignal): Promise<RecordedProof | null> {
  let response: Response;
  try {
    response = await fetch(recordedProofUrl(programId), signal ? { signal } : {});
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
  if (!response.ok) return null;
  try {
    return parseRecordedProof(await response.json(), programId);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
