// @vitest-environment node
// Requirement 16.1: text renders through React or textContent, never as HTML.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'dangerouslySetInnerHTML', pattern: /\bdangerouslySetInnerHTML\b/ },
  { name: '.innerHTML', pattern: /\.innerHTML\b/ },
  { name: 'outerHTML assignment', pattern: /\.outerHTML\s*(?:[+]?=)(?!=)/ },
  { name: 'insertAdjacentHTML', pattern: /\binsertAdjacentHTML\b/ },
];

/** Returns one "file:line: name" entry per forbidden use in `text`. */
function findHtmlSinks(file: string, text: string): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${name}`);
    }
  });
  return hits;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && path !== SELF ? [path] : [];
  });
}

describe('no HTML sinks in web/src (Req 16.1)', () => {
  it('flags each forbidden pattern with file:line', () => {
    const fixture = [
      'const ok = el.textContent;',
      '<div dangerouslySetInnerHTML={{ __html: x }} />',
      'el.innerHTML = name;',
      'el.outerHTML = name;',
      "el.insertAdjacentHTML('beforeend', name);",
      'const same = el.outerHTML === other;',
    ].join('\n');
    expect(findHtmlSinks('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:2: dangerouslySetInnerHTML',
      'fixture.tsx:3: .innerHTML',
      'fixture.tsx:4: outerHTML assignment',
      'fixture.tsx:5: insertAdjacentHTML',
    ]);
  });

  it('finds none in web/src', () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((f) =>
      findHtmlSinks(relative(join(SRC_DIR, '..'), f), readFileSync(f, 'utf8')),
    );
    expect(hits, `HTML sinks found:\n${hits.join('\n')}`).toEqual([]);
  });
});
