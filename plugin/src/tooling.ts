/**
 * What builds a plugin and what checks one, for anything that is not a plugin.
 *
 * Its own entry point because it runs on Node — esbuild, the filesystem, a
 * dynamic import — and none of that may end up inside a bundle destined for the
 * sandbox. A plugin imports `@orknux/plugin`; a build script, a test or the CLI
 * imports this.
 */
export { bundle } from './build.js';
export type { Bundled, BundleOptions } from './build.js';

export { inspect, NotAPluginError } from './inspect.js';
export type { Inspection } from './inspect.js';
