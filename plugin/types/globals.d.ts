/**
 * The contract as the sandbox presents it: two globals, no imports.
 *
 * This is the other way to write a plugin, and the one the server's own template
 * uses. Nothing is imported, so nothing has to be bundled — the file compiles to
 * itself, and what the editor checks it against is declared here rather than
 * pulled in.
 *
 *     /// <reference types="@orknux/plugin/globals" />
 *
 * or, once, in tsconfig.json:
 *
 *     { "compilerOptions": { "types": ["@orknux/plugin/globals"] } }
 *
 * Use it when a plugin is a single file with no dependencies and you would
 * rather not run a bundler at all — `tsc` alone produces something the server
 * takes. Everything else wants `import { definePlugin, fn } from '@orknux/plugin'`,
 * which is the same contract with the parameter types carried into `run`.
 *
 * Do not load both in one file. They describe the same two classes, and an
 * import shadows the global of the same name, which reads as a puzzle rather
 * than as the choice it is.
 */

/** The shape of a value crossing between a workflow and a plugin. */
type OrknuxValueType = 'string' | 'number' | 'boolean' | 'map' | 'array';

/** A function's declaration, checked as it is constructed. */
interface OrknuxFunctionDeclared {
  /** An identifier: letters, digits and underscores. */
  name: string;
  /** Optional; shown beside it in the interface. */
  description?: string;
  /** In the order `run` receives them. */
  params?: { name: string; type: OrknuxValueType }[];
  /** What it answers with. A function has to answer something. */
  returnType: OrknuxValueType;
  /** What it does. Stays here; the server calls back into it. */
  run: (...args: never[]) => unknown;
}

/**
 * What a plugin extends. Defined by the sandbox before this file is evaluated,
 * which is why it is declared rather than imported.
 */
declare abstract class OrknuxPlugin {
  /** What this plugin calls itself, and the prefix on everything it declares. */
  abstract id(): string;

  /** Which plugin API this was written against. */
  abstract apiVersion(): number;

  /** What this plugin offers. Defaults to none. */
  functions(): OrknuxFunction[];
}

/** What each declared function is wrapped in. */
declare class OrknuxFunction {
  constructor(declaration: OrknuxFunctionDeclared);

  readonly name: string;
  readonly description: string | null;
  readonly params: { name: string; type: OrknuxValueType }[];
  readonly returnType: OrknuxValueType;
  readonly run: (...args: never[]) => unknown;
}
