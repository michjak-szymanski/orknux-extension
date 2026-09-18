import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { OrknuxPlugin } from './contract.js';
import { MAX_SOURCE_BYTES } from './limits.js';
import type {
  DeclaredFunction,
  DeclaredParam,
  DeclaredParameter,
  Declaration,
} from './validate.js';

/**
 * Loads a built plugin and asks it what it is.
 *
 * The same questions the server asks, in the same order, refusing on the same
 * answers — so `check` says beforehand what an upload would have said: what the
 * plugin calls itself, which API it uses, what it offers, what it has to be
 * told, which JavaScript it needs, and what it asks the server to do for it.
 * What it is *not* is the server's sandbox: this imports the bundle into this
 * Node process, with everything Node has. Run it on a plugin you wrote, not on
 * one somebody sent you.
 *
 * Importing `./contract.js` is what puts `OrknuxPlugin`, `OrknuxFunction`,
 * `OrknuxParameter` and `orknux` on the global object before the bundle is
 * evaluated, which is the order the sandbox uses and the reason a plugin written
 * against the ambient globals — with no import of this package at all — loads
 * here too.
 */

/** The bundle is not a plugin, or did not hold up its end of the contract. */
export class NotAPluginError extends Error {
  constructor(reason: string) {
    super(`That file is not a usable plugin: ${reason}`);
    this.name = 'NotAPluginError';
  }
}

/** What a plugin answered, and what the file it came from weighs. */
export interface Inspection extends Declaration {
  /** Present even when empty, unlike on a bare [Declaration]: the plugin was asked. */
  parameters: DeclaredParameter[];
  permissions: string[];
  capabilities: string[];
  file: string;
  bytes: number;
  /** The digest the server will store, so the two can be compared. */
  sha256: string;
  /** Whether it is inside the size a plugin may be. */
  withinSizeLimit: boolean;
}

export async function inspect(file: string): Promise<Inspection> {
  const source = await readFile(file);
  const sha256 = createHash('sha256').update(source).digest('hex');

  /*
   * Node caches a module by URL, and `build` then `check` happens in one process
   * often enough that a second look at the same path would answer with the first
   * one's exports. The digest changes when the file does, which is exactly when
   * the cache should be missed.
   */
  const url = `${pathToFileURL(file).href}?sha256=${sha256.slice(0, 16)}`;

  let exported: unknown;
  try {
    exported = ((await import(url)) as { default?: unknown }).default;
  } catch (failure) {
    throw new NotAPluginError(failure instanceof Error ? failure.message : String(failure));
  }

  if (exported === undefined) throw new NotAPluginError('it has no default export');
  if (typeof exported !== 'function') {
    throw new NotAPluginError('the default export must be a class that extends OrknuxPlugin');
  }
  /*
   * By prototype, as the server does it, and not by looking for methods: a plain
   * object with all the right keys is not a plugin, and finding that out here is
   * the whole point of checking before uploading.
   */
  if (!(exported.prototype instanceof OrknuxPlugin)) {
    throw new NotAPluginError('the default export must extend OrknuxPlugin');
  }

  const plugin = new (exported as new () => Record<string, unknown>)();
  const answer = (method: string): unknown => {
    const asked = (plugin as unknown as Record<string, unknown>)[method];
    if (typeof asked !== 'function') throw new NotAPluginError(`it has no ${method}()`);
    return (asked as () => unknown).call(plugin);
  };

  const id = answer('id');
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new NotAPluginError('id() did not answer with a name');
  }

  const apiVersion = answer('apiVersion');
  if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion)) {
    throw new NotAPluginError('apiVersion() did not answer with a whole number');
  }

  const declared = answer('functions');
  if (!Array.isArray(declared)) {
    throw new NotAPluginError('functions() did not answer with an array');
  }

  const functions = declared.map((one) => read(one as Record<string, unknown>));

  /*
   * What the plugin needs to be told before it can do anything, read the way
   * the loader reads it: the point of declaring parameters is that a workspace
   * can be shown what a plugin will be given before it is given anything.
   */
  const wanted = answer('parameters');
  if (!Array.isArray(wanted)) {
    throw new NotAPluginError('parameters() did not answer with an array');
  }
  const parameters = wanted.map((one) => readParameter(one as Record<string, unknown>));

  /*
   * What JavaScript it says it needs. Trimmed, emptied and read once each, as
   * the loader reads them, before validation judges the names.
   */
  const asked = answer('permissions');
  if (!Array.isArray(asked)) {
    throw new NotAPluginError('permissions() did not answer with an array');
  }
  const permissions = [
    ...new Set(
      asked
        .map((one) => {
          if (typeof one !== 'string') {
            throw new NotAPluginError('permissions() answered with something that is not a name');
          }
          return one.trim();
        })
        .filter((one) => one.length > 0),
    ),
  ];

  /*
   * What it asks the server to do for it. Guarded the way the loader guards it —
   * a plugin with no `capabilities` member asks for nothing — although every
   * plugin loaded against this contract has one, because the base class does.
   */
  const capabilityMember = (plugin as unknown as Record<string, unknown>)['capabilities'];
  const askedOf = typeof capabilityMember === 'function' ? answer('capabilities') : [];
  if (!Array.isArray(askedOf)) {
    throw new NotAPluginError('capabilities() did not answer with an array');
  }
  const capabilities = askedOf.map((one) => {
    if (typeof one !== 'string') {
      throw new NotAPluginError('capabilities() answered with something that is not a name');
    }
    return one;
  });

  return {
    id: id.trim(),
    apiVersion,
    functions,
    parameters,
    permissions,
    capabilities,
    file,
    bytes: source.byteLength,
    sha256,
    withinSizeLimit: source.byteLength <= MAX_SOURCE_BYTES,
  };
}

function read(declared: Record<string, unknown>): DeclaredFunction {
  const params = Array.isArray(declared['params']) ? declared['params'] : [];

  return {
    name: text(declared, 'name') ?? refuse('a function has no name'),
    description: text(declared, 'description') ?? null,
    returnType: text(declared, 'returnType') ?? refuse('a function has no returnType'),
    params: params.map((param): DeclaredParam => {
      const one = param as Record<string, unknown>;
      return {
        name: text(one, 'name') ?? refuse('a parameter has no name'),
        type: text(one, 'type') ?? refuse('a parameter has no type'),
      };
    }),
  };
}

function readParameter(declared: Record<string, unknown>): DeclaredParameter {
  return {
    name: text(declared, 'name') ?? refuse('a parameter has no name'),
    description: text(declared, 'description') ?? null,
    type: text(declared, 'type') ?? refuse('a parameter has no type'),
    required: flag(declared, 'required', true),
    secret: flag(declared, 'secret', false),
    connectionType: text(declared, 'connectionType') ?? null,
  };
}

/** A member that has to be a string to be worth reading, trimmed, empty read as absent. */
function text(holder: Record<string, unknown>, member: string): string | undefined {
  const value = holder[member];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** A member that has to be a boolean to be worth reading, as the loader reads one. */
function flag(holder: Record<string, unknown>, member: string, fallback: boolean): boolean {
  const value = holder[member];
  return typeof value === 'boolean' ? value : fallback;
}

function refuse(reason: string): never {
  throw new NotAPluginError(reason);
}
