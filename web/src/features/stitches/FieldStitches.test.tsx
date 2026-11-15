import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadProgramSource } from '../program/loadProgramSource';
import { SourcePanes } from '../program/SourcePanes';
import type { FieldLink, ProgramSource } from '../program/types';
import { fieldCaption, fieldDescription, linesText, recordText, trimLeading } from './FieldStitches';

/** jsdom has no layout: report media queries as a viewport of `width` px would. */
function setViewportWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

let payroll: ProgramSource;
beforeAll(async () => {
  payroll = await loadProgramSource('PAYROLL');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const field = (name: string) => {
  const f = payroll.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
};
const listbox = () => screen.getByRole('listbox', { name: 'Fields' });
const option = (name: string) => within(listbox()).getByRole('option', { name });
const details = () => screen.getByTestId('field-details');
const cobolPane = () => screen.getByRole('region', { name: /^COBOL/ });
const portPane = () => screen.getByRole('region', { name: /^TypeScript port/ });
const line = (pane: HTMLElement, n: number) => pane.querySelector<HTMLElement>(`[data-line="${n}"]`);

describe('details text', () => {
  const base: FieldLink = {
    name: 'IN-HOURS',
    section: 'input',
    picture: '9(3)V9',
    cobolLine: 12,
    portLines: [40],
    portCode: 'record.slice(8, 12)',
    representation: 'bigint scaled by 10, 0.0 to 999.9, unsigned',
    offset: 8,
    length: 4,
  };

  it('gives record fields their offset, width and 1-based columns', () => {
    expect(recordText(base)).toBe('offset 8, width 4 (columns 9–12)');
    expect(recordText({ ...base, offset: 0, length: 1 })).toBe('offset 0, width 1 (column 1)');
    const { offset: _o, length: _l, ...working } = base;
    expect(recordText({ ...working, section: 'working' })).toBeNull();
  });

  it('lists the other port lines that use a field', () => {
    expect(linesText(base)).toBe('COBOL line 12, port line 40');
    expect(linesText({ ...base, portLines: [40, 70] })).toBe('COBOL line 12, port line 40; the port also uses it on line 70');
    expect(linesText({ ...base, portLines: [40, 70, 80, 90] })).toBe(
      'COBOL line 12, port line 40; the port also uses it on lines 70, 80 and 90',
    );
  });

  it('describes a field with its PIC, record position, TypeScript representation and port code', () => {
    expect(fieldDescription(base)).toBe(
      'Input record field. PIC 9(3)V9. Record offset 8, width 4 (columns 9–12). ' +
        'TypeScript: bigint scaled by 10, 0.0 to 999.9, unsigned. Port code: record.slice(8, 12). COBOL line 12, port line 40.',
    );
  });

  it('trims only the leading whitespace of a token line', () => {
    expect(
      trimLeading([
        ['   ', '#fff'],
        ['  05 ', '#aaa'],
        ['X ', '#bbb'],
      ]),
    ).toEqual([
      ['05 ', '#aaa'],
      ['X ', '#bbb'],
    ]);
  });
});

describe('field stitches (6.4, 6.6, 6.7)', () => {
  it('is one Tab stop: a listbox with one tabbable option, before the code panes', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    render(<SourcePanes source={payroll} />);
    const options = within(listbox()).getAllByRole('option');
    expect(options).toHaveLength(payroll.fields.length);
    expect(options.filter((o) => o.tabIndex === 0)).toHaveLength(1);
    // Grouped by record, with visible group labels.
    expect(within(listbox()).getAllByRole('group')).toHaveLength(3);
    expect(within(listbox()).getByRole('group', { name: 'Output record' })).toContainElement(option('OUT-TAX'));

    await user.tab();
    expect(options[0]).toHaveFocus();
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.tab();
    expect(cobolPane()).toHaveFocus();
    // The overlay is decorative: the listbox and details carry the information.
    expect(screen.getByTestId('stitch-overlay')).toHaveAttribute('aria-hidden', 'true');
  });

  it('moves with arrows and Home/End, shows the details as text, and clears on Escape', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    render(<SourcePanes source={payroll} />);
    const options = within(listbox()).getAllByRole('option');
    act(() => {
      options[0]?.focus();
    });
    await user.keyboard('{ArrowRight}');
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options.filter((o) => o.tabIndex === 0)).toEqual([options[1]]);

    await user.keyboard('{End}');
    expect(options.at(-1)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(options[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}'); // stays at the first
    expect(options[0]).toHaveFocus();

    // Arrow to OUT-TAX: the details give the PIC, the TypeScript representation and the port code.
    const outTax = field('OUT-TAX');
    for (let i = 0; i < options.length && !option('OUT-TAX').matches(':focus'); i++) await user.keyboard('{ArrowDown}');
    expect(option('OUT-TAX')).toHaveFocus();
    expect(option('OUT-TAX')).toHaveAccessibleDescription(fieldDescription(outTax));
    expect(details()).toHaveTextContent('OUT-TAX');
    expect(details()).toHaveTextContent(`PIC${outTax.picture}`);
    expect(details()).toHaveTextContent(`TypeScript${outTax.representation}`);
    expect(details()).toHaveTextContent(`Port code${outTax.portCode}`);
    expect(screen.getByTestId('field-lines')).toHaveTextContent(`COBOL ${outTax.cobolLine}`);
    // The field's lines are marked in both panes.
    expect(line(cobolPane(), outTax.cobolLine)).toHaveAttribute('data-field-active', 'true');
    expect(line(portPane(), outTax.portLines[0]!)).toHaveAttribute('data-field-active', 'true');

    await user.keyboard('{Escape}');
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toEqual([]);
    expect(details()).toHaveTextContent(/^Choose a field/);
    expect(cobolPane().querySelector('[data-field-active]')).toBeNull();
    expect(option('OUT-TAX')).toHaveFocus(); // focus stays, so arrows carry on from here
  });

  it('shows a field when the pointer is on its COBOL or port line, without touching statement links', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    render(<SourcePanes source={payroll} />);
    const gross = field('OUT-GROSS');
    await user.hover(line(cobolPane(), gross.cobolLine)!);
    expect(details()).toHaveTextContent(gross.representation);
    expect(cobolPane().querySelector('mark')).toBeNull();
    await user.unhover(line(cobolPane(), gross.cobolLine)!);
    expect(details()).toHaveTextContent(/^Choose a field/);

    const wsTax = field('WS-TAX');
    await user.hover(line(portPane(), wsTax.portLines[0]!)!);
    expect(details()).toHaveTextContent('WS-TAX');
    // Field lines add no tab stops to the panes.
    expect(cobolPane().querySelectorAll('[data-line][tabindex]')).toHaveLength(0);
  });

  it('captions whichever of the statement link and the field was touched last', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    render(<SourcePanes source={payroll} />);
    const caption = () => screen.getByTestId('link-caption');
    const statement = within(portPane()).getAllByRole('button')[0]!;
    await user.hover(statement);
    expect(caption()).toHaveTextContent(/highlighted for port/);
    await user.click(option('OUT-TAX'));
    expect(caption()).toHaveTextContent(fieldCaption(field('OUT-TAX')));
    await user.hover(statement);
    expect(caption()).toHaveTextContent(/highlighted for port/);
  });
  it('when stacked, gives the text form and buttons that switch the tab and focus the line', async () => {
    setViewportWidth(600);
    const user = userEvent.setup();
    render(<SourcePanes source={payroll} />);
    expect(screen.queryByTestId('stitch-overlay')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show in port' })).not.toBeInTheDocument();

    const rate = field('IN-RATE');
    await user.click(option('IN-RATE'));
    expect(screen.getByTestId('field-lines')).toHaveTextContent(`COBOL ${rate.cobolLine}`);
    expect(screen.getByTestId('field-lines')).toHaveTextContent(`Port ${rate.portLines[0]}`);

    await user.click(screen.getByRole('button', { name: 'Show in port' }));
    expect(screen.getByRole('tab', { name: 'TypeScript port' })).toHaveAttribute('aria-selected', 'true');
    const portLine = line(portPane(), rate.portLines[0]!)!;
    expect(portLine.closest('button') ?? portLine).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Show in COBOL' }));
    expect(screen.getByRole('tab', { name: 'COBOL' })).toHaveAttribute('aria-selected', 'true');
    expect(line(cobolPane(), rate.cobolLine)).toHaveFocus();
  });
});

describe('stitch overlay (6.3, 6.4, 6.5)', () => {
  /**
   * jsdom has no layout. Fake one: both panes 600 px tall at the top of a 1000 px overlay,
   * COBOL at x 0–480 and the port at x 520–1000, 20 px lines, 8 px monospace characters.
   * Pane scrolling is a `scrollTop` that fires `scroll`, as a browser does.
   */
  const LINE = 20;
  const PANE = { top: 0, width: 480, height: 600 };
  const scroll = new Map<Element, number>();
  const paneLeft = (pane: Element) => (pane.querySelector('[data-link]') ? 520 : 0);
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

  function fakeLayout() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('[data-testid="stitch-overlay"]')) return rect(0, 0, 1000, PANE.height);
      if (this.matches('[role="region"]')) return rect(paneLeft(this), PANE.top, PANE.width, PANE.height);
      const lineEl = this.closest('[data-line]');
      const pane = this.closest('[role="region"]');
      if (!lineEl || !pane) return rect(0, 0, 0, 0);
      const top = PANE.top + (Number(lineEl.getAttribute('data-line')) - 1) * LINE - (scroll.get(pane) ?? 0);
      if (this === lineEl) return rect(paneLeft(pane), top, PANE.width, LINE);
      return rect(paneLeft(pane) + 48, top, (this.textContent ?? '').length * 8, LINE);
    });
    for (const pane of [cobolPane(), portPane()]) {
      Object.defineProperty(pane, 'scrollTop', {
        configurable: true,
        get: () => scroll.get(pane) ?? 0,
        set: (v: number) => {
          scroll.set(pane, v);
          pane.dispatchEvent(new Event('scroll'));
        },
      });
    }
  }
  const scrollTo = (pane: HTMLElement, top: number) => {
    act(() => {
      pane.scrollTop = top;
    });
  };
  /** In view: the line's vertical centre is inside the pane (geometry.clipToPane). */
  const inView = (pane: HTMLElement, n: number) => {
    const centre = (n - 1) * LINE + LINE / 2 - pane.scrollTop;
    return centre >= 0 && centre <= PANE.height;
  };

  const overlay = () => screen.getByTestId('stitch-overlay');
  const faint = () => [...overlay().querySelectorAll('g')[0]!.querySelectorAll('path')];
  const faintNames = () => payroll.fields.filter((_, i) => faint()[i]?.style.display !== 'none').map((f) => f.name);
  /** The start and end points of a stitch path "M x0 y0 C …, x1 y1". */
  const ends = (d: string | null) => {
    const n = (d ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return [n[0], n[1], n.at(-2), n.at(-1)];
  };
  const group = (kind: 'field' | 'link') => overlay().querySelector<SVGGElement>(`[data-stitch="${kind}"]`)!;

  afterEach(() => {
    vi.restoreAllMocks();
    scroll.clear();
  });

  function setup() {
    setViewportWidth(1280);
    const user = userEvent.setup();
    render(<SourcePanes source={payroll} />);
    fakeLayout();
    return user;
  }

  it('joins only the fields whose COBOL and port lines are both in view, and redraws on scroll', async () => {
    setup();
    scrollTo(cobolPane(), 700); // COBOL lines 36–65: every field line
    scrollTo(portPane(), 0); // port lines 1–30
    const expected = () =>
      payroll.fields
        .filter((f) => inView(cobolPane(), f.cobolLine) && inView(portPane(), f.portLines[0]!))
        .map((f) => f.name);
    expect(expected()).toEqual(['WS-OT-HOURS', 'WS-GROSS', 'WS-TAX', 'WS-NET']);
    await waitFor(() => {
      expect(faintNames()).toEqual(expected());
    });
    expect(overlay()).toHaveAttribute('data-visible-stitches', '4');
    // From the right of the COBOL text to the left of the port text, at the line centres.
    const wsTax = faint()[payroll.fields.indexOf(field('WS-TAX'))]!;
    const [x0, y0, x1, y1] = ends(wsTax.getAttribute('d'));
    expect([y0, y1]).toEqual([470, 470]); // COBOL line 59 and port line 24, both at y 460–480
    expect(x0).toBeLessThanOrEqual(480);
    expect(x1).toBeGreaterThanOrEqual(520);

    scrollTo(portPane(), 400); // port lines 21–50: the input fields come into view too
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-visible-stitches', '8');
    });
    expect(faintNames()).toEqual(expected());
    expect(group('field').style.display).toBe('none');
    expect(overlay()).toHaveAttribute('data-active-stitch', 'none');
  });

  it('emphasises the active field in place of its faint stitch; Enter scrolls an out-of-view field into both panes', async () => {
    const user = setup();
    scrollTo(cobolPane(), 700);
    scrollTo(portPane(), 0);
    const wsTax = payroll.fields.indexOf(field('WS-TAX'));
    await waitFor(() => {
      expect(faintNames()).toContain('WS-TAX');
    });
    const faintD = faint()[wsTax]!.getAttribute('d');

    await user.click(option('WS-TAX')); // both lines already in view: no scroll
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-active-stitch', 'visible');
    });
    expect(portPane().scrollTop).toBe(0);
    expect(group('field').style.display).toBe('');
    for (const path of group('field').querySelectorAll('path')) expect(path.getAttribute('d')).toBe(faintD);
    expect(faintNames()).not.toContain('WS-TAX');
    expect(overlay()).toHaveAttribute('data-visible-stitches', '4');

    // Hover never scrolls, so a field whose port line is out of view gets no stitch.
    await user.hover(option('OUT-TAX'));
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-active-stitch', 'none');
    });
    expect(portPane().scrollTop).toBe(0);
    expect(faintNames()).toContain('WS-TAX');
    await user.unhover(option('OUT-TAX'));

    // Enter brings both lines into view, and the stitch follows the scroll.
    act(() => {
      option('OUT-TAX').focus();
    });
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-active-stitch', 'none');
    });
    await user.keyboard('{Enter}');
    const outTax = field('OUT-TAX');
    expect(inView(portPane(), outTax.portLines[0]!)).toBe(true);
    expect(inView(cobolPane(), outTax.cobolLine)).toBe(true);
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-active-stitch', 'visible');
    });
  });

  it('draws a statement-link stitch for the focused or hovered port statement when both ends are in view', async () => {
    const user = setup();
    scrollTo(cobolPane(), 1400); // COBOL lines 71–100
    scrollTo(portPane(), 400); // port lines 21–50
    const statement = (i: number) => portPane().querySelector<HTMLElement>(`[data-link="${i}"]`)!;
    const both = (i: number) => {
      const l = payroll.links[i]!;
      return inView(cobolPane(), l.cobol.start) && inView(cobolPane(), l.cobol.end) && inView(portPane(), l.port.end);
    };
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-link-stitch', 'none');
    });
    expect(group('link').style.display).toBe('none');

    expect(both(1)).toBe(true); // COBOL 82, port 48–49
    await user.hover(statement(1));
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-link-stitch', 'visible');
    });
    expect(group('link').style.display).toBe('');
    const [x0, , x1] = ends(group('link').querySelector('path')?.getAttribute('d') ?? null);
    expect(x0).toBeLessThanOrEqual(480);
    expect(x1).toBeGreaterThanOrEqual(520);

    expect(both(3)).toBe(false); // port 60–61 is below the port pane
    act(() => {
      statement(3).focus();
    });
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-link-stitch', 'none');
    });
    expect(group('link').style.display).toBe('none');

    act(() => {
      statement(0).focus(); // COBOL 79–80, port 43–45
    });
    await waitFor(() => {
      expect(overlay()).toHaveAttribute('data-link-stitch', 'visible');
    });
    // The field stitches are independent of the statement link.
    expect(overlay()).toHaveAttribute('data-active-stitch', 'none');
  });
});
