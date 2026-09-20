/*
 * Builds the plugins that bundle npm libraries.
 *
 * A plugin that imports a package cannot be loaded as it stands — the sandbox
 * resolves no imports — so its source lives in `<name>/src/` and what is
 * checked in beside it, `<name>/<name>.js`, is the build: one flat file, every
 * dependency inlined, which is what the server takes and what the tests load.
 * Plugins with no npm imports have no `src/` and are not built; they stay
 * files somebody can edit in a hurry.
 *
 * The settings mirror `@orknux/plugin`'s own bundler (see plugin/src/build.ts)
 * with one addition: `fs` and `path` resolve to an empty stub, because a
 * library's Node-only convenience corner (nomnoml's CLI file loader) would
 * otherwise fail a build for code the sandbox never reaches. The stub keeps
 * the strictness honest — anything that actually *calls* into Node still
 * breaks, loudly, at run rather than shipping quietly broken.
 *
 * Run through the container, from the repository root:
 *
 *     docker compose run --rm dev npm run build --workspace @orknux/plugins
 */

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Every plugin that is a build, as entry → artifact.
 *
 * Minified, unlike the tooling's default: these bundles carry a rendering
 * engine and a PDF writer, and what an administrator would read is the
 * source in `src/`, not two megabytes of inlined library.
 */
const BUILT = [
  { entry: 'mermaid/src/mermaid.js', outfile: 'mermaid/mermaid.js' },
  { entry: 'nomnoml/src/nomnoml.js', outfile: 'nomnoml/nomnoml.js' },
  { entry: 'pdf/src/pdf.js', outfile: 'pdf/pdf.js' },
];

/*
 * What every bundle carries in front of its own first line.
 *
 * A plugin is read before it is granted anything - the server loads the module
 * to ask what it wants, and cannot grant in order to find out whether to grant
 * - so the module body runs with nothing switched on. A library that builds a
 * `new TextEncoder` at module scope therefore failed to load at all, and the
 * plugin could not be installed. See shim.mjs for why the answer belongs in
 * the bundle rather than in the sandbox.
 */
const SHIM = readFileSync(here + 'shim.mjs', 'utf8');

/*
 * The letters a bundled font is allowed to carry.
 *
 * DejaVuSans is 739 kB because it sets Cyrillic, Greek, Armenian, the
 * mathematical operators and a great deal else. A report sets none of them,
 * and jsPDF parses and writes the whole file into every document that asks
 * for the face - which was most of the ten seconds a PDF was taking in the
 * sandbox before it gave up.
 *
 * So the build keeps what the plugin will actually set. ASCII, Latin-1 and
 * Latin Extended-A is every language written in a Latin alphabet with
 * diacritics: Polish, Czech, Hungarian, Turkish, Romanian, the Nordics, the
 * Baltics. After them, the punctuation that prose written by a model actually
 * contains - the dashes it uses instead of hyphens, the quotes it curls, the
 * bullet, the ellipsis, the euro.
 *
 * What this gives up is real and is the point of writing it down: Cyrillic,
 * Greek, CJK and anything else outside that range will not set. A document
 * needing those needs a different face, which is a decision about what this
 * plugin promises rather than a bug in it.
 */
const SETTABLE = (() => {
  let letters = '';
  for (let point = 0x20; point <= 0x7e; point += 1) letters += String.fromCodePoint(point);
  for (let point = 0xa0; point <= 0xff; point += 1) letters += String.fromCodePoint(point);
  for (let point = 0x100; point <= 0x17f; point += 1) letters += String.fromCodePoint(point);
  return letters + '\u2010\u2011\u2012\u2013\u2014\u2015\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2192';
})();

/*
 * Subsetting happens here rather than in a file somebody has to regenerate:
 * nothing is written to disk, the bundle is the only artifact, and the same
 * input gives the same bytes - which the release workflow depends on, because
 * it rebuilds every plugin and refuses any difference.
 */
const subsetTtf = {
  name: 'subset-ttf',
  setup(builder) {
    builder.onLoad({ filter: /\.ttf$/ }, async (asked) => {
      const whole = await readFile(asked.path);
      const kept = await subsetFont(whole, SETTABLE, { targetFormat: 'truetype' });
      console.log(
        `  ${asked.path.split('/').pop()}  ${Math.round(whole.length / 1024)} KB -> ` +
          `${Math.round(kept.length / 1024)} KB`,
      );
      return { contents: kept, loader: 'base64' };
    });
  },
};

for (const job of BUILT) {
  const built = await build({
    entryPoints: [here + job.entry],
    outfile: here + job.outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    /*
     * `browser` beside the tooling's own pair: a library that publishes only
     * node and browser builds (jsPDF) should hand us the browser one — that
     * is the build that guards its window usage instead of importing node:fs.
     */
    conditions: ['import', 'browser', 'default'],
    alias: {
      fs: here + 'stub.mjs',
      path: here + 'stub.mjs',
      /*
       * jsPDF ships three optional features this plugin never calls: `.html()`
       * through html2canvas, `addSvgAsImage` through canvg, and the sanitizer
       * both lean on. They are imported at the top of jsPDF regardless, and
       * came to 314 kB of the bundle - an eighth of it, to support calls that
       * are not in this file.
       *
       * Resolved to the same nothing `fs` and `path` get. Anything that
       * actually reaches for a function on them still fails, at the call, with
       * its name in the error.
       */
      html2canvas: here + 'stub.mjs',
      canvg: here + 'stub.mjs',
      dompurify: here + 'stub.mjs',
    },
    /*
     * A font file crosses into the bundle as the base64 its plugin feeds
     * jsPDF - through `subsetTtf` above, which throws away the letters this
     * plugin will never set. The loader stays as the answer for anything the
     * plugin does not intercept.
     */
    loader: { '.ttf': 'base64' },
    plugins: [subsetTtf],
    target: ['es2022'],
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: false,
    minify: true,
    write: true,
    metafile: true,
    logLevel: 'warning',
    banner: { js: SHIM },
  });
  const out = Object.entries(built.metafile.outputs)[0];
  console.log(`${job.outfile}  ${out === undefined ? '?' : out[1].bytes} bytes`);
}
