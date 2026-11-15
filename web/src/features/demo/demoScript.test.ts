// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../../../src/ports/payroll.layout';
import { compareRecords } from '../../../../src/semantics/layout';
import { firstDifference } from '../counterexample/fieldDifference';
import { parseRecording, type Recording } from '../proof/recording';
import { DEMO_MUTANT, DEMO_SCRIPT, DEMO_TOTAL_MS, demoRecordings, scriptDurationMs, stepRate, stepRecording } from './demoScript';

const recordedDir = new URL('../../../public/recorded/', import.meta.url);

function committed(file: string): Recording {
  const recording = parseRecording(JSON.parse(readFileSync(new URL(file, recordedDir), 'utf8')));
  if (!recording) throw new Error(`${file} is not a valid recording`);
  return recording;
}

describe('demoScript', () => {
  it('runs for 130 s in the design order (11.2, 11.12)', () => {
    expect(scriptDurationMs()).toBe(DEMO_TOTAL_MS);
    expect(DEMO_SCRIPT.map((step) => step.id)).toEqual([
      'program',
      'stitches',
      'prove-real',
      'sabotage',
      'prove-mutant',
      'shrink',
      'autopsy',
      'revive',
    ]);
  });

  it('names only committed recordings, each showing the outcome its step needs (16.4)', () => {
    const recordings = demoRecordings();
    expect(recordings.map((r) => r.file)).toEqual(['PAYROLL.json', `PAYROLL.${DEMO_MUTANT}.json`]);
    for (const { file, expect: outcome } of recordings) {
      expect(existsSync(new URL(file, recordedDir))).toBe(true);
      expect(committed(file).result.status).toBe(outcome === 'alive' ? 'equivalent' : 'diverged');
    }
  });

  it('fits each replay inside its step at its rate', () => {
    for (const step of DEMO_SCRIPT) {
      const recording = stepRecording(step);
      if (!recording) continue;
      const { progress, result } = committed(recording.file);
      const lastMs = Math.max(progress.at(-1)?.elapsedMs ?? 0, result.durationMs);
      expect(lastMs / stepRate(step)!).toBeLessThan(step.durationMs);
    }
  });

  it('describes the autopsy as the recording shows it: one penny in the 0.01 place (13)', () => {
    const { counterexample } = committed(`PAYROLL.${DEMO_MUTANT}.json`).result;
    const differing = counterexample!.cobol.flatMap((cobol, i) =>
      compareRecords(LAYOUT.output, cobol, counterexample!.port[i]!).filter((field) => field.differs),
    );
    expect(differing.map((field) => field.name)).toEqual(['OUT-TAX', 'OUT-NET']);
    const outputFields = new Map(LAYOUT.output.fields.map((field) => [field.name, field]));
    for (const field of differing) {
      expect(firstDifference(outputFields.get(field.name)!, field.cobol.raw, field.port.raw)).toEqual({
        kind: 'decimal-places',
        place: '0.01',
      });
    }
    const autopsy = DEMO_SCRIPT.find((step) => step.id === 'autopsy')!;
    expect(autopsy.caption).toMatch(/OUT-TAX and OUT-NET/);
    expect(autopsy.caption).toMatch(/0\.01 place/);
    expect(autopsy.cues.at(-1)?.cue).toEqual({ kind: 'inspect', field: 'OUT-TAX' });
  });
});
