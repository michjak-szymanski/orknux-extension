# PlantUML

The diagrams a model is most often asked for and mermaid is worst at: sequence
diagrams with activation bars and nested groups, class diagrams with real
cardinality, component, state, activity, deployment, ERDs, gantt charts,
mindmaps, wireframes, JSON trees.

**Drawn here.** The engine is bundled into the plugin and runs in the sandbox —
no server, no Java, no Graphviz binary, nothing fetched. A diagram does not
leave the machine.

| Function | |
|---|---|
| `render(source, format, width)` | The diagram as `png` or `svg`, the size it came out, and a key the bytes are kept under. |
| `check(source)` | Whether PlantUML can read it, and the line where it cannot. Reaches nothing. |
| `links(source)` | Urls that draw it on a PlantUML server, carrying the source inside them. Builds strings; sends nothing. |

## How a Java program renders in a sandbox

`@plantuml/core` is PlantUML compiled to JavaScript by TeaVM. Three things
stand between that and a sandbox with no page, no timers and no WebAssembly,
and each turned out to have an answer.

**It defers its work onto a timer.** `renderToString` returns immediately and
delivers through a callback; a plugin's `run` is synchronous with nothing to
await. But there is exactly one `setTimeout` in the engine, and it is TeaVM's
scheduler yielding to itself. So `src/dom.js` queues what gets scheduled and
turns the queue by hand after the call returns — an event loop, run inside one
synchronous call. A diagram takes one turn.

Running the callback *inline* instead does not work, and says so: re-entering
the scheduler from inside its own stack makes TeaVM refuse with `Can't enter
monitor from another thread synchronously`. That is also why this plugin
installs its own `setTimeout` over the one in `plugins/shim.mjs` — the shim
runs a timer inline, which is right for a layout engine that only ever yields,
and wrong for a scheduler.

**It measures text through a browser** — a canvas for the metrics, an SVG text
node's `getBBox` for the rest. `src/metrics.js` answers both from Helvetica's
advance widths, and the finished SVG is rewritten to ask for
`Helvetica, Arial, "Liberation Sans"` rather than the bare `sans-serif` the
engine writes. Those three carry identical metrics, so what was measured and
what a viewer draws are the same shapes. Measuring against one face and
drawing in another is how a label ends up outside its box.

**Its layout engine is Graphviz, shipped as WebAssembly.** True, and it does
not matter: the engine carries **Smetana**, PlantUML's own pure-Java port of
dot, and falls back to it when `viz-global.js` is absent — which it always is
here.

```
PlantUML: viz-global.js is not loaded, falling back to the Smetana layout engine
```

So class, component, state, activity, deployment and use case diagrams lay out
with no WebAssembly anywhere.

### How close it is to a real PlantUML

Drawing the same sequence diagram, this plugin and a PlantUML server land
within a few percent of each other — narrower, because the server's Java
default is usually DejaVu and this measures Helvetica:

| | server | here |
|---|---|---|
| `Alice -> Bob : Hello` / `Bob --> Alice : Hi` | 121 × 158 | 106 × 149 |
| `{"a": 1, "b": [2, 3]}` as `@startjson` | 99 × 53 | 96 × 43 |

What is not here: `!include <C4/C4_Context>` and the rest of the standard
library, and `!theme` definitions. Both are fetched over HTTP by the browser
build, there is no network in a sandbox, and a diagram using either still
draws — without them.

## What a refusal says

PlantUML does not reject a bad diagram. It **draws a picture of the error**,
with the source above it and the message below, which is no use to anything
trying to fix it. The plugin reads the two useful facts back out of that
picture — the marker `[From textarea (line 4)]` is the one thing only an error
image carries — and throws them:

```
Syntax Error? (Assumed diagram type: sequence) on line 4: nonsense !!! rubbish
```

`check` asks the same question as data rather than as a throw:

```json
{ "ok": false, "error": "Syntax Error? (Assumed diagram type: sequence)",
  "line": 4, "source": "nonsense !!! rubbish" }
```

## The shapes it exports

`Drawing`, `Checked`, `Links`. `render` answers the bytes **and** a short key
they are kept under for the session — and the tool a model sees answers only
the key, because a hundred kilobytes of base64 read back out into the next
tool call is a hundred kilobytes that has to come out perfect, and it does
not. `slack_uploadBinary` takes the key.

## Parameters

| Name | |
|---|---|
| `url` | A PlantUML server, used **only** to build the urls `links` returns. Optional; the public server is the default. Nothing is ever sent to it — drawing happens in the sandbox. |

## What it asks for, and why

`RENDER_PNG`, and only that. The diagram — engine, layout, text metrics, SVG —
is built in the plugin; turning finished markup into pixels needs a rasteriser,
and this sandbox has neither one nor the WebAssembly to bring one. It is the
same grant the mermaid plugin makes for the same reason, and the narrowest
there is: what crosses is markup the plugin just produced, and what comes back
is bytes computed from it. `svg` needs nothing at all.

**No permission.** The engine expects a browser and the bundle brings one —
the document, the serialiser and the canvas are `src/dom.js`, and the console
it chatters into comes from the shim every bundle here carries. Bringing its
own is the honest way to load without a permission, rather than having the
boundary quietly moved.

## It is a build

The source is `src/`, the checked-in `plantuml.js` beside it is the artifact,
and `npm run build:plugins` produces it. Unlike every other bundle here it is
minified for **whitespace only**: TeaVM emits labelled blocks with `continue`
and `break` jumping to them — the shape JVM bytecode has, written as
JavaScript — and esbuild's syntax and identifier passes rewrite those into
something that no longer parses (`SyntaxError: Undefined label 'l'`, at load,
before anything runs). That costs about two hundred kilobytes against a five
megabyte ceiling and buys a bundle that loads.

## A caveat worth knowing before you debug it

**Smetana is not dot.** It is PlantUML's own port and it is good, but a large
graph comes out less tidily than real Graphviz would manage — ten nodes look
the same, a hundred do not. Where a sprawling class diagram matters more than
where it is drawn, `links` gives you the same source on a server that has the
real thing.
