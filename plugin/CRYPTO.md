# `orknux.crypto`

What a plugin can compute, and why the server computes it.

## Why this exists at all

GraalJS has no crypto. Not "we turned it off" — the engine offers 108 `js.*`
options and not one of them is a digest, an HMAC or a random number. Node's
`crypto` module belongs to the Node launcher, which is a different runtime from
the embedded context a plugin runs in.

So a plugin cannot hash anything, and that is a wall rather than an
inconvenience: any plugin speaking a database's authentication handshake needs
HMAC-SHA256 and PBKDF2 before it can send a single query, and any plugin
signing a webhook or a JWT needs the same.

This is the smallest surface that removes the wall.

## It is not granted

No permission, no capability, no acceptance dialog. A digest reaches nothing,
sends nothing and learns nothing — it is arithmetic, in the same class as
`JSON.parse`, and the server does it only because the sandbox has no
instruction for it.

That is the line the plugin model already draws: *a permission turns on a
language builtin, and a capability is the server making a call for the plugin.*
This is neither. Making every plugin declare `CRYPTO` to compute a SHA-256
would be a dialog with no decision behind it, and a dialog nobody can answer
meaningfully is one they learn to click through.

What is bounded is size and cost, below.

## Everything crosses as base64

Only text crosses the sandbox boundary, so every byte string — input, key,
salt, output — is standard base64 with padding. A plugin holding text encodes
it first; `TextEncoder` is available under the `TEXT_ENCODING` permission, and
a plugin that would rather not ask for that can pass `{ text: '…' }` instead of
base64 and have the server encode it as UTF-8.

Every call answers an object. On success it carries `base64`; on refusal it
carries `error` and nothing else, the way the other helpers refuse — a refusal
is data a plugin can act on, never a throw.

```js
const { base64, error } = orknux.crypto.hash('sha256', { text: 'hello' });
```

## The surface

### `hash(algorithm, input)`

```js
orknux.crypto.hash('sha256', { base64: '...' })   → { base64 }
orknux.crypto.hash('sha256', { text: 'hello' })   → { base64 }
```

`algorithm` is one of `sha256`, `sha384`, `sha512`, `sha1`, `md5`.

`sha1` and `md5` are here because protocols need them — Postgres's older `md5`
authentication, S3 signatures, Git object ids — and refusing them would send
plugin authors to hand-written implementations that are worse in every way.
They are not for anything new.

### `hmac(algorithm, key, input)`

```js
orknux.crypto.hmac('sha256', { base64: keyB64 }, { text: 'client-key' })
  → { base64 }
```

The same algorithms. Key and input each take `base64` or `text`.

### `pbkdf2(algorithm, password, salt, iterations, length)`

```js
orknux.crypto.pbkdf2('sha256', { text: pw }, { base64: saltB64 }, 4096, 32)
  → { base64 }
```

`length` is the number of bytes wanted. `iterations` is capped — see below.

### `random(bytes)`

```js
orknux.crypto.random(32) → { base64 }
```

From the platform's secure source, not `Math.random`. A SCRAM nonce, a state
parameter, an idempotency key.

### `timingSafeEqual(a, b)`

```js
orknux.crypto.timingSafeEqual({ base64: mine }, { base64: theirs }) → { equal }
```

Comparing a signature with `===` leaks its prefix through how long the
comparison took. A plugin verifying a webhook signature should use this, and
the reason it is here rather than left to the plugin is that a constant-time
comparison written in JavaScript is not constant-time after a JIT has seen it.

## The bounds

| bound | value | why |
|-------|-------|-----|
| input | 8 MB per call | it crosses as base64 and is held in memory twice |
| `iterations` | 1,000,000 | a plugin asking for ten million blocks a thread for minutes |
| `length` | 1024 bytes | past any key anybody derives |
| `random` | 1024 bytes | the same |

The iteration cap is the one worth explaining. PBKDF2 is deliberately slow, and
the work happens on the server's side of the sandbox where the script guard's
wall-clock bound does not reach it — so a plugin naming a large enough number
is a denial of service against the whole installation rather than against its
own call. Postgres asks for 4096. Over the cap is a refusal naming it, not a
silent clamp: a plugin that thinks it did 10,000,000 rounds and got 1,000,000
has a security bug nobody can see.

## What a Postgres handshake needs from this

For the record, because it is the case that forced the surface:

```
SCRAM-SHA-256:
  random(18)                          → the client nonce
  pbkdf2('sha256', password, salt, i, 32)  → SaltedPassword
  hmac('sha256', SaltedPassword, 'Client Key')  → ClientKey
  hash('sha256', ClientKey)           → StoredKey
  hmac('sha256', StoredKey, authMessage)  → ClientSignature
```

Five calls, all of them here. The remaining blocker for a database plugin is
transport, not arithmetic — see the socket question, which this does not
answer.

## What it is not

It is not a TLS implementation. A plugin cannot negotiate a session, and
nothing here helps it try; a connection that needs TLS needs the server to
terminate it.

It is not asymmetric. No key generation, no signing with a private key, no
certificate handling. Those want a key to live somewhere and be managed, which
is a connection's job rather than a helper's, and inventing it before something
needs it would be guessing.
