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
docker compose run --rm dev npm run pack --workspace @orknux/plugins
```

`plugins/pack.sh` and `plugins/pack.ps1` wrap that last one for a POSIX shell
and for PowerShell, so packing is one command from either:

```
plugins/pack.sh github        # or .\plugins\pack.ps1 github
plugins/pack.sh               # every plugin
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

**Slack's and Microsoft's are not there, and that is not an oversight.**
simple-icons does not ship either — Slack's is tracked under a *permission
required* label — but the decisive reason is Slack's own brand terms rather
than anybody else's policy. Two lines of them rule this out:

- *"Most uses require a specific written license"*, which redistributing the
  mark in a public Apache-2.0 repository is not covered by; and
- *"Don't modify the marks"*, spelled out to include changing their colours —
  which is exactly what the `currentColor` treatment below does to every icon
  here.

So the second point would bite even with a licence: an official Slack mark
could not join this set on the set's own terms. It would have to ship
unmodified and full-colour, as a deliberate exception, from
[Slack's brand portal](https://brand.slackhq.com/logo) — and the
`currentColor` assertion in `manifests.test.js` would need to make room for it.
Microsoft's guidelines are the same shape. Until somebody takes that on,
`slack` and `teams` wear drawn glyphs. `pdf`, `todo`, `date` and `web` front no
service and never had a mark to use.

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

**A plugin that knows how its work should be done says so in `skills()`.**
A tool description is read one at a time, at the moment of calling, by a model
that has already decided to call something. The decisions worth changing happen
earlier — before the first step, or in the gap between two calls — and a skill
is the only surface read then. So the rule of thumb: if the guidance is *what
this argument means*, it belongs in the tool description; if it is *when to
reach for this at all*, or *what to check first*, it is a skill.

Write the description as the line a model chooses from with the page still
closed — "What to do when a release is bad" earns the click and "Deploy skill"
does not — and leave the frontmatter out, because the server writes it from the
name and description and stating the same two facts twice is how they drift.

**Packing is driven by the manifest, never by walking the folder.**
`plugins/pack.mjs` puts the plugin, its `plugin.json`, the README that manifest
names, the icon and the libraries `libraries()` declares at a zip's top level —
and nothing else. `src/` is excluded by construction rather than by a rule:
shipping `src/mermaid.js` would ship a file full of bare imports that cannot
load at all. Each plugin is inspected first, the way the server inspects it, so
packing fails on something the server would refuse rather than producing a zip
that fails at the upload. Zips land in `plugins/dist/`, which is ignored, and
are deterministic — every entry carries a fixed 1980 timestamp, so the same
input packs to the same bytes and a zip that differs is a plugin that changed.

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

## Releasing the plugins

A `plugins-v*` tag packs every plugin and attaches the zips to a GitHub
release — `.github/workflows/plugins.yml`. A separate namespace from `v*`,
which is the *library's* version: the plugins carry their own versions in their
own `plugin.json` files and change far more often, so tagging the library to
ship a slack fix would say something untrue.

```
git tag plugins-v2026.09.19 && git push origin plugins-v2026.09.19
```

Running it from the Actions tab instead makes no release and leaves the zips as
a build artifact, which is what checking the pack still works wants.

Two guards run before anything is published. The **rebuild check** runs
`build:plugins` and `build:icons` and fails on any diff — a zip is packed from
the checked-in artifact, so an artifact that no longer matches its source would
otherwise ship silently. The **zip check** opens each zip and runs the CLI's
`check` on the plugin inside, so a zip holding something the server would refuse
fails before the release exists rather than on somebody's installation.

The zips stay out of the repository on purpose: they hold only files that are
already committed, in a form git cannot delta, and `pdf` alone is 1.6 MB that
would be rewritten whole every time it is rebuilt.

## Releasing

The version in `plugin/package.json` is the one published, and a `v*` tag is what
publishes it — CI checks that the two agree and refuses the tag if they do not.
The plugin API version this package targets is `API_VERSION` in `src/limits.ts`,
and it is unrelated to both on purpose: this package can go out several times
against one plugin API.

When `API_VERSION` moves, the `plugin API` badge in both READMEs moves with it.
It is a static badge — there is nothing to read it off — so it is the one number
here that can drift without a test noticing.
