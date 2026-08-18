import { OrknuxFunction, OrknuxPlugin } from './contract.js';
import { API_VERSION, PLUGIN_ID } from './limits.js';
import type {
  OrknuxFunctionDeclaration,
  OrknuxFunctionInstance,
  OrknuxParam,
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

  /*
   * Checked here rather than left to the upload: a plugin that declares one name
   * twice is refused by the server as a whole, and the sentence it answers with
   * is easier to act on when it arrives while the file is still open.
   */
  const seen = new Set<string>();
  for (const declaration of declared) {
    if (seen.has(declaration.name)) {
      throw new Error(`${id} declares ${declaration.name} more than once`);
    }
    seen.add(declaration.name);
  }

  return class extends OrknuxPlugin {
    override id(): string {
      return id;
    }

    override apiVersion(): number {
      return apiVersion;
    }

    /* A copy, so nothing the server is handed can be edited from under it. */
    override functions(): OrknuxFunctionInstance[] {
      return declared.slice();
    }
  };
}
