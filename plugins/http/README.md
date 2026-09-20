# HTTP

The API nobody has written a plugin for yet.

Every other plugin here is about one service. This one is about whichever
service a workspace points it at — an internal API, a status endpoint, a vendor
with no plugin of its own — reachable from a workflow or an agent without
anybody writing JavaScript.

```
http_get('/v1/issues?state=open')
  -> { status: 200, ok: true, headers: {…}, body: '…', json: { issues: [...] } }
```

## Two fences, and the outer one is not this plugin's

The installation's proxy rules decide what the server will reach at all. A
plugin cannot see them or argue with them, and nothing configured here widens
them.

Inside that, `hosts` is this plugin's own fence. Name the hosts a workspace
means to talk to and anything else is refused here, before a request is made:

```
hosts: api.example.com, status.example.com

http_get('https://elsewhere.test/collect')
  -> elsewhere.test is not a host this plugin may reach:
     it is configured for api.example.com, status.example.com
```

Left empty it refuses nothing, which is a choice worth making deliberately
rather than finding out about. `baseUrl`'s own host is always in the fence
without being listed twice.

## Where the credential goes

`token` is attached **only** to a host this plugin was told about — `baseUrl`'s
host, or one named in `hosts`. Never to anything else. A token configured with
neither is refused rather than sent:

```
a token is configured but no baseUrl and no hosts are, so there is nowhere it
may safely be sent: name the hosts this plugin talks to
```

That rule is the reason this plugin is worth having over telling somebody to
write their own. The caller names a url; the credential is not theirs to place.
Without it, a model persuaded to fetch `https://elsewhere/` by something it read
in a page would send the workspace's API key there — and an agent reads pages
for a living.

A caller that sends its own `Authorization` header keeps it. It is saying it has
a better credential for this one call, and that is not a case worth overruling.

## Settings

| Setting | What it does |
|---|---|
| `baseUrl` | The API this is pointed at, so a caller can write `/v1/issues`. Its host is always reachable. |
| `hosts` | Comma-separated hosts this plugin may reach. Empty means no fence of its own. |
| `token` | The credential, sent only to the hosts above. Secret. |
| `authHeader` | Which header carries it. Empty for `authorization`. |
| `authScheme` | What precedes it — `Bearer`, `Basic`, `Token`. Empty sends it bare, which is what an `x-api-key` header wants. |

An `x-api-key` API is `authHeader: x-api-key` with `authScheme` left empty. A
Bearer API is both left empty.

## The calls

| Call | What it does |
|---|---|
| `get(url, headers)` | Fetches and reads. |
| `post(url, body, headers)` | A map body goes as JSON with the content type set; a string body goes exactly as written, which is how form-encoded and plain text are sent. |
| `request(url, method, body, headers)` | The same with the method named — `PUT`, `PATCH`, `DELETE`, `HEAD`. |
| `download(url, headers)` | Bytes rather than text. |

The first three answer `status`, `ok` (below 400), `headers`, `body` as text and
`json` — the body parsed where it was a JSON object, `null` otherwise. A JSON
array leaves `json` null and stays in `body`, because a map cannot hold a list
and whoever asked for an array knows they did.

A non-2xx is an answer, not an error: `status` and `body` come back so a caller
can say what the other end complained about. Only an unreachable host throws.

## Bytes

`download` answers a key rather than base64, the way everything here that makes
bytes does:

```
http_download('https://api.example.com/reports/q3.pdf')
  -> { status: 200, key: 'http.1x9k2m', size: 148223, contentType: 'application/pdf' }

slack_uploadBinary(channel, 'http.1x9k2m', 'q3.pdf', 'Q3', threadTs)
```

The bytes stay on the server. A file goes from an API into a channel without a
megabyte of base64 passing through a model on the way — which is the one thing
that does not survive the trip to the next call.

Workflow nodes have no session store to read a key from, so the function keeps
`base64` filled for them. The agents' tool empties it, because there the key is
what to pass. Up to 5 MB.

## What accepting this means

`NETWORK_REQUEST`, and this is the only plugin here asking for it without naming
the service it is for. With `hosts` configured it is exactly as wide as that
list. With `hosts` empty it is as wide as the installation's proxy rules, for
whoever can call a workflow.

Configure the fence.
