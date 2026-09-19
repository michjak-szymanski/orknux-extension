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
export {
  orknux,
  OrknuxFunction,
  OrknuxFunctionTool,
  OrknuxObject,
  OrknuxParameter,
  OrknuxPlugin,
  OrknuxSkill,
  OrknuxTool,
} from './contract.js';
export type {
  OrknuxFunctionConstructor,
  OrknuxFunctionToolConstructor,
  OrknuxObjectConstructor,
  OrknuxParameterConstructor,
  OrknuxPluginBase,
  OrknuxSkillConstructor,
  OrknuxToolConstructor,
} from './contract.js';

export { definePlugin, fn, functionTool, param, tool } from './define.js';
export type { OrknuxPluginSpec } from './define.js';

export {
  API_VERSION,
  CAPABILITIES,
  CONNECTION,
  CONNECTION_TYPES,
  IDENTIFIER,
  LIBRARY_PATH,
  MAX_FUNCTIONS,
  MAX_LIBRARIES,
  MAX_LIBRARY_PATH_LENGTH,
  MAX_OBJECTS,
  MAX_OPTIONS,
  MAX_PARAMETERS,
  MAX_PERMISSIONS,
  MAX_PROPERTIES,
  MAX_SKILLS,
  MAX_SKILL_CHARS,
  MAX_SKILL_NAME_LENGTH,
  MAX_SOURCE_BYTES,
  MAX_TOOLS,
  OBJECT_NAME,
  PARAMETER_TYPES,
  PERMISSIONS,
  PLUGIN_ID,
  PROPERTY_KINDS,
  SUPPORTED_API_VERSIONS,
  VALUE_TYPES,
} from './limits.js';

export type {
  OrknuxArgs,
  OrknuxBinaryResponse,
  OrknuxCapability,
  OrknuxConnectionHandle,
  OrknuxConnectionType,
  OrknuxFunctionDeclaration,
  OrknuxFunctionInstance,
  OrknuxFunctionToolDeclaration,
  OrknuxFunctionToolInstance,
  OrknuxHelpers,
  OrknuxObjectDeclaration,
  OrknuxObjectInstance,
  OrknuxParam,
  OrknuxParameterDeclaration,
  OrknuxParameterInstance,
  OrknuxParameterType,
  OrknuxPermission,
  OrknuxPluginConstructor,
  OrknuxPluginInstance,
  OrknuxPropertyKind,
  OrknuxProperty,
  OrknuxResponse,
  OrknuxRunContext,
  OrknuxSettings,
  OrknuxSkillDeclaration,
  OrknuxSkillInstance,
  OrknuxStorePut,
  OrknuxToolDeclaration,
  OrknuxToolInstance,
  OrknuxValues,
  OrknuxValueType,
  SlackConnectionArgument,
  SlackLinkedMessage,
  SlackMention,
  SlackPost,
  SlackReaction,
  SlackSearchResult,
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
  validateLibraries,
  validateObjects,
  validateParameters,
  validatePermissions,
  validateSkills,
  validateTools,
} from './validate.js';
export type {
  DeclaredFunction,
  DeclaredObject,
  DeclaredParam,
  DeclaredParameter,
  DeclaredProperty,
  DeclaredSkill,
  DeclaredTool,
  Declaration,
  Problem,
} from './validate.js';
