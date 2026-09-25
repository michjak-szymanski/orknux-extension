# Charts

Draws a chart from numbers a workflow already has — bar, column, line, area,
pie and donut — **offline, inside the sandbox**. Nothing is bundled and
nothing is fetched: a chart is arithmetic on a list of numbers written out as
SVG, and the server's rasteriser turns that into the picture Slack can show.

```
charts_render('{"type":"column","title":"Revenue by quarter","unit":"$",
                "labels":["Q1","Q2","Q3","Q4"],
                "series":[{"name":"Product","values":[412,468,455,521]},
                          {"name":"Services","values":[120,131,149,158]}]}')
  → { png: 'iVBORw0KGgo…', svg: '', bytes: 31204, width: 1200, height: 720,
      key: 'charts.2k9x1m' }
```

## One function

| Function | Answers |
|---|---|
| `render(spec, theme, format, width)` | A `Chart`: the `png` as base64 **or** the `svg` as text, its `bytes`, the `width` and `height` it came out at, and a short `key` the answer is kept under for the session. |

`theme` is `light` (the default) or `dark`. `format` is `png` unless you ask
for `svg`, because Slack draws no SVG and Slack is where most of these end up.
`width` is the picture's width in pixels, 1200 when left out; the height
follows, at five to three.

## The spec

JSON, as the first argument:

```json
{
  "type": "column",
  "title": "Revenue by quarter",
  "subtitle": "2026, in thousands",
  "unit": "$",
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "series": [
    { "name": "Product",  "values": [412, 468, 455, 521] },
    { "name": "Services", "values": [120, 131, 149, 158] }
  ],
  "stacked": false
}
```

| | |
|---|---|
| `type` | `bar`, `column`, `line`, `area`, `pie` or `donut` |
| `labels` | The categories along the axis, or the slices of a pie |
| `series` | One entry per colour, each with a `name` and one value per label. `null` is a gap. A single series may be written as `"values": [...]` at the top level instead. |
| `unit` | Written on every number — a currency sign before it, `%` or a word after it |
| `stacked` | Stacks the series of a bar, column or area chart |
| `title`, `subtitle` | Set above the plot; the subtitle in secondary ink |

## Which chart

| The question | `type` |
|---|---|
| How do these categories compare? | `column` for a few with short names, `bar` for many or long ones |
| How did it change over time? | `line`, or `area` for one series where the amount matters |
| How does the whole break down? | `donut` — the total sits in the hole — or `pie`; eight slices at most |
| How do the parts of each category add up? | `column` or `bar` with `"stacked": true` |

**One axis, always.** Two measures on different scales are two charts. A
second y-axis is the commonest way a chart lies, and this plugin has no way
to draw one.

## What it refuses, and why

Refused with a sentence rather than drawn wrong:

- **A ninth series.** Eight hues, in a fixed order chosen so that neighbours
  stay apart under every kind of colour-blindness, is as many as a reader can
  tell apart. Fold the small ones into "Other" or draw two charts.
- A type it has not got, a series with more values than there are labels, a
  value that is not a number.
- A negative in a pie or a stack, which has no shape.
- A pie given two series: a pie is one whole.

## How it is drawn

The rules a chart is read by are not options, so they are fixed:

- Bars are thin — 24 pixels at most — rounded at the data end and square at
  the baseline, with a two-pixel gap of surface between neighbours and between
  the segments of a stack. No stroke drawn around a mark: the surface does the
  separating.
- Lines are two pixels with round joins; every point wears a marker eight
  across with a ring of surface colour, so it stays legible where lines cross.
  An area is its hue at a tenth of its strength, never a solid block.
- Text wears ink, never the series colour. A swatch beside the name carries
  identity.
- A legend whenever there are two series or more, none for one — the title
  already names it. Values are labelled selectively: the end of each line, the
  cap of each bar when there is one series and a dozen bars or fewer. A number
  on every point is chaos that goes unread.
- The grid is a hairline one step off the surface; the baseline is the only
  darker line. Ticks are clean numbers with thousands separated.

Text is measured by a rule of thumb — about 0.55 em a character — because
there is no font in the sandbox to measure with. A label a hair off its slot
beats a chart that will not draw.

## Getting it in front of somebody

Pass the **key**, not the drawing:

```
charts_render(spec)                 → { png: '…', key: 'charts.2k9x1m', … }
slack_uploadBinary(channel, 'revenue.png', 'charts.2k9x1m', 'Revenue by quarter', threadTs)
```

The bytes stay on the server. The agents' tool answers the key **instead of**
the drawing, for that reason; where there is no session to keep bytes in — a
workflow node has none — the drawing comes back instead.

## What accepting this means

`RENDER_PNG`, and no permission at all. The chart is laid out here, and the
only thing that leaves the sandbox is the SVG this plugin just produced, going
to the server's rasteriser and coming back as pixels. No connection, no
address, no credential. `format: svg` asks the server for nothing.
