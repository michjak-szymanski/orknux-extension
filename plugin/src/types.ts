import type { VALUE_TYPES } from './limits.js';

/**
 * The shape of a value crossing between a workflow and a plugin.
 *
 * Derived from the list the server accepts rather than written out again, so the
 * two cannot disagree about what a plugin may declare.
 */
export type OrknuxValueType = (typeof VALUE_TYPES)[number];

/**
 * What each of those is in TypeScript.
 *
 * A map is `Record<string, unknown>` and an array `unknown[]`, not `object` and
 * `any[]`: everything crossing into the sandbox arrived as JSON, so what is
 * inside is genuinely unknown until the code looks. `unknown` makes it look.
 */
export interface OrknuxValues {
  string: string;
  number: number;
  boolean: boolean;
  map: Record<string, unknown>;
  array: unknown[];
}

/** One parameter, as it is declared. */
export interface OrknuxParam<
  Name extends string = string,
  Type extends OrknuxValueType = OrknuxValueType,
> {
  readonly name: Name;
  readonly type: Type;
}

/**
 * The arguments `run` is handed, read off the parameters it declared.
 *
 * This is the whole reason for declaring parameters as a tuple: `params` and the
 * signature of `run` are one statement rather than two that can drift, so
 * renaming a type in the declaration is a compile error in the body.
 */
export type OrknuxArgs<Params extends readonly OrknuxParam[]> = {
  -readonly [Index in keyof Params]: OrknuxValues[Params[Index]['type']];
};

/** A function, as it is written. */
export interface OrknuxFunctionDeclaration<
  Params extends readonly OrknuxParam[] = readonly OrknuxParam[],
  Returns extends OrknuxValueType = OrknuxValueType,
> {
  /** An identifier. Offered to a workflow prefixed with the plugin's id. */
  name: string;

  /** Optional; shown beside it in the interface. */
  description?: string;

  /** In the order `run` receives them. */
  params?: Params;

  /** What it answers with. A function has to answer something. */
  returnType: Returns;

  /**
   * What it does.
   *
   * Synchronous, and not by omission: the sandbox has no host access, no IO and
   * no way to hand a promise back across the boundary, so there is nothing a
   * plugin could usefully await. Everything it works with was passed to it.
   */
  run: (...args: OrknuxArgs<Params>) => OrknuxValues[Returns];
}

/**
 * A function after `OrknuxFunction` has checked it.
 *
 * The declaration as the sandbox stores it, which is not quite what was written:
 * an absent description became null and absent parameters became an empty array.
 */
export interface OrknuxFunctionInstance {
  readonly name: string;
  readonly description: string | null;
  readonly params: readonly OrknuxParam[];
  readonly returnType: string;
  readonly run: (...args: never[]) => unknown;
}

/** What a plugin answers when the server asks it what it is. */
export interface OrknuxPluginInstance {
  /** What this plugin calls itself, and the prefix on everything it declares. */
  id(): string;

  /** Which plugin API it was written against. */
  apiVersion(): number;

  /** What it offers. */
  functions(): OrknuxFunctionInstance[];
}

/**
 * A plugin as it leaves the file: a class, exported as the default.
 *
 * The server checks the prototype rather than probing for methods, so a plain
 * object with the right keys is refused however right the keys are.
 */
export type OrknuxPluginConstructor = new () => OrknuxPluginInstance;
