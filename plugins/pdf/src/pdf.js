/*
 * PDF, as a plugin — jsPDF for the writing, DejaVu for the alphabet, and
 * mermaid diagrams drawn into the page as vectors.
 *
 * The layout is still this file's own: a practical subset of HTML read into
 * blocks, wrapped and paged. What changed hands is everything below that.
 * jsPDF — bundled in by `plugins/build.mjs` — writes the file, and two DejaVu
 * faces travel inside the bundle as base64, so ą, ř and ő are set as the
 * letters they are instead of being folded to a, r and o. The price is that
 * the answer is binary now: it leaves as base64, which is the shape
 * `slack_uploadBinary` and the http door's `upload` take.
 *
 * ## Diagrams, embedded — and still no network
 *
 * A `<pre class="mermaid">` or `<mermaid>` block becomes a diagram *in* the
 * document. beautiful-mermaid renders it to SVG right here — pure JavaScript,
 * no DOM, bundled like everything else — and the SVG's small vocabulary
 * (rect, polygon, polyline, text) is translated to jsPDF's own vector calls,
 * colors resolved from the theme arithmetic the SVG spells as color-mix. So
 * the diagram is real vector drawing in the PDF, and nothing was fetched from
 * anywhere. The kinds that render are beautiful-mermaid's: flowchart/graph,
 * sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram; another kind is
 * refused with a sentence naming what renders.
 *
 * ## What of HTML is understood
 *
 * Headings h1–h3 (h4–h6 read as h3), paragraphs and divs, br and hr, ul and
 * ol with nesting, b/strong (i/em render regular — a third and fourth face
 * would put the bundle over the size a plugin may be), table cells run
 * together as text, and the mermaid blocks above. Scripts, styles and
 * comments are dropped whole; every other tag is ignored and its text kept.
 * Entities, named and numeric, are decoded. A report writer, not a browser:
 * no CSS, no raster images, no links.
 *
 * This file is a build product's *source* — `plugins/pdf/pdf.js` is what the
 * server loads, and editing that by hand is editing a bundle.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import { renderMermaidSync } from 'beautiful-mermaid';
import DEJAVU from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf';
import DEJAVU_BOLD from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf';

/** The alphabet of RFC 4648's base64, in order. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/*
 * atob and btoa are HTML's, not ECMAScript's, so GraalJS does not have them —
 * and jsPDF's font machinery reaches for them. Filled in where absent, with
 * binary-string semantics: each character is one byte.
 */
if (typeof globalThis.atob !== 'function') {
  globalThis.atob = (encoded) => {
    const clean = String(encoded).replace(/[^A-Za-z0-9+/]/g, '');
    let written = '';
    for (let index = 0; index + 1 < clean.length; index += 4) {
      const one = BASE64.indexOf(clean[index]);
      const two = BASE64.indexOf(clean[index + 1]);
      const three = index + 2 < clean.length ? BASE64.indexOf(clean[index + 2]) : -1;
      const four = index + 3 < clean.length ? BASE64.indexOf(clean[index + 3]) : -1;
      written += String.fromCharCode(((one << 2) | (two >> 4)) & 0xff);
      if (three >= 0) {
        written += String.fromCharCode(((two << 4) | (three >> 2)) & 0xff);
      }
      if (four >= 0) {
        written += String.fromCharCode(((three << 6) | four) & 0xff);
      }
    }
    return written;
  };
}
if (typeof globalThis.btoa !== 'function') {
  globalThis.btoa = (binary) => {
    const held = String(binary);
    let written = '';
    for (let index = 0; index < held.length; index += 3) {
      const one = held.charCodeAt(index) & 0xff;
      const two = index + 1 < held.length ? held.charCodeAt(index + 1) & 0xff : 0;
      const three = index + 2 < held.length ? held.charCodeAt(index + 2) & 0xff : 0;
      written += BASE64[one >> 2] + BASE64[((one & 3) << 4) | (two >> 4)];
      written += index + 1 < held.length ? BASE64[((two & 15) << 2) | (three >> 6)] : '=';
      written += index + 2 < held.length ? BASE64[three & 63] : '=';
    }
    return written;
  };
}

/** Bytes as base64, for the answer. */
function base64Of(bytes) {
  let written = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const one = bytes[index];
    const two = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const three = index + 2 < bytes.length ? bytes[index + 2] : 0;
    written += BASE64[one >> 2] + BASE64[((one & 3) << 4) | (two >> 4)];
    written += index + 1 < bytes.length ? BASE64[((two & 15) << 2) | (three >> 6)] : '=';
    written += index + 2 < bytes.length ? BASE64[three & 63] : '=';
  }
  return written;
}

/** The page: A4, in points, origin top-left as jsPDF has it. */
const PAGE = { width: 595.28, height: 841.89, margin: 56 };

/** How each kind of block is set: size, weight, and the air around it. */
const STYLES = {
  h1: { size: 20, bold: true, before: 14, after: 8 },
  h2: { size: 16, bold: true, before: 12, after: 6 },
  h3: { size: 13, bold: true, before: 10, after: 5 },
  p: { size: 11, bold: false, before: 0, after: 6 },
  item: { size: 11, bold: false, before: 0, after: 2 },
};

/** The entities worth knowing by name; the numeric kind is decoded by value. */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', bull: '•',
  middot: '·', copy: '©', reg: '®', trade: '™',
  deg: '°', laquo: '«', raquo: '»', sect: '§', euro: '€',
};

/** HTML text with its entities decoded. */
function decoded(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const known = ENTITIES[name.toLowerCase()];
    return known === undefined ? whole : known;
  });
}

/**
 * HTML read into blocks: a flat list of {kind, runs, marker, depth, source},
 * each run a piece of text with its weight. Diagram blocks are lifted out
 * first, whole and entity-decoded with their newlines kept — mermaid needs
 * them — and everything else is walked with a stack of what is open, which
 * is as much structure as this subset needs.
 */
function blocksOf(html) {
  let source = String(html);
  source = source.replace(/<!--[\s\S]*?-->/g, ' ');

  const diagrams = [];
  source = source.replace(
    /<pre\s[^>]*class=["']?mermaid["']?[^>]*>([\s\S]*?)<\/pre\s*>|<mermaid[^>]*>([\s\S]*?)<\/mermaid\s*>/gi,
    (whole, fenced, tagged) => {
      diagrams.push(decoded(fenced === undefined ? tagged : fenced).trim());
      return `<diagram ${diagrams.length - 1}>`;
    },
  );

  source = source.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const body = source.match(/<body[^>]*>([\s\S]*)<\/body\s*>/i);
  if (body !== null) {
    source = body[1];
  }

  const blocks = [];
  let runs = [];
  let kind = 'p';
  let marker = null;
  let depth = 0;
  let bold = 0;
  let italic = 0;
  const lists = []; // a number counts an <ol>; null is a <ul>

  const flush = () => {
    if (runs.some((one) => /\S/.test(one.text) || one.break === true)) {
      blocks.push({ kind: kind, runs: runs, marker: marker, depth: depth });
    }
    runs = [];
    kind = 'p';
    marker = null;
  };

  for (const token of source.split(/(<[^>]*>)/)) {
    if (token.length === 0) {
      continue;
    }
    if (token[0] !== '<') {
      const text = decoded(token).replace(/\s+/g, ' ');
      if (text.length > 0) {
        runs.push({ text: text, bold: bold > 0, italic: italic > 0 });
      }
      continue;
    }

    const name = (token.match(/^<\/?\s*([a-z0-9]+)/i) ?? [])[1];
    const tag = typeof name === 'string' ? name.toLowerCase() : '';
    const closing = token[1] === '/';

    if (tag === 'diagram') {
      flush();
      const index = token.match(/^<diagram (\d+)>$/);
      if (index !== null) {
        blocks.push({ kind: 'diagram', runs: [], marker: null, depth: 0, source: diagrams[Number(index[1])] });
      }
    } else if (/^h[1-6]$/.test(tag)) {
      flush();
      if (!closing) {
        kind = tag === 'h1' || tag === 'h2' ? tag : 'h3';
      }
    } else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' || tag === 'blockquote' || tag === 'tr') {
      flush();
    } else if (tag === 'br') {
      runs.push({ text: '', break: true });
    } else if (tag === 'hr') {
      flush();
      blocks.push({ kind: 'hr', runs: [], marker: null, depth: 0 });
    } else if (tag === 'ul' || tag === 'ol') {
      flush();
      if (closing) {
        lists.pop();
      } else {
        lists.push(tag === 'ol' ? 1 : null);
      }
    } else if (tag === 'li') {
      flush();
      if (!closing) {
        kind = 'item';
        depth = Math.max(lists.length, 1);
        const counting = lists[lists.length - 1];
        if (typeof counting === 'number') {
          marker = `${counting}.`;
          lists[lists.length - 1] = counting + 1;
        } else {
          marker = '•';
        }
      }
    } else if (tag === 'b' || tag === 'strong') {
      bold = Math.max(0, bold + (closing ? -1 : 1));
    } else if (tag === 'i' || tag === 'em') {
      italic = Math.max(0, italic + (closing ? -1 : 1));
    } else if (tag === 'td' || tag === 'th') {
      if (!closing && runs.length > 0) {
        runs.push({ text: '  ', bold: false, italic: false });
      }
    }
    // Every other tag is ignored, and the text it wrapped is kept.
  }
  flush();
  return blocks;
}

/** The width of some text in the face and size the writer would set it. */
function widthOf(doc, text, bold, size) {
  doc.setFont('DejaVu', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  return doc.getTextWidth(text);
}

/**
 * A block's runs broken into words that remember their weight, so a word set
 * half plain and half bold still wraps as one word.
 */
function wordsOf(doc, block, style) {
  const words = [];
  let open = false;
  for (const run of block.runs) {
    if (run.break === true) {
      words.push({ break: true });
      open = false;
      continue;
    }
    const pieces = run.text.split(' ');
    for (let index = 0; index < pieces.length; index++) {
      if (index > 0) {
        open = false;
      }
      if (pieces[index].length === 0) {
        continue;
      }
      const bold = style.bold || run.bold === true;
      const part = { text: pieces[index], bold: bold, width: widthOf(doc, pieces[index], bold, style.size) };
      if (open) {
        words[words.length - 1].parts.push(part);
      } else {
        words.push({ parts: [part] });
      }
      open = true;
    }
  }
  return words;
}

/** Words folded into lines no wider than fits, each part carrying its x offset. */
function linesOf(doc, words, style, available) {
  const space = widthOf(doc, ' ', false, style.size);
  const lines = [];
  let line = [];
  let width = 0;

  const push = () => {
    lines.push(line);
    line = [];
    width = 0;
  };

  for (const word of words) {
    if (word.break === true) {
      push();
      continue;
    }
    const whole = word.parts.reduce((sum, part) => sum + part.width, 0);
    if (line.length > 0 && width + space + whole > available) {
      push();
    }
    let x = width + (line.length > 0 ? space : 0);
    for (const part of word.parts) {
      line.push({ text: part.text, bold: part.bold, x: x });
      x += part.width;
    }
    width = x;
  }
  if (line.length > 0) {
    push();
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* The diagram translator: beautiful-mermaid's SVG, drawn as vectors. */
/* ------------------------------------------------------------------ */

/** One tag's attributes, read without a DOM. */
function attrsOf(held) {
  const attrs = {};
  for (const one of held.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    attrs[one[1]] = one[2];
  }
  return attrs;
}

/** #RGB or #RRGGBB as [r, g, b]. */
function channelsOf(hex) {
  const held = hex.trim();
  if (/^#[0-9a-f]{3}$/i.test(held)) {
    return [held[1], held[2], held[3]].map((one) => parseInt(one + one, 16));
  }
  if (/^#[0-9a-f]{6}$/i.test(held)) {
    return [held.slice(1, 3), held.slice(3, 5), held.slice(5, 7)].map((one) => parseInt(one, 16));
  }
  return null;
}

/** fg mixed into bg by a share, which is what the SVG's color-mix computes. */
function mixed(fg, bg, share) {
  return fg.map((one, index) => Math.round(one * share + bg[index] * (1 - share)));
}

/**
 * The share of fg in each derived variable, as the SVG's own stylesheet
 * declares them — and which explicit theme variable overrides each, where a
 * theme sets one.
 */
const DERIVED = {
  '_text': { share: 1 },
  '_text-sec': { share: 0.6, from: 'muted' },
  '_text-muted': { share: 0.4, from: 'muted' },
  '_text-faint': { share: 0.25 },
  '_line': { share: 0.5, from: 'line' },
  '_arrow': { share: 0.85, from: 'accent' },
  '_node-fill': { share: 0.03, from: 'surface' },
  '_node-stroke': { share: 0.2, from: 'border' },
  '_group-fill': { share: 0 },
  '_group-hdr': { share: 0.05 },
  '_inner-stroke': { share: 0.12 },
  '_key-badge': { share: 0.1 },
};

/** A paint attribute resolved to [r, g, b], or null for none/unknown. */
function colorOf(value, vars) {
  if (typeof value !== 'string' || value.length === 0 || value === 'none') {
    return null;
  }
  const direct = channelsOf(value);
  if (direct !== null) {
    return direct;
  }
  const named = value.match(/^var\(--([a-z_-]+)\)$/i);
  if (named === null) {
    return null;
  }
  const key = named[1];
  if (vars[key] !== undefined) {
    return channelsOf(vars[key]);
  }
  const derived = DERIVED[key];
  if (derived !== undefined) {
    if (derived.from !== undefined && vars[derived.from] !== undefined) {
      return channelsOf(vars[derived.from]);
    }
    const fg = channelsOf(vars.fg ?? '#27272A');
    const bg = channelsOf(vars.bg ?? '#FFFFFF');
    return mixed(fg, bg, derived.share);
  }
  return channelsOf(vars.fg ?? '#27272A');
}

/** "x,y x,y …" as [[x, y], …]. */
function pointsOf(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite));
}

/** An arrowhead at `tip`, pointing the way `from` → `tip` does. */
function arrowheadAt(doc, from, tip, place, scale, color) {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return;
  }
  const ux = dx / length;
  const uy = dy / length;
  const back = 7 * scale;
  const half = 2.5 * scale;
  const baseX = place(tip[0]) - ux * back;
  const baseY = place.y(tip[1]) - uy * back;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.triangle(
    place(tip[0]),
    place.y(tip[1]),
    baseX - uy * half,
    baseY + ux * half,
    baseX + uy * half,
    baseY - ux * half,
    'FD',
  );
}

/** The size the SVG root declares for itself, in its own units. */
function svgSize(svg) {
  const root = svg.match(/<svg\b([^>]*)>/);
  const rootAttrs = attrsOf(root === null ? '' : root[1]);
  const width = Number(rootAttrs.width);
  const height = Number(rootAttrs.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('the rendered diagram carries no size');
  }
  return { width: width, height: height };
}

/**
 * One diagram, rendered by beautiful-mermaid and drawn onto the page with
 * jsPDF's vector calls. Answers the height it took, in points.
 */
function drawnDiagram(doc, svg, left, top, maxWidth, maxHeight) {
  const root = svg.match(/<svg\b([^>]*)>/);
  const rootAttrs = attrsOf(root === null ? '' : root[1]);
  const { width, height } = svgSize(svg);

  const vars = {};
  for (const one of (rootAttrs.style ?? '').matchAll(/--([a-z-]+):\s*([^;]+)/gi)) {
    vars[one[1]] = one[2].trim();
  }

  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const place = (x) => left + x * scale;
  place.y = (y) => top + y * scale;

  /*
   * The defs are patterns, not drawing: the arrowhead polygons in there live
   * in marker-local coordinates and are drawn where a polyline references
   * them, never where they are written.
   */
  const drawn = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');

  const walker = /<(rect|polygon|polyline)\b([^>]*?)\/>|<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  for (const found of drawn.matchAll(walker)) {
    if (found[1] !== undefined) {
      const attrs = attrsOf(found[2]);
      const fill = colorOf(attrs.fill, vars);
      const stroke = colorOf(attrs.stroke, vars);
      const style = fill !== null && stroke !== null ? 'FD' : fill !== null ? 'F' : stroke !== null ? 'S' : null;
      if (style === null) {
        continue;
      }
      if (fill !== null) {
        doc.setFillColor(fill[0], fill[1], fill[2]);
      }
      if (stroke !== null) {
        doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
        doc.setLineWidth(Number(attrs['stroke-width'] ?? 1) * scale);
      }

      if (found[1] === 'rect') {
        const rx = Number(attrs.rx ?? 0) * scale;
        const x = place(Number(attrs.x));
        const y = place.y(Number(attrs.y));
        const w = Number(attrs.width) * scale;
        const h = Number(attrs.height) * scale;
        if (rx > 0) {
          doc.roundedRect(x, y, w, h, rx, rx, style);
        } else {
          doc.rect(x, y, w, h, style);
        }
      } else {
        const points = pointsOf(attrs.points ?? '');
        if (points.length < 2) {
          continue;
        }
        const deltas = [];
        for (let index = 1; index < points.length; index++) {
          deltas.push([
            (points[index][0] - points[index - 1][0]) * scale,
            (points[index][1] - points[index - 1][1]) * scale,
          ]);
        }
        doc.lines(deltas, place(points[0][0]), place.y(points[0][1]), [1, 1], style, found[1] === 'polygon');

        const arrow = colorOf('var(--_arrow)', vars) ?? [0, 0, 0];
        if (found[1] === 'polyline' && attrs['marker-end'] !== undefined && points.length >= 2) {
          arrowheadAt(doc, points[points.length - 2], points[points.length - 1], place, scale, arrow);
        }
        if (found[1] === 'polyline' && attrs['marker-start'] !== undefined && points.length >= 2) {
          arrowheadAt(doc, points[1], points[0], place, scale, arrow);
        }
      }
    } else {
      const attrs = attrsOf(found[3]);
      const content = decoded(found[4].replace(/<[^>]+>/g, '')).trim();
      if (content.length === 0) {
        continue;
      }
      const color = colorOf(attrs.fill, vars) ?? [0, 0, 0];
      const size = Number(attrs['font-size'] ?? 12) * scale;
      const bold = Number(attrs['font-weight'] ?? 400) >= 600;
      doc.setFont('DejaVu', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const anchor = attrs['text-anchor'];
      doc.text(content, place(Number(attrs.x)), place.y(Number(attrs.y) + Number(attrs.dy ?? 0)), {
        align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
      });
    }
  }

  return height * scale;
}

export default class Pdf extends OrknuxPlugin {

  id() {
    return 'pdf';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [];
  }

  permissions() {
    // TextEncoder and friends, which jsPDF's unicode font machinery leans on.
    return ['TEXT_ENCODING'];
  }

  capabilities() {
    // None: the writer, the renderer and the fonts are all inside this file.
    return [];
  }

  /* What a written document comes back as. */
  objects() {
    return [
      new OrknuxObject({
        name: 'Document',
        description: 'A PDF that was written.',
        properties: [
          {
            name: 'base64',
            kind: 'string',
            description: 'The file itself. Hand it to slack_uploadBinary with a .pdf filename.',
          },
          { name: 'pages', kind: 'number', description: 'How many pages it came to.' },
          { name: 'bytes', kind: 'number', description: 'How large the file is, before base64.' },
        ],
      }),
    ];
  }

  /* The agents' surface: the one call, fronted. A proxy, so everything stays the function's own. */
  tools() {
    return [new OrknuxFunctionTool({ function: 'fromHtml' })];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'fromHtml',
        description:
          'Lays HTML out as a PDF on A4: h1-h3, p, br, hr, ul/ol lists, b/strong - and mermaid ' +
          'diagrams, drawn into the page as vectors: put the diagram source in <pre ' +
          'class="mermaid">...</pre> (flowchart/graph, sequenceDiagram, stateDiagram-v2, ' +
          'classDiagram, erDiagram). Full Unicode text - Polish, Czech, the lot - set in DejaVu. A ' +
          'report writer, not a browser: no CSS, no raster images, no links; i/em render regular. ' +
          'Answers the file as base64 - hand it to slack_uploadBinary with a .pdf filename - with ' +
          'its page and byte counts. title is the document\'s title metadata.',
        params: [
          { name: 'html', type: 'string' },
          { name: 'title', type: 'string', required: false, default: '' },
        ],
        returnType: 'Document',
        run: (html, title) => {
          if (typeof html !== 'string' || html.trim().length === 0) {
            throw new Error('there is no html to lay out');
          }
          const blocks = blocksOf(html);
          if (!blocks.some((block) => block.kind === 'hr' || block.kind === 'diagram' || block.runs.length > 0)) {
            throw new Error('the html holds no text to lay out');
          }

          const doc = new jsPDF({ unit: 'pt', format: 'a4' });
          doc.addFileToVFS('DejaVuSans.ttf', DEJAVU);
          doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
          doc.addFileToVFS('DejaVuSans-Bold.ttf', DEJAVU_BOLD);
          doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
          if (typeof title === 'string' && title.length > 0) {
            doc.setProperties({ title: title });
          }

          const top = PAGE.margin;
          const bottom = PAGE.height - PAGE.margin;
          const usable = PAGE.width - PAGE.margin * 2;
          let y = top;

          const carry = () => {
            doc.addPage();
            y = top;
          };

          for (const block of blocks) {
            if (block.kind === 'hr') {
              if (y + 18 > bottom) {
                carry();
              }
              y += 10;
              doc.setDrawColor(160, 160, 160);
              doc.setLineWidth(0.5);
              doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
              y += 8;
              continue;
            }

            if (block.kind === 'diagram') {
              let svg;
              try {
                svg = renderMermaidSync(block.source);
              } catch (failure) {
                const said = failure instanceof Error ? failure.message : String(failure);
                throw new Error(`could not render the diagram: ${said}`);
              }
              /*
               * Sized before placed — the size is on the SVG root, no drawing
               * needed to know it. A diagram taller than what is left of the
               * page starts a fresh one, and one taller than a whole page is
               * scaled to fit it.
               */
              const room = bottom - top;
              const sized = svgSize(svg);
              const claimed = sized.height * Math.min(1, usable / sized.width, room / sized.height);
              if (y + claimed > bottom) {
                carry();
              }
              y += 4;
              drawnDiagram(doc, svg, PAGE.margin, y, usable, room);
              y += claimed + 12;
              continue;
            }

            const style = STYLES[block.kind];
            const indent = block.kind === 'item' ? block.depth * 16 : 0;
            const left = PAGE.margin + indent;
            const leading = style.size * 1.4;
            const lines = linesOf(doc, wordsOf(doc, block, style), style, usable - indent);

            if (y !== top) {
              y += style.before;
            }
            for (let index = 0; index < lines.length; index++) {
              y += leading;
              if (y > bottom) {
                carry();
                y = top + leading;
              }
              doc.setTextColor(39, 39, 42);
              if (index === 0 && block.marker !== null) {
                doc.setFont('DejaVu', 'normal');
                doc.setFontSize(style.size);
                const wide = doc.getTextWidth(block.marker);
                doc.text(block.marker, left - wide - 5, y);
              }
              for (const part of lines[index]) {
                doc.setFont('DejaVu', part.bold ? 'bold' : 'normal');
                doc.setFontSize(style.size);
                doc.text(part.text, left + part.x, y);
              }
            }
            y += style.after;
          }

          const bytes = new Uint8Array(doc.output('arraybuffer'));
          return {
            base64: base64Of(bytes),
            pages: doc.getNumberOfPages(),
            bytes: bytes.length,
          };
        },
      }),
    ];
  }
}
