/*
 * PlantUML, as a plugin — drawn here, in the sandbox.
 *
 * PlantUML draws what a model is most often asked for and mermaid is worst at:
 * sequence diagrams with activation bars and nested groups, class diagrams
 * with real cardinality, component, state, activity, deployment, ERDs, gantt,
 * mindmaps, wireframes, JSON trees. This plugin bundles the engine and runs
 * it. Nothing is fetched, nothing is sent, and no diagram leaves the machine.
 *
 * ## How that is possible, given it is a Java program
 *
 * `@plantuml/core` is PlantUML compiled to JavaScript by TeaVM, and three
 * things stand between that and a sandbox with no page, no timers and no
 * WebAssembly. Each turned out to have an answer.
 *
 * **It defers its work onto a timer.** `renderToString` returns immediately
 * and delivers through a callback, and a plugin's `run` is synchronous with
 * nothing to await. But there is exactly one `setTimeout` in the engine, and
 * it is TeaVM's scheduler yielding to itself — so `src/dom.js` queues what is
 * scheduled and turns the queue by hand after the call, which is an event loop
 * run inside one synchronous call. A diagram takes one turn.
 *
 * **It measures text through a browser.** A canvas for the metrics, an SVG
 * text node's `getBBox` for the rest. Both are answered here from Helvetica's
 * own advance widths — see `src/metrics.js` — which is the face `sans-serif`
 * resolves to nearly everywhere this will be looked at.
 *
 * **Its layout engine is Graphviz, shipped as WebAssembly.** That part is
 * true, and it does not matter: the engine carries Smetana, PlantUML's own
 * pure-Java port of dot, and falls back to it when `viz-global.js` is absent.
 * Which it always is here. Class, component, state, activity, deployment and
 * use case diagrams lay out with no WebAssembly anywhere.
 *
 * ## What it asks for
 *
 * `RENDER_PNG`, and only to turn the finished SVG into a picture — the one
 * thing a sandbox with no rasteriser cannot do for itself, and the same grant
 * the mermaid plugin makes for the same reason. `svg` needs nothing at all.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/* First, and unconditionally: the engine is built against a browser. */
import { drain } from './dom.js';
import { renderToString } from '@plantuml/core';

/** PlantUML's own base64 alphabet, which is not the standard one's order. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/** And the standard one, which is what `orknux.encoding` answers in. */
const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Where `links` points when a workspace has not named a server of its own. */
const PUBLIC = 'https://www.plantuml.com/plantuml';

/** The formats a diagram comes back as. */
const FORMATS = ['png', 'svg'];

/**
 * What the engine draws instead of refusing.
 *
 * A syntax error is not an error to PlantUML: it draws a picture of the
 * problem, with the source above it and a caret under the line that stopped
 * it. Useful to look at and useless to act on, so the two facts worth having
 * are read back out of that picture — this marker is the one thing only an
 * error image carries.
 */
const FAILED = /\[From \w+ \(line (\d+)\)\s*\]/;

/**
 * The face the drawing asks a viewer for.
 *
 * The engine writes `font-family="sans-serif"` and leaves the rest to whoever
 * opens it — which is Arial on Windows, Helvetica on a Mac, and DejaVu Sans on
 * a good deal of Linux. DejaVu sets about a tenth wider than the other two, so
 * a label measured here against Helvetica's widths would be drawn there in
 * something too big for the box around it.
 *
 * Naming the face is the fix rather than padding every box to survive the
 * worst case: Helvetica, Arial and Liberation Sans carry the same advance
 * widths, and between them they are on very nearly every machine. What was
 * measured and what is drawn are then the same shapes.
 */
const FACE = 'Helvetica,Arial,&quot;Liberation Sans&quot;,sans-serif';

/**
 * The house pair, as the style block PlantUML reads.
 *
 * The same neutrals the charts, mermaid and nomnoml plugins draw in - a cool
 * off-white fill inside an ink outline that is not quite black, the series
 * blue for arrows - so a diagram and a chart posted together read as one
 * family. `root` sets every element at once; the rest are the few PlantUML
 * paints from a different place. Written as a `<style>` block rather than
 * skinparams because one block covers every diagram kind, and put after the
 * `@start` line because that is the only place PlantUML reads it.
 *
 * A theme left out draws PlantUML's own, which is what every diagram drawn
 * before this looked like and what a source carrying its own skinparams
 * expects to be left alone.
 */
const THEMES = {
  light: {
    bg: '#ffffff', fg: '#131a20', line: '#4a5865', fill: '#eef2f4', arrow: '#2a78d6', muted: '#71808c',
  },
  dark: {
    bg: '#141a1f', fg: '#e6ecf0', line: '#a6b4be', fill: '#1c262d', arrow: '#3987e5', muted: '#7a8994',
  },
};

function styleOf(theme) {
  return [
    '<style>',
    `root { BackgroundColor ${theme.bg}; FontColor ${theme.fg}; LineColor ${theme.line}; LineThickness 1.2; }`,
    `document { BackgroundColor ${theme.bg}; }`,
    `arrow { LineColor ${theme.arrow}; FontColor ${theme.fg}; }`,
    `element { BackgroundColor ${theme.fill}; LineColor ${theme.line}; RoundCorner 6; }`,
    `note { BackgroundColor ${theme.fill}; LineColor ${theme.muted}; FontColor ${theme.fg}; }`,
    `title { FontColor ${theme.fg}; FontSize 15; FontStyle bold; }`,
    `sequenceDiagram { lifeLine { LineColor ${theme.muted}; LineStyle 4-4; } }`,
    '</style>',
  ].join('\n');
}

/**
 * The source with the house style put where PlantUML reads it: after the
 * `@start` line. A source with no such line is handed over as it is, because
 * PlantUML is about to refuse it anyway and the refusal should be about the
 * source, not about a block this plugin added.
 */
function styled(source, theme) {
  const named = typeof theme === 'string' ? theme.trim().toLowerCase() : '';
  if (named === '') {
    return source;
  }
  const palette = THEMES[named];
  if (palette === undefined) {
    throw new Error(`no theme called ${theme}: it is ${Object.keys(THEMES).join(' or ')}, or left out for PlantUML's own`);
  }
  return source.replace(/^(\s*@start\w+[^\n]*\n)/, `$1${styleOf(palette)}\n`);
}

/** How wide a picture is drawn when nobody says — twice its own size, so it can be read. */
const READABLE = 2;

/** And the width past which a bigger picture is only a bigger file. */
const WIDEST = 2400;

/** A nested field, or null rather than a thrown error on the way down. */
function at(holder, name) {
  if (holder === null || typeof holder !== 'object') {
    return null;
  }
  const held = holder[name];
  return held === undefined ? null : held;
}

/** Every text the SVG sets, in the order it sets it. */
function texts(svg) {
  return [...svg.matchAll(/>([^<>]+)</g)].map((one) => one[1]);
}

/** The `&amp;` an SVG carries, back as the character it stands for. */
function plain(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
 * The problem an error image is a picture of, or null where it is a diagram.
 *
 * Read from the marker rather than from the message, because a diagram is
 * perfectly entitled to contain a note that says "Syntax Error?" — and only
 * an error image says which line it stopped on.
 */
function problemWith(svg, source) {
  const marked = FAILED.exec(svg);
  if (marked === null) {
    return null;
  }
  const line = Number(marked[1]);
  const lines = source.split('\n');
  /*
   * The last complaint, not the first thing that looks like one. An error
   * image opens with PlantUML's own version banner — which carries the words
   * "Unknown compile time" and matched every pattern written to find an error
   * message — then sets the source, then says what stopped it. What stopped it
   * is the part worth quoting, and it is at the end.
   */
  const said = texts(svg)
    .map((one) => plain(one).trim())
    .filter((one) => one.length > 0 && !/^PlantUML version/i.test(one) && !FAILED.test(one))
    .filter((one) => /error|cannot|unknown|expect|unsupported/i.test(one))
    .pop();
  return {
    error: said === undefined ? 'PlantUML could not read this diagram' : said,
    line: Number.isFinite(line) ? line : null,
    source: Number.isFinite(line) && line >= 1 && line <= lines.length ? lines[line - 1].trim() : null,
  };
}

/**
 * The same drawing, asking for the face it was measured against.
 *
 * Only the generic value is rewritten: a diagram that named a font of its own
 * — `skinparam defaultFontName Courier` — asked for that one on purpose, and
 * was measured as monospace to match.
 */
function faced(svg) {
  return svg.replace(/font-family="sans-serif"/g, `font-family="${FACE}"`);
}

/** What the SVG says its own size is. */
function sizeOf(svg) {
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const wide = /\bwidth="([\d.]+)/.exec(svg);
  const tall = /\bheight="([\d.]+)/.exec(svg);
  return {
    width: Number(wide === null ? (box === null ? 0 : box[1]) : wide[1]),
    height: Number(tall === null ? (box === null ? 0 : box[2]) : tall[1]),
  };
}

/**
 * The same drawing, at a width somebody asked for.
 *
 * The root's own `width` and `height` are rewritten rather than left to the
 * viewBox, because a rasteriser reads the document's declared size and fits
 * the viewBox into it — markup carrying only a viewBox is drawn into a 400 by
 * 400 default and letterboxed, which is a bug this repository has had twice.
 */
function sized(svg, width) {
  const held = sizeOf(svg);
  if (held.width <= 0 || held.height <= 0) {
    return svg;
  }
  const tall = Math.round((width * held.height) / held.width);
  return svg
    .replace(/(<svg\b[^>]*?)\bwidth="[^"]*"/, `$1width="${width}"`)
    .replace(/(<svg\b[^>]*?)\bheight="[^"]*"/, `$1height="${tall}"`);
}

/**
 * One diagram, drawn.
 *
 * The callback is called inside `drain`, which turns the engine's own queue —
 * so by the time this returns, the answer is already here. Nothing is awaited
 * because there is nothing to await: this is the whole of the asynchrony the
 * engine has, run by hand.
 */
function drawn(source) {
  const asked = typeof source === 'string' ? source.trim() : '';
  if (asked.length === 0) {
    throw new Error('there is no diagram source to draw');
  }

  let svg = null;
  let failed = null;
  let settled = false;
  renderToString(
    asked.split('\n'),
    (answer) => {
      svg = answer;
      settled = true;
    },
    (problem) => {
      failed = String(problem);
      settled = true;
    },
  );
  drain(() => settled);

  if (failed !== null) {
    throw new Error(`could not draw the diagram: ${failed}`);
  }
  if (typeof svg !== 'string' || svg.length === 0) {
    throw new Error('the renderer answered nothing, which it should not be able to do');
  }
  return svg;
}

/** The source's own UTF-8 bytes, for the url `links` builds. */
function bytesOf(text) {
  const encoded = orknux.encoding.encodeBase64(text);
  if (encoded.error !== undefined) {
    throw new Error(`could not encode the diagram: ${encoded.error}`);
  }
  const written = encoded.base64.replace(/=+$/, '');
  const bytes = [];
  let held = 0;
  let bits = 0;
  for (let index = 0; index < written.length; index += 1) {
    const value = STANDARD.indexOf(written[index]);
    if (value < 0) {
      continue;
    }
    held = (held << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((held >> bits) & 0xff);
    }
  }
  return bytes;
}

/**
 * A deflate stream that compresses nothing.
 *
 * A PlantUML url carries the source deflated, and the sandbox has no
 * compressor. Stored blocks are the part of the format that needs none: a bit
 * saying this is the last block, a length, its complement, then the bytes. Any
 * inflater reads it, PlantUML's included.
 */
function deflated(bytes) {
  const out = [];
  let at = 0;
  do {
    const chunk = bytes.slice(at, at + 65535);
    const last = at + 65535 >= bytes.length ? 1 : 0;
    out.push(last, chunk.length & 0xff, (chunk.length >> 8) & 0xff, ~chunk.length & 0xff, (~chunk.length >> 8) & 0xff);
    for (let each = 0; each < chunk.length; each += 1) {
      out.push(chunk[each]);
    }
    at += 65535;
  } while (at < bytes.length);
  return out;
}

/** Those bytes in PlantUML's alphabet, which is what a url carries. */
function encoded(source) {
  const asked = typeof source === 'string' ? source.trim() : '';
  if (asked.length === 0) {
    throw new Error('there is no diagram source to link to');
  }
  const bytes = deflated(bytesOf(asked));

  let written = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    written += ALPHABET[first >> 2];
    written += ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    written += ALPHABET[((second & 0x0f) << 2) | (third >> 6)];
    written += ALPHABET[third & 0x3f];
  }
  return written;
}

/** A short name for what a drawing is kept under, so nothing large is retyped. */
function keyFor(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `plantuml.${hash.toString(36)}`;
}

/** What a tool hands a model: the key, never the bytes it names. */
function keyedOnly(made) {
  if (made.key === '') {
    /* No session to keep it in, so the answer is the only copy there is. */
    return made;
  }
  return { ...made, svg: '', png: '' };
}

export default class PlantUml extends OrknuxPlugin {

  id() {
    return 'plantuml';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'url',
        description:
          'A PlantUML server, for the urls links builds — your own, or the public one if a ' +
          'diagram may be opened there. Nothing is ever sent to it: drawing happens here.',
        type: 'string',
        required: false,
      }),
    ];
  }

  permissions() {
    /*
     * None. The engine expects a browser and gets one from the bundle — the
     * document, the serialiser and the canvas are in `src/dom.js`, and the
     * console it chatters into comes from the shim every bundle here carries.
     * Bringing its own is the honest way to load without a permission, rather
     * than having the boundary quietly moved.
     */
    return [];
  }

  capabilities() {
    /*
     * Drawing the finished SVG as a picture, and nothing else.
     *
     * The diagram is built in this file — engine, layout and all — but turning
     * markup into pixels needs a rasteriser, and this sandbox has neither one
     * nor the WebAssembly to bring one. What crosses is markup this plugin
     * just produced; what comes back is bytes computed from it. No connection,
     * no address, no credential.
     */
    return ['RENDER_PNG'];
  }

  objects() {
    return [
      new OrknuxObject({
        name: 'Drawing',
        description: 'A diagram drawn here, in the sandbox.',
        properties: [
          {
            name: 'svg',
            kind: 'string',
            description:
              'The SVG markup, where svg was asked for. Empty for png. Slack hosts an SVG as a ' +
              'file but draws none, so ask for png when somebody should see the diagram.',
          },
          {
            name: 'png',
            kind: 'string',
            description:
              'The picture as base64, where png was asked for. Empty for svg. Pass the key ' +
              'rather than this: slack_uploadBinary takes it, and nothing has to be retyped.',
          },
          { name: 'bytes', kind: 'number', description: 'How long the answer is.' },
          {
            name: 'width',
            kind: 'number',
            description: 'How wide it came out, read off what was drawn rather than echoed back from the request.',
          },
          {
            name: 'height',
            kind: 'number',
            description:
              'How tall. Worth a glance beside width: a diagram far longer one way than the ' +
              'other is one a chat column shrinks to nothing, and redrawing it the other way is the fix.',
          },
          {
            name: 'key',
            kind: 'string',
            description:
              'Where this drawing is kept for the rest of this session. Hand it on as ' +
              'contentKey rather than copying the bytes out. Empty where there is no session.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'Checked',
        description: 'Whether PlantUML can read a diagram, asked without drawing one anybody sees.',
        properties: [
          { name: 'ok', kind: 'boolean', description: 'It parsed.' },
          { name: 'error', kind: 'string', description: "What is wrong, in PlantUML's words. Null where nothing is." },
          { name: 'line', kind: 'number', description: 'Which line of the source stopped it.' },
          { name: 'source', kind: 'string', description: 'That line itself, so the message has something to sit beside.' },
        ],
      }),

      new OrknuxObject({
        name: 'Links',
        description: 'Urls that draw a diagram on a PlantUML server, carrying its source inside them.',
        properties: [
          { name: 'png', kind: 'string', description: 'The picture.' },
          { name: 'svg', kind: 'string', description: 'The same as SVG.' },
          { name: 'txt', kind: 'string', description: 'The same in letters, which only a server draws.' },
          { name: 'editor', kind: 'string', description: 'Opens the source on the server, where somebody can change it.' },
          { name: 'markdown', kind: 'string', description: 'The image, ready to paste into a comment.' },
        ],
      }),
    ];
  }

  skills() {
    return [
      new OrknuxSkill({
        name: 'Drawing a diagram with PlantUML',
        description: 'What it draws, what a refusal tells you, and how a diagram reaches somebody.',
        content: `# Drawing a diagram with PlantUML

\`plantuml_render\` draws PlantUML source **here** — the engine is bundled in
the plugin, nothing is fetched and no diagram leaves the machine. It answers a
**key**, not the picture.

## Pass the key, never the bytes

A PNG is a hundred kilobytes of base64. Reading it back out into the next tool
call means generating a hundred kilobytes of text perfectly, and it does not
come out perfectly — one stray character and the call is refused as malformed.
The key is eleven characters and names the same bytes on the server.

    plantuml_render(source, "png")      → { key: "plantuml.1a2b3c", ... }
    slack_uploadBinary(contentKey: "plantuml.1a2b3c", ...)

## A refusal names a line. Fix that line.

PlantUML does not reject a bad diagram — it *draws a picture of the error*,
which is no use to anything trying to fix it. This plugin reads the message
and the line back out of that picture and throws them:

    Syntax Error? (Assumed diagram type: sequence) on line 7: Alice -> : Hello

So fix line 7. Do not rewrite the diagram, and do not render it again
unchanged. The usual causes are a missing participant on one side of an arrow,
a stray \`}\`, and a keyword from a different diagram type.

\`plantuml_check\` asks the same question as data rather than as a throw, which
is what a workflow condition wants.

## What it draws

Everything PlantUML does, which is most of what gets asked for:

\`\`\`
@startuml                     sequence: ->, -->, activate, group, alt/else, note
@startuml                     class: Cart *-- Item, interfaces, cardinality "1..*"
@startuml                     component, deployment, use case, state, object
@startuml                     activity: start / :step; / if (x?) then / stop
@startmindmap  ... @endmindmap
@startgantt    ... @endgantt
@startjson     ... @endjson        a JSON document drawn as a tree
@startsalt     ... @endsalt        wireframes
@startwbs      ... @endwbs
\`\`\`

The diagrams that need graph layout — class, component, state, activity,
deployment, use case — are laid out by **Smetana**, PlantUML's own port of
Graphviz. It is not quite dot: a very large graph is laid out less tidily than
a server with real Graphviz would manage. Ten nodes look the same; a hundred
do not.

Two things genuinely need a server and are not here. \`!include <C4/C4_Context>\`
and the other standard-library sprites are fetched over HTTP, and a \`!theme\`
is too — a diagram using either still draws, without them.

## Sharing one

\`plantuml_links\` builds urls that carry the source inside them, and reaches
nothing to do it. The \`editor\` one opens the diagram on a PlantUML server
where somebody can change it, and \`markdown\` is ready to paste into a comment.
A link beats an attachment when a diagram is going to be argued about, because
whoever disagrees can edit it. It is also the one way to get the **text**
rendering, which only a server draws.

Note what that means: a link *does* carry the diagram off the machine, to
whichever server the workspace configured. Drawing does not.`,
      }),
    ];
  }

  /*
   * `render` is a tool of its own, the way the mermaid plugin's is: the model
   * gets the key and the measurements, and the bytes stay where they are. The
   * other two answer text that is the point of asking.
   */
  tools() {
    const drawing = this.functions().find((one) => one.name === 'render');
    return [
      new OrknuxTool({
        name: 'render',
        description:
          drawing.description +
          ' The answer carries the key and not the picture itself: the bytes stay on the server ' +
          'and the key names them, so pass it on rather than looking for markup or base64 here. ' +
          'Where there is no session to keep a drawing in, the drawing comes back instead, ' +
          'because then it is the only copy there is.',
        params: drawing.params,
        returnType: drawing.returnType,
        run: (source, format, width, theme) => keyedOnly(drawing.run(source, format, width, theme)),
      }),
      new OrknuxFunctionTool({ function: 'check' }),
      new OrknuxFunctionTool({ function: 'links' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'render',
        description:
          'Draws PlantUML source - sequence, class, component, state, activity, deployment, use ' +
          'case, ERD, gantt, mindmap, wbs, json, salt - right here, with no server and nothing ' +
          'fetched. format is png (the default) for a picture people can see, or svg for markup ' +
          'that scales; width sets the picture width in pixels for a png - svg carries its own size ' +
          'and scales anyway - and is left out to draw at twice the size the diagram laid itself ' +
          'out at, which is what makes it readable. Answers the picture as ' +
          'base64 or the markup as text, the size it came out, and a short key the answer is kept ' +
          'under for this session - pass that key on rather than copying the bytes. A diagram ' +
          'PlantUML cannot read is refused with the message and the line it stopped on, so fix ' +
          'that line rather than drawing the same source again. theme is light or dark - the house ' +
          'pair the charts, mermaid and nomnoml plugins share, so a diagram and a chart posted ' +
          'together read as one family - or left out for PlantUML\'s own look, which a source ' +
          'carrying its own skinparams should ask for.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'format', type: 'string', required: false, default: 'png' },
          { name: 'width', type: 'number', required: false, default: 0 },
          { name: 'theme', type: 'string', required: false, default: '' },
        ],
        returnType: 'Drawing',
        run: (source, format, width, theme) => {
          const asked = typeof format === 'string' && format.length > 0 ? format.toLowerCase() : 'png';
          if (!FORMATS.includes(asked)) {
            throw new Error(`no format called ${format}: it is ${FORMATS.join(' or ')}`);
          }

          const text = typeof source === 'string' ? source : '';
          const svg = faced(drawn(styled(text, theme)));

          /* PlantUML draws its refusals. This turns one back into a refusal. */
          const problem = problemWith(svg, text.trim());
          if (problem !== null) {
            throw new Error(
              `${problem.error}${problem.line === null ? '' : ` on line ${problem.line}`}` +
                `${problem.source === null ? '' : `: ${problem.source}`}`,
            );
          }

          const drawnAt = sizeOf(svg);
          const wanted =
            Number.isFinite(width) && width > 0
              ? Math.min(Math.round(width), WIDEST)
              : Math.min(Math.round(drawnAt.width * READABLE), WIDEST);

          if (asked === 'svg') {
            const key = keyFor(svg);
            const kept = orknux.session.store.put(key, svg);
            return {
              svg: svg,
              png: '',
              bytes: svg.length,
              width: Math.round(drawnAt.width),
              height: Math.round(drawnAt.height),
              key: kept.error === undefined ? key : '',
            };
          }

          /*
           * The one thing this sandbox cannot do for itself. What is handed
           * over is the markup drawn a moment ago, and what comes back is
           * bytes computed from it.
           */
          const picture = orknux.render.pngFromSvg(sized(svg, wanted), wanted);
          if (picture.error !== undefined) {
            throw new Error(`could not draw the diagram as a picture: ${picture.error}`);
          }

          const key = keyFor(picture.base64);
          const kept = orknux.session.store.put(key, picture.base64);
          return {
            svg: '',
            png: picture.base64,
            bytes: picture.bytes,
            /* What came back, not what was asked for: a server ceiling may have had an opinion. */
            width: picture.width,
            height: picture.height,
            key: kept.error === undefined ? key : '',
          };
        },
      }),

      new OrknuxFunction({
        name: 'check',
        description:
          'Whether PlantUML can read this source, answered as data rather than thrown - ok, and ' +
          'the message and the line where it is not. Draws nothing anybody sees and reaches ' +
          'nothing at all. For a condition that has to decide something, and for checking a ' +
          'diagram somebody else wrote before putting it in a document.',
        params: [{ name: 'source', type: 'string' }],
        returnType: 'Checked',
        run: (source) => {
          const text = typeof source === 'string' ? source : '';
          const problem = problemWith(drawn(text), text.trim());
          return {
            ok: problem === null,
            error: problem === null ? null : problem.error,
            line: problem === null ? null : problem.line,
            source: problem === null ? null : problem.source,
          };
        },
      }),

      new OrknuxFunction({
        name: 'links',
        description:
          'Urls that draw this diagram on a PlantUML server, carrying the source inside them - as ' +
          'a png, an svg, letters, an editable page, and as markdown ready to paste into a ' +
          'comment. Reaches nothing: the urls are built here. Use it to give somebody a diagram ' +
          'they can edit, and for the text rendering, which only a server draws. Note that ' +
          'opening one does send the diagram to that server, where drawing it here does not.',
        params: [{ name: 'source', type: 'string' }],
        returnType: 'Links',
        run: (source) => {
          const text = typeof source === 'string' ? source : '';
          /* Encoded once: it is the same string in all five, and it is the expensive part. */
          const written = encoded(text);
          const configured = at(this.settings, 'url');
          const site =
            typeof configured === 'string' && configured.trim().length > 0
              ? configured.trim().replace(/\/+$/, '')
              : PUBLIC;
          return {
            png: `${site}/png/${written}`,
            svg: `${site}/svg/${written}`,
            txt: `${site}/txt/${written}`,
            /* `uml` is the server's own page for a diagram, which can be edited from. */
            editor: `${site}/uml/${written}`,
            markdown: `![diagram](${site}/png/${written})`,
          };
        },
      }),
    ];
  }
}
