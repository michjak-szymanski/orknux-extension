# `orknux.render`

What the server draws for a plugin, and why it has to be the server.

## Status, before anything else

| what | the server today |
|------|------------------|
| `RENDER_PNG` as a capability | **accepted** |
| `render.pngFromSvg(svg, width?)` | **accepted** — mirrored, shipped, in use |
| `render.pngFromPdf(base64, page?, width?)` | **proposed** — this document |

The first two are live and three plugins draw through them. The third is not,
and is not mirrored: `limits.ts` and `types/globals.d.ts` do not name it, so a
plugin calling it fails `check` here exactly as the upload would refuse it.
That is deliberate. A mirror that accepts what the server rejects is the one
direction this package may not be wrong in, and the cost of being wrong is a
plugin that passes every local check and cannot be installed.

When it lands, the mirror follows, and the plugin half is about thirty lines.

## Why the server draws

The sandbox has no rasteriser and cannot be given one. There is no DOM and no
canvas, no WebAssembly to carry a decoder in, and the source ceiling is 5 MB —
a PDF rasteriser is an order of magnitude past that before it does anything.

So drawing is a capability rather than a library, and `RENDER_PNG` already
says so. What crosses is bytes a plugin just produced and what comes back is
bytes computed from them: no connection, no address, no credential. It is the
narrowest thing on the capability list, and that argument does not change when
the input is a PDF rather than an SVG.

**No new capability.** `pngFromPdf` belongs under `RENDER_PNG` because it
reaches exactly what `pngFromSvg` reaches, which is nothing. A second grant
would make an administrator weigh a distinction that does not exist.

## The proposal

```ts
render: {
  pngFromSvg(svg: string, width?: number): OrknuxDrawnPng;

  /**
   * One page of a PDF, drawn as a picture.
   *
   * @param base64 the document, as `pdf_fromHtml` answers it
   * @param page   which page, 1-indexed. Out of range is an error, not page 1
   * @param width  the picture's width in pixels; the page's own proportions
   *               decide the height. Left out, the page is drawn at 96 dpi
   */
  pngFromPdf(base64: string, page?: number, width?: number): OrknuxDrawnPng;
}
```

`OrknuxDrawnPng` already exists and needs no change:

```ts
type OrknuxDrawnPng =
  | { base64: string; bytes: number; error?: undefined }
  | { error: string; base64?: undefined; bytes?: undefined };
```

### What it should refuse, and how

A refusal is data rather than a thrown error, the way every other door here
answers, so a plugin can say something useful about it:

| when | `error` should say |
|---|---|
| the base64 is not a PDF | that it is not a PDF, rather than a parser's own words |
| `page` is past the end | how many pages there are, so a caller can correct it |
| `page` is below 1 | pages are counted from one |
| the document is larger than the cap | the cap, in megabytes |
| `width` is past the cap | the cap, in pixels |

Naming the actual number in the last four matters more than it sounds: the
caller is usually a model, and "page 7 of 3" is a sentence it can act on where
"invalid page" is a sentence it guesses at.

### Bounds worth picking now

| | suggested | why |
|---|---|---|
| document size | 10 MB of decoded bytes | what `http.upload` already caps at, so one number to remember |
| width | 4096 px | past a screen, and the point where a picture stops being a check and starts being a file |
| pages per call | one | a caller wanting three asks three times, and each answer stays small enough to cross |

## What it is for

**Checking the page, which nothing can do today.** A plugin lays a document
out and answers how many pages it made; whether the diagram overflowed its
column, whether a heading landed alone at the foot of a page, whether a glyph
came out blank — nobody can see. A model that can look at page one can tell
the difference between a report and a mess, and can say so before sending it
to somebody.

It also closes a gap the `problems` field only half covers. `pdf_fromHtml`
reports what it knows went wrong — a diagram that refused, a character the
face cannot set. It cannot report what went wrong silently, and layout goes
wrong silently by nature.

## What the plugin half looks like

A function and a tool on the pdf plugin, taking the key rather than the bytes,
because the bytes are what does not survive being written back out:

```js
pdf_preview(contentKey, page, width) -> { png, bytes, key }
```

The document comes out of the session store, the page comes back as a picture
under its own key, and `slack_uploadBinary` takes that key like any other. The
plugin would declare `RENDER_PNG`, which it does not today — `pdf` is
currently the only diagram-adjacent plugin asking for no capability at all,
and this would change that. Worth saying out loud before it does.
