# PDF

Composes PDF documents from a workflow: text, headings, tables — and a
Mermaid diagram drawn straight into the page, rendered by the same offline
pipeline the Mermaid plugin ships. The document comes back as base64 for a
downstream node to store or send.

Everything runs inside the sandbox; the PDF library ships as the plugin's own
bundled libraries, so nothing is installed on the server and nothing leaves
it.

## Write one, look at it, read it back

| Function | Answers |
|---|---|
| `fromHtml(html, title = "")` | A `Document`: the file as `base64`, its `pages` and `bytes`, a `key` it is kept under, and `problems` — what went wrong without stopping the document. |
| `preview(base64, page, width)` | A `Preview`: that page drawn as a picture, its size, the document's `pages`, and a `key` for the picture. |
| `read(base64, from, to)` | A `Reading`: what the document **says**, as text, plus `characters`, `pages`, the range actually read, and a `key`. |

There are no parameters to configure. Nothing to point at and no credential.

```
pdf_fromHtml('<h1>Q3 review</h1><p>Revenue was up 4%.</p>')
  → { base64: 'JVBERi0xLjMK…', pages: 1, bytes: 2841, key: 'pdf.1k9x2m', problems: [] }
```

Hand the **key** to `slack_uploadBinary` with a `.pdf` filename. That is the
whole handoff — the PDF never becomes a file on disk anywhere, and never passes
through a model as base64, which does not survive being written back out.

### The two questions about a document

`preview` answers *how does it look*. `read` answers *what does it say*. They
share a capability and a parser and are otherwise opposites:

- **Layout goes wrong silently**, and `problems` can only report what the
  writer knew about — not a heading stranded at the foot of a page or a table
  that ran off the side. Draw the page and look at it before you send it to
  anybody.
- **Text is what something can act on** — find the total on an invoice, quote
  a clause, decide whether a report is worth passing on.

`read` answers reading order, not layout: a `<section data-page="N">` per page
and a `<p>` per block, with the line breaks inside a block folded to spaces,
because those are where the page wrapped rather than where a sentence ended. A
two-column page reads as two columns rather than as alternating lines. Columns,
tables and anything positioned rather than written are flattened — for a
question about arrangement, draw it instead.

Text that was itself markup comes back escaped: a PDF whose contents are
`<script>` reads as `&lt;script&gt;`. It is a document *saying* something, not
a document *doing* something, and that distinction is pinned by a test.

`from` and `to` name a range of pages, counting from one, both optional. 200,000
characters is the most one call returns; past that it is refused with the number
in the sentence, and a range is the way through.

```
pdf_read(key)
  → { html: '<section data-page="1"><p>Invoice 42</p>…', characters: 4180,
      pages: 6, from: 1, to: 6, key: 'pdf.9m2k1x' }
```

That last key holds the **text**, which `slack_upload` takes as `contentKey` —
so a document read here reaches a channel as a snippet without being copied out
and pasted back in.

### Agents get a key, workflows get bytes

Both `preview` and `read` come in two shapes. The **function** takes `base64`,
because a workflow node has no session to hold a key in and refusing there
would close its only door. The **tool** takes `contentKey` and has no `base64`
argument at all: a few hundred thousand characters of base64 typed into a tool
call arrives a character wrong and is rejected before anything runs.

What they answer differs the other way round. `preview` strips its picture from
the agent's answer — nobody reads base64 — and `read` does not strip its text,
because the text *is* the answer.

## What of HTML is understood

A report writer, not a browser. The layout is this plugin's own: a practical
subset of HTML read into blocks, wrapped and paged onto A4.

| | |
|---|---|
| Headings | `h1`–`h3`. `h4`–`h6` read as `h3`. |
| Text | `p`, `div`, `br`, `hr` |
| Lists | `ul` and `ol`, nested |
| Emphasis | `b` and `strong`. **`i`/`em` render regular** — a third and fourth font face would put the bundle over the size a plugin may be. |
| Tables | Cells run together as text |
| Diagrams | `<pre class="mermaid">` or `<mermaid>` — see below |
| Entities | Named and numeric, decoded |

Scripts, styles and comments are dropped whole. Every other tag is ignored and
its text kept, so unknown markup degrades to its content rather than to an
error.

**Not supported, on purpose:** CSS, raster images, links. Those are the things
that would require a browser engine, and a browser engine is the thing this
plugin exists to not need.

## Diagrams, embedded — and still no network

Put Mermaid source in a `<pre class="mermaid">` block and it becomes a diagram
*in* the document:

```html
<h2>How a delivery is handled</h2>
<pre class="mermaid">
flowchart LR
  A[Webhook] --> B{Verified?}
  B -->|yes| C[Describe]
  B -->|no| D[Refuse]
</pre>
```

beautiful-mermaid renders it to SVG right there — pure JavaScript, no DOM,
bundled like everything else — and the SVG's small vocabulary (`rect`,
`polygon`, `polyline`, `text`) is translated into jsPDF's own vector calls.

So the diagram is **real vector drawing in the PDF**, not a picture of one: it
stays sharp at any zoom, and nothing was fetched from anywhere to make it.

These kinds render, which are beautiful-mermaid's:

`flowchart` / `graph` · `sequenceDiagram` · `stateDiagram-v2` ·
`classDiagram` · `erDiagram`

Another kind is refused with a sentence naming what does render, rather than
producing an empty box.

## Unicode, properly

Two DejaVu faces travel inside the bundle as base64, so **ą, ř and ő are set
as the letters they are** instead of being folded to a, r and o. Polish,
Czech, Hungarian, the lot.

This is why the answer is binary. Getting real typography meant embedding real
fonts, which meant the document leaves as base64 rather than as text — which
is the shape `slack_uploadBinary` and the http door's `upload` take anyway.

## What it asks for, and why

`TEXT_ENCODING`, for `TextEncoder` and friends, which jsPDF's Unicode font
machinery leans on.

**And `RENDER_PDF`**, which is a real change from the days when this asked for
nothing at all.

Writing a document still asks the server for nothing: the writer, the layout,
the fonts and the diagram renderer are all inside the file, and `fromHtml` is
arithmetic on a string that happens to produce a PDF. It is *looking at* one
that needs help — rasterising needs a rasteriser, and reading needs a parser,
neither of which a sandbox with no WebAssembly can carry.

`preview` and `read` share that one grant deliberately. Same parser, same
embedded-file and encryption and font models, same risk surface — a second
capability would ask an operator to weigh a distinction that is not there.

Nothing is fetched either way. What crosses is a document this plugin is
holding, and what comes back is pixels or text computed from it: no connection,
no address, no credential. A workspace that only writes documents never calls
the other two and can weigh the grant on its own.

## How it is laid out

Three libraries are bundled in by `plugins/build.mjs`:

| | |
|---|---|
| **jsPDF** | Writes the file |
| **beautiful-mermaid** | Renders diagrams to SVG, without a DOM |
| **dejavu-fonts-ttf** | Two faces, embedded as base64 |

That puts the built plugin at roughly 4.1 MB, against a 5 MB ceiling — which
is why `i`/`em` share a face with regular text rather than getting an italic
one.

**`plugins/pdf/src/pdf.js` is the source; `plugins/pdf/pdf.js` is the build
product the server loads.** Editing the latter by hand is editing a bundle.
Run `npm run build:plugins` after changing the source.

## Why not a headless browser

Because there isn't one, and there deliberately never will be. A plugin runs
in a sandbox with no DOM, no network and no filesystem. The usual way to make
a PDF — render HTML in Chrome and print it — needs all three, plus a browser
installed on the server and kept patched.

The trade is real and worth stating plainly: you give up CSS and get a
document that is composed entirely from a string, by code an administrator can
read, with nothing installed and nothing leaving the box.
