/*
 * What `fs` and `path` resolve to in a bundled plugin: nothing, on purpose.
 *
 * A library's Node-only corner may `require` these lazily without ever calling
 * them from the paths a plugin uses. Resolving them to an empty object lets
 * such a library bundle; anything that actually reaches for a function on them
 * still fails, at the call, with its name in the error.
 */
export default {};
