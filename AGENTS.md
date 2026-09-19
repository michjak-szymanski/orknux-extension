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
docker compose run --rm dev npm run build:plugins   # the plugins that bundle libraries
docker compose run --rm dev npm run build:icons --workspace @orknux/plugins
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

Five files mirror the server, and drift in any of them is a broken promise:

| here                  | there                                     |
|-----------------------|-------------------------------------------|
| `src/contract.ts`     | `PluginRunner.CONTRACT`, `HostHelpers`    |
| `src/inspect.ts`      | `PluginRunner.read`                       |
| `src/validate.ts`     | `PluginDeclarations.validated`, `validatedTools` and `validatedParameters`, `PluginPermissions`, `PluginCapabilities` |
| `src/limits.ts`       | `PluginApiVersions`, `PluginUploadAPI`, `PluginRunner`, `PluginPermission`, `PluginCapability`, `ConnectionType` |
| `types/globals.d.ts`  | the TypeScript template `PluginUploadAPI` serves |

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

## What a plugin's folder carries

Every directory under `plugins/` holds the same four things, and
`manifests.test.js` checks that it does:

| file | |
|------|---|
| `<name>.js` | the plugin, as the server loads it — one file, no imports it cannot resolve |
| `plugin.json` | the marketplace manifest |
| `README.md` | the long description, as markdown, which the manifest names |
| `icon.svg` | the face beside the name, drawn in `currentColor` so one file suits a light listing and a dark one |
| `lib/`, `src/` | libraries it ships with, or the source a built plugin is bundled from |

Four of the icons are the real marks — GitHub, Confluence, Prometheus, Mermaid
— written by `plugins/icons.mjs` out of [simple-icons], which is CC0 while each
trademark stays its owner's. Using one to say what a plugin works with is the
use trademark law has always allowed, and `npm run build:icons` regenerates
them; do not hand-edit those four.

**Slack's and Microsoft's are not there, and that is not an oversight.** Both
were removed from simple-icons at the brand owners' request, which is those
owners saying they do not want their marks redistributed this way — so `slack`
and `teams` wear drawn glyphs, and only somebody taking the assets from Slack's
own media kit or Microsoft's brand centre, under those companies' terms, should
change that. `pdf` and `todo` front no service and never had a mark to use.

All eight are drawn in `currentColor` rather than a brand hex: half the marks
are near-black and would vanish on a dark listing, and a fill attribute
survives the sanitizing a marketplace does to uploaded markup where a `<style>`
block carrying a media query might not.

[simple-icons]: https://simpleicons.org

`plugin.json` is the marketplace's file, not ours: its shape is
`plugins/plugin.schema.json`, copied from that service so editors validate
against it and so the test can. `plugins/plugin.example.json` is a filled-in
one to copy when writing a new plugin.

There is no catalog above these, and there should not be one: a plugin is
described in its own folder and nowhere else, so what is on offer is whatever
carries a `plugin.json`. A list at the root repeating the same prose is one
more thing to write and one more thing that can disagree with the code.

The manifest is prose, with one exception. The marketplace does not read what a
plugin will ask to be allowed and does not vouch for it — permissions,
capabilities and libraries are discovered by the installing server from the
code itself, in its sandbox, when somebody accepts them. The one claim checked
is `key`, which must be what `id()` answers, because a listing keyed
differently from the code is a listing that installs as something else. That
check is the reason `manifests.test.js` exists.

**A plugin that bundles a library is a build.** Its source lives in `src/` and
the checked-in `<name>.js` beside it is the artifact — so the artifact is what
the tests load, what a URL serves, and what the manifest's `path` names.
Editing the artifact by hand is editing a bundle. `plugins/build.mjs` mirrors
the tooling's own bundler settings; where it differs — minification, the
`browser` exports condition, the `.ttf` loader, the `fs`/`path` stubs — the
comment there says why.

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
