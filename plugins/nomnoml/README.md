# nomnoml

The UML-shaped half of what people draw about software: classes with their
fields, actors and use cases, packages inside packages, state machines, and a
note pinned beside the thing it is about. Written in nomnoml's compact syntax,
rendered to SVG **here**, offline, in the sandbox.

The companion to the Mermaid plugin rather than its replacement. Mermaid draws
flowcharts and sequences; this draws the structural diagrams mermaid is awkward
at, and the two syntaxes barely overlap.

## One function, one tool

| Function | Answers |
|---|---|
| `render(source, theme, direction)` | A `Drawing`: the `svg`, its `bytes`, a short `key` the drawing is kept under for the session, and an `editor` url that opens it for hand-tweaking. |

```
nomnoml_render('[<actor>User] -> [<usecase>Load a plugin]\n[Server|check();grant()] o- [Plugin]')
  → { svg: '<svg …>', bytes: 3825, key: 'nomnoml.1fpehnu',
      editor: 'https://www.nomnoml.com/#view/…' }
```

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
nomnoml_render('[a] -> [b]')          → { …, key: 'nomnoml.1fpehnu' }
slack_upload('C123', 'design.svg', '', 'the shape of it', '', 'nomnoml.1fpehnu')
```

The key is content-derived, so rendering the same diagram twice lands on the
same key and simply overwrites itself. It comes back **empty** where there was
no session to keep it in — a workflow node, for instance — which is exactly
when the `svg` in the answer is the only copy there is.

**Slack draws no SVG.** It hosts one as a file and shows a card, not a picture.
That is a Slack limitation rather than this plugin's; see below.

## What it asks for, and why

**Nothing.** No capability, because nothing is fetched at any time from
anywhere. No permission, because the library never reaches for a builtin behind
one — it measures text from metrics it carries rather than through a DOM, lays
the graph out itself, and writes markup. It is arithmetic on a string.

That makes it, alongside confluence and todo, one of the few plugins here an
administrator can accept without weighing what it can reach — and the only
diagramming one. The Mermaid plugin asks for `TEXT_ENCODING`; this asks for
nothing at all.

The SVG is self-contained too: no font `@import`, no remote reference. The
drawing is as offline as the drawing of it was.

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

## Why there is no png

This sandbox cannot draw one, and the plugin will not pretend otherwise:
rasterising SVG needs a rasteriser, and there is neither one here nor the
WebAssembly to bring one.

The Mermaid plugin answers PNGs through a server-side capability. When that
capability is part of this package's contract, the same few lines belong here —
and then Slack gets a picture in the message rather than a file card.

## How it is laid out

`nomnoml` is bundled in by `plugins/build.mjs`, which puts the built plugin at
roughly 80 KB — a twentieth of the Mermaid plugin, whose layout engine is
considerably heavier.

**`plugins/nomnoml/src/nomnoml.js` is the source; `plugins/nomnoml/nomnoml.js`
is the build product the server loads.** Editing the latter by hand is editing
a bundle. Run `npm run build:plugins` after changing the source.

nomnoml is MIT-licensed, by Daniel Kallin — <https://github.com/skanaar/nomnoml>.
