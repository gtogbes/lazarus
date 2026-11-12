import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ProgramSource } from '../program/types';
import { useProofRun } from '../proof/useProofRun';
import { MutantDiff } from './MutantDiff';

/**
 * Requirement 4.1-4.4: pick a realistic mistake to plant in the port. The choice
 * lives in the `useProofRun` store (`selectedMutant`), so Prove runs the mutant
 * (4.2). A native radio group keeps it keyboard operable: Tab in, arrows to move.
 */
export function SabotagePanel({ source }: { readonly source: ProgramSource }) {
  const { selectedMutant, selectMutant } = useProofRun(
    useShallow((s) => ({ selectedMutant: s.selectedMutant, selectMutant: s.selectMutant })),
  );
  const selected = source.mutants.find((m) => m.id === selectedMutant) ?? null;
  const name = `mutant-${source.id}`;

  return (
    <section aria-labelledby="sabotage-title" className="mt-6 rounded border border-zinc-800 bg-zinc-900 p-4">
      <h2 id="sabotage-title" className="text-lg font-semibold">
        Sabotage the port
      </h2>
      <p className="mt-1 max-w-prose text-sm text-zinc-300">
        Plant a realistic migration mistake, then Prove it again and watch the proof catch it.
      </p>
      <fieldset className="mt-3">
        <legend className="sr-only">Port to prove</legend>
        <ul className="grid gap-2">
          <li>
            <Option name={name} value={null} checked={selected === null} onSelect={selectMutant}>
              No sabotage: prove the real port
            </Option>
          </li>
          {source.mutants.map((mutant) => (
            <li key={mutant.id}>
              <Option name={name} value={mutant.id} checked={selected?.id === mutant.id} onSelect={selectMutant}>
                {mutant.title}
                {/* The space keeps "Equivalent" a separate word in the radio's accessible name. */}
                {mutant.equivalent !== undefined && ' '}
                {mutant.equivalent !== undefined && (
                  <span className="ml-1 rounded border border-sky-300 px-1.5 text-xs font-semibold text-sky-200">
                    Equivalent
                  </span>
                )}
              </Option>
            </li>
          ))}
        </ul>
      </fieldset>
      {selected && (
        <div className="mt-4" data-testid="mutant-details">
          <h3 className="font-semibold">{selected.title}</h3>
          <p className="mt-1 text-sm text-zinc-300">
            Breaks <code className="font-mono text-zinc-100">{selected.rule}</code>
          </p>
          <p className="mt-1 max-w-prose text-sm">{selected.explanation}</p>
          {selected.equivalent !== undefined && (
            <p className="mt-2 max-w-prose rounded border border-sky-300 p-2 text-sm" data-testid="equivalent-reason">
              <strong className="text-sky-200">Equivalent mutant: no input can expose it.</strong> {selected.equivalent}
            </p>
          )}
          <MutantDiff
            mutant={selected}
            portPath={source.port.path}
            background={source.background}
            foreground={source.foreground}
          />
        </div>
      )}
    </section>
  );
}

interface OptionProps {
  readonly name: string;
  readonly value: string | null;
  readonly checked: boolean;
  readonly onSelect: (value: string | null) => void;
  readonly children: ReactNode;
}

function Option({ name, value, checked, onSelect, children }: OptionProps) {
  return (
    <label className="flex cursor-pointer items-baseline gap-2 text-sm">
      <input
        type="radio"
        name={name}
        value={value ?? ''}
        checked={checked}
        onChange={() => {
          onSelect(value);
        }}
        className="accent-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      />
      <span>{children}</span>
    </label>
  );
}
