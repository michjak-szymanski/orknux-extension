# Working in orknux-extension

Notes for anyone — human or agent — changing this repository. See
[README.md](README.md) for what it is, and [plugin/README.md](plugin/README.md)
for what it is like to use.

## Commands

There is no Node on the development machine; the toolchain runs in a container.

```
docker compose run --rm dev npm install
docker compose run --rm dev npm test          # builds, then node --test
docker compose run --rm dev npm run typecheck
docker compose run --rm dev npm run example
```

`npm test` builds first on purpose: the tests import `dist/`, not `src/`, so what
they exercise is what gets published — including the `.d.ts` emit, which is half
of what this package is.

## The rule this repository exists to keep

The server defines `OrknuxPlugin` and `OrknuxFunction` in the sandbox and then
checks a plugin's default export by prototype. **Nothing here may ever bundle a
class of its own into a plugin.** `src/contract.ts` exports bindings to the
globals; the fallback classes beneath them exist for Node, where the globals are
absent, and they are a copy of the server's `PluginRunner.CONTRACT` — wording
included, because the wording is what somebody reads when their plugin is
refused.

Three files mirror the server, and drift in any of them is a broken promise:

| here                  | there                                     |
|-----------------------|-------------------------------------------|
| `src/contract.ts`     | `PluginRunner.CONTRACT`                   |
| `src/inspect.ts`      | `PluginRunner.read`                       |
| `src/validate.ts`     | `PluginDeclarations.validated`            |
| `src/limits.ts`       | `PluginApiVersions`, `PluginUploadAPI`, `PluginRunner` |

Where this is deliberately stricter than the server, the comment says so and
says why — a parameter typed `none` is the one such place today. Stricter is
allowed, because it can only refuse something no plugin should be doing.
Looser is not: the whole point is that a plugin which passes here is one the
upload accepts.

## Conventions

- **The main entry point must stay bundle-safe.** `src/index.ts` may import
  nothing that touches Node — no `node:fs`, no esbuild, no dynamic import.
  Anything that does goes behind `@orknux/plugin/tooling`, which a plugin never
  imports. A regression here is not a type error; it is a plugin bundle that
  tries to inline esbuild.
- **Types carry the declaration into `run`.** `params` is a tuple, captured with
  a `const` type parameter, and `OrknuxArgs` reads the argument types off it.
  That is the feature; anything that erases it back to `unknown[]` has removed
  the reason to use this over the server's template.
- Comments say why, not what. TSDoc on everything exported.
- No dependencies but esbuild, and it is only reached from the tooling entry
  point. A plugin toolchain that pulled in an argument parser would be a
  dependency in every plugin project for the sake of three flags.

## Tests

`node:test`, in plain JavaScript against `dist/`. Written in the server's own
wording — `assert.match(problem.message, /is not a usable function name/)` — so
that a message changing there shows up here as a failure rather than as two
products saying different things about the same refusal.

`bundle.test.js` is the important one: it builds each fixture the way the CLI
does and then loads the result. `fixtures/imported.ts` proves the import style
survives bundling, `fixtures/ambient.js` proves the no-imports style still
loads, `fixtures/shaped.js` proves that something merely shaped like a plugin is
refused, and `fixtures/reaching.js` proves that a plugin reaching for Node fails
the build rather than the server.

## Releasing

The version in `plugin/package.json` is the one published, and a `v*` tag is what
publishes it — CI checks that the two agree and refuses the tag if they do not.
The plugin API version this package targets is `API_VERSION` in `src/limits.ts`,
and it is unrelated to both on purpose: this package can go out several times
against one plugin API.

When `API_VERSION` moves, the `plugin API` badge in both READMEs moves with it.
It is a static badge — there is nothing to read it off — so it is the one number
here that can drift without a test noticing.
