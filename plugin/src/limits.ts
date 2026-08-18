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
