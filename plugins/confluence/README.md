# Confluence

The wiki beside the work. The answer to half the questions a workflow or an
agent is asked lives on a Confluence page, so this plugin offers the two
calls that matter: **search** the wiki, and **open a page** as readable text.

Point `url` at the wiki's root (Cloud or Server/Data Center), keep the
credential in a workspace variable, and accept `NETWORK_REQUEST` — the server
makes the calls; the plugin never holds the token.

## Two functions, both tools

| Function | Answers |
|---|---|
| `search(query, limit = 20)` | `total` and `matches` — `id`, `type`, `title`, `space`, an `excerpt` around the match, `updated` and `url` each. `openPage` takes either the id or the url. |
| `openPage(page)` | One page whole: `id`, `title`, `space`, `version`, `updated`, `by` — who last changed it — `url`, and the `body`. |
| `findUsers(name, limit)` | People by name — `Jo Smith`, or just `jo`. The one call that takes a label, and it answers the ids every other call needs. |
| `openUser(person, withAvatar)` | Who an id belongs to: display name, email where Atlassian will say, whether it is a person or an app, and a profile link. Takes a mention copied straight out of a page. `withAvatar` fetches the picture itself as base64. |

Both are fronted to agents, which is most of the point: a model that can look
something up on the wiki stops guessing at it.

### Searching with words or with CQL

`search` passes the query through as written, so both of these work:

```
search('deployment runbook')                       // plain words, page text
search('space = "DOC" AND title ~ "runbook"')      // CQL
search('type = blogpost AND lastmodified > now("-4w")')
```

Plain words search page text. CQL is Confluence's own query language and is
the sharper instrument — `space`, `title`, `type`, `label`, `creator`,
`lastmodified` — when a search needs to be exact rather than lucky.

### Opening a page by id or by link

`openPage` takes whatever names the page, which is usually whatever somebody
pasted:

```
openPage('123456')                                          // the id
openPage('https://acme.atlassian.net/wiki/spaces/DOC/pages/123456/Runbook')
openPage('https://wiki.acme.com/pages/viewpage.action?pageId=123456')
```

Cloud's `/spaces/KEY/pages/123/` form and Server's `?pageId=123` form are both
understood. A `search` result's `url` can be handed straight back.

## A mention is an id, not a name

This is the thing that makes a page body hard to read. Confluence stores a
mention as markup carrying an identifier:

```xml
<ac:link><ri:user ri:userkey="ff8080816f2b1c34016f2b1c34000001"/></ac:link>   <!-- Server -->
<ac:link><ri:user ri:account-id="5b10ac8d82e05b22cc7d4ef5"/></ac:link>        <!-- Cloud -->
```

So "who owns this runbook" comes back as a string of hex, and that is true of
any macro wrapping an `<ri:user>` — a mention, a profile macro, an author
parameter.

`openPage` therefore answers a `mentions` list: every id in the body, each
once, read out of the markup rather than asked for. `openUser` turns one into
a person:

```
openUser('ff8080816f2b1c34016f2b1c34000001')                       // Server: a user key
openUser('<ac:link><ri:user ri:userkey="ff80…"/></ac:link>')       // or the mention, pasted whole
openUser('5b10ac8d82e05b22cc7d4ef5')                               // Cloud: an account id
openUser('https://wiki.acme.com/display/~jsmith')                  // or a profile url
openUser('jsmith')                                                 // Server: a username
```

Which kind of id a bare string is depends on the deployment, and the plugin
decides that the same way it decides everything else — off `email`. On Cloud
it is an account id, because Cloud retired usernames. On Server a
32-character hex string is a user key and anything else is a username, which
is the distinction Confluence itself draws.

### The avatar, and why fetching it is opt-in

`avatarUrl` is a url and never the image — and it sits behind the same login
as the wiki, so handing it to somebody who is not signed in shows them
nothing. `withAvatar: true` therefore fetches the picture with the plugin's
own credential and answers it three ways: `avatar` as base64, `avatarType`
as what the bytes are, and `avatarKey` naming them in the session store —
pass that key to `slack_upload` rather than copying base64 through a model.

It is off by default because a name and an email are what a lookup is usually
for, and bytes nobody asked for are bytes through the model. A fetch that
fails leaves all three empty and the lookup intact: an avatar is decoration,
and failing a whole lookup over a missing default picture would be the wrong
trade.

**The url hangs off the site, not off the wiki.** Cloud's `_links.base` ends
in `/wiki` and the avatar path *begins* with `/wiki`, so joining them the
obvious way asks for `/wiki/wiki/aa-avatar/…` and 404s. This builds it from
the scheme and host instead, which is right on both deployments.

**A display name is not an identifier**, so there is no `openUser("Jo Smith")`
— Confluence looks a person up by key, not by label. `findUsers` is the call
that takes a name, and it answers people carrying the ids everything else
needs:

```
findUsers('Jo Smith')   →  { total: 2, users: [ { id, name, url, … }, … ] }
```

It matches on the full name the way the people directory does, so a fragment
is enough. This is the one place the two deployments genuinely differ, the
same way the jira plugin's search does: Cloud has `/rest/api/search/user`,
and Server asks the CQL search everything else goes through with `type=user`.
Which one runs is decided off `email`, like everything else here.

The people it answers are the same `User` shape `openUser` gives, with the
avatar bytes empty — a search fetches no pictures.

Resolve the one you need rather than all of them — a page mentioning eight
people is eight requests if you ask for eight, and usually only the owner
mattered.

**The body is Confluence storage format**, which is XHTML — not markdown, not
plain text. Read it as HTML. That is what Confluence actually stores, and
converting it here would mean choosing a lossy target for everybody.

## Parameters

| Name | |
|---|---|
| `url` | The wiki's root. **Required.** `https://your-site.atlassian.net/wiki` for Cloud, or the base url of a Server/Data Center install. |
| `email` | Whose API token `token` is. Set for Cloud, **left empty for Server/Data Center** — this is the field that picks the authentication scheme. |
| `token` | The credential. **Secret**, so it lives in a workspace variable and is never typed into a page. An API token on Cloud, a personal access token on Server. |

### Cloud or Server is read off `email`

Atlassian has two authentication schemes, and which one applies is decided by
whether `email` is set rather than by asking anybody to say which install they
have:

| `email` | Sent as | Which install |
|---|---|---|
| set | `Basic base64(email:token)` | Cloud |
| empty | `Bearer token` | Server / Data Center |

Nothing else about the two differs here: `/rest/api/search` and
`/rest/api/content` answer on both.

## What it asks for, and why

`NETWORK_REQUEST`, and nothing else. It is the widest capability there is,
asked for because this plugin is about exactly one outside service — every
request goes to the `url` above. The plugin has no network of its own; the
server makes each call on its behalf, so the token is never in the sandbox.

**No permission at all.** Basic authentication is base64, and the sandbox has
no `btoa` on purpose. This file used to carry the alphabet, the loop, and a
`TEXT_ENCODING` permission to reach the bytes. `orknux.encoding` replaced all
three — encoding is ungranted because it reaches nothing, being arithmetic on
a string the way a digest is.

## The shapes it exports

`Match`, `Search`, `Page` — so a workflow passes a page around rather than a
bare map, and a condition reads `.space` instead of indexing into JSON.
`orkx plugin check` prints every field.

## A caveat worth knowing before you debug it

**A search that answers nothing may be a permissions answer, not an empty
wiki.** Confluence filters results by what the credential can see, so a query
that works in the browser can come back empty through a token with narrower
access. Check the token's own view of the space before assuming the CQL is
wrong.
