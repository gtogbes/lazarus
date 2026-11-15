import type { Pic } from '../../src/semantics/decimal.ts';
import { parseNumericPicture, type Field, type ProgramLayout } from '../../src/semantics/layout.ts';
import type { FieldLink } from '../src/features/program/types.ts';

/**
 * Field map for the stitch lines (Requirement 6.1, design: "Stitches"). Each
 * COBOL data item is paired with the port code that represents it:
 *
 * - input fields with the port's `record.slice(offset, offset + length)` read,
 * - output fields with the elements of the array `processRecord` returns and
 *   joins with `' '` (the FILLERs between them are the separators),
 * - numeric working-storage items with `PICS` entries, by name (`WS-OT-HOURS`
 *   is `otHours`) or by the COBOL names listed in the entry's comment:
 *
 *       amount: pic(7, 2, false), // 9(7)V99: WS-LINE, WS-DISC
 *
 * The layout module is checked against the FD items too. A stitch is a claim
 * about the code, so any broken mapping fails the build with every problem
 * listed (Requirement 6.2), as `statementLinks.ts` does for statement quotes.
 */

export class FieldLinkError extends Error {
  constructor(
    readonly file: string,
    readonly problems: readonly string[],
  ) {
    super(`Field linking failed for ${file}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'FieldLinkError';
  }
}

/** One elementary DATA DIVISION item (it has a PIC). */
interface DataItem {
  readonly level: number;
  readonly name: string;
  /** PIC string plus SIGN and USAGE clauses, VALUE stripped, whitespace collapsed. */
  readonly picture: string;
  readonly line: number;
  readonly section: 'file' | 'working' | 'other';
  /** The 01 record this item belongs to. */
  readonly record: string;
}

const VALUE_CLAUSE = /\s+VALUES?\s+(?:IS\s+|ARE\s+)?(?:"[^"]*"|'[^']*'|\S+)/i;
const PIC_CLAUSE = /^(.*?)\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+)(.*)$/i;

/** DATA DIVISION entries in fixed format: comment lines skipped, entries end at a separator period. */
function dataItems(cobolSource: string): DataItem[] | null {
  const lines = cobolSource.split(/\r?\n/);
  const items: DataItem[] = [];
  let inData = false;
  let section: DataItem['section'] = 'other';
  let record = '';
  let entry = '';
  let entryLine = 0;

  const finish = () => {
    const words = entry.trim().split(/\s+/);
    entry = '';
    const upper = words.map((w) => w.toUpperCase());
    if (upper[1] === 'SECTION') {
      section = upper[0] === 'FILE' ? 'file' : upper[0] === 'WORKING-STORAGE' ? 'working' : 'other';
      return;
    }
    if (!/^\d{1,2}$/.test(words[0] ?? '')) return; // FD, SD and other non-item entries
    const level = Number(words[0]);
    if (level === 88 || level === 66) return;
    const hasName = words[1] !== undefined && !/^PIC(?:TURE)?$/i.test(words[1]);
    const name = hasName ? upper[1]! : 'FILLER';
    if (level === 1 || level === 77) record = name;
    const clauses = words.slice(hasName ? 2 : 1).join(' ').replace(VALUE_CLAUSE, '');
    const pic = PIC_CLAUSE.exec(` ${clauses}`);
    if (!pic) return; // a group item
    const picture = `${pic[2]} ${pic[1]} ${pic[3]}`.replace(/\s+/g, ' ').trim().toUpperCase();
    items.push({ level, name, picture, line: entryLine, section, record });
  };

  for (const [index, raw] of lines.entries()) {
    const indicator = raw[6];
    if (indicator === '*' || indicator === '/') continue;
    let text = raw.slice(7, 72);
    const words = text.trim().split(/\s+/).map((w) => w.toUpperCase().replace(/\.$/, ''));
    if (!inData) {
      inData = words[0] === 'DATA' && words[1] === 'DIVISION';
      continue;
    }
    if (words[0] === 'PROCEDURE' && words[1] === 'DIVISION') break;
    // A period followed by a space or the end of the line ends an entry (not the one in PIC 9.99).
    while (text.trim() !== '') {
      if (entry.trim() === '') entryLine = index + 1;
      const end = /\.(?=\s|$)/.exec(text);
      if (!end) {
        entry += ` ${text}`;
        break;
      }
      entry += ` ${text.slice(0, end.index)}`;
      text = text.slice(end.index + 1);
      finish();
    }
  }
  return inData ? items : null;
}

function normalisePicture(picture: string): string {
  return picture.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** `WS-OT-HOURS` → `otHours`: the name rule for `PICS` keys. */
export function picsKeyFor(cobolName: string): string {
  const parts = cobolName.toLowerCase().replace(/^(?:in|out|ws)-/, '').split('-');
  return parts.map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
}

function samePic(a: Pic, b: Pic): boolean {
  return a.intDigits === b.intDigits && a.scale === b.scale && a.signed === b.signed;
}

function showPic(p: Pic): string {
  return `pic(${p.intDigits}, ${p.scale}, ${p.signed})`;
}

function representation(type: Field['type'] | { kind: 'numeric'; pic: Pic }, length: number): string {
  if (type.kind === 'alphanumeric') return `string, ${length} character${length === 1 ? '' : 's'}`;
  const { intDigits, scale, signed } = type.pic;
  const max = `${'9'.repeat(intDigits) || '0'}${scale > 0 ? `.${'9'.repeat(scale)}` : ''}`;
  const scaling = scale > 0 ? ` scaled by ${10n ** BigInt(scale)}` : '';
  const range = signed ? `-${max} to ${max}, signed` : `${max.replace(/9/g, '0').replace(/^0+(?=\d)/, '')} to ${max}, unsigned`;
  return `bigint${scaling}, ${range}`;
}

interface PicsEntry {
  readonly key: string;
  readonly pic: Pic;
  readonly line: number;
  readonly code: string;
  /** COBOL names from the comment, or null to map by the name rule. */
  readonly names: readonly string[] | null;
}

const PICS_START = /^\s*export\s+const\s+PICS\s*=\s*\{\s*$/;
const PICS_ENTRY = /^\s*(\w+):\s*(pic\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(true|false)\s*\)),?\s*(?:\/\/\s*(.*))?$/;
const COBOL_NAME = /^[A-Z][A-Z0-9-]*$/;

function picsEntries(portLines: readonly string[], problems: string[]): PicsEntry[] {
  const start = portLines.findIndex((line) => PICS_START.test(line));
  if (start < 0) return [];
  const entries: PicsEntry[] = [];
  for (let i = start + 1; i < portLines.length; i++) {
    const text = portLines[i] ?? '';
    if (/^\s*\}/.test(text)) break;
    if (text.trim() === '' || /^\s*\/\//.test(text)) continue;
    const match = PICS_ENTRY.exec(text);
    if (!match) {
      problems.push(`port line ${i + 1}: PICS entry is not "key: pic(i, s, signed), // PIC[: NAME, ...]": ${text.trim()}`);
      continue;
    }
    const [, key = '', code = '', i9 = '0', s9 = '0', signed, comment = ''] = match;
    const colon = comment.indexOf(':');
    let names: string[] | null = null;
    if (colon >= 0) {
      names = comment.slice(colon + 1).split(',').map((n) => n.trim());
      const bad = names.filter((n) => !COBOL_NAME.test(n));
      if (bad.length > 0 || names.length === 0) {
        problems.push(`PICS.${key} (port line ${i + 1}): the comment's names are not COBOL names: "${comment.slice(colon + 1).trim()}"`);
        names = names.filter((n) => COBOL_NAME.test(n));
      }
    }
    entries.push({
      key,
      pic: { intDigits: Number(i9), scale: Number(s9), signed: signed === 'true' },
      line: i + 1,
      code: `${key}: ${code}`,
      names,
    });
  }
  return entries;
}

interface ArrayElement {
  readonly code: string;
  readonly line: number;
}

/** Elements of `return [ ... ].join(' ')` inside `processRecord`, split at top-level commas. */
function returnedElements(portSource: string): ArrayElement[] | null {
  const fn = portSource.search(/\bfunction\s+processRecord\s*\(/);
  if (fn < 0) return null;
  const ret = /\breturn\s*\[/g;
  ret.lastIndex = fn;
  const open = ret.exec(portSource);
  if (!open) return null;
  const lineAt = (offset: number) => portSource.slice(0, offset).split('\n').length;
  const elements: ArrayElement[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open.index + open[0].length;
  for (let i = start; i < portSource.length; i++) {
    const c = portSource[i]!;
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === '}' || c === ']') && depth > 0) depth--;
    else if (depth === 0 && (c === ',' || c === ']')) {
      const raw = portSource.slice(start, i);
      const code = raw.trim();
      if (code !== '') elements.push({ code, line: lineAt(start + raw.indexOf(code)) });
      start = i + 1;
      if (c === ']') {
        return /^\s*\.join\(\s*(['"])\s\1\s*\)/.test(portSource.slice(i + 1)) ? elements : null;
      }
    }
  }
  return null;
}

const PICS_REF = /\bPICS\.(\w+)\b/g;
const FORMAT_DISPLAY =
  /^formatDisplay\(([\s\S]+),\s*(?:PICS\.(\w+)|pic\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(true|false)\s*\))\s*\)$/;
const PAD_END = /\.padEnd\(\s*(\d+)\s*\)$/;

/**
 * Why a returned element cannot be the given output field, or null when it can.
 * Alphanumeric fields take a string expression (an identifier, a slice,
 * `x.padEnd(n)` with n the field's length); numeric fields take
 * `formatDisplay(x, PICS.k)` or `formatDisplay(x, pic(i, s, signed))` with the field's PIC.
 */
function elementMismatch(field: Field, code: string, entryByKey: ReadonlyMap<string, PicsEntry>): string | null {
  if (field.type.kind === 'alphanumeric') {
    if (/\bformatDisplay\(/.test(code)) return `is a formatDisplay(...) number, but the field is PIC ${field.picture}`;
    const pad = PAD_END.exec(code);
    if (pad && Number(pad[1]) !== field.length) {
      return `pads to ${pad[1]} characters, but the field is PIC ${field.picture}, ${field.length} characters`;
    }
    return null;
  }
  const want = showPic(field.type.pic);
  const m = FORMAT_DISPLAY.exec(code);
  if (!m) return `is not formatDisplay(x, PICS.k) or formatDisplay(x, pic(i, s, signed)), but the field is numeric, ${want}`;
  const [, , key, i9 = '0', s9 = '0', signed] = m;
  if (key !== undefined) {
    const entry = entryByKey.get(key);
    if (!entry) return `uses PICS.${key}, which does not exist`;
    return samePic(entry.pic, field.type.pic) ? null : `uses PICS.${key} ${showPic(entry.pic)}, but the field is ${want}`;
  }
  const inline: Pic = { intDigits: Number(i9), scale: Number(s9), signed: signed === 'true' };
  return samePic(inline, field.type.pic) ? null : `uses ${showPic(inline)}, but the field is ${want}`;
}

/**
 * Port lines after whole-line comments that mention `name`: the statement-link
 * quotes that read or write the item, so the first code line of each.
 */
function quotedUses(portLines: readonly string[], name: string): number[] {
  const mention = new RegExp(`(?:^|[^A-Z0-9-])${name.replace(/-/g, '\\-')}(?![A-Z0-9-])`, 'i');
  const uses: number[] = [];
  for (let i = 0; i < portLines.length; i++) {
    const comment = /^\s*\/\/(.*)$/.exec(portLines[i] ?? '');
    if (!comment || !mention.test(comment[1] ?? '')) continue;
    let j = i + 1;
    while (j < portLines.length && /^\s*(?:\/\/.*)?$/.test(portLines[j] ?? '')) j++;
    if (j < portLines.length) uses.push(j + 1);
  }
  return uses;
}

/**
 * Builds the field map for one program. Line numbers are 1-based. Throws
 * `FieldLinkError` listing every broken mapping.
 */
export function linkFields(
  cobolSource: string,
  portSource: string,
  layout: ProgramLayout,
  file = 'port',
): FieldLink[] {
  const items = dataItems(cobolSource);
  if (items === null) throw new FieldLinkError(file, ['the COBOL source has no DATA DIVISION']);
  const portLines = portSource.split(/\r?\n/);
  const problems: string[] = [];
  const entries = picsEntries(portLines, problems);
  const entryByKey = new Map(entries.map((e) => [e.key, e]));

  // PICS entries to COBOL items: by the comment's names, else by the name rule.
  const entriesFor = new Map<DataItem, PicsEntry[]>();
  for (const entry of entries) {
    const where = `PICS.${entry.key} (port line ${entry.line})`;
    const mapped =
      entry.names === null
        ? items.filter((item) => item.name !== 'FILLER' && picsKeyFor(item.name) === entry.key)
        : entry.names.flatMap((name) => {
            const found = items.filter((item) => item.name === name);
            if (found.length === 0) problems.push(`${where}: the comment names ${name}, which is not a COBOL data item`);
            return found;
          });
    if (mapped.length === 0 && entry.names === null) {
      problems.push(`${where}: maps to no COBOL item (no item is named like "${entry.key}"; list the COBOL names in its comment)`);
    }
    for (const item of mapped) {
      let itemPic: Pic;
      try {
        itemPic = parseNumericPicture(item.picture);
      } catch {
        problems.push(`${where}: maps to ${item.name} (COBOL line ${item.line}), which is not numeric: PIC ${item.picture}`);
        continue;
      }
      if (!samePic(itemPic, entry.pic)) {
        problems.push(`${where}: ${showPic(entry.pic)} differs from ${item.name} PIC ${item.picture} (COBOL line ${item.line}), which is ${showPic(itemPic)}`);
      }
      entriesFor.set(item, [...(entriesFor.get(item) ?? []), entry]);
    }
  }

  const links: FieldLink[] = [];

  /** Primary line, the PICS entries it references or that map to the item, then quoted uses. */
  const portLinesFor = (primary: number, item: DataItem | undefined, name: string, code: string): number[] => {
    const referenced = [...code.matchAll(PICS_REF)].flatMap((m) => entryByKey.get(m[1] ?? '') ?? []);
    const mapped = item ? (entriesFor.get(item) ?? []) : [];
    const lines = [primary, ...[...referenced, ...mapped].map((e) => e.line), ...quotedUses(portLines, name)];
    return [...new Set(lines)];
  };

  /** A numeric record field's port code must use a PICS entry with the field's PIC. */
  const checkReference = (field: Field, code: string, line: number) => {
    if (field.type.kind !== 'numeric') return;
    for (const m of code.matchAll(PICS_REF)) {
      const entry = entryByKey.get(m[1] ?? '');
      if (!entry) problems.push(`${field.name}: port line ${line} uses PICS.${m[1]}, which does not exist`);
      else if (!samePic(entry.pic, field.type.pic)) {
        problems.push(`${field.name}: port line ${line} uses PICS.${entry.key} ${showPic(entry.pic)}, but the field is ${showPic(field.type.pic)}`);
      }
    }
  };

  // Layout against the FD record, position by position.
  const recordItems = (side: 'input' | 'output'): (DataItem | undefined)[] => {
    const record = layout[side];
    const fd = items.filter((item) => item.section === 'file' && item.record === record.name && item.level !== 1);
    if (fd.length === 0) problems.push(`${side} layout ${record.name}: no FD record of that name in the COBOL`);
    else if (fd.length !== record.fields.length) {
      problems.push(`${side} layout ${record.name}: ${record.fields.length} fields, but the FD record has ${fd.length} items`);
    }
    return record.fields.map((field, i) => {
      const item = fd[i];
      if (item === undefined) return undefined;
      if (item.name !== field.name.toUpperCase()) {
        problems.push(`${side} layout ${record.name} field ${i + 1}: ${field.name}, but the FD item is ${item.name} (COBOL line ${item.line})`);
      } else if (item.picture !== normalisePicture(field.picture)) {
        problems.push(`${field.name}: layout PIC ${field.picture}, but the FD has PIC ${item.picture} (COBOL line ${item.line})`);
      }
      return item;
    });
  };

  const recordLink = (field: Field, item: DataItem | undefined, section: 'input' | 'output', line: number, code: string) => {
    checkReference(field, code, line);
    if (item === undefined) return;
    links.push({
      name: field.name,
      section,
      picture: field.picture,
      cobolLine: item.line,
      portLines: portLinesFor(line, item, field.name, code),
      portCode: code,
      representation: representation(field.type, field.length),
      offset: field.offset,
      length: field.length,
    });
  };

  // Input fields: exactly one `record.slice(offset, offset + length)` each.
  const inputItems = recordItems('input');
  const slices = portLines.flatMap((text, i) =>
    [...text.matchAll(/\brecord\.slice\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)].map((m) => ({
      start: Number(m[1]),
      end: Number(m[2]),
      line: i + 1,
      code: text.trim().replace(/;$/, ''),
    })),
  );
  const claimed = new Set<(typeof slices)[number]>();
  layout.input.fields.forEach((field, i) => {
    const matches = slices.filter((s) => s.start === field.offset && s.end === field.offset + field.length);
    matches.forEach((s) => claimed.add(s));
    if (field.name === 'FILLER') return;
    const want = `record.slice(${field.offset}, ${field.offset + field.length})`;
    if (matches.length !== 1) {
      problems.push(
        matches.length === 0
          ? `${field.name}: no ${want} in the port`
          : `${field.name}: ${want} appears ${matches.length} times (port lines ${matches.map((s) => s.line).join(', ')})`,
      );
      return;
    }
    const [slice] = matches as [(typeof slices)[number]];
    recordLink(field, inputItems[i], 'input', slice.line, slice.code);
  });
  for (const slice of slices) {
    if (!claimed.has(slice)) {
      problems.push(`port line ${slice.line}: record.slice(${slice.start}, ${slice.end}) matches no input field`);
    }
  }

  // Output fields: the returned array's elements in order, FILLERs as the ' ' separators.
  const outputItems = recordItems('output');
  const outputFields = layout.output.fields;
  outputFields.forEach((field, i) => {
    const isFiller = field.name === 'FILLER';
    if (isFiller !== (i % 2 === 1)) {
      problems.push(`${field.name} (output field ${i + 1}): the join(' ') needs one PIC X FILLER between each pair of fields, and none at the ends`);
    } else if (isFiller && normalisePicture(field.picture) !== 'X') {
      problems.push(`output FILLER ${i + 1}: PIC ${field.picture}, but the join(' ') separator is PIC X`);
    }
  });
  if (outputFields.length % 2 === 0 && outputFields.length > 0) {
    problems.push(`output layout ${layout.output.name}: ends with a FILLER, which the join(' ') does not write`);
  }
  const elements = returnedElements(portSource);
  const named = outputFields.flatMap((field, i) => (field.name === 'FILLER' ? [] : [{ field, item: outputItems[i] }]));
  if (elements === null) {
    problems.push("processRecord has no `return [ ... ].join(' ')`");
  } else {
    // Each element must match its field's kind and PIC, so a missing or extra
    // element is reported where it is, not at the field the shift lands on.
    const n = named.length;
    const m = elements.length;
    const reason = (i: number, j: number) => elementMismatch(named[i]!.field, elements[j]!.code, entryByKey);
    const fits = (i: number, j: number) => reason(i, j) === null;
    const link = (i: number, j: number) => {
      const { field, item } = named[i]!;
      recordLink(field, item, 'output', elements[j]!.line, elements[j]!.code);
    };
    const describe = (j: number) => `"${elements[j]!.code}" (port line ${elements[j]!.line})`;

    if (n === m) {
      named.forEach(({ field }, i) => {
        const why = reason(i, i);
        if (why === null) link(i, i);
        else problems.push(`${field.name}: returned element ${i + 1} ${describe(i)} ${why}`);
      });
    } else {
      const counts = `${n} output field${n === 1 ? '' : 's'}, but processRecord returns ${m} element${m === 1 ? '' : 's'}`;
      let first = 0;
      while (first < Math.min(n, m) && fits(first, first)) first++;
      // One missing (n > m) or extra (m > n) element at position k: everything before k
      // lines up, everything after lines up shifted by one.
      const candidates: number[] = [];
      if (Math.abs(n - m) === 1) {
        for (let k = 0; k <= first && k < Math.max(n, m); k++) {
          let ok = true;
          for (let i = k + 1; ok && i < Math.max(n, m); i++) ok = n > m ? fits(i, i - 1) : fits(i - 1, i);
          if (ok) candidates.push(k);
        }
      }
      const firstField = first < n ? ` The first field whose element does not match is ${named[first]!.field.name}.` : '';
      if (candidates.length > 0) {
        const lo = candidates[0]!;
        const hi = candidates[candidates.length - 1]!;
        if (n > m) {
          const names = candidates.map((k) => named[k]!.field.name);
          problems.push(
            names.length === 1
              ? `${names[0]}: no element for it in the array processRecord returns (${counts})`
              : `the element for one of ${names.join(', ')} is missing from the array processRecord returns (${counts}).${firstField}`,
          );
          for (let i = 0; i < lo; i++) link(i, i);
          for (let i = hi + 1; i < n; i++) link(i, i - 1);
        } else {
          problems.push(
            candidates.length === 1
              ? `port line ${elements[lo]!.line}: returned element "${elements[lo]!.code}" matches no output field (${counts})`
              : `one of the returned elements ${candidates.map(describe).join(', ')} matches no output field (${counts}).${firstField}`,
          );
          for (let i = 0; i < lo; i++) link(i, i);
          for (let j = hi + 1; j < m; j++) link(j - 1, j);
        }
      } else {
        for (let i = 0; i < first; i++) link(i, i);
        if (first < n) {
          const why = first < m ? `: returned element ${first + 1} ${describe(first)} ${reason(first, first)}` : '';
          problems.push(`${named[first]!.field.name} is the first output field whose element does not match (${counts})${why}`);
        }
        for (let j = n; j < m && first === n; j++) {
          problems.push(`port line ${elements[j]!.line}: returned element "${elements[j]!.code}" matches no output field (${counts})`);
        }
      }
    }
  }

  // Numeric working-storage items with a PICS entry. Items without one (flags, constants) are allowed.
  for (const item of items) {
    const [entry] = entriesFor.get(item) ?? [];
    if (item.section !== 'working' || entry === undefined) continue;
    links.push({
      name: item.name,
      section: 'working',
      picture: item.picture,
      cobolLine: item.line,
      portLines: portLinesFor(entry.line, item, item.name, entry.code),
      portCode: entry.code,
      representation: representation({ kind: 'numeric', pic: entry.pic }, 0),
    });
  }

  if (problems.length > 0) throw new FieldLinkError(file, problems);
  return links.sort((a, b) => a.cobolLine - b.cobolLine);
}
