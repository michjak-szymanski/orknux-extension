# Mermaid

Renders Mermaid diagram text to a picture **offline, inside the sandbox** — the
renderer and its layout engine ship as the plugin's own libraries, so a workflow
can turn `graph TD` into something a person can look at without a browser, a
network round trip, or anything installed on the server.

```
mermaid_render('graph TD\n  A[Request] --> B{Cached?}\n  B -->|yes| C[Serve]\n  B -->|no| D[Fetch]')
  → { png: 'iVBORw0KGgo…', svg: '', bytes: 24180, width: 1046, height: 1200,
      key: 'mermaid.2k9x1m' }
```

## Two functions

| Function | Answers |
|---|---|
| `render(source, theme, format, width)` | A `Drawing`: the `png` as base64 **or** the `svg` as text, its `bytes`, the `width` and `height` it came out at, and a short `key` the answer is kept under for the session. |
| `links(source, theme)` | A `Links`: an `image` url, an `svg` url, an `editor` url, and `markdown` ready to paste into a GitHub comment. |

**A picture is the default.** Slack draws no SVG at all — it hosts one as a file
and shows a card — and Slack is where most of these end up, so the format that
makes a diagram visible is the one that happens without being asked for. Ask for
`format: 'svg'` when you want the markup itself: to edit it, to put it in a
document, or to hand it to the PDF plugin, which draws it into the page as
vectors.

## What it draws, and what it refuses

Five kinds are rendered here: **flowchart/graph**, **sequenceDiagram**,
**stateDiagram-v2**, **classDiagram** and **erDiagram**.

Anything else — `pie`, `gantt`, `mindmap`, `journey` — is **refused by name**.
That is deliberate. A renderer that quietly draws something else when it does
not recognise a diagram produces a picture that is wrong rather than an error
that is right, and the wrong picture is the one that gets posted.

`links` handles every kind, including the refused ones, because the source
travels inside the url and the reader's browser does the drawing. The price is
that the reader's browser reaches mermaid.ink.

## How big it comes out

`width` in pixels, and the height follows the drawing's own proportions. Left
out, the plugin picks — and what it picks is a **scale**, not a width, because
a width says nothing about how large a diagram is when the other side is free
to be eighteen times longer.

Twice the size the diagram laid itself out at, since text in these is set at
about ten units and twenty pixels is where it stops being a guess. Then:

- a diagram smaller than 1200 on its long side is brought up to it, because a
  two-node picture has room to spare;
- the area is capped at four megapixels, which is the only cap that treats a
  tall drawing and a wide one the same way;
- and nothing is ever drawn **smaller** than it laid itself out, whatever that
  costs — below 1× the text is gone, and a big file the server refuses is a
  better answer than a small one nobody can read.

Both of those clauses are scars. A fourteen-node nomnoml chain declares
4074 × 192; under the old width cap it was drawn at 0.59× and arrived as a
132-pixel sliver that Slack fitted to its column. A sixteen-node flowchart
declares 300 × 1475; asked for 1200 wide it came back 5890 tall, and a server
ceiling shrank the whole thing back down.

The answer carries `width` and `height` **as drawn** — read off the file, not
echoed back from the request — so a ceiling that had an opinion is visible
rather than something you notice later in Slack. When they come back wildly
lopsided, the fix is to redraw the diagram in the other direction rather than
to ask for more pixels: no picture is legible in a chat column at 18:1.

For `svg` the two fields report what the markup declares for itself, since
nothing drew it.

## Themes

`theme` names a palette, left out for the light default:

    zinc-light, zinc-dark, tokyo-night, tokyo-night-storm, tokyo-night-light,
    catppuccin-mocha, catppuccin-latte, nord, nord-light, dracula,
    github-light, github-dark, solarized-light, solarized-dark, one-dark

`links` uses mermaid.ink's own set instead — `default`, `dark`, `forest`,
`neutral` — because the rendering happens there.

## Getting it in front of somebody

Pass the **key**, not the drawing:

```
mermaid_render(source)              → { png: '…', key: 'mermaid.2k9x1m', … }
slack_uploadBinary(channel, 'mermaid.2k9x1m', 'flow.png', 'The request path', threadTs)
```

The bytes stay on the server. Copying a picture out of one answer and pasting it
into the next call means thousands of characters that have to come back
perfect — and they do not. One that went to Slack arrived with a stray character
in the middle and the whole call was rejected as malformed JSON.

The key is content-derived, so rendering the same diagram twice lands on the
same key and overwrites itself rather than piling up.

The agents' tool answers the key **instead of** the drawing, for that reason.
Where there is no session to keep bytes in — a workflow node has none — the
drawing comes back instead, because then it is the only copy there is.

## What accepting this means

`TEXT_ENCODING` and `RENDER_PNG`. Nothing is fetched: the diagram is laid out
here, and the only thing that leaves the sandbox is the SVG this plugin just
produced, going to the server's rasteriser and coming back as pixels. No
connection, no address, no credential.

`links` is the exception worth knowing about, and it is the *reader's*
exception: the urls it builds are fetched by whoever opens them, not by this
plugin.
