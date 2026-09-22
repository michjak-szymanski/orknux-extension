/*
 * PlantUML, as a plugin.
 *
 * PlantUML draws the diagrams a model is most often asked for and mermaid is
 * worst at — sequence diagrams with activation and grouping, class diagrams
 * with real cardinality, component, state, activity, deployment, ERDs, gantt,
 * mindmaps, wireframes, JSON — out of text a model already writes well.
 *
 * ## Why this calls a server, when the mermaid plugin calls nobody
 *
 * PlantUML now ships a pure-JavaScript build (`@plantuml/core`, TeaVM), and
 * the obvious question is why it is not bundled here the way mermaid and
 * nomnoml are. It was tried. Three things stop it, and the first is fatal:
 *
 * 1. **It is asynchronous.** `renderToString(lines, onSuccess, onError)`
 *    returns immediately and delivers through a callback scheduled on a
 *    timer. A plugin's `run` is synchronous — there is nothing to await, and
 *    no event loop for it to be pumped by — so the answer arrives after the
 *    only moment it could have been returned in.
 * 2. **It measures text through a real DOM.** Layout asks an SVG text node
 *    for `getBBox()`, dozens of times for even a small diagram, and then
 *    wants an XML document to serialise through. Stubs get a little further
 *    each time and then want the next piece of a browser.
 * 3. **Layout is Graphviz, shipped as WebAssembly.** The sandbox has none, so
 *    every diagram that needs graph layout — class, component, state,
 *    activity, deployment, use case — could not be laid out even if the two
 *    above were solved.
 *
 * So the drawing is done by a PlantUML server, which is what one is for, and
 * every request is made by the *server* on the plugin's behalf under the
 * NETWORK_REQUEST capability a person accepted.
 *
 * ## The encoding, and why there is no compression in it
 *
 * A PlantUML url carries the diagram inside it: the path is the source,
 * deflated and then written in PlantUML's own base64 alphabet. The sandbox has
 * no compressor — so what this builds is a deflate stream of *stored* blocks,
 * which is a valid deflate stream that happens to compress nothing. Four
 * characters per three bytes, against the two per byte that PlantUML's `~h`
 * hex form would cost.
 *
 * That is also the one real limit here: the diagram travels in a url, and a
 * server caps how long a url may be — a stock Tomcat at eight kilobytes. A
 * source past what fits is refused by name rather than sent to be truncated
 * into a syntax error somewhere in the middle.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept NETWORK_REQUEST, which is all it asks for.
 * 2. Set `url` to a PlantUML server — your own, or
 *    `https://www.plantuml.com/plantuml` if the diagrams are not confidential.
 *    There is deliberately no default: whose server sees the diagram text is
 *    not a decision this file should make quietly.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** PlantUML's own base64 alphabet, which is not the standard one's order. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/** And the standard one, which is what `orknux.encoding` answers in. */
const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * How long an encoded diagram may be before it is refused.
 *
 * A stock Tomcat takes eight kilobytes of request line, and the diagram is the
 * request line. Seven thousand leaves room for the server's own path and for
 * a proxy in front of it with a lower opinion.
 */
const MAX_ENCODED = 7000;

/** The formats a picture can come back as, and what each is fetched as. */
const FORMATS = { png: 'binary', svg: 'text' };

/** A nested field, or null rather than a thrown error on the way down. */
function at(holder, name) {
  if (holder === null || typeof holder !== 'object') {
    return null;
  }
  const held = holder[name];
  return held === undefined ? null : held;
}

/**
 * One of an answer's headers, whatever case it came back in.
 *
 * Everything this plugin learns about a diagram beyond its bytes is in a
 * header — the size it came out, what PlantUML made of it, and the line a
 * syntax error is on — so reading them by one spelling would lose all of it
 * behind a proxy that normalised the case.
 */
function header(answered, name) {
  const held = answered.headers;
  if (held === null || typeof held !== 'object') {
    return null;
  }
  const wanted = name.toLowerCase();
  for (const key of Object.keys(held)) {
    if (key.toLowerCase() === wanted) {
      return held[key];
    }
  }
  return null;
}

/** A header that should be a number, as one, or null where it was neither. */
function numeric(answered, name) {
  const said = header(answered, name);
  const held = Number(said);
  return typeof said === 'string' && said.length > 0 && Number.isFinite(held) ? held : null;
}

/** The server's root, without its trailing slash. */
function root(settings) {
  const configured = settings.url;
  if (typeof configured !== 'string' || configured.length === 0) {
    throw new Error("the plugin's url parameter is not set, and every PlantUML call needs a server");
  }
  return configured.endsWith('/') ? configured.slice(0, -1) : configured;
}

/**
 * The source's own UTF-8 bytes.
 *
 * `orknux.encoding` does the UTF-8, which is the part that has to be right —
 * a diagram with an accent or a CJK label is bytes the sandbox cannot produce
 * on its own — and the standard base64 it answers in is unpacked here.
 * Ungranted, both halves: this is arithmetic on a string.
 */
function bytesOf(text) {
  const encoded = orknux.encoding.encodeBase64(text);
  if (encoded.error !== undefined) {
    throw new Error(`could not encode the diagram: ${encoded.error}`);
  }
  const written = encoded.base64.replace(/=+$/, '');
  const bytes = [];
  let held = 0;
  let bits = 0;
  for (let at = 0; at < written.length; at += 1) {
    const value = STANDARD.indexOf(written[at]);
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
 * Stored blocks are the part of the format that needs no compressor: a header
 * bit saying this is the last block, a length, its complement, and then the
 * bytes as they are. PlantUML's decoder inflates it like any other stream —
 * it has no way to tell, and no reason to care.
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

/** Those bytes in PlantUML's alphabet, three at a time, which is what a url carries. */
function encoded(source) {
  const asked = typeof source === 'string' ? source.trim() : '';
  if (asked.length === 0) {
    throw new Error('there is no diagram source to draw');
  }
  const bytes = deflated(bytesOf(asked));

  let written = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at];
    const second = at + 1 < bytes.length ? bytes[at + 1] : 0;
    const third = at + 2 < bytes.length ? bytes[at + 2] : 0;
    written += ALPHABET[first >> 2];
    written += ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    written += ALPHABET[((second & 0x0f) << 2) | (third >> 6)];
    written += ALPHABET[third & 0x3f];
  }

  if (written.length > MAX_ENCODED) {
    throw new Error(
      `the diagram is too long to travel in a url: ${asked.length} characters encode to ` +
        `${written.length}, and a PlantUML server takes about ${MAX_ENCODED} - split it, or ` +
        'drop the parts of it that are not the point',
    );
  }
  return written;
}

/** Where one diagram lives on the configured server, in one of its formats. */
function where(settings, format, source) {
  return `${root(settings)}/${format}/${encoded(source)}`;
}

/**
 * What PlantUML said about a refusal.
 *
 * A syntax error is an HTTP 400 whose *body is a picture of the error* — which
 * is no use to a caller that has to fix the source. What is useful is in the
 * headers: the message, and the line it is on. Thrown in this plugin's voice
 * so that a model fixes line 12 rather than rendering the same diagram again.
 */
function refusal(answered, source) {
  const said = header(answered, 'x-plantuml-diagram-error');
  const line = header(answered, 'x-plantuml-diagram-error-line');
  if (typeof said !== 'string' || said.length === 0) {
    return `the PlantUML server answered ${answered.status}`;
  }
  const lines = source.split('\n');
  const at = Number(line);
  const quoted =
    Number.isFinite(at) && at >= 1 && at <= lines.length ? `: ${lines[at - 1].trim()}` : '';
  return Number.isFinite(at) ? `${said} on line ${at}${quoted}` : said;
}

/** A short name for what a drawing is kept under, so nothing large is retyped. */
function keyFor(text) {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `plantuml.${hash.toString(36)}`;
}

/** What a tool hands a model: the key, never the bytes it names. */
function keyedOnly(drawn) {
  if (drawn.key === '') {
    /* No session to keep it in, so the answer is the only copy there is. */
    return drawn;
  }
  return { ...drawn, svg: '', png: '' };
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
          'A PlantUML server: your own, or https://www.plantuml.com/plantuml if the diagrams ' +
          'are not confidential. The diagram text travels to whichever this names.',
        type: 'string',
        required: true,
      }),
    ];
  }

  permissions() {
    // None. The url's encoding is base64 in a different order over a deflate
    // stream that compresses nothing — arithmetic, and `orknux.encoding` does
    // the one part of it that needs the server, which is the UTF-8.
    return [];
  }

  capabilities() {
    /*
     * Drawing is the server's, as it is for mermaid — but for a different
     * reason, and the difference is the whole of this plugin's design. There
     * the diagram is built in the sandbox and only the rasterising is asked
     * for; here the engine itself is a Java program, and the JavaScript build
     * of it cannot run in a sandbox with no DOM, no timers and no
     * WebAssembly. So what is asked for is a network request, and the thing
     * on the other end of it is a PlantUML.
     */
    return ['NETWORK_REQUEST'];
  }

  objects() {
    return [
      new OrknuxObject({
        name: 'Drawing',
        description: 'A diagram drawn by the PlantUML server.',
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
            description: 'How wide it came out, in pixels, as the server measured it — not as anything asked for.',
          },
          {
            name: 'height',
            kind: 'number',
            description:
              'How tall. Worth a glance beside width: a diagram far longer one way than the ' +
              'other is one a chat column shrinks to nothing, and redrawing it the other way is the fix.',
          },
          {
            name: 'description',
            kind: 'string',
            description: "PlantUML's own summary of what it drew — \"(2 participants)\", \"(5 entities)\".",
          },
          {
            name: 'key',
            kind: 'string',
            description:
              'Where this drawing is kept for the rest of this session. Hand it on as ' +
              'contentKey rather than copying the bytes out. Empty where there is no session.',
          },
          { name: 'url', kind: 'string', description: 'The same diagram on the server, for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Ascii',
        description: 'A diagram as letters, which is a diagram a model can actually read.',
        properties: [
          { name: 'text', kind: 'string', description: 'The drawing in box-drawing characters.' },
          { name: 'description', kind: 'string', description: "PlantUML's own summary of what it drew." },
          { name: 'url', kind: 'string', description: 'The same diagram as a picture, for a person.' },
        ],
      }),

      new OrknuxObject({
        name: 'Checked',
        description: 'Whether a diagram is one PlantUML can draw, without drawing it anywhere anybody sees.',
        properties: [
          { name: 'ok', kind: 'boolean', description: 'It parsed.' },
          { name: 'error', kind: 'string', description: "What is wrong, in PlantUML's words. Null where nothing is." },
          { name: 'line', kind: 'number', description: 'Which line of the source. Null where it did not say.' },
          { name: 'source', kind: 'string', description: 'That line itself, so the message has something to sit beside.' },
          { name: 'type', kind: 'string', description: 'What PlantUML took it to be: SEQUENCE, CLASS, MINDMAP.' },
        ],
      }),

      new OrknuxObject({
        name: 'Links',
        description: 'Urls that draw a diagram elsewhere, carrying its source inside them.',
        properties: [
          { name: 'png', kind: 'string', description: 'The picture.' },
          { name: 'svg', kind: 'string', description: 'The same as SVG.' },
          { name: 'txt', kind: 'string', description: 'The same in letters.' },
          { name: 'editor', kind: 'string', description: 'Opens the source in the server on a page that can edit it.' },
          { name: 'markdown', kind: 'string', description: 'The image, ready to paste into a comment.' },
        ],
      }),
    ];
  }

  /*
   * One page, and most of it is about the two mistakes that cost the most.
   *
   * A model asked for a diagram writes PlantUML well and then does two
   * expensive things with it: it copies a hundred kilobytes of base64 into its
   * next tool call, and on a syntax error it rewrites the whole diagram rather
   * than the line the server named.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Drawing a diagram with PlantUML',
        description: 'What it draws, what to do when it refuses, and how a diagram reaches somebody.',
        content: `# Drawing a diagram with PlantUML

\`plantuml_render\` draws PlantUML source on a PlantUML server and answers a
**key**, not the picture. That is the first thing to know about it.

## Pass the key, never the bytes

A PNG is a hundred kilobytes of base64. Reading it back out into the next tool
call means generating a hundred kilobytes of text perfectly, and it does not
come out perfectly — one stray character in the middle and the call is refused
as malformed. The key is eleven characters and names the same bytes on the
server.

    plantuml_render(source, "png")      → { key: "plantuml.1a2b3c", ... }
    slack_uploadBinary(contentKey: "plantuml.1a2b3c", ...)

## A refusal names a line. Fix that line.

PlantUML answers a syntax error as *a picture of the error*, which is no use.
This plugin reads the message and the line number out of the answer's headers
instead, and throws them:

    Syntax Error? (Assumed diagram type: sequence) on line 7: Alice -> : Hello

So fix line 7. Do not rewrite the diagram, and do not render it again
unchanged — the server is not going to change its mind. The usual causes are
a missing participant on one side of an arrow, a stray \`}\`, and a keyword
from a different diagram type.

\`plantuml_check\` asks the same question without producing a picture, and
answers data rather than throwing, which is what a workflow condition wants.

## Read it back before you trust it

\`plantuml_ascii\` draws the same diagram in box-drawing characters. You cannot
see a PNG; you can read this. For sequence diagrams especially it is worth one
call before sending a picture to somebody — it is how you find that two
participants came out in the wrong order, or that a message you meant as a
reply was drawn as a call.

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

Sequence and class diagrams are what it is best at, and what mermaid is worst
at — activation bars, nested groups, real cardinality on an association. Reach
for \`mermaid_render\` instead when the diagram is a simple flowchart and it
matters that nothing leaves the server: mermaid draws in the sandbox, this
calls a PlantUML.

## Two limits worth knowing before you hit them

**The diagram travels inside the url**, so a very long one is refused by name
rather than truncated. If that happens, the diagram is almost certainly saying
more than a reader wanted anyway: draw the part being discussed.

**The server sees the source.** Where that server is
\`www.plantuml.com/plantuml\`, the diagram has left the building — worth a
thought before drawing anything that names internal systems.

## Sharing one

\`plantuml_links\` builds urls that carry the source inside them and needs no
request at all. The \`editor\` one opens the diagram on the server where
somebody can change it, and \`markdown\` is ready to paste into a comment. A
link is better than an attachment when the diagram is going to be argued
about, because whoever disagrees can edit it.`,
      }),
    ];
  }

  /*
   * `render` is a tool of its own, the way the mermaid plugin's is: the model
   * gets the key and the measurements, and the bytes stay where they are. The
   * other three are proxies — they answer text that is the point of asking.
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
        run: (source, format) => keyedOnly(drawing.run(source, format)),
      }),
      new OrknuxFunctionTool({ function: 'ascii' }),
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
          'case, ERD, gantt, mindmap, wbs, json, salt - on the configured PlantUML server. format ' +
          'is png (the default) for a picture people can see, or svg for markup that scales. ' +
          'Answers the picture as base64 or the markup as text, its size in pixels as the server ' +
          'measured it, what PlantUML made of the diagram, a url to it, and a short key the ' +
          'answer is kept under for this session - pass that key on rather than copying the ' +
          'bytes. A syntax error is refused with the message and the line it is on, so fix that ' +
          'line rather than rendering the same source again.',
        params: [
          { name: 'source', type: 'string' },
          { name: 'format', type: 'string', required: false, default: 'png' },
        ],
        returnType: 'Drawing',
        run: (source, format) => {
          const asked = typeof format === 'string' && format.length > 0 ? format.toLowerCase() : 'png';
          if (FORMATS[asked] === undefined) {
            throw new Error(`no format called ${format}: it is ${Object.keys(FORMATS).join(' or ')}`);
          }
          const text = typeof source === 'string' ? source : '';
          const url = where(this.settings, asked, text);

          /*
           * A PNG is fetched as bytes and an SVG as text, because a PNG does
           * not survive being read as a string - and both doors answer their
           * headers, which is where everything else about the diagram is.
           */
          const answered =
            FORMATS[asked] === 'binary' ? orknux.http.download(url) : orknux.http.get(url);
          if (answered.error !== undefined) {
            throw new Error(`could not reach the PlantUML server: ${answered.error}`);
          }
          if (answered.status >= 400) {
            throw new Error(refusal(answered, text));
          }

          const drawn = asked === 'png' ? answered.base64 : answered.body;
          const bytes = asked === 'png' ? answered.size : drawn.length;
          const key = keyFor(url);
          const kept = orknux.session.store.put(key, drawn);

          return {
            svg: asked === 'svg' ? drawn : '',
            png: asked === 'png' ? drawn : '',
            bytes: bytes,
            /* The server measured the drawing; nothing here has to guess at it. */
            width: numeric(answered, 'x-plantuml-diagram-width'),
            height: numeric(answered, 'x-plantuml-diagram-height'),
            description: header(answered, 'x-plantuml-diagram-description'),
            /* Empty where there is no session, which is when the answer above is the only copy. */
            key: kept.error === undefined ? key : '',
            url: url,
          };
        },
      }),

      new OrknuxFunction({
        name: 'ascii',
        description:
          'Draws the same source in box-drawing characters instead of pixels - a diagram a model ' +
          'can read rather than one it has to take on trust. Worth one call before sending a ' +
          'sequence diagram to somebody: participants in the wrong order and a reply drawn as a ' +
          'call are both obvious here and invisible in a png. Answers the text, what PlantUML ' +
          'made of the diagram, and a url to the picture.',
        params: [{ name: 'source', type: 'string' }],
        returnType: 'Ascii',
        run: (source) => {
          const text = typeof source === 'string' ? source : '';
          const answered = orknux.http.get(where(this.settings, 'txt', text));
          if (answered.error !== undefined) {
            throw new Error(`could not reach the PlantUML server: ${answered.error}`);
          }
          if (answered.status >= 400) {
            throw new Error(refusal(answered, text));
          }
          return {
            text: answered.body,
            description: header(answered, 'x-plantuml-diagram-description'),
            url: where(this.settings, 'png', text),
          };
        },
      }),

      new OrknuxFunction({
        name: 'check',
        description:
          'Whether the server can draw this source, answered as data rather than thrown - ok, ' +
          'the message and the line where it is not, and what PlantUML took the diagram to be. ' +
          'For a condition that has to decide something, and for checking a diagram somebody ' +
          'else wrote before drawing it into a document.',
        params: [{ name: 'source', type: 'string' }],
        returnType: 'Checked',
        run: (source) => {
          const text = typeof source === 'string' ? source : '';
          const answered = orknux.http.get(where(this.settings, 'svg', text));
          if (answered.error !== undefined) {
            throw new Error(`could not reach the PlantUML server: ${answered.error}`);
          }

          const said = header(answered, 'x-plantuml-diagram-error');
          const line = numeric(answered, 'x-plantuml-diagram-error-line');
          const lines = text.split('\n');
          const type = typeof answered.body === 'string'
            ? (answered.body.match(/data-diagram-type="([A-Z_]+)"/) ?? [])[1] ?? null
            : null;

          return {
            ok: answered.status < 400 && (said === null || said.length === 0),
            error: said,
            line: line,
            source: line !== null && line >= 1 && line <= lines.length ? lines[line - 1].trim() : null,
            type: type,
          };
        },
      }),

      new OrknuxFunction({
        name: 'links',
        description:
          'Urls that draw this diagram on the configured server, carrying the source inside them ' +
          '- as a png, an svg, letters, an editable page, and as markdown ready to paste into a ' +
          'comment. Reaches nothing: the urls are built here. A link beats an attachment when a ' +
          'diagram is going to be argued about, because whoever disagrees can open it and edit it.',
        params: [{ name: 'source', type: 'string' }],
        returnType: 'Links',
        run: (source) => {
          const text = typeof source === 'string' ? source : '';
          /* Encoded once: it is the same string in all five, and it is the expensive part. */
          const written = encoded(text);
          const site = root(this.settings);
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
