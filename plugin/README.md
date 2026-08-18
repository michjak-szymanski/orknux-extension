# @orknux/plugin

[![npm](https://img.shields.io/npm/v/@orknux/plugin?label=npm)](https://www.npmjs.com/package/@orknux/plugin)
[![CI](https://github.com/michjak-szymanski/orknux-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/michjak-szymanski/orknux-extension/actions/workflows/ci.yml)
[![plugin API](https://img.shields.io/badge/plugin%20API-1-blue)](https://github.com/michjak-szymanski/orknux-extension/blob/main/plugin/src/limits.ts)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen)](https://github.com/michjak-szymanski/orknux-extension/blob/main/plugin/package.json)
[![Licence](https://img.shields.io/badge/licence-Apache--2.0-blue)](https://github.com/michjak-szymanski/orknux-extension/blob/main/LICENSE)

Writing plugins for [orknux-server](https://github.com/michjak-szymanski/orknux-server)
in TypeScript, and knowing before you upload one that the server will take it.

```bash
npm install --save-dev @orknux/plugin
npx orknux-plugin init my-plugin
```

## What a plugin is

One file, evaluated as a single ES module in a sandbox with no network, no
filesystem and no module resolution. It exports one class by default, that class
extends `OrknuxPlugin`, and the server asks it three questions when it is loaded:
what it calls itself, which plugin API it was written against, and what functions
it offers.

What it declares becomes functions every workspace can call, named for the plugin
and then for the function — `teammates_isTeammate`. The id is the plugin's
identity, not its filename: loading the same id again replaces what is loaded.

```ts
import { definePlugin, fn } from '@orknux/plugin';

export default definePlugin({
  id: 'teammates',
  functions: [
    fn({
      name: 'isTeammate',
      description: 'Whether an email address belongs to a member of this workspace.',
      params: [{ name: 'email', type: 'string' }],
      returnType: 'boolean',
      run: (email) => email.endsWith('@example.com'),
    }),
  ],
});
```

`email` is a `string` there without being annotated. The parameters are declared
once and `run` is typed from them, so changing `type: 'string'` to `'number'` is a
compile error in the body rather than a plugin that lies about itself.

```bash
npx orknux-plugin build src/plugin.ts -o dist/teammates.js
```

```
dist/teammates.js  4.5 KB

teammates  ·  plugin API 1  ·  4.5 KB  ·  sha256 2a2d7118aa42…

  teammates_isTeammate(email: string): boolean
      Whether an email address belongs to a member of this workspace.

Accepted. Load it with: orkx plugin load --file dist/teammates.js
```

## The types a value may have

`string`, `number`, `boolean`, `map`, `array` — and what each is in TypeScript:

| declared  | in `run`                  |
|-----------|---------------------------|
| `string`  | `string`                  |
| `number`  | `number`                  |
| `boolean` | `boolean`                 |
| `map`     | `Record<string, unknown>` |
| `array`   | `unknown[]`               |

A map is `unknown`-valued and an array `unknown`-elemented because everything
crossing into the sandbox arrived as JSON: what is inside it is genuinely unknown
until the code looks, and `unknown` is what makes the code look.

The server has two more types that a plugin may not use. `none` means "answers
nothing", and a function has to answer something. `object` names one of a
*workspace's* own definitions — and a plugin's functions belong to every
workspace at once, so there is no workspace whose objects they could be naming. A
plugin that wants a structure asks for a `map`.

## Why an import is safe here

The sandbox defines `OrknuxPlugin` and `OrknuxFunction` on the global object
before it evaluates a plugin, and then checks the default export **by prototype**.
A copy of those classes bundled in from a library would satisfy every type and
fail that check, because it would be a different class with the same shape.

So what this package exports is not a copy — it is a binding:

```js
globalThis.OrknuxPlugin  // ← what `import { OrknuxPlugin }` resolves to
```

which is why bundling this package into a plugin is fine, and why the class the
build produces really is the one the server is looking for. Outside the sandbox —
in a unit test, or in `orknux-plugin check` — nothing has defined those globals,
so the package installs a faithful copy of the server's own contract, wording
included, and a plugin refused locally is refused with the sentence the server
would have used.

## Three ways to write one

**Described.** `definePlugin` is the short one, and what `init` scaffolds. It
returns a real class extending `OrknuxPlugin`.

**Written out.** The same thing, when a method has something to say:

```ts
import { OrknuxFunction, OrknuxPlugin } from '@orknux/plugin';

export default class Teammates extends OrknuxPlugin {
  id() {
    return 'teammates';
  }

  apiVersion() {
    return 1;
  }

  functions() {
    return [new OrknuxFunction({ name: 'isTeammate', returnType: 'boolean', run: () => true })];
  }
}
```

**Against the globals, importing nothing.** This is the style of the template the
server itself hands out, and it needs no bundler at all — `tsc` alone produces
something the server takes:

```jsonc
// tsconfig.json
{ "compilerOptions": { "types": ["@orknux/plugin/globals"] } }
```

```ts
export default class Teammates extends OrknuxPlugin {
  id(): string {
    return 'teammates';
  }
  apiVersion(): number {
    return 1;
  }
  functions(): OrknuxFunction[] {
    return [];
  }
}
```

Do not mix the last one with the first two in a single file: they describe the
same two classes, and an import shadowing a global of the same name reads as a
puzzle rather than as the choice it is.

## Building

`orknux-plugin build` bundles with esbuild into one ES module targeting ES2022,
because that is what the sandbox will evaluate: `format: esm`, `platform:
neutral`, nothing external.

Neutral rather than node is the point of it. A plugin that reaches for `node:fs`
fails **the build**, on the line that reached for it — rather than uploading
cleanly and failing the first time it runs, where an unresolved import is
somebody else's incident.

| flag | |
|---|---|
| `-o, --out <file>` | where the bundle goes. Defaults to `dist/<entry>.js` |
| `--minify` | smaller, and unreadable when an administrator downloads it again |
| `--no-check` | bundle without asking whether it would be accepted |

Build to `dist/<id>.js`. The filename becomes what the plugin is *called* on the
Plugins screen — the id is what it *is* — so a bundle named after its entry point
turns up in the list as "plugin".

## Checking

`build` ends by loading the bundle and asking it the three questions the upload
asks, then applying the rules the upload applies: identifiers, types, duplicate
names, the API version, the size. It exits non-zero if anything would be refused,
so a plugin that would not load does not pass a build script. `orknux-plugin
check dist/teammates.js` does the same to a file that already exists.

**It is not the sandbox.** Checking imports the bundle into your Node process,
with everything Node has. Run it on a plugin you wrote, not on one somebody sent
you.

The same functions are exported, so a plugin can have its own tests:

```ts
import { validate } from '@orknux/plugin';
import { bundle, inspect } from '@orknux/plugin/tooling';

await bundle({ entry: 'src/plugin.ts', outfile: 'dist/teammates.js' });
const declared = await inspect('dist/teammates.js');

expect(validate(declared)).toEqual([]);
```

## Loading it

Either from the Plugins screen, as an administrator, or:

```bash
orkx plugin load --file dist/teammates.js
```

## What a plugin cannot do

Nothing, yet, but compute. The sandbox denies host access, class loading, IO,
threads, processes and the environment; there is no `fetch`, no `console`, no
`load`. A function is given its arguments and answers — which is why `run` is
typed as synchronous, and why there is no point writing it as `async`.

There is also a clock on it: a plugin has ten seconds and ten million statements
to be *loaded* in, which is generous for declaring functions and not generous at
all for doing work at module scope.

Nor does the server call `run` yet. Declarations are checked and stored, and the
functions appear in every workspace, but the calling half of the plugin API is
still being written. Write `run` as though it will be called — it will — and do
not expect a workflow to reach it today.

## Versions

`apiVersion()` says which plugin API a plugin was written against; a server
refuses a version it does not know rather than guessing. `API_VERSION` and
`SUPPORTED_API_VERSIONS` are exported, and this package's job is to track the
server: when the server learns a version, this changes with it.

The rest of what the server enforces is exported too — `PLUGIN_ID`,
`IDENTIFIER`, `MAX_FUNCTIONS`, `MAX_SOURCE_BYTES`, `VALUE_TYPES` — because the
only thing this package really sells is that they are the same numbers.

## Licence

Apache-2.0. The server is AGPL-3.0; this is not, deliberately — a few lines of it
end up inlined in every plugin anybody builds, and what somebody's plugin is
licensed under should be their decision.
