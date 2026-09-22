/*
 * How wide a line of text is, without a font to measure it with.
 *
 * PlantUML lays a diagram out by measuring its own labels: a box is as wide as
 * the words in it, a lifeline sits where the participant's name ends. In a
 * browser it asks a canvas; there is no canvas here, so these are the tables it
 * would have got.
 *
 * They are Helvetica's advance widths, in thousandths of an em — the same
 * numbers Arial and Liberation Sans carry, because all three are metrically
 * compatible. Measuring against one face and drawing in another is how a label
 * ends up hanging out of the box around it, so the plugin writes that trio
 * into the finished SVG as the font to use: what was measured here and what a
 * viewer sets are then the same shapes, on Windows, on a Mac and on a Linux
 * box with Liberation installed, which is all of them.
 *
 * What is given up, and worth saying: a machine with none of the three falls
 * back to whatever its `sans-serif` is, and if that is DejaVu — about a tenth
 * wider — a tight label sits close to its border. Nothing overlaps, because
 * every box on the page was measured the same way.
 */

/** Helvetica, per 1000 em, for every character from space to tilde. */
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Helvetica-Bold, which is not the same shape scaled — `a` grows, `.` does not. */
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Courier is one width, which is the whole of what monospace means. */
const MONOSPACE = 600;

/** Where a character is drawn in one cell or two — CJK, kana, the fullwidth forms. */
function isWide(point) {
  return (
    (point >= 0x1100 && point <= 0x115f) ||
    (point >= 0x2e80 && point <= 0xa4cf) ||
    (point >= 0xac00 && point <= 0xd7a3) ||
    (point >= 0xf900 && point <= 0xfaff) ||
    (point >= 0xfe30 && point <= 0xfe6f) ||
    (point >= 0xff00 && point <= 0xff60) ||
    (point >= 0xffe0 && point <= 0xffe6)
  );
}

/** One character's advance, per 1000 em. */
function advance(point, bold, fixed) {
  if (fixed) {
    return isWide(point) ? MONOSPACE * 2 : MONOSPACE;
  }
  if (point >= 0x20 && point <= 0x7e) {
    return (bold ? BOLD : REGULAR)[point - 0x20];
  }
  /* A combining mark is drawn on top of the letter before it and advances nothing. */
  if (point >= 0x300 && point <= 0x36f) {
    return 0;
  }
  if (isWide(point)) {
    return 1000;
  }
  /*
   * Everything else — the accented Latin that Polish, Czech and Turkish are
   * written in, Greek, Cyrillic — is set at the width of the letter it is
   * shaped like. Capitals are wider than lowercase and that is the whole of
   * the distinction worth drawing without a table for every alphabet.
   */
  const capital = point >= 0xc0 && point <= 0xde;
  return capital ? (bold ? 722 : 667) : bold ? 611 : 556;
}

/**
 * How wide `text` sets at `size` pixels, in pixels.
 *
 * `family` and `weight` are what the engine asked for: anything whose name
 * says monospace is set at one width, anything whose weight says bold is set
 * from the bold table.
 */
export function widthOf(text, size, family, weight) {
  const fixed = /mono|courier|consol/i.test(String(family ?? ''));
  const bold = /bold|[7-9]00/i.test(String(weight ?? ''));
  let units = 0;
  for (const character of String(text ?? '')) {
    units += advance(character.codePointAt(0), bold, fixed);
  }
  return (units * (Number(size) || 14)) / 1000;
}

/**
 * How far a line of text reaches above and below its baseline.
 *
 * Helvetica's own ascent and descent are 0.718 and 0.207 of an em, and those
 * are the numbers for the glyphs. These are a little larger, because what the
 * engine does with them is space lines and size the boxes it draws around
 * them — the same job a font's line height does, which includes the gap
 * between one line and the next. Measured against a real PlantUML drawing the
 * same diagram, the tighter pair came out 14% shorter than the server; this
 * pair lands within a couple of pixels.
 */
export function heightOf(size) {
  const at = Number(size) || 14;
  return { ascent: at * 0.9, descent: at * 0.25 };
}
