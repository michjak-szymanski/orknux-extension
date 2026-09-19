# Jira

The other half of the sentence the github plugin starts. A pull request merging
is only half of "the work is done"; the other half is a ticket moving, and a
workflow that can read one and not write the other is a workflow somebody
finishes by hand.

So: find issues by JQL, open one whole, comment on it, move it through its
workflow, and raise a new one. Every call is made by the server on the plugin's
behalf under `NETWORK_REQUEST` — the plugin never holds the token.

| Function | |
|----------|---|
| `search(jql, limit)` | Jira's own query language: `project = PROJ AND status = "In Progress"`, `assignee = currentUser() ORDER BY updated DESC`. |
| `openIssue(key)` | One issue whole, description included, as text. Answers the `Issue` shape below rather than a bare map. |
| `comment(key, text)` | A comment, as plain text. |
| `transition(key, to)` | Moves an issue — what dragging its card to another column does. |
| `createIssue(project, type, summary, description)` | Raises a new one. |

`transition` takes a status or transition **by name**, matched whatever the
capitals, because an id is a number out of somebody's workflow configuration
that nobody knows. Which moves are possible depends on where the issue is right
now, so the list is read at the moment of asking and a name that is not
available is refused with the ones that are.

## The shape it exports

`objects()` declares **`Issue`**, which arrives in a workspace as `jira_Issue`.
`openIssue` answers it instead of a `map`, so a workflow built against it knows
that `status` is a string and `labels` is a list of them without reading this
file to find out.

| Field | | |
|---|---|---|
| `key` | string | `PROJ-123`, which every other call takes |
| `summary` | string | the one-line title |
| `description` | string | the body, as text — null from a search |
| `status` | string | where it sits in its workflow |
| `type` | string | Task, Bug, Story |
| `priority` | string | null where the project does not use them |
| `assignee` / `reporter` | string | display names |
| `labels` | array of string | empty from a search |
| `resolution` | string | why it closed, or null while open |
| `created` / `updated` | string | ISO 8601, as Jira gives it |
| `url` | string | the browse link |

`search` still answers a `map` holding a list of these: it fills `description`,
`labels` and `resolution` as null and empty rather than leaving them out, so
one shape describes both calls and a caller reading `labels` gets a list either
way.

## Setting one up

1. Load this plugin and accept `TEXT_ENCODING` and `NETWORK_REQUEST`.
2. Set `url` to the site root — `https://your-site.atlassian.net` for Cloud, or
   the base url of a Server install.
3. Put the credential in a workspace variable and point `token` at it. For
   Cloud that is an API token and `email` must say whose it is; for Server it is
   a personal access token and `email` stays empty.
4. Optionally set `project`, the key new issues belong to unless a call names
   one.

That `email` setting is the same signal the confluence plugin uses, because it
is the same company's two products — and here it also picks the search
endpoint, which is the one place Cloud and Server genuinely differ.

## Why v2 everywhere except search

Jira's v3 API speaks Atlassian Document Format: a description or a comment is
not a string but a tree of nodes, and posting a one-line comment would mean
building one. v2 takes and answers plain text, so v2 is what this uses for
reading an issue, commenting, transitioning and creating.

Search is the exception, and not by choice. Atlassian **removed**
`/rest/api/2/search` and `/rest/api/3/search` from Cloud through the second half
of 2025 — they answer 410 now — leaving `POST /rest/api/3/search/jql`, which is
bounded: it wants an explicit field list, it pages by a cursor rather than an
offset, and it does not answer a total at all. Server and Data Center still have
v2 search and still answer a total. So `search` picks its endpoint by the same
`email` setting, and `total` comes back null on Cloud rather than invented.

Should an instance ever hand back Atlassian Document Format where v2 used to
answer text, the tree is walked for its text rather than shown to a caller as
`[object Object]`.
