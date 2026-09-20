# nomnoml

The UML-shaped half of what people draw about software: classes with their
fields, actors and use cases, packages inside packages, state machines, and a
note pinned beside the thing it is about. Written in nomnoml's compact syntax,
laid out **here**, offline, in the sandbox, and answered as a picture.

The companion to the Mermaid plugin rather than its replacement. Mermaid draws
flowcharts and sequences; this draws the structural diagrams mermaid is awkward
at, and the two syntaxes barely overlap.

## One function, one tool

| Function | Answers |
|---|---|
| `render(source, theme, direction, format, width)` | A `Drawing`: the `png` as base64 **or** the `svg` as text, its `bytes`, the `width` and `height` it came out at, a short `key` the answer is kept under for the session, and an `editor` url that opens the diagram for hand-tweaking. |

```
nomnoml_render('[<actor>User] -> [<usecase>Load a plugin]\n[Server|check();grant()] o- [Plugin]')
  → { png: 'iVBORw0KGgo…', svg: '', bytes: 18402, width: 1200, height: 934,
      key: 'nomnoml.1fpehnu',
      editor: 'https://www.nomnoml.com/#view/…' }
```

**A picture is the default**, because a picture is what a person can see —
Slack draws no SVG at all, it hosts one as a file and shows a card. Ask for
`format: 'svg'` when you want the markup itself: to edit it, to put it in a
document, or to hand it somewhere that does draw it.

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

Both of those clauses are scars. A fourteen-node chain declares 4074 × 192;
under the old width cap it was drawn at 0.59× and arrived as a 132-pixel
sliver that Slack fitted to its column. A sixteen-node flowchart declares
300 × 1475; asked for 1200 wide it came back 5890 tall, and a server ceiling
shrank the whole thing back down.

**The size is written into the SVG as well as asked for.** Batik reads a
document's own `width` and `height` and fits the viewBox into them, so a root
carrying only a viewBox has no size at all and falls back to Batik's default
400 × 400 — which turns a request for 1200 into a 1200 × 400 canvas with the
drawing letterboxed in the middle of it. This plugin once stripped the
intrinsic size deliberately, on exactly the opposite theory, and that is the
picture that came back 178 pixels wide in an 800-pixel frame.

**And `transparent` is spelled `none` on the way out.** It is a CSS colour and
SVG 1.1 has no such keyword, so a strict renderer falls back to the property's
initial value — black for `fill`. nomnoml marks its background rect
`fill="transparent"`, and what came back was a solid black slab behind every
diagram: invisible on a dark chat theme, which is why it went unnoticed, and
obvious anywhere else.

The answer carries `width` and `height` **as drawn** — read off the file, not
echoed back from the request — so a ceiling that had an opinion is visible
rather than something you notice later in Slack. When they come back wildly
lopsided, the fix is to redraw the diagram in the other direction rather than
to ask for more pixels: no picture is legible in a chat column at 18:1.

For `svg` the two fields report what the markup declares for itself, since
nothing drew it.

## The syntax, in one table

| | |
|---|---|
| `[Node]` | A box |
| `[A] -> [B]` | An arrow. Also `->`, `<->`, `-->`, `-/-`, `+->`, `o->` |
| `[A] o- [B]` | Composition. `+-` is aggregation, `<:-` inheritance |
| `[Name\|field; method()]` | Compartments, separated by `;` |
| `[A] label -> [B]` | A label on the association |
| `[<package>orknux\|[a] -> [b]]` | **Nesting** — a diagram inside a box's second compartment |
| `#direction: right` | A directive; see below |

The shape of a box is a prefix: `<actor>`, `<usecase>`, `<state>`, `<package>`,
`<frame>`, `<database>`, `<note>`, `<choice>`, `<start>`, `<end>`, `<input>`,
`<sender>`, `<receiver>`, `<transceiver>`, `<table>`, `<hidden>`, `<label>`,
`<abstract>`, `<instance>`, `<reference>`, `<lollipop>`, `<pipe>`.

## Themes and direction

| `theme` | |
|---|---|
| `light` | nomnoml's own, and what leaving it out means |
| `dark` | For a dark channel or a dark page |
| `mono` | Black on white — for printing, and for a document that supplies its own colour |
| `blueprint` | Pale lines on deep blue |

`direction` is `down` (nomnoml's default) or `right`.

Both are applied by putting directives **in front of** your source, which means
**your own directives win.** Write `#direction: down` in the diagram and it
overrides the argument; write `#fill:` and it overrides the theme. That is the
right way round — the argument is the convenience, the source is the statement.

The full directive vocabulary is nomnoml's: `#fill`, `#stroke`, `#background`,
`#direction`, `#font`, `#fontSize`, `#lineWidth`, `#padding`, `#spacing`,
`#zoom`, `#ranker`, `#edges`, `#title`, and more. `#fill` takes a list —
one colour per nesting depth — which is why the dark themes name two.

## Passing the drawing on by key

The same arrangement the Mermaid plugin uses, and for the same reason: an SVG
that travels back through the model has to be retyped character for character
to reach the next tool call, and a few kilobytes of that does not survive the
trip.

```
nomnoml_render('[a] -> [b]')                     → { …, key: 'nomnoml.1fpehnu' }
slack_uploadBinary('C123', 'design.png', 'nomnoml.1fpehnu', 'the shape of it', '')

nomnoml_render('[a] -> [b]', '', '', 'svg')      → { …, key: 'nomnoml.w39dw' }
slack_upload('C123', 'design.svg', '', 'the shape of it', '', 'nomnoml.w39dw')
```

The key is content-derived, so rendering the same diagram twice lands on the
same key and simply overwrites itself. It comes back **empty** where there was
no session to keep it in — a workflow node, for instance — which is exactly
when the `svg` in the answer is the only copy there is.

## What it asks for, and why

**No permission at all.** The library never reaches for a builtin behind one —
it measures text from metrics it carries rather than through a DOM, lays the
graph out itself, and writes markup. It is arithmetic on a string. The Mermaid
plugin asks for `TEXT_ENCODING`; this asks for nothing.

**One capability: `RENDER_PNG`,** for the single thing this sandbox cannot do
for itself. Rasterising needs a rasteriser, and there is neither one here nor
the WebAssembly to bring one.

It is the narrowest thing on the capability list rather than the widest.
Nothing is fetched, at any time, from anywhere: markup this plugin has just
written goes out, and bytes computed from it come back. No connection, no
address, no credential. And `format: 'svg'` answers without asking the server
anything at all.

The SVG is self-contained too: no font `@import`, no remote reference. The
layout is as offline as it ever was — only the drawing of the picture is not.

## Why it fits where other renderers do not

The sandbox has no DOM, no canvas, no network and no WebAssembly, which rules
out nearly every diagramming library:

| | |
|---|---|
| mermaid itself | Measures text through a real DOM |
| D2 | Only implementation is Go → WASM, 59.7 MB |
| viz.js 3 (Graphviz) | WebAssembly |
| viz.js 2 (Graphviz) | asm.js, so it would run — but it is from 2019 |
| **nomnoml** | **Plain JS, synchronous, no DOM — 80 KB built** |

Two properties are load-bearing. It is **synchronous**, so `run` can return the
drawing rather than a promise nothing here can await. And it needs **no
document**, because it measures text from font metrics rather than by asking a
browser.

## How it is laid out

`nomnoml` is bundled in by `plugins/build.mjs`, which puts the built plugin at
roughly 80 KB — a twentieth of the Mermaid plugin, whose layout engine is
considerably heavier.

**`plugins/nomnoml/src/nomnoml.js` is the source; `plugins/nomnoml/nomnoml.js`
is the build product the server loads.** Editing the latter by hand is editing
a bundle. Run `npm run build:plugins` after changing the source.

nomnoml is MIT-licensed, by Daniel Kallin — <https://github.com/skanaar/nomnoml>.
