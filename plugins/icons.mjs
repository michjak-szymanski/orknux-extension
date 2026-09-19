/*
 * Writes the brand icons, from the marks their owners publish.
 *
 * Four of the plugins front a named service, and a listing for one should show
 * that service's own mark rather than a drawing of something like it. Those
 * come from [simple-icons], which is CC0 — the collection is public domain, and
 * each trademark stays its owner's. Using one here is the use trademark law
 * has always allowed: saying which service this plugin talks to.
 *
 * Two are deliberately absent. Slack's mark and Microsoft's were **removed
 * from simple-icons at the brand owners' request**, which is those owners
 * saying plainly that they do not want their marks redistributed this way — so
 * `plugins/slack/icon.svg` and `plugins/teams/icon.svg` are drawn glyphs
 * instead, and stay that way unless somebody takes the assets from Slack's own
 * media kit or Microsoft's brand centre under those companies' terms. `pdf`
 * and `todo` front no service and never had a mark to use.
 *
 * Drawn in `currentColor` rather than in the brand's own hex. Two reasons, and
 * the second is the one that decides it: half these marks are near-black
 * (GitHub #181717, Confluence #172B4D) and vanish on a dark listing; and a
 * fill attribute survives the sanitizing a marketplace does to somebody else's
 * uploaded markup, where a `<style>` block carrying a media query might not.
 * The silhouette is what makes a mark recognisable at 20px anyway.
 *
 *     docker compose run --rm dev npm run build:icons --workspace @orknux/plugins
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as icons from 'simple-icons';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Which plugin wears which mark, by simple-icons' own export name. */
const BRANDED = [
  { plugin: 'github', icon: 'siGithub' },
  { plugin: 'confluence', icon: 'siConfluence' },
  { plugin: 'prometheus', icon: 'siPrometheus' },
  { plugin: 'mermaid', icon: 'siMermaid' },
  /*
   * The odd one out: the markdown mark is not a trademark anybody holds —
   * Dustin Curtis put it in the public domain — so it is here for the plainer
   * reason that it is the mark the thing already has.
   */
  { plugin: 'markdown', icon: 'siMarkdown' },
];

for (const { plugin, icon } of BRANDED) {
  const mark = icons[icon];
  if (mark === undefined) {
    throw new Error(`simple-icons no longer publishes ${icon} — see the note above before replacing it`);
  }

  const svg = `<!--
  The ${mark.title} mark, from simple-icons (CC0-1.0): ${mark.source}
  The trademark remains ${mark.title}'s own, shown here to say what this
  plugin works with. Regenerate with plugins/icons.mjs; do not hand-edit.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" role="img">
  <title>${mark.title}</title>
  <path d="${mark.path}"/>
</svg>
`;
  writeFileSync(`${here}${plugin}/icon.svg`, svg);
  console.log(`${plugin}/icon.svg  ${mark.title}  ${svg.length} bytes`);
}
