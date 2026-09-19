/*
 * Writes the brand icons, from the marks their owners publish.
 *
 * Eight of the plugins front something with a mark, and a listing for one
 * should show that mark rather than a drawing of something like it. They come
 * from two collections, because no single one carries them all.
 *
 * [simple-icons] is CC0 — the collection is public domain, each trademark
 * stays its owner's, and using one here is the use trademark law has always
 * allowed: saying what a plugin works with.
 *
 * [Font Awesome Free] is **CC BY 4.0**, which is why `ATTRIBUTION` exists and
 * why every file written from it carries the licence in a comment. It is here
 * for the two marks simple-icons will not carry: Slack asked for theirs to be
 * removed, and Microsoft's went the same way. Font Awesome publishes its own
 * monochrome renderings of both under a licence that permits redistributing
 * them — so these are *Font Awesome's glyphs of* those marks rather than
 * assets from Slack's or Microsoft's own brand portals, and the difference is
 * worth stating. Anyone wanting the vendors' exact artwork should take it from
 * those portals under those companies' terms and drop it in over the file; the
 * manifest already points at `icon.svg` and nothing else would change.
 *
 * `teams` wears the Microsoft mark, because Font Awesome has no Teams-specific
 * glyph. Less precise than the others, and still a good deal closer than the
 * drawing it replaces.
 *
 * `pdf`, `todo`, `date` and `web` front no service and have no mark to use.
 * `markdown` is the odd one among the branded: its mark is not a trademark
 * anybody holds — Dustin Curtis put it in the public domain — so it is here
 * for the plainer reason that it is the mark the thing already has.
 *
 * Everything is drawn in `currentColor`, so one file suits a light listing and
 * a dark one — half these marks are near-black and would vanish on a dark
 * page. Both collections publish monochrome single-path glyphs, so this is
 * using them as published rather than recolouring a full-colour mark. A fill
 * attribute also survives the sanitizing a marketplace does to uploaded
 * markup, where a `<style>` block carrying a media query might not.
 *
 *     docker compose run --rm dev npm run build:icons --workspace @orknux/plugins
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as simple from 'simple-icons';
import * as brands from '@fortawesome/free-brands-svg-icons';

const here = fileURLToPath(new URL('.', import.meta.url));

/** What CC BY 4.0 asks in return, carried in every file it applies to. */
const ATTRIBUTION = 'Font Awesome Free (https://fontawesome.com) — icons licensed CC BY 4.0.';

/** Which plugin wears which mark, and out of which collection. */
const BRANDED = [
  { plugin: 'github', from: 'simple', icon: 'siGithub' },
  { plugin: 'confluence', from: 'simple', icon: 'siConfluence' },
  { plugin: 'jira', from: 'simple', icon: 'siJira' },
  { plugin: 'prometheus', from: 'simple', icon: 'siPrometheus' },
  { plugin: 'mermaid', from: 'simple', icon: 'siMermaid' },
  { plugin: 'markdown', from: 'simple', icon: 'siMarkdown' },
  { plugin: 'slack', from: 'brands', icon: 'faSlack' },
  { plugin: 'teams', from: 'brands', icon: 'faMicrosoft' },
];

/** The names a collection's own spelling does not capitalise for us. */
const TITLES = { slack: 'Slack', microsoft: 'Microsoft' };

/** One mark, however its collection spells one: a title, a viewBox, a path. */
function markOf({ from, icon }) {
  if (from === 'simple') {
    const found = simple[icon];
    if (found === undefined) {
      throw new Error(`simple-icons no longer publishes ${icon} — see the note above`);
    }
    return { title: found.title, viewBox: '0 0 24 24', path: found.path, source: found.source, notice: null };
  }

  const found = brands[icon];
  if (found === undefined) {
    throw new Error(`Font Awesome no longer publishes ${icon} — see the note above`);
  }
  /* Font Awesome packs an icon as [width, height, ligatures, unicode, path]. */
  const [width, height, , , path] = found.icon;
  return {
    title: TITLES[found.iconName] ?? found.iconName,
    viewBox: `0 0 ${width} ${height}`,
    path: Array.isArray(path) ? path[0] : path,
    source: `https://fontawesome.com/icons/${found.iconName}?f=brands`,
    notice: ATTRIBUTION,
  };
}

for (const entry of BRANDED) {
  const mark = markOf(entry);
  const licence = mark.notice === null ? '' : `\n  ${mark.notice}`;

  const svg = `<!--
  The ${mark.title} mark: ${mark.source}
  The trademark remains ${mark.title}'s own, shown here to say what this
  plugin works with.${licence}
  Regenerate with plugins/icons.mjs; do not hand-edit.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}" width="24" height="24" fill="currentColor" role="img">
  <title>${mark.title}</title>
  <path d="${mark.path}"/>
</svg>
`;
  writeFileSync(`${here}${entry.plugin}/icon.svg`, svg);
  console.log(`${entry.plugin}/icon.svg  ${mark.title.padEnd(11)} ${String(svg.length).padStart(5)} bytes  (${entry.from})`);
}
