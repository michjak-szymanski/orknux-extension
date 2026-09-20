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
| `render(source, theme, direction, format, width)` | A `Drawing`: the `png` as base64 **or** the `svg` as text, its `bytes`, a short `key` the answer is kept under for the session, and an `editor` url that opens the diagram for hand-tweaking. |

```
nomnoml_render('[<actor>User] -> [<usecase>Load a plugin]\n[Server|check();grant()] o- [Plugin]')
  → { png: 'iVBORw0KGgo…', svg: '', bytes: 18402, key: 'nomnoml.1fpehnu',
      editor: 'https://www.nomnoml.com/#view/…' }
```

**A picture is the default**, because a picture is what a person can see —
Slack draws no SVG at all, it hosts one as a file and shows a card. Ask for
`format: 'svg'` when you want the markup itself: to edit it, to put it in a
document, or to hand it somewhere that does draw it.

`width` sets the picture's width in pixels and lets the height follow the
drawing's own proportions; left out, the size the diagram declares is the size
that is drawn. It means nothing for `svg`.

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
