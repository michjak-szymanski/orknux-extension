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
  return svg.replace(/^\s*@import url\([^)]*\);\s*$/m, '');
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
    // None: the renderer is bundled into this very file, and SVG is text.
    return [];
  }

  /* The agents' surface: both calls, fronted. Proxies, so everything stays the functions' own. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'render' }),
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
          '...), empty for the light default. The answer is SVG text: put it on Slack with ' +
          'slack_upload and a .svg filename, where it shows as an image. Answers svg and its byte ' +
          'count.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'theme', type: 'string' },
        ],
        returnType: 'map',
        run: (source, theme) => {
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

          const held = offline(svg);
          return { svg: held, bytes: held.length };
        },
      }),

      new OrknuxFunction({
        name: 'links',
        description:
          'Turns mermaid source into links that render it elsewhere: image is a PNG and svg an SVG ' +
          'from mermaid.ink, editor opens the source in the mermaid live editor, and markdown is the ' +
          'image ready to paste into a GitHub comment. The source travels inside the links and the ' +
          'reader\'s browser does the rendering - so this handles every diagram kind, including the ' +
          'ones render refuses, at the price of the reader\'s browser reaching mermaid.ink. theme is ' +
          'default, dark, forest or neutral - empty for default.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'theme', type: 'string' },
        ],
        returnType: 'map',
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
