/*
 * Mermaid, as a plugin — rendered here, offline, in real mermaid syntax.
 *
 * The mermaid library itself cannot run in the sandbox: its renderer measures
 * text through a real DOM, and the sandbox — GraalJS, language builtins only —
 * has none, deliberately. What this plugin bundles instead is
 * beautiful-mermaid, the library that took the other road: mermaid's syntax,
 * laid out in pure JavaScript (ELK) with metric-based text measurement, no
 * DOM, no browser, rendering *synchronously* to SVG. It is bundled into this
 * very file by `plugins/build.mjs`; nothing is fetched from anywhere, at any
 * time, and `render` asks for no capability at all. The one network reference
 * the library leaves in its output — a Google Fonts @import for Inter — is
 * stripped, so the SVG is as offline as the rendering was.
 *
 * What renders: flowchart/graph, sequenceDiagram, stateDiagram-v2,
 * classDiagram and erDiagram. A diagram kind beyond those (pie, gantt,
 * mindmap, ...) is refused with the library's own sentence saying what it
 * takes — and for those, `links` still answers the mermaid.live/mermaid.ink
 * urls, where the reader's own browser does the rendering.
 *
 * SVG is text: it survives every door strings pass through. `slack_upload`
 * with a `.svg` filename makes it a hosted image in a channel.
 *
 * This file is a build product's *source* — `plugins/mermaid/mermaid.js` is
 * what the server loads, and editing that by hand is editing a bundle.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderMermaidSync, THEMES } from 'beautiful-mermaid';

/** The url-safe alphabet of RFC 4648's base64url, in order. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url of some bytes, unpadded, as the mermaid-live-editor reads it. */
function base64url(bytes) {
  let written = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const one = bytes[index];
    const two = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const three = index + 2 < bytes.length ? bytes[index + 2] : 0;
    written += BASE64URL[one >> 2] + BASE64URL[((one & 3) << 4) | (two >> 4)];
    if (index + 1 < bytes.length) {
      written += BASE64URL[((two & 15) << 2) | (three >> 6)];
    }
    if (index + 2 < bytes.length) {
      written += BASE64URL[three & 63];
    }
  }
  return written;
}

/** The themes the live editor knows; anything else falls back rather than breaking a link. */
const LINK_THEMES = ['default', 'dark', 'forest', 'neutral'];

/** The rendered SVG with the one outward reference — the Inter @import — taken out. */
function offline(svg) {
  return drawableAnywhere(svg.replace(/^\s*@import url\([^)]*\);\s*$/m, ''));
}

/**
 * The same drawing, in SVG a 1.1 renderer can read.
 *
 * `orient="auto-start-reverse"` is SVG 2. Every browser understands it and
 * Batik - which is what draws the PNG on the server - does not: it reads the
 * value as an angle, fails on the word, and refuses the whole document with
 * `For input string: "auto-start-reverse"`. So every sequence diagram rendered
 * fine and every attempt to turn one into a picture failed.
 *
 * What the value means is "orient auto, then turn it round", which is exactly
 * a 180 degree rotation about the marker's own reference point. Rewriting it
 * that way is not an approximation: the marker points where it always did, and
 * the document no longer uses a word from a later specification to say so.
 *
 * Done here rather than in the renderer because this is the half that knows
 * what it drew. A renderer rewriting somebody else's markers would be guessing.
 */
function drawableAnywhere(svg) {
  return svg.replace(
    /<marker([^>]*?)orient="auto-start-reverse"([^>]*)>([\s\S]*?)<\/marker>/g,
    (whole, before, after, inside) => {
      const attributes = `${before}${after}`;
      const at = (name) => {
        const found = attributes.match(new RegExp(`${name}="([^"]*)"`));
        return found === null ? 0 : Number(found[1]) || 0;
      };

      return (
        `<marker${before}orient="auto"${after}>` +
        `<g transform="rotate(180 ${at('refX')} ${at('refY')})">${inside}</g>` +
        '</marker>'
      );
    },
  );
}

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
  return `mermaid.${hash.toString(36)}`;
}

/**
 * The same answer with the bytes taken out, which is what a model wants.
 *
 * An answer reaches a model by being read, every character of it, and this one
 * runs to thousands - read on the way to a key a dozen characters long that
 * names the very same bytes on the server. So the tool below answers the key
 * and leaves them where they are.
 *
 * Unless there was nowhere to leave them: outside a session `put` refuses and
 * the key comes back empty, and then what is in the answer is the only copy
 * there is. Stripping it there would answer nothing at all.
 */
function keyedOnly(made) {
  if (made.key.length === 0) {
    return made;
  }
  return { ...made, svg: '', png: '' };
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

export default class Mermaid extends OrknuxPlugin {

  id() {
    return 'mermaid';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [];
  }

  permissions() {
    // TextEncoder, for `links` alone: the live editor's url carries the
    // diagram as base64 of the state json's UTF-8 bytes.
    return ['TEXT_ENCODING'];
  }

  capabilities() {
    /*
     * Drawing is the server's to do, and only drawing.
     *
     * The diagram is built in this file - the layout engine is bundled here -
     * but turning the result into a picture needs a rasteriser, and this
     * sandbox has neither one nor the WebAssembly to bring one. So the one
     * thing asked for is the one thing that cannot be done here.
     *
     * It reaches nothing: what crosses is markup this plugin just produced,
     * and what comes back is bytes computed from it. No connection, no
     * address, no credential.
     */
    return ['RENDER_PNG'];
  }

  /*
   * Mermaid is the syntax a model already knows, and that is the problem.
   *
   * It knows all of mermaid - pie charts, gantt, mindmaps, journeys - and this
   * draws five kinds. A model that writes one of the others gets a refusal
   * naming what it takes, which is recoverable, but only if it knows `links`
   * exists and answers every kind. That is what this is for.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Drawing with mermaid',
        description: 'The five kinds this draws, what to do with the rest, and how a diagram reaches somebody.',
        content: `# Drawing with mermaid

\`mermaid_render\` draws mermaid source here, in the sandbox - no browser, no
service, nothing fetched. It draws **five kinds**:

\`flowchart\` / \`graph\` · \`sequenceDiagram\` · \`stateDiagram-v2\` ·
\`classDiagram\` · \`erDiagram\`

## Any other kind

\`pie\`, \`gantt\`, \`mindmap\`, \`journey\`, \`quadrantChart\`, \`timeline\` and the rest are
refused by name. That is not the end of it - **\`mermaid_links\` handles every
kind**, because the source travels inside the url and the reader's own browser
does the drawing:

    mermaid_links(source)  ->  { image, svg, editor, markdown }

\`image\` is a PNG url. Give it to \`slack_uploadFromUrl\` and the channel gets a
picture; paste \`markdown\` into a GitHub comment and it renders there. The price
is that the reader's browser reaches mermaid.ink, which \`render\` never does.

So: \`render\` for the five, \`links\` for everything else. Do not translate a pie
chart into a flowchart.

## Which tool at all

| You are drawing | Use |
|---|---|
| A process, steps, decisions | \`mermaid_render\`, \`flowchart\` |
| Who called whom, in order | \`mermaid_render\`, \`sequenceDiagram\` |
| Classes, packages, actors, what contains what | \`nomnoml_render\` |
| A pie chart, a gantt, a mindmap | \`mermaid_links\` |

## The arguments

\`format\` is \`png\` unless you say otherwise, and png is what you want: **Slack
draws no SVG**, so an svg posted to a channel arrives as a file card somebody
has to download. Ask for \`svg\` only when something other than a person reads
it - a document that embeds the markup, a file somebody will edit.

\`width\` sets the picture's width in pixels; left out, the diagram's own size is
used. \`theme\` is a palette by name: \`zinc-light\`, \`zinc-dark\`, \`tokyo-night\`,
\`catppuccin-mocha\`, \`catppuccin-latte\`, \`nord\`, \`dracula\`, \`github-dark\`,
\`solarized-light\`, \`one-dark\` and others - left out for the light default. A
name it does not know is refused with the list.

## Getting it to somebody

The answer carries a **key**, not the picture. Pass the key:

    mermaid_render(source)  ->  { key: 'mermaid.1k3af9', bytes: 18402 }
    slack_uploadBinary(channel, 'flow.png', 'mermaid.1k3af9', comment, threadTs)

\`slack_uploadBinary\` takes that key and nothing else - there is no argument to
put bytes in. A picture is thousands of characters of base64 and does not
survive being written back out by you; the key is a dozen and what it names
never leaves the server.

## When it will not draw

The error says what is wrong, and there are only two kinds of wrong:

- **a kind this does not draw** - the message lists the five. Use \`links\`.
- **a syntax error** - the message names it. Fix that line.

Both are answers, not bugs. Do not call again with the same source, and do not
rewrite a working diagram because the first attempt used a kind that is not
drawn here - change the tool, not the diagram.`,
      }),
    ];
  }

  /* What a drawing comes back as, and what a link to one looks like. */
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
              'file but draws none, so it arrives as a file card - ask for png when somebody ' +
              'should see the diagram in the message.',
          },
          {
            name: 'png',
            kind: 'string',
            description:
              'The picture as base64, where png was asked for. Empty for svg. Hand it to ' +
              'slack_uploadBinary as the base64, or save_artifact with base64 true.',
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
              'Where this drawing is kept for the rest of this session. Hand it to ' +
              'slack_upload as contentKey instead of copying the svg out - the bytes never ' +
              'leave the server, so nothing can be truncated on the way.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'Links',
        description: 'Urls that render a diagram elsewhere, carrying its source inside them.',
        properties: [
          { name: 'image', kind: 'string', description: 'A PNG from mermaid.ink.' },
          { name: 'svg', kind: 'string', description: 'The same as SVG.' },
          { name: 'editor', kind: 'string', description: 'Opens the source in the mermaid live editor.' },
          { name: 'markdown', kind: 'string', description: 'The image, ready to paste into a GitHub comment.' },
        ],
      }),
    ];
  }

  /* The agents' surface: both calls, fronted. Proxies, so everything stays the functions' own. */
  /*
   * `render` is a tool of its own; `links` is still its function.
   *
   * What a model should be handed is not what a workflow node should be
   * handed - the drawing is the function's answer and the key is the tool's,
   * and the difference between them is the several thousand characters a
   * model would otherwise read on its way past. `links` answers four urls and
   * has nothing to strip, so it stays a proxy.
   */
  tools() {
    const drawing = this.functions().find((one) => one.name === 'render');
    return [
      new OrknuxTool({
        name: 'render',
        description:
          drawing.description +
          ' The answer carries the key and not the drawing itself: the bytes stay on the server ' +
          'and the key names them, so pass it on rather than looking for markup or base64 here. ' +
          'Where there is no session to keep a drawing in, the drawing comes back instead, ' +
          'because then it is the only copy there is.',
        params: drawing.params,
        returnType: drawing.returnType,
        run: (source, theme, format, width) => keyedOnly(drawing.run(source, theme, format, width)),
      }),
      new OrknuxFunctionTool({ function: 'links' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'render',
        description:
          'Renders mermaid source to SVG right here - no external service, no browser. Takes ' +
          'flowchart/graph, sequenceDiagram, stateDiagram-v2, classDiagram and erDiagram; another ' +
          'kind (pie, gantt, mindmap, ...) is refused by name - use links for those. theme names a ' +
          'palette (zinc-light, zinc-dark, tokyo-night, catppuccin-mocha, catppuccin-latte, nord, ' +
          '...), left out for the light default. format is png (the default) for a picture people ' +
          'can see, or svg for the markup; width sets the picture width in pixels, left out to ' +
          'be sized for reading - twice what the diagram laid itself out at, brought up where ' +
          'that is still small, and capped on area rather than on either side. Answers png as ' +
          'base64 or svg as text, the byte count, the width and height it actually came out at, ' +
          'and a short key the answer is kept under for this session. Those two are worth a ' +
          'look: a drawing far longer one way than the other is one a chat column shrinks to ' +
          'nothing, and redrawing it in the other direction is the fix rather than more pixels. To put it on Slack pass ' +
          'that key - slack_uploadBinary takes it for a png, slack_upload for an svg - rather ' +
          'than copying the answer out and pasting it in, which is thousands of characters that ' +
          'have to come back perfect and do not.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'theme', type: 'string', required: false, default: '' },
          { name: 'format', type: 'string', required: false, default: 'png' },
          { name: 'width', type: 'number', required: false, default: 0 },
        ],
        returnType: 'Drawing',
        run: (source, theme, format, width) => {
          if (typeof source !== 'string' || source.trim().length === 0) {
            throw new Error('there is no diagram source to render');
          }

          let palette;
          if (typeof theme === 'string' && theme.length > 0) {
            palette = THEMES[theme];
            if (palette === undefined) {
              throw new Error(
                `no theme called ${theme}: the themes are ${Object.keys(THEMES).join(', ')}`,
              );
            }
          }

          let svg;
          try {
            svg = renderMermaidSync(source, palette);
          } catch (failure) {
            /*
             * The library's parse errors name the line and, for a diagram
             * kind it does not draw, say which kinds it does — thrown on in
             * this plugin's own voice so the model can fix the source or
             * reach for `links` instead of retrying the same call.
             */
            const said = failure instanceof Error ? failure.message : String(failure);
            throw new Error(`could not render the diagram: ${said}`);
          }

          const asked = typeof format === 'string' && format.length > 0 ? format.toLowerCase() : 'png';
          if (asked !== 'png' && asked !== 'svg') {
            throw new Error(`no format called ${format}: it is png or svg`);
          }

          const held = offline(svg);

          /*
           * Kept here as well as answered, and this is the half that matters
           * for anything large.
           *
           * The answer travels through the model: it reads the svg, and to
           * upload it it has to write every character of it back out in the
           * next tool call. A diagram of four kilobytes is four kilobytes of
           * generated text that has to come out perfect, and it does not -
           * one that went to Slack as base64 arrived with a stray character
           * in the middle of it and the whole call was rejected as malformed
           * JSON.
           *
           * So the bytes are also left in the session's own store, and the
           * key is short enough to copy without getting it wrong. Whatever
           * reads it takes them from here rather than from what the model
           * managed to retype. The svg stays in the answer because a caller
           * that only wants to look at it should not have to fetch it, and
           * because a workflow node - no session, no store - has nowhere
           * else to read it from.
           */
          /*
           * PNG unless somebody asked for the markup, because a picture is
           * what a person can see.
           *
           * Slack draws no SVG at all - it hosts one as a file card - so the
           * format that makes a diagram visible is the one that should happen
           * without being asked for. svg is still there for a caller that
           * wants the markup itself: to edit it, to put it in a document, or
           * to hand it somewhere that does draw it.
           *
           * The drawing is the server's work. This sandbox has no WebAssembly
           * and no rasteriser, so `orknux.render.pngFromSvg` is not a
           * convenience over something the plugin could do itself - it is the
           * only way this answer exists.
           */
          if (asked === 'png') {
            const drawn = orknux.render.pngFromSvg(scalable(held), drawnWidth(held, width));
            if (drawn.error !== undefined) {
              throw new Error(`could not draw the diagram: ${drawn.error}`);
            }

            const key = keyFor(drawn.base64);
            const kept = orknux.session.store.put(key, drawn.base64);
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
              key: kept.error === undefined ? key : '',
            };
          }

          const key = keyFor(held);
          const kept = orknux.session.store.put(key, held);

          /* Markup has no drawn size, so what it declares for itself is the honest answer. */
          const declared = intrinsic(held) ?? { width: 0, height: 0 };

          return {
            svg: held,
            png: '',
            bytes: held.length,
            width: Math.round(declared.width),
            height: Math.round(declared.height),
            // Empty where there is no session to keep it in, which is exactly
            // when a caller has to fall back to the answer above.
            key: kept.error === undefined ? key : '',
          };
        },
      }),

      new OrknuxFunction({
        name: 'links',
        description:
          'Turns mermaid source into links that render it elsewhere - and image is the way to get ' +
          'a diagram somebody can actually see in a Slack message, since Slack draws no SVG: give ' +
          'that url to slack_uploadFromUrl. image is a PNG and svg an SVG ' +
          'from mermaid.ink, editor opens the source in the mermaid live editor, and markdown is the ' +
          'image ready to paste into a GitHub comment. The source travels inside the links and the ' +
          'reader\'s browser does the rendering - so this handles every diagram kind, including the ' +
          'ones render refuses, at the price of the reader\'s browser reaching mermaid.ink. theme is ' +
          'default, dark, forest or neutral.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'theme', type: 'string', required: false, default: 'default' },
        ],
        returnType: 'Links',
        run: (source, theme) => {
          if (typeof source !== 'string' || source.trim().length === 0) {
            throw new Error('there is no diagram source to link');
          }
          const chosen = LINK_THEMES.includes(theme) ? theme : 'default';

          /*
           * The mermaid-live-editor's state JSON, which is what both sites
           * read out of the url. Encoded from UTF-8 bytes, not code units.
           */
          const state = JSON.stringify({ code: source, mermaid: { theme: chosen } });
          const encoded = base64url(new TextEncoder().encode(state));

          const image = `https://mermaid.ink/img/${encoded}?type=png`;
          return {
            image: image,
            svg: `https://mermaid.ink/svg/${encoded}`,
            editor: `https://mermaid.live/edit#base64:${encoded}`,
            markdown: `![diagram](${image})`,
          };
        },
      }),
    ];
  }
}
