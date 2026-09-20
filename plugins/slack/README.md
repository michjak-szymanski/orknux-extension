# Slack

The whole Slack surface, wrapped so workflows and agents call it by name: read
a thread, follow a permalink, say who an id is, resolve a mention, post, react,
search, carry files both ways — and the one question the raw API never answers
on its own, *is this the first reply in the thread*, written to be a workflow
condition.

Most of it never touches a token. A plugin has no network, so those calls ask
the **server** to talk to Slack, under a capability somebody accepted and
through a connection the workspace pointed it at. The four file functions are
the exception, and say so below.

## Fourteen functions, thirteen of them tools

Everything except `isFirstReply` is fronted to agents as a tool. That one is a
workflow's gate, written to be a condition — a model reading a thread has
better ways to ask.

Twelve of those thirteen are the function itself, under a name an agent can
call. The thirteenth, `uploadBinary`, is a tool of its own with a different
signature — see *Two surfaces* below for why.

Every function in the first two groups takes `connection` first: pass the
connection a trigger says its event arrived on, or an empty string to use the
configured `slack` parameter. The section after the tables says why.

### Reading

| Function | Answers |
|---|---|
| `readThread(connection, channel, threadTs, limit)` | `messages` — each with `ts`, `user`, `text` and whether it is the `parent` — and `replies`, Slack's own count of the whole thread rather than of the page. `limit` defaults to 20. |
| `readMessage(connection, link)` | The one message a permalink points at: `channel`, `ts`, `user`, `text`, `threadTs`. For when a message quotes another by link. |
| `whoIs(connection, userId)` | Who an id belongs to: `id`, `name`, `realName`, `displayName`, `bot`. Takes the id bare or as the whole `<@U…>` notation a message carries it in. |
| `search(connection, query, limit)` | `matches` — `channel`, `channelName`, `ts`, `user`, `text`, `permalink` each — and `total`, how many the whole search holds. Slack's search syntax works: `in:#channel`, `from:@name`, `"an exact phrase"`. |
| `isFirstReply(connection, channel, threadTs, ts)` | `true` only if this message is the first reply in its thread. **Not a tool** — a workflow condition. |

### Writing

| Function | Answers |
|---|---|
| `post(connection, channel, text, threadTs, attachments)` | The new message's `channel` and `ts`. An empty `threadTs` posts to the channel itself. `attachments` hangs files on the message and takes **either kind**: a permalink string for a file already on Slack, or a map for one that isn't there yet — `{filename, content}`, `{filename, base64}`, or `{url}` — which is uploaded first. See below. |
| `react(connection, channel, ts, emoji)` | `true`. The emoji's short name, with or without colons. Already-reacted counts as done. |
| `mention(connection, name)` | The notation Slack renders as a ping — `<@U…>` for a person, `<!subteam^S…>` for a group — from a display name, username, email, id or group handle. Put the answer in a message as it is, and never write `<@…>` from a guessed id. |

### Files out

All four need `botToken`. Which one you want follows from the shape the content
is in:

| Function | For |
|---|---|
| `upload(channel, filename, content, comment, threadTs, contentKey)` | **Text** Slack will host: an SVG, a CSV, a log, JSON, mermaid source. Answers the file's `id` and `permalink`. An empty `channel` uploads without sharing, and the permalink then goes into a later `post`'s `attachments`. `contentKey` takes the bytes from the session store instead of from `content` — see *Passing content by key*. |
| `uploadBinary(channel, filename, …, comment, threadTs)` | **Bytes** Slack will host — a PDF, a rendered diagram. Up to the http door's 10 MB. **The two surfaces differ:** agents pass a `contentKey` and have no base64 argument at all; the workflow function still takes `base64`, because a workflow has no session and so never had a key. See *Two surfaces* below. |
| `uploadFromUrl(channel, url, filename, comment, threadTs)` | **Copying a file from a url onto Slack**, so the channel holds the file rather than a link. Fetches up to 5 MB. An empty `filename` is derived from the url and its content type. |
| `remoteFile(channel, url, title, filetype)` | **Pointing at a url without copying it.** Slack keeps a pointer and shows a card. The right door when the bytes should stay where they are, or exceed the caps above. |

### Files in

| Function | Answers |
|---|---|
| `listAttachments(channel, ts)` | `files` hanging on one message — `id`, `name`, `title`, `filetype`, `mimetype`, `size`, `permalink` each. A message with no files answers an empty list. Reads channel history, falling back to the thread, because a reply is not in the channel's history. |
| `readAttachment(file)` | One attachment by id: `name`, `mimetype`, `size`, and exactly one of `content` (text as text) or `base64` (binary as bytes), the other `null` — plus a `key` naming whichever it was. Hand that straight to `uploadBinary` or `upload` as `contentKey` to move a file between channels without either of you retyping it. |

## Passing content by key

A tool's answer reaches the next tool call by going **through the model**,
which has to write every character of it back out. A few kilobytes does not
survive that trip: a rendered diagram went to Slack with one stray character in
the middle of it and the whole call was rejected as malformed JSON.

So both upload functions take a `contentKey` as well as their content:

```
mermaid_render('flowchart LR
 A --> B')   → { png: 'iVBORw0…', bytes: 18402, key: 'mermaid.1k3af9' }
slack_uploadBinary('C123', 'flow.png', 'mermaid.1k3af9', 'the flow', '')
```

The key is a dozen characters, and what it names never leaves the server — the
render puts the bytes in the session store on the way out, and the upload reads
them back from there.

**Preferred, not exclusive.** A caller holding the text passes `content` as
before, and a workflow node has no session to keep anything in, so `content`
stays the path that always works. A key that names nothing throws and says to
pass the content or render again, rather than uploading an empty file.

**A diagram goes as a picture.** Slack draws no SVG — it hosts one as a file
and shows a card with a filename on it, so an SVG in a channel is something
people have to download before they can see it. `mermaid_render` and
`nomnoml_render` both answer a `png` unless asked otherwise; send that, with a
`.png` filename, through `uploadBinary`. `format: 'svg'` is for a reader that
is not a person.

**Everything else that is text goes to `upload`, not `uploadBinary`.** A CSV, a
log, JSON, a config. Encoding text to base64 to send it as bytes doubles its
length and puts it back through the model, which is the problem this exists to
avoid.

## Two surfaces, on purpose

`uploadBinary` is the one call here whose tool is not its function, and the
signatures differ by one argument:

| | |
|---|---|
| **function** — a workflow step calls this | `uploadBinary(channel, filename, base64, comment, threadTs, contentKey)` |
| **tool** — an agent calls this | `uploadBinary(channel, filename, contentKey, comment, threadTs)` |

The function keeps its `base64`. A workflow has no session, so a key was never
on offer to it, and taking the argument away would close the only door it has.

The tool has nowhere to put bytes at all. A model has a key every time —
everything that makes bytes answers one — and it still wrote five thousand
characters of base64 into the argument, where it arrived a character wrong and
the whole call was rejected as malformed before anything ran. Advice did not
fix that, and a refusal would only have described it after the fact. An
argument a model should never fill is an argument that should not be in front
of it.

That only works because nothing that makes bytes leaves them unnamed:

| Answers a key | |
|---|---|
| `mermaid_render`, `nomnoml_render` | the picture, or the markup |
| `pdf_fromHtml` | the document |
| `slack_readAttachment` | whichever half it read — so a file moves between channels without passing through anybody |

## Parameters

| Name | |
|---|---|
| `slack` | A `SLACK` connection: the Slack to read through when a function is not handed one. Optional. |
| `botToken` | A **bot** token (`xoxb-`), **secret**. The four file functions, `readAttachment`, and `post` when an attachment is a file rather than a permalink. |
| `userToken` | A **user** token (`xoxp-`), **secret**. `search` alone — see *Two tokens* below. Optional: without it, search falls back to the connection's own User Token field. |

## Attaching a file to a message

`post` takes both kinds of attachment, and which one you want follows from
whether the file is on Slack already:

```js
// Already there — a permalink an event or readThread carried. Costs nothing.
post(conn, 'C123', 'here it is', '', ['https://acme.slack.com/files/U1/F2/report.pdf'])

// Not there yet — uploaded first, with botToken, then attached.
post(conn, 'C123', 'this quarter', '', [
  { filename: 'q3.csv',    content: 'region,revenue
EMEA,41000' },
  { filename: 'q3.pdf',    base64:  pdfFromHtml.base64 },
  { url: 'https://ci.acme.com/build/42/chart.png' },
])
```

A string is used as it is and needs no token at all. A map is a file that does
not exist yet: it is uploaded with `botToken` and its permalink goes into the
message with the others, so both kinds end up in one message.

**The upload deliberately does not share to the channel.** Sharing at upload
time makes Slack post the file as its own message — a second message nobody
asked for, arriving before the text that explains it. A permalink in the
message that follows is Slack's own way of hanging a file on a message
somebody wrote, which is why `post` needs nothing beyond `SLACK_POST_MESSAGE`
for the permalink half.

Use the `upload*` functions directly when you want the file to *be* the
message, or when you want its id back.

## Two tokens, because Slack needs two

| | |
|---|---|
| `botToken` | `xoxb-`. Uploads files **as the bot**, under the bot's name and picture. |
| `userToken` | `xoxp-`. Runs `search`, which Slack will not answer for a bot at all: `search.messages` refuses a bot token with `not_allowed_token_type`. |

They used to share a field, and the failure mode was quiet: somebody needs
search, puts a user token in `botToken` because that is the only token field
there is, and from then on every file the workspace uploads is posted by that
person rather than by the app. `tokenOf` still warns when it sees an `xoxp-`,
and now has somewhere to point.

`userToken` is optional. Left empty, `search` uses the connection's own **User
Token** field, which is where a workspace that has one usually keeps it — so
nothing that works today stops working.

## Why the connection is an argument, not just a setting

A workspace with two Slack connections has two Slacks. A reply that arrived on
one has to be read through that one — read through the other it is a thread
that does not exist, or worse, a different thread with the same timestamp.

So every call takes a connection, and a trigger says which one its event came
in on: wire `trigger.connection` to the argument and it is right by
construction rather than by whichever connection happened to be configured.
Passing an empty string falls back to the `slack` parameter, which is what a
workspace with one Slack wants and one fewer thing to wire.

## What it asks for, and why

`TEXT_ENCODING`, for the byte length a file upload declares — the length of
text is a fact about its UTF-8 encoding, not its character count.

Seven Slack capabilities, one per call: `SLACK_READ_THREAD`,
`SLACK_READ_MESSAGE`, `SLACK_READ_USER`, `SLACK_MENTION`,
`SLACK_POST_MESSAGE`, `SLACK_ADD_REACTION`, `SLACK_SEARCH`. Each is the server
making one call for the plugin; the plugin never sees a token and could not use
one.

`NETWORK_REQUEST` — **for the functions that hold a token.** The server's
capability vocabulary has no spelling for "put a file on Slack", so the file
functions go straight at Slack's Web API with `botToken`; `post` joins them
when an attachment is a file rather than a permalink, and `search` does when
`userToken` is set. Everything else here runs on capabilities and never sees a
credential.

### Slack-side scopes

| For | Scope |
|---|---|
| `upload`, `uploadBinary`, `uploadFromUrl`, `post` with a file attachment | `files:write` |
| `remoteFile` | `remote_files:write`, `remote_files:share` |
| `listAttachments` | `files:read`, plus the conversation's history scope |
| `readAttachment` | `files:read` |
| `search` via `userToken` | `search:read`, on a user token |

## Two caveats worth knowing before you debug them

**Search answers only for a user token.** `search.messages` refuses a bot token
with `not_allowed_token_type`, which comes back as the error — so a search runs
on either the `userToken` parameter or the connection's **User Token** field,
and on nothing else.

**A condition that cannot be decided must not quietly decide.** `isFirstReply`
throws when the thread cannot be read rather than answering `false`: "we could
not read the thread" and "this is not the first reply" are different facts, and
a workflow treating them alike would silently stop firing the day a scope was
revoked.

## The skill it brings

**"Posting to Slack so people read it"** — the half-dozen habits that separate
a message people read from one they scroll past: run markdown through
`markdown_toSlack` first, never hand-write a mention, reply in the thread,
attach rather than paste a wall of text. Granted like any other skill catalog;
nothing is automatic.
