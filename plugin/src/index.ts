/**
 * Writing a plugin for orknux-server.
 *
 * Everything exported here is safe to import from a plugin: the three classes
 * and the `orknux` helpers are bindings to what the sandbox already defines, and
 * the rest is types, constants and pure functions. Nothing reaches for a file, a
 * network or a Node built-in, because a plugin that imported one would bundle it
 * and the sandbox would refuse the result.
 *
 * The tooling — bundling a plugin, and loading a built one to check it — is
 * `@orknux/plugin/tooling`, and is deliberately not here.
 */
export { orknux, OrknuxFunction, OrknuxParameter, OrknuxPlugin } from './contract.js';
export type {
  OrknuxFunctionConstructor,
  OrknuxParameterConstructor,
  OrknuxPluginBase,
} from './contract.js';

export { definePlugin, fn, param } from './define.js';
export type { OrknuxPluginSpec } from './define.js';

export {
  API_VERSION,
  CAPABILITIES,
  CONNECTION,
  CONNECTION_TYPES,
  IDENTIFIER,
  MAX_FUNCTIONS,
  MAX_PARAMETERS,
  MAX_PERMISSIONS,
  MAX_SOURCE_BYTES,
  PARAMETER_TYPES,
  PERMISSIONS,
  PLUGIN_ID,
  SUPPORTED_API_VERSIONS,
  VALUE_TYPES,
} from './limits.js';

export type {
  OrknuxArgs,
  OrknuxCapability,
  OrknuxConnectionHandle,
  OrknuxConnectionType,
  OrknuxFunctionDeclaration,
  OrknuxFunctionInstance,
  OrknuxHelpers,
  OrknuxParam,
  OrknuxParameterDeclaration,
  OrknuxParameterInstance,
  OrknuxParameterType,
  OrknuxPermission,
  OrknuxPluginConstructor,
  OrknuxPluginInstance,
  OrknuxResponse,
  OrknuxRunContext,
  OrknuxSettings,
  OrknuxValues,
  OrknuxValueType,
  SlackConnectionArgument,
  SlackLinkedMessage,
  SlackMention,
  SlackPost,
  SlackReaction,
  SlackThread,
  SlackThreadMessage,
  SlackUserInfo,
} from './types.js';

export {
  qualifiedName,
  validate,
  validateApiVersion,
  validateCapabilities,
  validateFunctions,
  validateId,
  validateParameters,
  validatePermissions,
} from './validate.js';
export type {
  DeclaredFunction,
  DeclaredParam,
  DeclaredParameter,
  Declaration,
  Problem,
} from './validate.js';
