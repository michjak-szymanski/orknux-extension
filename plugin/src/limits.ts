/**
 * What the server enforces, written down once.
 *
 * Every number and pattern here has a counterpart in orknux-server, and the
 * comment says which — because the only thing this package is really selling is
 * that a plugin which passes locally is a plugin the server will accept. When one
 * of these drifts, the promise is broken quietly, so they are kept together and
 * named after the rule rather than after the value.
 */

/** What a plugin written today should answer from `apiVersion()`. */
export const API_VERSION = 1;

/** Every version the server this package tracks still loads. */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1];

/** More than a plugin has any business offering; the loader stops reading past it. */
export const MAX_FUNCTIONS = 100;

/**
 * More than a plugin has any business asking a workspace to fill in.
 *
 * Lower than the function bound on purpose: every one of these is something a
 * person has to sit down and answer, and a plugin asking for fifty pieces of
 * configuration is asking the wrong question. `MAX_PARAMETERS` in `PluginRunner`.
 */
export const MAX_PARAMETERS = 50;

/**
 * More than there are permissions to ask for.
 *
 * A bound on the answer rather than a rule about plugins: what is actually
 * allowed is decided against [PERMISSIONS], and a name that is not on it is
 * refused whatever the length of the list. `MAX_PERMISSIONS` in `PluginRunner`.
 */
export const MAX_PERMISSIONS = 32;

/** A plugin is one bundled file, and the row it is stored in has a size. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/**
 * What a plugin may call itself.
 *
 * Short because it is the prefix on every function it declares: `teammates` plus
 * `isTeammate` is what a workflow calls, and the name it is called by has room
 * for both.
 */
export const PLUGIN_ID = /^[A-Za-z_$][A-Za-z0-9_$]{0,31}$/;

/** A function or parameter name, held to the rule a workspace's own functions are. */
export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

/**
 * The types a value may have crossing between a workflow and a plugin.
 *
 * The server has two more. `none` means "answers nothing", which neither a
 * parameter nor a return may be. `object` names one of a workspace's own
 * definitions, and a plugin's functions belong to every workspace at once — so
 * there is no workspace whose objects they could be naming. A plugin that wants a
 * structure asks for a `map`.
 */
export const VALUE_TYPES = ['string', 'number', 'boolean', 'map', 'array'] as const;

/**
 * The types a *plugin's* parameter may be — narrower than [VALUE_TYPES], and the
 * narrowing is the server's: a parameter is answered either by typing a value or
 * by pointing at one of the workspace's variables, and a variable holds a
 * scalar. `PluginDeclarations.SETTABLE` in orknux-server.
 *
 * A connection is spelled beside them rather than among them because it is not a
 * value at all — see [CONNECTION].
 */
export const PARAMETER_TYPES = ['string', 'number', 'boolean'] as const;

/**
 * How a plugin spells a parameter that names one of the workspace's connections.
 *
 * Not a value type: those are what a value can be, and this is a reference to a
 * row. What crosses into the sandbox for it is a handle — an id and a type,
 * never the connection's credential. `PluginDeclarations.CONNECTION`.
 */
export const CONNECTION = 'connection';

/**
 * The kinds of connection a workspace can hold, and so the kinds a `connection`
 * parameter may name. `ConnectionType` in orknux-server.
 */
export const CONNECTION_TYPES = ['SLACK', 'SMTP', 'HTTP'] as const;

/**
 * Every permission a plugin may ask for, which is every one the server can
 * grant. A closed list, and that is the security property: each name turns on
 * one language builtin and nothing else, so the vocabulary itself cannot express
 * "give me a socket". `PluginPermission` in orknux-server, in the enum's order.
 */
export const PERMISSIONS = ['CONSOLE', 'INTL', 'TEXT_ENCODING', 'PERFORMANCE', 'TEMPORAL'] as const;

/**
 * Everything a plugin may ask the *server* to do on its behalf.
 *
 * Deliberately a second list rather than five more permissions: a permission
 * relaxes the sandbox and reaches nothing, while a capability is a call the
 * server makes for the plugin — so they are declared apart, accepted apart, and
 * neither can be agreed to under cover of the other. `PluginCapability` in
 * orknux-server, in the enum's order.
 */
export const CAPABILITIES = [
  'SLACK_READ_THREAD',
  'SLACK_POST_MESSAGE',
  'SLACK_ADD_REACTION',
  'SLACK_READ_MESSAGE',
  'SLACK_READ_USER',
  'SLACK_MENTION',
  'NETWORK_REQUEST',
] as const;
