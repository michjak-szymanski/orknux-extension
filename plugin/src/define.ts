import { OrknuxFunction, OrknuxParameter, OrknuxPlugin } from './contract.js';
import { API_VERSION, PLUGIN_ID } from './limits.js';
import type {
  OrknuxCapability,
  OrknuxFunctionDeclaration,
  OrknuxFunctionInstance,
  OrknuxParam,
  OrknuxParameterDeclaration,
  OrknuxParameterInstance,
  OrknuxPermission,
  OrknuxPluginConstructor,
  OrknuxValueType,
} from './types.js';

/**
 * Declares one function.
 *
 * Sugar over `new OrknuxFunction(...)`, and the reason to prefer it is the
 * inference: the parameters are captured as a tuple, so `run` is typed from what
 * was declared rather than annotated a second time by hand. Change a parameter's
 * type and the body stops compiling, which is the only way the two stay in step.
 */
export function fn<
  const Params extends readonly OrknuxParam[] = readonly [],
  Returns extends OrknuxValueType = OrknuxValueType,
>(declaration: OrknuxFunctionDeclaration<Params, Returns>): OrknuxFunctionInstance {
  return new OrknuxFunction<Params, Returns>(declaration);
}

/**
 * Declares one parameter — something the plugin has to be told, once per
 * workspace, arriving as `this.settings`.
 *
 * Sugar over `new OrknuxParameter(...)`, for symmetry with `fn`. There is no
 * inference to buy here; what it buys is the same checking at the line that
 * declares it — a connection that does not say which kind fails where it is
 * written, not on the way into an upload.
 */
export function param(declaration: OrknuxParameterDeclaration): OrknuxParameterInstance {
  return new OrknuxParameter(declaration);
}

/** A plugin, described rather than written out as a class. */
export interface OrknuxPluginSpec {
  /**
   * What this plugin calls itself, and the prefix on everything it declares.
   *
   * Its identity rather than its filename: loading the same id again replaces
   * what is loaded, whatever the file was called.
   */
  id: string;

  /** Which plugin API this was written against. Defaults to the current one. */
  apiVersion?: number;

  /** What it offers. A plugin may have none and still be worth loading. */
  functions?: readonly OrknuxFunctionInstance[];

  /**
   * What it has to be told before it can work. Each workspace answers these
   * once, and what they come to arrives as `this.settings` — which is why a
   * `run` that reads settings is written as a method or a `function`, never an
   * arrow: the sandbox calls it with the plugin as `this`.
   */
  parameters?: readonly OrknuxParameterInstance[];

  /**
   * Which JavaScript it needs beyond what every plugin gets. Whoever loads the
   * plugin is shown this list and has to accept it; leave it out if you need
   * nothing, which is the common case.
   */
  permissions?: readonly OrknuxPermission[];

  /**
   * What it asks the server to do on its behalf — the calls behind `orknux`.
   * Shown and accepted apart from the permissions, because a capability reaches
   * outside the sandbox where a permission does not.
   */
  capabilities?: readonly OrknuxCapability[];
}

/**
 * A plugin, as the default export.
 *
 * ```ts
 * export default definePlugin({ id: 'teammates', functions: [ … ] })
 * ```
 *
 * The class style — `class Teammates extends OrknuxPlugin` — is the same thing
 * and equally accepted; this is here because most plugins have nothing to say in
 * a method body that the object does not say already.
 *
 * What it returns really is a class extending the sandbox's `OrknuxPlugin`, not
 * something shaped like one. The server checks the prototype, so nothing else
 * would be loaded.
 */
export function definePlugin(spec: OrknuxPluginSpec): OrknuxPluginConstructor {
  const id = spec.id;
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) {
    throw new Error(
      `"${String(id)}" cannot be a plugin id: it has to start with a letter and hold only ` +
        'letters, digits or underscores, up to 32 of them — it becomes the prefix on ' +
        'every function the plugin declares.',
    );
  }

  const apiVersion = spec.apiVersion ?? API_VERSION;
  const declared = spec.functions === undefined ? [] : [...spec.functions];
  const wanted = spec.parameters === undefined ? [] : [...spec.parameters];
  const asked = spec.permissions === undefined ? [] : [...spec.permissions];
  const askedOf = spec.capabilities === undefined ? [] : [...spec.capabilities];

  /*
   * Checked here rather than left to the upload: a plugin that declares one name
   * twice is refused by the server as a whole, and the sentence it answers with
   * is easier to act on when it arrives while the file is still open. The
   * parameters are held to the same rule for the same reason.
   */
  const seen = new Set<string>();
  for (const declaration of declared) {
    if (seen.has(declaration.name)) {
      throw new Error(`${id} declares ${declaration.name} more than once`);
    }
    seen.add(declaration.name);
  }

  const named = new Set<string>();
  for (const parameter of wanted) {
    if (named.has(parameter.name)) {
      throw new Error(`${id} declares the parameter ${parameter.name} more than once`);
    }
    named.add(parameter.name);
  }

  return class extends OrknuxPlugin {
    override id(): string {
      return id;
    }

    override apiVersion(): number {
      return apiVersion;
    }

    /* Copies, so nothing the server is handed can be edited from under it. */
    override functions(): OrknuxFunctionInstance[] {
      return declared.slice();
    }

    override parameters(): OrknuxParameterInstance[] {
      return wanted.slice();
    }

    override permissions(): OrknuxPermission[] {
      return asked.slice();
    }

    override capabilities(): OrknuxCapability[] {
      return askedOf.slice();
    }
  };
}
