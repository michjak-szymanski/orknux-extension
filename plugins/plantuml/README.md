# PlantUML

The diagrams a model is most often asked for and mermaid is worst at:
sequence diagrams with activation bars and nested groups, class diagrams with
real cardinality, component, state, activity, deployment, ERDs, gantt charts,
mindmaps, wireframes, JSON trees — out of text a model already writes well.

Every request is made by the server on the plugin's behalf under
`NETWORK_REQUEST`, against the PlantUML server the workspace named.

| Function | |
|---|---|
| `render(source, format)` | The diagram as `png` or `svg`, its size as **the server measured it**, and a key the bytes are kept under. |
| `ascii(source)` | The same diagram in box-drawing characters — a diagram a model can actually read. |
| `check(source)` | Whether it parses, and the line where it does not. Answered as data, not thrown. |
| `links(source)` | Five urls carrying the source inside them. Reaches nothing. |

All four are fronted to agents, with the skill that says which mistake costs
what.

## Why this calls a server, when the mermaid plugin calls nobody

PlantUML now ships a pure-JavaScript build — `@plantuml/core`, compiled with
TeaVM — and the obvious question is why it is not bundled here the way mermaid
and nomnoml are. It was tried. Three things stop it, and the first is fatal:

1. **It is asynchronous.** `renderToString(lines, onSuccess, onError)` returns
   immediately and delivers through a callback scheduled on a timer. A
   plugin's `run` is synchronous — there is nothing to await, and no event
   loop for it to be pumped by — so the answer arrives after the only moment
   it could have been returned in.
2. **It measures text through a real DOM.** Layout asks an SVG text node for
   `getBBox()`, eighteen times for a two-line sequence diagram, and then wants
   an XML document to serialise through. Stubs get a little further each time
   and then ask for the next piece of a browser.
3. **Layout is Graphviz, shipped as WebAssembly.** The sandbox has none — so
   class, component, state, activity, deployment and use case diagrams could
   not be laid out even if the two above were solved.

It is also 3.9 MB before a DOM, against a 5 MB source ceiling. A PlantUML
server has a JVM, Graphviz and fonts, and is what one is for.

## The encoding, and why there is no compression in it

A PlantUML url carries the diagram inside it: the path is the source,
deflated, then written in PlantUML's own base64 alphabet — which is the same
sixty-four characters in a different order, so the standard one does not
substitute.

The sandbox has no compressor. What this builds is a deflate stream of
**stored** blocks: the header bit that says this is the last block, a length,
its complement, and then the bytes as they are. It is a valid deflate stream
that happens to compress nothing, PlantUML's decoder inflates it like any
other, and it costs four characters per three bytes — against the two
characters per byte that PlantUML's `~h` hex form would cost.

`~1` is *not* this, despite what the older documentation suggests: a current
server reads that prefix as Huffman and answers "This URL does not look like
HUFFMAN data". The prefix-less form is deflate, and that is what this builds.

That encoding is also the one real limit here. A url has a length cap — a
stock Tomcat at eight kilobytes — so a source past roughly five thousand
characters is refused by name, with the numbers in the sentence, rather than
sent to be truncated into a syntax error somewhere in the middle.

## What a refusal says

PlantUML answers a syntax error with HTTP 400 and **a picture of the error**,
which is no use to anything trying to fix the source. What is useful is in the
headers, and this reads them:

```
Syntax Error? (Assumed diagram type: sequence) on line 4: nonsense !!! rubbish
```

`check` asks the same question without throwing, which is what a workflow
condition wants:

```json
{ "ok": false, "error": "Syntax Error? (Assumed diagram type: sequence)",
  "line": 4, "source": "nonsense !!! rubbish", "type": null }
```

The same headers carry the diagram's measured width and height and PlantUML's
own description of it — `(2 participants)`, `(5 entities)` — so nothing here
has to guess at the size of a picture it cannot see.

## `ascii` is the one worth knowing about

`plantuml_ascii` draws the diagram in box-drawing characters. A model cannot
look at a PNG; it can read this.

```
┌───┐                ┌───┐
│Ada│                │Bob│
└─┬─┘                └─┬─┘
  │ Zażółć gęślą jaźń  │
  │───────────────────>│
  │      ✓ done        │
  │< ─ ─ ─ ─ ─ ─ ─ ─ ─ │
```

One call before sending a picture to somebody finds the two things that are
invisible in a PNG and obvious here: participants that came out in the wrong
order, and a message meant as a reply drawn as a call.

## The shapes it exports

`Drawing`, `Ascii`, `Checked`, `Links`. `render` answers the bytes **and** a
short key they are kept under for the session — and the tool a model sees
answers only the key, because a hundred kilobytes of base64 read back out into
the next tool call is a hundred kilobytes that has to come out perfect, and it
does not. `slack_uploadBinary` takes the key.

## Parameters

| Name | |
|---|---|
| `url` | A PlantUML server. **Required**, with no default: `https://www.plantuml.com/plantuml` renders anything, and whose server sees the diagram text is not a decision this plugin should make quietly. A self-hosted one is a container. |

## What it asks for, and why

`NETWORK_REQUEST`, and nothing else — every request goes to the `url` above.

**No permission at all.** The encoding is arithmetic: base64 in a different
order over a deflate stream that compresses nothing. The one part that needs
the server is turning the source into its own UTF-8 bytes, and
`orknux.encoding` does that ungranted — which is what keeps a diagram labelled
in Polish or Japanese encoding to the bytes the other end will decode.

## A caveat worth knowing before you debug it

**The server sees the source.** That is the whole arrangement, and it is worth
a thought before drawing anything that names internal systems on a public
renderer. A PlantUML server is a stateless container with no database; running
one is the answer, and then this plugin is entirely inside the network.
