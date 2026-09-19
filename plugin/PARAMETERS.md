# Parameters that say more

Two additions, and a note on what each is worth. Both exist to delete something
a plugin is currently writing by hand.

## Status, before anything else

| what | the server today |
|------|------------------|
| `options` on a plugin parameter | **accepted** — declare it and it is stored |
| a picker on the settings page | **drawn** — a parameter naming values is chosen from a list |
| `required: false` and `default` on a *function* parameter | **accepted** |

All three are live. The last of them took the longest because it had to mean
the same thing to four readers at once — see below.

## 1. `options` on a plugin parameter

```ts
param({
  name: 'backend',
  type: 'string',
  description: 'Which search service to ask.',
  options: ['tavily', 'brave'],
})
```

What it replaces: a plugin checking the string itself and throwing a sentence
that lists the choices. That sentence was written twice, in the same shape, in
two plugins — and a typo in a text box is found at the first call, while a
choice that cannot be typed cannot be mistyped.

Rules, all refused at load:

- a non-empty array of non-empty strings
- no duplicates, at most 50 of them
- not on a `secret` — a secret cannot be one of a set somebody can read
- not on a `connection` — that names a row the workspace has, and already has
  its own picker

`required` still means what it meant. A parameter with options and
`required: false` is one a workspace may leave alone.

## 2. Optional function parameters

The problem, in the words the plugins actually use:

```
limit: number       // "0 for the default"
connection: string  // "an empty string to use the configured one"
timezone: string    // "an IANA name; empty for the configured one"
```

Thirty-six places say some variant of that. Every one is a workaround for the
same thing: every positional argument has to be supplied, so a plugin invents a
sentinel and then spends a sentence explaining it. Those sentences live in tool
descriptions a model reads on every call — so the convention costs context
repeatedly, and "pass 0 to mean default" is exactly the kind of instruction a
model gets wrong.

The shape being proposed:

```ts
params: [
  { name: 'channel', type: 'string' },
  { name: 'limit', type: 'number', required: false, default: 20 },
]
```

which would delete the sentinel, the `limit || 20` idiom, and the sentence.

**What `run` sees does not change.** The server puts the default in before the
call, so every argument still arrives — there is no `undefined` to guard
against and no `limit || 20` left to write.

**Two things are refused at load**, rather than at the call that would have
found them:

- a default that is not of the parameter's own type, which otherwise shows up
  only when somebody leaves that argument out — months later, in somebody
  else's workflow
- an optional parameter before a required one. Arguments are positional, so
  "may be left out" only means anything at the end; nothing downstream could
  tell which argument was missing.

A default also implies `required: false`. Writing one alongside
`required: true` is refused rather than ignored: a default that can never apply
is a mistake, not a preference.

**What it took.** A function's parameters are rows read by four things — the
workflow editor's argument form, the tool spec a model is given, the caller
that positions the arguments, and the editor that lets somebody take a plugin
function over. All four now agree, and the schema a model is given says
`required` per parameter instead of true for everything, with the default named
in the description: *"how many come back, 20 if not given"* answers the question
the sentinel used to answer badly.

## 3. `definePlugin` takes `skills` and `objects` — accepted

It handled everything else and silently not these two, so the ergonomic way to
write a plugin was the one that could not teach an agent or export a shape.

```ts
export default definePlugin({
  id: 'jira',
  skills: [new OrknuxSkill({ name: 'Triage', content: '…' })],
  objects: [new OrknuxObject({ name: 'Issue', properties: [ … ] })],
})
```
