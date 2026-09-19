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

Every function in the first two groups takes `connection` first: pass the
connection a trigger says its event arrived on, or an empty string to use the
configured `slack` parameter. The section after the tables says why.

### Reading

| Function | Answers |
|---|---|
| `readThread(connection, channel, threadTs, limit)` | `messages` — each with `ts`, `user`, `text` and whether it is the `parent` — and `replies`, Slack's own count of the whole thread rather than of the page. `limit` 0 for the default of 20. |
| `readMessage(connection, link)` | The one message a permalink points at: `channel`, `ts`, `user`, `text`, `threadTs`. For when a message quotes another by link. |
| `whoIs(connection, userId)` | Who an id belongs to: `id`, `name`, `realName`, `displayName`, `bot`. Takes the id bare or as the whole `<@U…>` notation a message carries it in. |
| `search(connection, query, limit)` | `matches` — `channel`, `channelName`, `ts`, `user`, `text`, `permalink` each — and `total`, how many the whole search holds. Slack's search syntax works: `in:#channel`, `from:@name`, `"an exact phrase"`. |
| `isFirstReply(connection, channel, threadTs, ts)` | `true` only if this message is the first reply in its thread. **Not a tool** — a workflow condition. |

### Writing

| Function | Answers |
|---|---|
| `post(connection, channel, text, threadTs, attachments)` | The new message's `channel` and `ts`. An empty `threadTs` posts to the channel itself; `attachments` takes permalinks of files already on Slack and attaches each. |
| `react(connection, channel, ts, emoji)` | `true`. The emoji's short name, with or without colons. Already-reacted counts as done. |
| `mention(connection, name)` | The notation Slack renders as a ping — `<@U…>` for a person, `<!subteam^S…>` for a group — from a display name, username, email, id or group handle. Put the answer in a message as it is, and never write `<@…>` from a guessed id. |

### Files out

All four need `botToken`. Which one you want follows from the shape the content
is in:

| Function | For |
|---|---|
| `upload(channel, filename, content, comment, threadTs)` | **Text** Slack will host: a CSV, a log, JSON, mermaid source. Answers the file's `id` and `permalink`. An empty `channel` uploads without sharing, and the permalink then goes into a later `post`'s `attachments`. |
| `uploadBinary(channel, filename, base64, comment, threadTs)` | **Bytes** Slack will host, as base64 — a PDF, an image. Up to the http door's 10 MB. `pdf_fromHtml` answers base64 ready for this. |
| `uploadFromUrl(channel, url, filename, comment, threadTs)` | **Copying a file from a url onto Slack**, so the channel holds the file rather than a link. Fetches up to 5 MB. An empty `filename` is derived from the url and its content type. |
| `remoteFile(channel, url, title, filetype)` | **Pointing at a url without copying it.** Slack keeps a pointer and shows a card. The right door when the bytes should stay where they are, or exceed the caps above. |

### Files in

| Function | Answers |
|---|---|
| `listAttachments(channel, ts)` | `files` hanging on one message — `id`, `name`, `title`, `filetype`, `mimetype`, `size`, `permalink` each. A message with no files answers an empty list. Reads channel history, falling back to the thread, because a reply is not in the channel's history. |
| `readAttachment(file)` | One attachment by id: `name`, `mimetype`, `size`, and exactly one of `content` (text as text) or `base64` (binary as bytes), the other `null`. |

## Parameters

| Name | |
|---|---|
| `slack` | A `SLACK` connection: the Slack to read through when a function is not handed one. Optional. |
| `botToken` | A bot token, **secret**, used only by the four file functions and `readAttachment`. Everything else runs without it. |

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

`NETWORK_REQUEST` — **for the file functions alone.** The server's capability
vocabulary has no spelling for "put a file on Slack", so those four go straight
at Slack's Web API with the `botToken` above. They are the only functions here
that hold a credential.

### Slack-side scopes

| For | Scope |
|---|---|
| `upload`, `uploadBinary`, `uploadFromUrl` | `files:write` |
| `remoteFile` | `remote_files:write`, `remote_files:share` |
| `listAttachments` | `files:read`, plus the conversation's history scope |
| `readAttachment` | `files:read` |

## Two caveats worth knowing before you debug them

**Search answers only for a user token.** `search.messages` refuses a bot token
with `not_allowed_token_type`, which comes back as the error — so the
connection's **User Token** field is what a search actually runs on.

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
