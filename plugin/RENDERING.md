# `orknux.render`

What the server draws for a plugin, and why it has to be the server.

## Status

| what | the server today |
|------|------------------|
| `RENDER_PNG` | **accepted** — `pngFromSvg`, mirrored, three plugins draw through it |
| `RENDER_PDF` | **accepted** — `pngFromPdf`, mirrored |
| a plugin using `pngFromPdf` | **written** — `pdf_preview`, the last section |

Both capabilities are live and both are in `limits.ts` and
`types/globals.d.ts`, so a plugin declaring either passes `check` here exactly
as the upload accepts it.

## Why the server draws

The sandbox has no rasteriser and cannot be given one. There is no DOM and no
canvas, no WebAssembly to carry a decoder in, and the source ceiling is 5 MB —
a PDF rasteriser is an order of magnitude past that before it does anything.

So drawing is a capability rather than a library. What crosses is bytes a
plugin just produced and what comes back is bytes computed from them: no
connection, no address, no credential.

## Two grants, not one

This document proposed `pngFromPdf` under `RENDER_PNG`, on the grounds that it
reaches exactly what `pngFromSvg` reaches, which is nothing. That argument was
answered, and the answer is better:

> Its own grant rather than `RENDER_PNG`: the reach is the same, which is
> nothing, but the parser is not — a PDF carries an embedded-file model, an
> encryption model and a font stack, and an operator may reasonably draw
> markup without handing documents to one.

Reach is not the only thing a grant is about. An SVG rasteriser and a PDF
rasteriser have the same blast radius and very different attack surfaces, and
an administrator who accepts the first has not thereby accepted the second.
The recorded reasoning is worth keeping because the mistake is easy to repeat:
*it reaches nothing* answers the question of what a capability can get at, and
says nothing about what it can be handed.

## What is there

```ts
render: {
  /** The SVG drawn as a PNG — `RENDER_PNG`. */
  pngFromSvg(svg: string, width?: number): OrknuxDrawnPng;

  /** One page of a PDF, drawn as a PNG — `RENDER_PDF`. */
  pngFromPdf(pdf: string, page?: number, width?: number): OrknuxDrawnPdfPage;
}
```

`pdf` is the document as base64, which is the shape a plugin that made one
already holds it in. `page` counts from one and defaults to the first; a page
past the end is refused by name rather than rounded into the first. `width` is
the picture's width in pixels, left out for 96 dpi.

```ts
type OrknuxDrawnPdfPage =
  | { base64: string; bytes: number; width: number; height: number; pages: number; error?: undefined }
  | { error: string; base64?: undefined; /* …and the rest undefined */ };
```

The three fields beyond the picture are the reason this is worth having over a
bare image. `pages` is the **document's** page count rather than this page's
number, so one call establishes both that the page exists and how many more
there are — a caller checking a document does not have to probe for the end.
`width` and `height` are the drawn picture's, which is what tells you whether
a page came out portrait when it should not have.

A refusal is data rather than a throw, the way every door here answers, and
outside the sandbox the fallback says so in a sentence:

    there is no renderer here: only a call made inside the sandbox can draw one

## What it is for

Looking at what was actually produced, which nothing could do before.

`pdf_fromHtml` reports what it *knows* went wrong — a diagram that refused, a
character the bundled face cannot set — in its `problems` field. It cannot
report what went wrong silently, and layout goes wrong silently by nature: a
heading stranded at the foot of a page, a diagram crowding its column, a table
that ran off the side. The contract puts it plainly:

> a model that can see reads pictures, so without this an agent reports that
> the report is ready because that is what it did, rather than because that is
> what came out.

## The plugin half

A function and a tool on the pdf plugin, and the split is the one three slack
calls already use:

```
function (workflows)  pdf_preview(base64, page, width)      -> Preview
tool     (agents)     pdf_preview(contentKey, page, width)  -> Preview
```

The **tool takes a key and has nowhere to put bytes**. A model always has one —
`pdf_fromHtml` answers a key beside the document — and a few hundred thousand
characters of base64 typed into a tool call arrives a character wrong and is
rejected before anything runs. The **function keeps taking base64**, because a
workflow node has no session and so never had a key, and refusing there would
close its only door.

**What it answers is not stripped**, and that is where this parts company with
every other tool here. The renderers and `fromHtml` answer a model a key and
keep the bytes, because nobody reads base64 and retyping it is what fails. A
preview is the exception: the picture *is* the answer, and a preview whose
picture you cannot see is not one. The key comes back too, so
`slack_uploadBinary` can show somebody the page.

`Preview` carries `pages` as the **document's** count rather than this page's
number, so one call says both that the page exists and how many more there are.

And the consequence that was flagged before it happened, now happened: `pdf`
asked for **no capability at all** and asks for `RENDER_PDF`. That is a real
change to what an administrator accepts, and it is why `preview` is a separate
call rather than something `fromHtml` does on the way out - a workspace that
only writes documents never draws one and can weigh the grant on its own.
