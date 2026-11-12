import { useRef, useState } from 'react';
import type { ReplayResult } from './replay';

/** Select the command text so a failed copy can be finished with the keyboard. */
function selectText(element: HTMLElement | null): void {
  if (!element) return;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Requirement 5.4: the replay command as selectable text, with a copy button and an announced result. */
export function ReplayCommand({ result }: { readonly result: ReplayResult }) {
  const codeRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState('');

  if (!result.ok) {
    return (
      <p className="mt-2 text-sm text-zinc-300" data-testid="replay-unavailable">
        {result.reason}
      </p>
    );
  }
  const { command, note } = result.replay;

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('No clipboard');
      await navigator.clipboard.writeText(command);
      setMessage('Copied the replay command.');
    } catch {
      selectText(codeRef.current);
      setMessage('Could not copy automatically. The command is selected: press Ctrl+C or Command+C to copy it.');
    }
  }

  return (
    <>
      {/* Long commands scroll sideways: focusable so keyboard users can scroll it (WCAG 2.1.1). */}
      <pre
        role="region"
        aria-label="Replay command"
        tabIndex={0}
        className="mt-2 overflow-x-auto rounded border border-zinc-700 bg-zinc-950 p-3 text-sm"
      >
        <code ref={codeRef} className="font-mono text-zinc-100 select-all" data-testid="replay-command">
          {command}
        </code>
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          className="rounded border border-zinc-500 px-3 py-1.5 text-sm font-semibold text-zinc-100 hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          Copy command
        </button>
        <p role="status" aria-live="polite" className="text-sm text-zinc-300" data-testid="copy-status">
          {message}
        </p>
      </div>
      <p className="mt-2 max-w-prose text-sm text-zinc-300">{note}</p>
    </>
  );
}
