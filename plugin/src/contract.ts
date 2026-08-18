import type {
  OrknuxFunctionDeclaration,
  OrknuxFunctionInstance,
  OrknuxParam,
  OrknuxValueType,
} from './types.js';

/**
 * The two classes a plugin is written against.
 *
 * **These are the sandbox's, not this package's.** The server defines
 * `OrknuxPlugin` and `OrknuxFunction` on the global object before it evaluates a
 * plugin, and then checks the default export by prototype — `exported.prototype
 * instanceof globalThis.OrknuxPlugin`. A copy bundled in from here would satisfy
 * every type in this file and fail that check, because it would be a different
 * class with the same shape. So what is exported below is a binding to whatever
 * is already there, which is what makes `import` safe in a file that ends up
 * inlined by a bundler: the import compiles to a read of the global.
 *
 * The fallbacks are for everywhere that is not the sandbox — a unit test, or
 * `orknux-plugin check` — where nothing has defined them and `class extends
 * undefined` would throw before anything could be asked. They are a faithful copy
 * of the server's own contract, wording included, so a plugin that is refused
 * locally is refused with the sentence the server would have used.
 */

class OrknuxPluginFallback {
  id(): string {
    throw new Error('a plugin must implement id(), answering what it is called');
  }

  apiVersion(): number {
    throw new Error('a plugin must implement apiVersion(), answering which plugin API it uses');
  }

  functions(): OrknuxFunctionInstance[] {
    return [];
  }
}

class OrknuxFunctionFallback {
  constructor(declared: unknown) {
    if (declared === null || typeof declared !== 'object') {
      throw new Error('an OrknuxFunction needs a declaration');
    }

    const source = declared as Record<string, unknown>;
    const self = this as unknown as Record<string, unknown>;

    self['name'] = source['name'];
    self['description'] = source['description'] === undefined ? null : source['description'];
    self['params'] = source['params'] === undefined ? [] : source['params'];
    self['returnType'] = source['returnType'];
    self['run'] = source['run'];

    if (typeof self['name'] !== 'string' || self['name'].length === 0) {
      throw new Error('an OrknuxFunction needs a name');
    }
    if (typeof self['returnType'] !== 'string') {
      throw new Error(`${self['name']} needs a returnType`);
    }
    if (typeof self['run'] !== 'function') {
      throw new Error(`${self['name']} needs a run function; it is what the function does`);
    }
    if (!Array.isArray(self['params'])) {
      throw new Error(`${self['name']} declares params that are not an array`);
    }
  }
}

/**
 * What a plugin extends.
 *
 * Ambient, so nothing is emitted for it: the value below is the sandbox's class,
 * and this only says what may be assumed about it. `id` and `apiVersion` are
 * abstract because a plugin that leaves one out is refused at load — better a
 * compile error while it is being written than a sentence from the server later.
 */
declare abstract class OrknuxPluginContract {
  /**
   * What this plugin calls itself. Its identity, not its filename: loading this
   * id again replaces whatever is loaded under it.
   */
  abstract id(): string;

  /** Which plugin API this was written against. */
  abstract apiVersion(): number;

  /** What this plugin offers. Defaults to none. */
  functions(): OrknuxFunctionInstance[];
}

/**
 * What each declared function is wrapped in.
 *
 * A constructor rather than a plain object because it checks as it builds: a
 * function with no name, no return type or nothing to run fails on the line that
 * declares it, which is where somebody can see what is missing.
 */
export interface OrknuxFunctionConstructor {
  new <
    const Params extends readonly OrknuxParam[] = readonly [],
    Returns extends OrknuxValueType = OrknuxValueType,
  >(
    declaration: OrknuxFunctionDeclaration<Params, Returns>,
  ): OrknuxFunctionInstance;
}

const scope = globalThis as unknown as {
  OrknuxPlugin?: unknown;
  OrknuxFunction?: unknown;
};

scope.OrknuxPlugin ??= OrknuxPluginFallback;
scope.OrknuxFunction ??= OrknuxFunctionFallback;

export const OrknuxPlugin = scope.OrknuxPlugin as typeof OrknuxPluginContract;

export const OrknuxFunction = scope.OrknuxFunction as OrknuxFunctionConstructor;

/** The base class as a type, for anything that wants to name it. */
export type OrknuxPluginBase = OrknuxPluginContract;
