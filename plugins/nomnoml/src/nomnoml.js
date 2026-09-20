/*
 * nomnoml, as a plugin — UML-flavoured diagrams, rendered here, offline.
 *
 * The companion to the mermaid plugin rather than its replacement. Mermaid's
 * syntax is flowcharts and sequences; nomnoml's is the other half of what
 * people draw about software — classes with their fields, actors and use
 * cases, packages containing packages, state machines, notes pinned beside
 * the thing they are about.
 *
 * What makes it fit here is what it does not need. nomnoml is plain
 * JavaScript with its own layout engine, it renders *synchronously*, and it
 * measures text arithmetically rather than through a DOM — so it runs in a
 * sandbox that has no document, no canvas and no WebAssembly. Bundled by
 * `plugins/build.mjs` at about seventy kilobytes, which is a twentieth of
 * what the mermaid plugin carries.
 *
 * It asks for no permission at all: it never reaches for a builtin behind
 * one, measuring text from metrics it carries rather than through a DOM. The
 * SVG it produces is self-contained — no font import, no remote reference —
 * so the drawing is as offline as the drawing of it was.
 *
 * ## The one thing it does ask the server for
 *
 * Drawing, and only drawing. A diagram nobody can see is not much use, and
 * Slack - like most places one is read - draws no SVG at all: it hosts one as
 * a file and shows a card. Turning markup into a picture needs a rasteriser,
 * and there is neither one in this sandbox nor the WebAssembly to bring one,
 * so `RENDER_PNG` is the one capability here.
 *
 * It reaches nothing: markup this plugin just produced goes out, and bytes
 * computed from it come back. No connection, no address, no credential. And
 * `format: svg` still answers the markup without the server being asked
 * anything at all.
 *
 * This file is a build product's *source* — `plugins/nomnoml/nomnoml.js` is
 * what the server loads, and editing that by hand is editing a bundle.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as nomnoml from 'nomnoml';

/**
 * The palettes, as the directives nomnoml reads them from.
 *
 * Put in front of the source rather than passed as options, because
 * directives are how nomnoml is configured — and a caller who writes their
 * own should win, which is what putting these first arranges.
 *
 * `#fill` takes a list, one entry per nesting depth, which is why the dark
 * palettes name two: a package drawn inside a package should not vanish into
 * the thing containing it.
 */
const THEMES = {
  /* nomnoml's own, and what a `theme` left out means. */
  light: '',
  dark: '#background: #1e232b\n#fill: #272c35; #323845\n#stroke: #e8eaed\n',
  mono: '#background: #ffffff\n#fill: #ffffff\n#stroke: #111111\n',
  blueprint: '#background: #0f2d4a\n#fill: #14395e; #1b4877\n#stroke: #cfe3f7\n',
};

/** Which way the layout runs. nomnoml's own default is down. */
const DIRECTIONS = ['down', 'right'];

/**
 * A short name for one drawing, derived from the drawing itself.
 *
 * Content rather than a counter or a clock: the same diagram rendered twice
 * lands on the same key and simply overwrites itself, and nothing here has to
 * ask what time it is or keep a number between calls.
 *
 * FNV-1a because it is four lines and this is a name, not a checksum - two
 * different diagrams colliding would mean one overwriting the other's entry
 * in a single session, which is a handful of bits away from never.
 */
function keyFor(text) {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `nomnoml.${hash.toString(36)}`;
}

/**
 * The source in a url the nomnoml editor opens, escaped the way it escapes.
 *
 * Its own `urlEncode` is `encodeURIComponent` with the two quotes spelled
 * out, and quotes are not rare in a diagram - a label carries an apostrophe
 * often enough - so those two replacements are the difference between a link
 * that opens this diagram and one that opens something else.
 */
function editorUrl(source) {
  const escaped = encodeURIComponent(source).replace(/'/g, '%27').replace(/"/g, '%22');
  return `https://www.nomnoml.com/#view/${escaped}`;
}

/**
 * The same drawing with the bytes taken out, which is what a model wants.
 *
 * An answer reaches a model by being read, every character of it, and a
 * diagram is thousands of them - read to reach a key twelve characters long
 * that names the same bytes on the server. So the tool below answers the key
 * and leaves the drawing where it is.
 *
 * Unless there was nowhere to leave it: outside a session `put` refuses and
 * the key comes back empty, and then the bytes in the answer are the only
 * copy there is. Stripping them there would answer nothing at all.
 */
function keyedOnly(drawing) {
  if (drawing.key.length === 0) {
    return drawing;
  }
  return { ...drawing, svg: '', png: '' };
}

/**
 * The size a drawing declares for itself, both sides of it.
 *
 * The viewBox rather than the width attribute, and the root element rather
 * than the document: a search for `width="..."` anywhere in the markup finds
 * the first rectangle in the body just as happily as the drawing, and mermaid
 * writes its own root as a percentage besides. The viewBox is the one place
 * an SVG states its own coordinate space.
 */
function intrinsic(svg) {
  const close = svg.indexOf('>');
  const root = close === -1 ? svg : svg.slice(0, close);

  const box = /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(root);
  if (box !== null) {
    const width = Number(box[3]);
    const height = Number(box[4]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width: width, height: height };
    }
  }

  /* No viewBox, so the declared size is all there is to go on. */
  const wide = /\bwidth="([\d.]+)"/.exec(root);
  const tall = /\bheight="([\d.]+)"/.exec(root);
  if (wide === null || tall === null) {
    return null;
  }
  const width = Number(wide[1]);
  const height = Number(tall[1]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width: width, height: height }
    : null;
}

/**
 * How wide to draw, when the caller did not say.
 *
 * A renderer sizes an SVG for layout, not for looking at: a two-node flowchart
 * declares about 140 points, and drawn at 140 pixels it is a postage stamp
 * that Slack then scales up into a blur. Vector redrawn larger is not upscaled
 * - every line is computed again at the new size - so the only cost of asking
 * for more is the file, and a diagram nobody can read costs more than that.
 *
 * ## Why a width is not the thing to decide
 *
 * This asked for a width and nothing else, and both ways that goes wrong were
 * shipped. A fourteen-node nomnoml chain declares 4074 by 224; asked for 2400
 * wide it came back 2400 by 132, a sliver that Slack fits to its column and
 * renders as a smear - the "too small" that started this. A sixteen-node
 * mermaid flowchart declares 300 by 1475; asked for 1200 wide it came back
 * 1200 by 5890, which is where a server ceiling takes over and shrinks the
 * whole thing back down again.
 *
 * Both are the same mistake: a width says nothing about how large a drawing
 * is when the other side is free to be eighteen times longer.
 *
 * ## What is decided instead
 *
 * A scale - how many pixels a drawing gets per unit it drew in - and the
 * width is whatever that comes to.
 *
 * Twice, to start with, because text in these diagrams is set at about ten
 * units and twenty pixels is the size it stops being a guess. Then the long
 * side is brought up to `longest` where the whole diagram is smaller than
 * that, since a two-node picture has room to spare. Then `pixels` caps the
 * area, which is the only cap that treats a tall drawing and a wide one the
 * same. And never below 1: a drawing rendered smaller than it laid itself out
 * has lost its text, and no ceiling is worth that - better to hand the server
 * something too big and let it say so.
 *
 * A caller who names a width gets exactly it, ceilings and all.
 */
const PNG = { scale: 2, longest: 1200, pixels: 4e6 };

function drawnWidth(svg, asked) {
  if (typeof asked === 'number' && asked > 0) {
    return asked;
  }
  const size = intrinsic(svg);
  if (size === null) {
    return PNG.longest;
  }

  let scale = Math.max(PNG.scale, PNG.longest / Math.max(size.width, size.height));
  scale = Math.min(scale, Math.sqrt(PNG.pixels / (size.width * size.height)));
  return Math.round(size.width * Math.max(scale, 1));
}

/**
 * The same drawing with its intrinsic size taken off, leaving the viewBox.
 *
 * Handed a width, a rasteriser is supposed to scale the document to it. Handed
 * a document that also declares `width="140"`, some place that 140-pixel
 * drawing inside the canvas you asked for and leave the rest empty - which
 * looks like the diagram shrinking, because relative to the picture it did.
 *
 * The viewBox is what says how to scale, and it stays. Without a competing
 * intrinsic size there is nothing to letterbox against, so the drawing fills
 * the width it was asked for whichever way the rasteriser is built.
 *
 * Only on the way to a picture. The svg answer keeps its width and height,
 * because something embedding markup wants to know how big it is.
 */
function scalable(svg) {
  const close = svg.indexOf('>');
  if (close === -1 || !/viewBox=/.test(svg.slice(0, close))) {
    return svg;
  }
  const root = svg
    .slice(0, close)
    .replace(/\s(?:width|height)="[^"]*"/g, '');
  return root + svg.slice(close);
}

export default class Nomnoml extends OrknuxPlugin {

  id() {
    return 'nomnoml';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [];
  }

  permissions() {
    // None. The library is arithmetic on a string: it measures text from
    // metrics it carries, lays the graph out itself, and writes markup.
    return [];
  }

  capabilities() {
    /*
     * Drawing is the server's to do, and only drawing.
     *
     * The diagram is laid out in this file - the engine is bundled here - but
     * turning the result into a picture needs a rasteriser this sandbox does
     * not have and cannot be given. Nothing is fetched, at any time, from
     * anywhere; what crosses is markup this plugin just wrote.
     */
    return ['RENDER_PNG'];
  }

  /*
   * Its syntax is nobody's first guess.
   *
   * A model reaching for a diagram writes mermaid, because mermaid is what
   * there is most of in the world - and mermaid's arrows, its node shapes and
   * its `graph TD` header are all parse errors here. The description says
   * what the syntax is; a skill can say when this is the right tool at all,
   * which is the part a description is too short for.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Drawing with nomnoml',
        description: 'When nomnoml is the right diagram, its syntax, and why a wrong one does not error.',
        content: `# Drawing with nomnoml

\`nomnoml_render\` draws the **structural** half of what people draw about
software: classes and what they hold, actors and use cases, packages inside
packages, state machines, a note pinned beside the thing it is about.

## Which tool

| You are drawing | Use |
|---|---|
| A class, its fields, what it inherits or contains | \`nomnoml_render\` |
| An actor and what they do | \`nomnoml_render\` |
| Packages, components, what is inside what | \`nomnoml_render\` |
| A flowchart - steps, decisions, arrows through a process | \`mermaid_render\` |
| A sequence - who called whom, in order | \`mermaid_render\` |

**This is not mermaid, and it will not tell you so.** nomnoml accepts a great
deal and draws *something* rather than refusing. Write mermaid at it and you
get a diagram - just not the one you meant:

    graph TD                ->  a stray box labelled "graph TD", beside the rest
    A[start] --> B[done]    ->  four boxes: A, B, start and done

So the question after a render is not "did it error" but "is this the diagram I
asked for". If you want a flowchart, call \`mermaid_render\` rather than
translating one into this.

## The syntax, entire

    [Node]                      a box
    [A] -> [B]                  an arrow
    [A] o- [B]                  composition        +- is aggregation
    [A] <:- [B]                 inheritance        -- is a plain line
    [Name|field; method()]      compartments, separated by ;
    [A] label -> [B]            a label on the association

The **shape** of a box is a prefix inside it:

    [<actor>Developer]     [<usecase>Load a plugin]     [<state>queued]
    [<package>orknux|…]    [<note>an aside]             [<database>rows]
    [<frame>deploy|…]      [<choice>ok?]                [<start>] [<end>]

**Nesting is the thing it does best.** A diagram inside a box's second
compartment is drawn inside that box:

    [<package>server|
      [Loader] -> [Sandbox]
      [Sandbox] o- [Plugin]
    ]

## Arguments

\`theme\` is \`light\` (the default), \`dark\`, \`mono\` or \`blueprint\`. \`direction\` is \`down\`
(the default) or \`right\` - use \`right\` when the diagram is a chain rather than a
tree. Your own \`#\` directives in the source beat both.

\`format\` is \`png\` unless you say otherwise, and png is what you want: Slack
draws no SVG, so an svg posted to a channel is a file card people have to
download. Ask for \`svg\` only when something other than a person will read it.

## When it does refuse

The error names the line and the column and what it expected:

    Parse error at line 1 column 9, expected "]" but got end of file

**Fix that line.** Do not rewrite the whole diagram, and do not call again with
the same source hoping for a different answer. It is nearly always an
unbalanced bracket: every \`[\` needs its \`]\`, the nested ones included.

The other thing worth knowing does *not* refuse: a \`|\` inside a label starts a
new compartment, so \`[Send a|b message]\` draws a box in two parts rather than
one label. Reword it.

If two attempts fail, draw something simpler and say what you left out. A
diagram of the three boxes that matter is worth more than none.

## Getting it to somebody

The answer carries a **key**, not the picture. Pass the key:

    nomnoml_render(source)  ->  { key: 'nomnoml.1fpehnu', bytes: 18402 }
    slack_uploadBinary(channel, 'design.png', 'nomnoml.1fpehnu', comment, threadTs)

\`slack_uploadBinary\` takes the key and nothing else - there is no argument to
put bytes in. The \`editor\` url in the answer opens the diagram in the nomnoml
editor, which is worth giving somebody who will want to tweak it.`,
      }),
    ];
  }

  objects() {
    return [
      new OrknuxObject({
        name: 'Drawing',
        description: 'A diagram rendered here, in the sandbox.',
        properties: [
          {
            name: 'svg',
            kind: 'string',
            description:
              'The SVG markup, where svg was asked for. Empty for png. Slack hosts an SVG as a ' +
              'file but draws none, so it arrives as a file card rather than as a picture.',
          },
          {
            name: 'png',
            kind: 'string',
            description:
              'The picture as base64, where png was asked for - which is the default. Empty for ' +
              'svg. Hand it to slack_uploadBinary as the base64.',
          },
          { name: 'bytes', kind: 'number', description: 'How long the answer is.' },
          {
            name: 'width',
            kind: 'number',
            description:
              'How wide the picture came out, in pixels - read off the file rather than echoed ' +
              'back from the request, so a server ceiling that brought it down shows here. For ' +
              'an svg it is the size the markup declares.',
          },
          {
            name: 'height',
            kind: 'number',
            description:
              'How tall it came out. Worth a glance beside width: a diagram far longer one way ' +
              'than the other is one a chat column will shrink to nothing, and redrawing it in ' +
              'the other direction is what fixes that rather than a larger picture.',
          },
          {
            name: 'key',
            kind: 'string',
            description:
              'Where this drawing is kept for the rest of this session. Pass it rather than ' +
              'copying the answer out - slack_uploadBinary takes it for a png, slack_upload as ' +
              'contentKey for an svg - so the bytes never leave the server and nothing can be ' +
              'truncated on the way. Empty where there was no session to keep it in.',
          },
          {
            name: 'editor',
            kind: 'string',
            description:
              'Opens this diagram in the nomnoml editor, source and all, for somebody who wants ' +
              'to tweak it by hand.',
          },
        ],
      }),
    ];
  }

  /*
   * A tool of its own rather than a proxy, for the same reason `slack`'s
   * uploadBinary is: what a model should be handed is not what a workflow
   * node should be handed. The drawing is the function's answer and the key
   * is this one's, and the only difference between them is the several
   * thousand characters a model would otherwise read on its way past.
   */
  tools() {
    const drawing = this.functions().find((one) => one.name === 'render');
    return [
      new OrknuxTool({
        name: 'render',
        description:
          drawing.description +
          ' The answer carries the key and not the drawing itself: the bytes stay on the server ' +
          'and the key names them, so pass it to slack_uploadBinary as contentKey rather than ' +
          'looking for markup here. Where there is no session to keep a drawing in, the drawing ' +
          'comes back instead, because then it is the only copy there is.',
        params: drawing.params,
        returnType: drawing.returnType,
        run: (source, theme, direction, format, width) =>
          keyedOnly(drawing.run(source, theme, direction, format, width)),
      }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'render',
        description:
          'Renders nomnoml source to SVG right here - no external service, no browser. nomnoml ' +
          'draws the UML-shaped half of what people draw about software, and its syntax is ' +
          'compact: [Node] is a box, [A] -> [B] an arrow, [A] o- [B] composition, and ' +
          '[Name|field; method()] gives a box compartments. The shapes are written as a prefix - ' +
          '[<actor>User], [<usecase>Sign in], [<state>queued], [<package>name|...], ' +
          '[<note>an aside], [<database>rows], [<frame>...], [<choice>which?] - and a diagram ' +
          'nests by being written inside a box\'s second compartment. theme is light (the ' +
          'default), dark, mono or blueprint; direction is down (the default) or right; your own ' +
          '# directives in the source override both. For flowcharts and sequence diagrams use ' +
          'mermaid_render instead - this draws neither. format is png (the default) for a ' +
          'picture people can see, or svg for the markup; width sets the picture width in ' +
          'pixels, left out to be sized for reading - twice what the diagram laid itself out ' +
          'at, brought up where that is still small, and capped on area rather than on either ' +
          'side. Answers png as base64 or svg as ' +
          'text, the byte count, the width and height it actually came out at - worth a look, ' +
          'since a drawing far longer one way than the other is one a chat column shrinks to ' +
          'nothing, and redrawing it the other way with direction is the fix rather than more ' +
          'pixels - a short key the answer is kept under for this session, and a ' +
          'url that opens the diagram in the nomnoml editor. To put it on Slack pass that key - ' +
          'slack_uploadBinary takes it for a png, slack_upload as contentKey for an svg - rather ' +
          'than copying the answer out and pasting it in.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'theme', type: 'string', required: false, default: '' },
          { name: 'direction', type: 'string', required: false, default: '' },
          { name: 'format', type: 'string', required: false, default: 'png' },
          { name: 'width', type: 'number', required: false, default: 0 },
        ],
        returnType: 'Drawing',
        run: (source, theme, direction, format, width) => {
          if (typeof source !== 'string' || source.trim().length === 0) {
            throw new Error('there is no diagram source to render');
          }

          let directives = '';

          if (typeof theme === 'string' && theme.length > 0) {
            const named = theme.trim().toLowerCase();
            const palette = THEMES[named];
            if (palette === undefined) {
              throw new Error(
                `no theme called ${theme}: the themes are ${Object.keys(THEMES).join(', ')}`,
              );
            }
            directives += palette;
          }

          if (typeof direction === 'string' && direction.length > 0) {
            const named = direction.trim().toLowerCase();
            if (!DIRECTIONS.includes(named)) {
              throw new Error(`no direction called ${direction}: it is ${DIRECTIONS.join(' or ')}`);
            }
            directives += `#direction: ${named}\n`;
          }

          /* Checked here rather than after the drawing, so a typo costs nothing. */
          const asked =
            typeof format === 'string' && format.length > 0 ? format.trim().toLowerCase() : 'png';
          if (asked !== 'png' && asked !== 'svg') {
            throw new Error(`no format called ${format}: it is png or svg`);
          }

          let svg;
          try {
            svg = nomnoml.renderSvg(directives + source);
          } catch (failure) {
            /*
             * nomnoml's parse errors name the line and the column and say
             * what they expected, which is a sentence a model can correct
             * itself from - thrown on in this plugin's own voice so it reads
             * as one answer rather than as a library leaking through.
             */
            const said = failure instanceof Error ? failure.message : String(failure);
            throw new Error(`could not render the diagram: ${said.split('\n')[0]}`);
          }

          /*
           * Kept here as well as answered, and this is the half that matters
           * for anything large.
           *
           * The answer travels through the model: it reads the svg, and to
           * upload it it has to write every character of it back out in the
           * next tool call. A few kilobytes of generated text has to come out
           * perfect and does not - one that went to Slack arrived with a
           * stray character in the middle of it and the whole call was
           * rejected as malformed JSON.
           *
           * So the bytes are also left in the session's own store, under a
           * key short enough to copy without getting it wrong. The svg stays
           * in the answer because a caller that only wants to look at it
           * should not have to fetch it, and because a workflow node - no
           * session, no store - has nowhere else to read it from.
           */
          /*
           * A picture unless somebody asked for the markup, because a picture
           * is what a person can see.
           *
           * Slack draws no SVG at all - it hosts one as a file card - and it
           * is where most of these end up, so the format that makes a diagram
           * visible is the one that should happen without being asked for.
           * svg is still there for a caller that wants the markup itself: to
           * edit it, to put it in a document, or to hand it somewhere that
           * does draw it.
           *
           * The drawing is the server's work. This sandbox has no rasteriser
           * and no WebAssembly to bring one, so `orknux.render.pngFromSvg` is
           * not a convenience over something this plugin could do itself - it
           * is the only way that answer exists.
           */
          if (asked === 'png') {
            const drawn = orknux.render.pngFromSvg(scalable(svg), drawnWidth(svg, width));
            if (drawn.error !== undefined) {
              throw new Error(`could not draw the diagram: ${drawn.error}`);
            }

            const drawnKey = keyFor(drawn.base64);
            const drawnKept = orknux.session.store.put(drawnKey, drawn.base64);
            return {
              svg: '',
              png: drawn.base64,
              bytes: drawn.bytes,
              /*
               * What came back, not what was asked for. The two differ
               * whenever a server ceiling had an opinion, and that difference
               * is the whole reason a caller can tell a drawing that came out
               * legible from one that did not.
               */
              width: drawn.width,
              height: drawn.height,
              key: drawnKept.error === undefined ? drawnKey : '',
              editor: editorUrl(source),
            };
          }

          const key = keyFor(svg);
          const kept = orknux.session.store.put(key, svg);

          /* Markup has no drawn size, so what it declares for itself is the honest answer. */
          const declared = intrinsic(svg) ?? { width: 0, height: 0 };

          return {
            svg: svg,
            png: '',
            bytes: svg.length,
            width: Math.round(declared.width),
            height: Math.round(declared.height),
            key: kept.error === undefined ? key : '',
            editor: editorUrl(source),
          };
        },
      }),
    ];
  }
}
