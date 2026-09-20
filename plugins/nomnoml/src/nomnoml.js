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
 * It asks for nothing at all: no capability, because nothing is fetched, and
 * no permission, because it never reaches for a builtin behind one. The SVG
 * it produces is self-contained — no font import, no remote reference — so
 * the drawing is as offline as the drawing of it was.
 *
 * ## Why there is no png here
 *
 * Because this sandbox cannot draw one, and this plugin will not pretend
 * otherwise. Turning SVG into a picture needs a rasteriser, and there is
 * neither one here nor the WebAssembly to bring one. The mermaid plugin
 * answers pngs through a server capability; when that capability is in this
 * package's contract, the same few lines belong here.
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
    // None either. Nothing is fetched, at any time, from anywhere.
    return [];
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
              'The SVG markup. Slack hosts an SVG as a file but draws none, so it arrives as a ' +
              'file card rather than as a picture in the message.',
          },
          { name: 'bytes', kind: 'number', description: 'How long that markup is.' },
          {
            name: 'key',
            kind: 'string',
            description:
              'Where this drawing is kept for the rest of this session. Hand it to slack_upload ' +
              'as contentKey instead of copying the svg out - the bytes never leave the server, ' +
              'so nothing can be truncated on the way. Empty where there was no session to keep ' +
              'it in.',
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

  tools() {
    return [new OrknuxFunctionTool({ function: 'render' })];
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
          'mermaid_render instead - this draws neither. Answers the svg, its byte count, a short ' +
          'key the drawing is kept under for this session, and a url that opens it in the ' +
          'nomnoml editor. To put it on Slack call slack_upload with a .svg filename and pass ' +
          'that key as contentKey, rather than copying the svg out and pasting it in.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'theme', type: 'string', required: false, default: '' },
          { name: 'direction', type: 'string', required: false, default: '' },
        ],
        returnType: 'Drawing',
        run: (source, theme, direction) => {
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
          const key = keyFor(svg);
          const kept = orknux.session.store.put(key, svg);

          return {
            svg: svg,
            bytes: svg.length,
            key: kept.error === undefined ? key : '',
            editor: editorUrl(source),
          };
        },
      }),
    ];
  }
}
