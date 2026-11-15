import { describe, expect, it } from 'vitest';
import { clipToPane, MIN_CONTROL_OFFSET, stitchPath, visibleStitchPath, type Rect } from './geometry';

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });

const overlay = rect(100, 50, 1000, 600);
const cobolPane = rect(100, 50, 480, 600);
const portPane = rect(620, 50, 480, 600);

describe('stitchPath', () => {
  it('runs from the COBOL line right edge to the port line left edge, in overlay coordinates', () => {
    // COBOL line right edge x = 100 + 400 = 500 -> 400; centre y = 110 + 10 = 120 -> 70.
    // Port line left edge x = 640 -> 540; centre y = 310 + 10 = 320 -> 270.
    const d = stitchPath(rect(100, 110, 400, 20), rect(640, 310, 400, 20), overlay);
    expect(d).toBe('M 400 70 C 470 70, 470 270, 540 270');
  });

  it('keeps a minimum control offset when the ends are close', () => {
    const d = stitchPath(rect(0, 0, 100, 20), rect(104, 0, 100, 20), rect(0, 0, 300, 100));
    expect(d).toBe(`M 100 10 C ${100 + MIN_CONTROL_OFFSET} 10, ${104 - MIN_CONTROL_OFFSET} 10, 104 10`);
  });

  it('rounds coordinates to one decimal place', () => {
    const d = stitchPath(rect(0.04, 0, 100.03, 10.33), rect(200.26, 0, 10, 10), rect(0, 0, 300, 100));
    expect(d).toBe('M 100.1 5.2 C 150.2 5.2, 150.2 5, 200.3 5');
  });
});

describe('clipToPane', () => {
  it('returns the visible part of a line wider than its pane', () => {
    expect(clipToPane(rect(80, 100, 600, 20), cobolPane)).toEqual(rect(100, 100, 480, 20));
  });

  it('keeps a line whose centre is in view and trims the hidden part', () => {
    expect(clipToPane(rect(100, 40, 400, 20), cobolPane)).toEqual(rect(100, 50, 400, 10));
  });

  it('drops a line whose centre is above or below the pane', () => {
    expect(clipToPane(rect(100, 35, 400, 20), cobolPane)).toBeNull();
    expect(clipToPane(rect(100, 645, 400, 20), cobolPane)).toBeNull();
  });

  it('drops a line scrolled out sideways or with no height', () => {
    expect(clipToPane(rect(600, 100, 100, 20), cobolPane)).toBeNull();
    expect(clipToPane(rect(100, 100, 400, 0), cobolPane)).toBeNull();
  });
});

describe('visibleStitchPath', () => {
  const cobolLine = rect(100, 110, 400, 20);
  const portLine = rect(620, 310, 600, 20);

  it('draws a pair when both lines are in view, clipped to the panes', () => {
    expect(visibleStitchPath(cobolLine, cobolPane, portLine, portPane, overlay)).toBe(
      stitchPath(cobolLine, rect(620, 310, 480, 20), overlay),
    );
  });

  it('draws nothing when either line is out of view', () => {
    const hidden = rect(100, 700, 400, 20);
    expect(visibleStitchPath(hidden, cobolPane, portLine, portPane, overlay)).toBeNull();
    expect(visibleStitchPath(cobolLine, cobolPane, hidden, portPane, overlay)).toBeNull();
  });
});
