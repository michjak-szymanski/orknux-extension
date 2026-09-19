# PDF

Composes PDF documents from a workflow: text, headings, tables — and a
Mermaid diagram drawn straight into the page, rendered by the same offline
pipeline the Mermaid plugin ships. The document comes back as base64 for a
downstream node to store or send.

Everything runs inside the sandbox; the PDF library ships as the plugin's own
bundled libraries, so nothing is installed on the server and nothing leaves
it.

## One function, one tool

| Function | Answers |
|---|---|
| `fromHtml(html, title = "")` | A `Document`: the file as `base64`, plus its `pages` and `bytes`. `title` is the document's title metadata. |

There are no parameters to configure. Nothing to point at, no credential, no
capability — see *What it asks for* below.

```
pdf_fromHtml('<h1>Q3 review</h1><p>Revenue was up 4%.</p>')
  → { base64: 'JVBERi0xLjMK…', pages: 1, bytes: 2841 }
```

Hand the `base64` to `slack_uploadBinary` with a `.pdf` filename, or to the
http door's `upload`. That is the whole handoff — the PDF never becomes a file
on disk anywhere.

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

**No capabilities at all.** The writer, the renderer and the fonts are all
inside the file. This plugin makes no network request, holds no credential,
and reaches nothing — it is arithmetic on a string that happens to produce a
PDF. It is the one plugin here that an administrator can accept without
thinking about what it can see.

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
