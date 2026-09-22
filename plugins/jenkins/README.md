# Jenkins

The question asked in the minute after something goes red: which job, which
build, what broke, and can it be run again. It is answered today by somebody
opening a browser tab, and the answer is nearly always one of four things — the
job's state, a build's result, the failing tests, the last hundred lines of the
log.

Every call is made by the server on the plugin's behalf under
`NETWORK_REQUEST` — the plugin never holds the token.

| Function | |
|---|---|
| `jobs(folder, limit)` | What is on the Jenkins, or inside one folder. `more` says whether there were others. |
| `job(job)` | One job whole, including the **parameters** a build takes. Read this before triggering. |
| `build(job, which)` | One build: result, duration, what caused it, and the commits in it. |
| `buildLog(job, which, lines)` | The **end** of the console output, which is where a build says why it stopped. |
| `testResults(job, which, limit)` | The counts, and the failing cases by name with their messages. |
| `trigger(job, parameters)` | Asks for a build. Answers a queue item, not a build. |
| `queueItem(item)` | Whether that queued build has started, and what number it got. |

All seven are fronted to agents, and two skills travel with them: one on
triaging a failure without dragging a megabyte of log into the answer, one on
what triggering actually does.

## Naming a job, and naming a build

`job` takes whatever names it, which is usually whatever somebody pasted:

```
job('deploy')                                        // a job at the top level
job('platform/services/deploy')                      // a path through folders
job('https://ci.example.com/job/platform/job/deploy/')
job('https://ci.example.com/job/deploy/412/')        // a link to a build
```

Folders nest, and a folder is **not** listed into: `jobs()` answers it with
`folder: true`, and passing that name back lists what is inside it. That is one
call per level, deliberately — a recursive listing of a large controller is a
very expensive way to find one job.

`which` takes a build number as a string, or one of Jenkins' own permalinks —
`lastBuild`, `lastCompletedBuild`, `lastStableBuild`, `lastSuccessfulBuild`,
`lastFailedBuild`, `lastUnsuccessfulBuild` — and is `lastBuild` when it is not
given. A url that names a build answers that build whatever `which` says,
because a link to build 412 is a link to build 412.

**Only the path is read out of a url; the host is not.** Every request goes to
the `url` parameter below, so a link to a *different* Jenkins names a job on
this one, or nothing at all.

## Two answers Jenkins gives that are not answers

**A job's status is a colour.** `blue` is passing, `red` is failing, `yellow`
is unstable, and an `_anime` suffix means it is building right now — so
`red_anime` is "failing, and currently building". Nobody should have to know
that: `status` is a word here (`passing`, `failing`, `unstable`, `aborted`,
`never built`, `disabled`) and `building` is a boolean beside it.

**A link Jenkins writes points wherever its administrator said it lives**,
which on a great many instances is still `http://localhost:8080`. So every
`url` answered here is built from the `url` this plugin was given, which is the
one address known to work — it is the one the answer just came back from.

## The log is fetched by the tail, not by the whole

A console log runs to megabytes, and everything handed to a plugin has to fit
in a sandbox. So `buildLog` asks Jenkins how long the log is — `progressiveText`
says so in a header, and takes a byte offset — and fetches only a window off
the end of it. A 40 MB log costs a window rather than 40 MB.

Where that header does not come back — an old controller, a proxy that drops
it, a `HEAD` nobody answers — the whole console is fetched and cut here
instead. Same answer, dearer.

`truncated` says there is more above what came back. There is deliberately no
call that answers a whole log: if the tail does not say, ask for more lines,
and quote the `url` so a person can read the rest.

## The shapes it exports

`Job`, `Jobs`, `Parameter`, `Build`, `Change`, `Log`, `Tests`, `Failure`,
`Queued` — so a workflow passes a build around rather than a bare map, and a
condition reads `.result` instead of indexing into JSON.

`Job` is one shape for both calls that answer a job, the way jira's `Issue` is:
a listing leaves `buildable`, `inQueue`, `health` and `parameters` empty rather
than absent, so a caller reading `parameters` gets a list either way instead of
finding out which call it came from. `orkx plugin check` prints every field.

## Parameters

| Name | |
|---|---|
| `url` | The controller's root. **Required.** `https://ci.example.com`, or `https://example.com/jenkins` where it is served under a path. |
| `user` | Whose API token `token` is. Jenkins authenticates a token *as somebody*, so a token with no user is refused here rather than sent as something Jenkins cannot read. |
| `token` | An API token, made on that user's own configuration page. **Secret**, so it lives in a workspace variable. A password works on most instances and should not be used. |

Both credential fields are optional, and the two go together: set neither and
the instance is read anonymously, which is a real way to run a public Jenkins
and no way at all to trigger a build on one.

## What it asks for, and why

`NETWORK_REQUEST`, and nothing else. It is the widest capability there is,
asked for because this plugin is about exactly one outside service — every
request goes to the `url` above. The plugin has no network of its own; the
server makes each call on its behalf, so the token is never in the sandbox.

**No permission at all.** Basic authentication is base64, and the sandbox has
no `btoa` on purpose. `orknux.encoding` does the UTF-8 and the base64, and it
is ungranted because it reaches nothing — it is arithmetic on a string, the way
a digest is.

## The CSRF crumb, and why a POST fetches one first

Jenkins protects against cross-site request forgery with a crumb: a token read
from `/crumbIssuer/api/json` and sent back on every POST. Since Jenkins 2.96 a
request authenticated with an **API token** is exempt, so most of the time that
extra GET answers nothing and costs a round trip.

`trigger` makes it anyway, because the instances where the exemption does not
hold — a password used in place of a token, an older controller, a proxy that
loses the distinction — fail with a 403 and an HTML page behind it, which is
the least debuggable answer Jenkins has. A crumb issuer that refuses, or is not
there, is not treated as an error: it means CSRF protection is off, or that
this credential may not ask, and the POST that follows says so itself.

## A caveat worth knowing before you debug it

**A queue item is not a build, and it does not last.** `trigger` answers a
queue id because that is all Jenkins knows yet: the build has been put behind
whatever else is waiting for an executor. `queueItem` says where it got to —
and Jenkins forgets an item about five minutes after the build starts, so past
that it answers that it is gone and points at the job's `lastBuild` instead.

Nothing here polls, because nothing in a plugin can wait: `run` is synchronous
and there is no sleep in the sandbox. A workflow that must act on a result
checks back on its own schedule, or lets the job say so — a post-build step
calling a webhook beats anything that sits and asks.
