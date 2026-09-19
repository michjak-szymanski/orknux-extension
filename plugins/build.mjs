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
import { fileURLToPath } from 'node:url';

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
  { entry: 'pdf/src/pdf.js', outfile: 'pdf/pdf.js' },
];

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
    },
    /* A font file crosses into the bundle as the base64 its plugin feeds jsPDF. */
    loader: { '.ttf': 'base64' },
    target: ['es2022'],
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: false,
    minify: true,
    write: true,
    metafile: true,
    logLevel: 'warning',
  });
  const out = Object.entries(built.metafile.outputs)[0];
  console.log(`${job.outfile}  ${out === undefined ? '?' : out[1].bytes} bytes`);
}
