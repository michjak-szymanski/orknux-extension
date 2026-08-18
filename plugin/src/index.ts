/**
 * Writing a plugin for orknux-server.
 *
 * Everything exported here is safe to import from a plugin: the two classes are
 * bindings to what the sandbox already defines, and the rest is types, constants
 * and pure functions. Nothing reaches for a file, a network or a Node built-in,
 * because a plugin that imported one would bundle it and the sandbox would refuse
 * the result.
 *
 * The tooling — bundling a plugin, and loading a built one to check it — is
 * `@orknux/plugin/tooling`, and is deliberately not here.
 */
export { OrknuxFunction, OrknuxPlugin } from './contract.js';
export type { OrknuxFunctionConstructor, OrknuxPluginBase } from './contract.js';

export { definePlugin, fn } from './define.js';
export type { OrknuxPluginSpec } from './define.js';

export {
  API_VERSION,
  IDENTIFIER,
  MAX_FUNCTIONS,
  MAX_SOURCE_BYTES,
  PLUGIN_ID,
  SUPPORTED_API_VERSIONS,
  VALUE_TYPES,
} from './limits.js';

export type {
  OrknuxArgs,
  OrknuxFunctionDeclaration,
  OrknuxFunctionInstance,
  OrknuxParam,
  OrknuxPluginConstructor,
  OrknuxPluginInstance,
  OrknuxValues,
  OrknuxValueType,
} from './types.js';

export { qualifiedName, validate, validateApiVersion, validateFunctions, validateId } from './validate.js';
export type { DeclaredFunction, DeclaredParam, Declaration, Problem } from './validate.js';
