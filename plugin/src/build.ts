import { build as esbuild } from 'esbuild';

/**
 * Turning a plugin into the one file the server takes.
 *
 * The server has no compiler and no module resolution: what is uploaded is
 * evaluated as a single ES module, in a sandbox where an `import` resolves to
 * nothing. So everything a plugin uses has to be inlined, which is what `bundle`
 * means here — including this package, whose only runtime line reads the two
 * classes off the global object and therefore survives being inlined.
 *
 * Nothing is external, deliberately. An external import would be left in the
 * output as an import, and the first thing the sandbox did with it would be to
 * fail — long after the build said it had succeeded.
 */
export interface BundleOptions {
  /** The file holding the default export. */
  entry: string;

  /** Where the one file goes. `.js` or `.mjs`; the server takes nothing else. */
  outfile: string;

  /**
   * Off by default, and worth leaving off. The source is what an administrator
   * downloads from the server later, and a plugin is small enough that the only
   * thing minifying buys is a file nobody can read.
   */
  minify?: boolean;
}

export interface Bundled {
  outfile: string;
  bytes: number;
}

export async function bundle(options: BundleOptions): Promise<Bundled> {
  const result = await esbuild({
    entryPoints: [options.entry],
    outfile: options.outfile,
    bundle: true,
    format: 'esm',
    /*
     * Neutral, not node: a platform of `node` would let `node:fs` resolve and
     * hand the sandbox an import it cannot answer. This way the build fails on
     * the line that reached for it.
     */
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['import', 'default'],
    /* What GraalVM's JavaScript is configured for is ECMAScript 2023. */
    target: ['es2022'],
    /* Real characters rather than escapes; the upload is decoded as UTF-8. */
    charset: 'utf8',
    legalComments: 'none',
    /* A sourcemap cannot be uploaded, so a comment pointing at one is a dead end. */
    sourcemap: false,
    minify: options.minify === true,
    write: true,
    metafile: true,
    logLevel: 'silent',
  });

  const written = Object.entries(result.metafile.outputs)[0];

  return {
    outfile: options.outfile,
    bytes: written === undefined ? 0 : written[1].bytes,
  };
}
