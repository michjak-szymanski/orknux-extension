import type {
  OrknuxCapability,
  OrknuxFunctionDeclaration,
  OrknuxFunctionInstance,
  OrknuxHelpers,
  OrknuxParam,
  OrknuxParameterDeclaration,
  OrknuxParameterInstance,
  OrknuxPermission,
  OrknuxSettings,
  OrknuxValueType,
} from './types.js';

/**
 * The classes a plugin is written against, and the `orknux` object beside them.
 *
 * **These are the sandbox's, not this package's.** The server defines
 * `OrknuxPlugin`, `OrknuxFunction`, `OrknuxParameter` and `orknux` on the global
 * object before it evaluates a plugin, and then checks the default export by
 * prototype — `exported.prototype instanceof globalThis.OrknuxPlugin`. A copy
 * bundled in from here would satisfy every type in this file and fail that
 * check, because it would be a different class with the same shape. So what is
 * exported below is a binding to whatever is already there, which is what makes
 * `import` safe in a file that ends up inlined by a bundler: the import compiles
 * to a read of the global.
 *
 * The fallbacks are for everywhere that is not the sandbox — a unit test, or
 * `orknux-plugin check` — where nothing has defined them and `class extends
 * undefined` would throw before anything could be asked. They are a faithful copy
 * of the server's own contract, wording included, so a plugin that is refused
 * locally is refused with the sentence the server would have used. The `orknux`
 * fallback answers every ungranted call the way the sandbox answers one — with
 * `{ error }` as data — because outside the sandbox nothing has been granted,
 * which is exactly what those sentences say.
 */

class OrknuxPluginFallback {
  constructor() {
    /*
     * What the sandbox's own construction helper does after `new`: settings are
     * put on the instance rather than passed to the constructor, frozen so a
     * run cannot rewrite what it was given. Empty here, as they are while a
     * plugin is only being asked what it is.
     */
    Object.defineProperty(this, 'settings', {
      value: Object.freeze({}),
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }

  id(): string {
    throw new Error('a plugin must implement id(), answering what it is called');
  }

  apiVersion(): number {
    throw new Error('a plugin must implement apiVersion(), answering which plugin API it uses');
  }

  functions(): OrknuxFunctionInstance[] {
    return [];
  }

  parameters(): OrknuxParameterInstance[] {
    return [];
  }

  permissions(): OrknuxPermission[] {
    return [];
  }

  capabilities(): OrknuxCapability[] {
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

class OrknuxParameterFallback {
  constructor(declared: unknown) {
    if (declared === null || typeof declared !== 'object') {
      throw new Error('an OrknuxParameter needs a declaration');
    }

    const source = declared as Record<string, unknown>;
    const self = this as unknown as Record<string, unknown>;

    self['name'] = source['name'];
    self['description'] = source['description'] === undefined ? null : source['description'];
    self['type'] = source['type'];
    self['required'] = source['required'] === undefined ? true : source['required'];
    self['secret'] = source['secret'] === undefined ? false : source['secret'];
    self['connectionType'] = source['connectionType'] === undefined ? null : source['connectionType'];

    if (typeof self['name'] !== 'string' || self['name'].length === 0) {
      throw new Error('an OrknuxParameter needs a name');
    }
    if (typeof self['type'] !== 'string') {
      throw new Error(`${self['name']} needs a type`);
    }
    if (typeof self['required'] !== 'boolean') {
      throw new Error(`${self['name']} says required is neither true nor false`);
    }
    if (typeof self['secret'] !== 'boolean') {
      throw new Error(`${self['name']} says secret is neither true nor false`);
    }
    /*
     * Said here as well as at the upload, as the sandbox says it, so a plugin
     * author is told which half is wrong at the moment they write it rather
     * than at the moment somebody tries to load it.
     */
    if (self['type'] === 'connection' && typeof self['connectionType'] !== 'string') {
      throw new Error(`${self['name']} is a connection, so it needs a connectionType`);
    }
    if (self['connectionType'] !== null && self['type'] !== 'connection') {
      throw new Error(`${self['name']} names a connectionType but is not a connection`);
    }
  }
}

/**
 * The `orknux` object for everywhere that is not the sandbox.
 *
 * Every door answers the sentence the sandbox answers an ungranted call with,
 * because that is the truth here too: nothing has been granted, and a refusal is
 * data so a plugin under test can say something useful about it. `log` is the
 * one exception — it was never a capability, nothing is reached by it — so it
 * writes to the console where there is one, which is where a test's tracing
 * wants to go.
 */
function ungrantedHelpers(): OrknuxHelpers {
  /*
   * `{ error }` satisfies every answer type here, because every answer type has
   * a refusal arm — that is the shape of the contract, not a coincidence.
   */
  const refused = (capability: string) => (): { error: string } => ({
    error: `this plugin was not granted ${capability}`,
  });

  const say = (level: 'debug' | 'info' | 'warn' | 'error') =>
    (...parts: unknown[]): void => {
      if (typeof console === 'undefined') return;
      const line = parts
        .map((one) => {
          if (typeof one === 'string') return one;
          try {
            return JSON.stringify(one);
          } catch {
            return String(one);
          }
        })
        .join(' ');
      console[level](line);
    };

  return {
    slack: {
      thread: refused('SLACK_READ_THREAD'),
      post: refused('SLACK_POST_MESSAGE'),
      react: refused('SLACK_ADD_REACTION'),
      message: refused('SLACK_READ_MESSAGE'),
      user: refused('SLACK_READ_USER'),
      mention: refused('SLACK_MENTION'),
    },
    http: {
      request: refused('NETWORK_REQUEST'),
      get: refused('NETWORK_REQUEST'),
      post: refused('NETWORK_REQUEST'),
    },
    log: {
      debug: say('debug'),
      info: say('info'),
      warn: say('warn'),
      error: say('error'),
    },
  };
}

/**
 * What a plugin extends.
 *
 * Ambient, so nothing is emitted for it: the value below is the sandbox's class,
 * and this only says what may be assumed about it. `id` and `apiVersion` are
 * abstract because a plugin that leaves one out is refused at load — better a
 * compile error while it is being written than a sentence from the server later.
 * Everything else defaults to none, so a plugin says only what it has to say.
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

  /** What this plugin has to be told before it can work. Defaults to none. */
  parameters(): OrknuxParameterInstance[];

  /**
   * Which JavaScript this plugin needs beyond what every plugin gets.
   *
   * Whoever loads it is shown the list and has to accept it, and only what was
   * accepted is turned on — for this plugin, in the sandbox one of its calls
   * runs in, and nowhere else. Loading is done with none of them granted, so
   * the top level of the bundle has to evaluate without them: ask for what
   * `run` needs, not for what loading needs.
   */
  permissions(): OrknuxPermission[];

  /**
   * What this plugin asks the server to do on its behalf.
   *
   * Separate from `permissions()`, which only ever turns on a language builtin.
   * These reach outside — so they are declared apart, granted apart, and shown
   * apart to whoever accepts the plugin.
   */
  capabilities(): OrknuxCapability[];

  /**
   * What a workspace set those parameters to, keyed by name.
   *
   * Frozen, and put there by the server for the length of one call. A parameter
   * nothing usable is set for is absent rather than null, so
   * `this.settings.token === undefined` is the question to ask. This is the
   * whole of what a plugin knows about the workspace it is running for.
   */
  readonly settings: OrknuxSettings;
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

/**
 * What each declared parameter is wrapped in, checking as it builds for the
 * same reason: a connection that does not say which kind, or a secret that is
 * not asking for anything a secret could protect, fails on the line that
 * declares it.
 */
export interface OrknuxParameterConstructor {
  new (declaration: OrknuxParameterDeclaration): OrknuxParameterInstance;
}

const scope = globalThis as unknown as {
  OrknuxPlugin?: unknown;
  OrknuxFunction?: unknown;
  OrknuxParameter?: unknown;
  orknux?: unknown;
};

scope.OrknuxPlugin ??= OrknuxPluginFallback;
scope.OrknuxFunction ??= OrknuxFunctionFallback;
scope.OrknuxParameter ??= OrknuxParameterFallback;
scope.orknux ??= ungrantedHelpers();

export const OrknuxPlugin = scope.OrknuxPlugin as typeof OrknuxPluginContract;

export const OrknuxFunction = scope.OrknuxFunction as OrknuxFunctionConstructor;

export const OrknuxParameter = scope.OrknuxParameter as OrknuxParameterConstructor;

/**
 * What the server will do on a plugin's behalf: the Slack calls, one HTTP door,
 * and a log. Each call needs the capability the plugin declared and a person
 * accepted; without it the answer is `{ error }` saying so, never a throw.
 */
export const orknux = scope.orknux as OrknuxHelpers;

/** The base class as a type, for anything that wants to name it. */
export type OrknuxPluginBase = OrknuxPluginContract;
