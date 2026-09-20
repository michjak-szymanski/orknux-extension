/*
 * Confluence, as a plugin.
 *
 * What this exists for is the wiki beside the work: the answer to half the
 * questions a workflow or an agent is asked lives on a Confluence page, and a
 * plugin has no network, deliberately and permanently. So the two calls here —
 * search, and open a page — are made by the *server* on the plugin's behalf,
 * under the NETWORK_REQUEST capability a person accepted, against the
 * Confluence the workspace named.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept NETWORK_REQUEST, which is all it asks for.
 * 2. Set `url` to the wiki's root — `https://your-site.atlassian.net/wiki` for
 *    Cloud, or the base url of a Server/Data Center install.
 * 3. Put a credential in one of the workspace's variables and point `token` at
 *    it. For Cloud that is an API token, and `email` must say whose it is; for
 *    Server/Data Center it is a personal access token, and `email` stays empty.
 *
 * Which of Atlassian's two authentication schemes applies is read off `email`:
 * set, the token is sent as Basic `email:token`, which is Cloud's way; unset,
 * as a Bearer token, which is Server's. Nothing else about the two differs
 * here, because `/rest/api/search` and `/rest/api/content` answer on both.
 *
 * ## Why this asks for no permission
 *
 * Basic authentication is base64, and the sandbox hands out language builtins
 * and nothing else — no `btoa`, on purpose. This file used to carry the
 * alphabet and the loop, and ask for TEXT_ENCODING to get at the bytes.
 * `orknux.encoding` replaced both: the server does the UTF-8 and the base64,
 * so an email with anything past ASCII in it is still encoded the way the
 * other end will decode it, and the plugin needs no permission to say so.
 * Encoding is ungranted because it reaches nothing — it is arithmetic on a
 * string, the way a digest is.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** A nested field, or null rather than a thrown error on the way down. */
function at(holder, name) {
  if (holder === null || typeof holder !== 'object') {
    return null;
  }
  const held = holder[name];
  return held === undefined ? null : held;
}

/** The wiki's root, without its trailing slash. */
function root(settings) {
  const configured = settings.url;
  if (typeof configured !== 'string' || configured.length === 0) {
    throw new Error("the plugin's url parameter is not set, and every Confluence call needs it");
  }
  return configured.endsWith('/') ? configured.slice(0, -1) : configured;
}

/** The authorization header: Basic for Cloud where `email` is set, Bearer for Server. */
function authorization(settings) {
  const token = settings.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error("the plugin's token parameter is not set, and every Confluence call needs it");
  }
  const email = settings.email;
  if (typeof email === 'string' && email.length > 0) {
    /*
     * `orknux.encoding` rather than a hand-rolled alphabet and a TextEncoder:
     * the server does the UTF-8 and the base64, so this plugin needs no
     * permission to turn a string into its own bytes.
     */
    const pair = orknux.encoding.encodeBase64(`${email}:${token}`);
    if (pair.error !== undefined) {
      throw new Error(`could not encode the credential: ${pair.error}`);
    }
    return 'Basic ' + pair.base64;
  }
  return 'Bearer ' + token;
}

/** One read of Confluence's API, authenticated, answered or thrown. */
function read(settings, path) {
  const answered = orknux.http.get(root(settings) + path, {
    accept: 'application/json',
    authorization: authorization(settings),
  });
  if (answered.error !== undefined) {
    throw new Error(`could not reach Confluence: ${answered.error}`);
  }
  if (answered.status >= 400) {
    const said = at(answered.json, 'message');
    throw new Error(
      `Confluence answered ${answered.status}${typeof said === 'string' ? ': ' + said : ''} for ${path.split('?')[0]}`,
    );
  }
  return answered.json;
}

/** A search hit's text, with the @@@hl@@@ highlight markers Confluence wraps matches in taken out. */
function plain(text) {
  return typeof text === 'string' ? text.replace(/@@@(?:end)?hl@@@/g, '') : null;
}

/**
 * The content id, from an id or from any of the urls Confluence spells a page
 * as — Cloud's `/spaces/KEY/pages/123/Title` and Server's `?pageId=123` both.
 */
function pageId(page) {
  const asked = typeof page === 'string' ? page.trim() : String(page);
  if (/^\d+$/.test(asked)) {
    return asked;
  }
  const inPath = asked.match(/\/pages\/(\d+)/);
  if (inPath !== null) {
    return inPath[1];
  }
  const inQuery = asked.match(/[?&]pageId=(\d+)/);
  if (inQuery !== null) {
    return inQuery[1];
  }
  throw new Error(`not a page id or a page url: ${asked}`);
}

export default class Confluence extends OrknuxPlugin {

  id() {
    return 'confluence';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'url',
        description:
          'The wiki\'s root: https://your-site.atlassian.net/wiki for Cloud, ' +
          'or the base url of a Server install.',
        type: 'string',
        required: true,
      }),
      new OrknuxParameter({
        name: 'email',
        description:
          'Whose API token this is, for Cloud\'s Basic authentication. ' +
          'Leave empty on Server, where the token stands alone.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'token',
        description: 'An API token (Cloud, with email) or a personal access token (Server, without).',
        type: 'string',
        required: true,
        secret: true,
      }),
    ];
  }

  permissions() {
    // None. Turning `email:token` into base64 is `orknux.encoding`'s job now,
    // and that is ungranted — it reaches nothing, the way a digest does not.
    return [];
  }

  capabilities() {
    // The widest capability there is, asked for because this plugin is about
    // exactly one outside service: every request goes to the url above.
    return ['NETWORK_REQUEST'];
  }

  /* The two shapes this plugin answers. */
  /*
   * Two calls, and the whole skill is about the first one.
   *
   * `search` takes plain words or CQL and passes either through as written, so
   * a model that does not know CQL exists gets whatever full-text matching
   * gives it - which on a wiki of any size is the wrong page, confidently.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Looking something up on Confluence',
        description: 'Searching a wiki so the right page comes back, and what its body actually is.',
        content: `# Looking something up on Confluence

The answer to a great many questions is already written down on the wiki. Two
calls get at it: \`confluence_search\` finds the page, \`confluence_openPage\` reads
it.

## Search with CQL, not with hope

\`search\` passes the query through as written. Plain words search page text,
which on a wiki of any size returns the twenty pages that mention your words
and not the one that is about them. **CQL is how you ask properly:**

    space = "DOC" AND title ~ "runbook"
    title ~ "deploy" AND lastmodified > now("-12w")
    space = "ENG" AND type = page AND text ~ "rate limit"
    creator = "jsmith" AND lastmodified > now("-4w")

The fields worth knowing: \`space\`, \`title\`, \`text\`, \`type\` (\`page\`, \`blogpost\`),
\`label\`, \`creator\`, \`lastmodified\`, \`created\`. \`~\` is contains, \`=\` is exact.
\`now("-4w")\` takes \`d\`, \`w\`, \`m\`, \`y\`.

**Prefer \`title ~\` over plain text** when you know roughly what the page is
called. A runbook is titled like a runbook; its body mentions a hundred things
it is not about.

## Then open exactly one

Each match carries an \`id\` and a \`url\`, and \`openPage\` takes either - or any
Confluence link somebody pasted, Cloud's \`/spaces/KEY/pages/123/Title\` or
Server's \`?pageId=123\`.

Read the excerpts first and open the **one** page that answers the question.
Opening five to see which is right costs five page bodies in your context and
usually the first one was right.

## The body is XHTML, not markdown

\`openPage\` answers Confluence **storage format**, which is XHTML: \`<p>\`, \`<h2>\`,
\`<ac:structured-macro>\` for panels and code blocks. Read it as HTML. Do not
quote it back to somebody as though it were prose - pull the answer out and say
it in your own words, with the page's \`url\` so they can go and read it.

## When nothing comes back

**An empty search is usually permissions, not an empty wiki.** Confluence
filters by what the credential can see, so a query that works in a browser can
answer nothing through a token with narrower access. Say that is a possibility
rather than telling somebody their wiki has no runbook.

If a query with several \`AND\` clauses finds nothing, drop the narrowest clause
and search again - a wrong space key or a stale label answers empty in exactly
the same way as a subject nobody has written about.`,
      }),
    ];
  }

  objects() {
    return [
      new OrknuxObject({
        name: 'Match',
        description: 'One page a search turned up.',
        properties: [
          { name: 'id', kind: 'string', description: 'The content id; openPage takes it.' },
          { name: 'type', kind: 'string', description: 'page, blogpost, comment.' },
          { name: 'title', kind: 'string', description: 'With the highlight markers taken out.' },
          { name: 'space', kind: 'string', description: 'Which space it lives in.' },
          { name: 'excerpt', kind: 'string', description: 'The passage around the match.' },
          { name: 'updated', kind: 'string', description: 'When it last changed.' },
          { name: 'url', kind: 'string', description: 'The link for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Search',
        description: 'What a search of the wiki came to.',
        properties: [
          { name: 'total', kind: 'number', description: 'How many the whole search holds, not how many came back.' },
          { name: 'matches', kind: 'array', of: 'Match', description: 'Capped by limit.' },
        ],
      }),

      new OrknuxObject({
        name: 'Page',
        description: 'One Confluence page, whole.',
        properties: [
          { name: 'id', kind: 'string', description: 'The content id.' },
          { name: 'title', kind: 'string', description: 'The title.' },
          { name: 'space', kind: 'string', description: 'The space key.' },
          { name: 'version', kind: 'number', description: 'Which revision this is.' },
          { name: 'updated', kind: 'string', description: 'When that revision was made.' },
          { name: 'by', kind: 'string', description: 'Who made it.' },
          {
            name: 'body',
            kind: 'string',
            description: 'Confluence storage format, which is XHTML — read it as HTML.',
          },
          { name: 'url', kind: 'string', description: 'The link for a person to open.' },
        ],
      }),
    ];
  }

  /* The agents' surface: both calls, fronted. Proxies, so everything stays the functions' own. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'search' }),
      new OrknuxFunctionTool({ function: 'openPage' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'search',
        description:
          'Searches Confluence. Pass plain words to search page text, or CQL for anything sharper - ' +
          'space = "DOC", title ~ "runbook", type = blogpost, lastmodified > now("-4w") - which is used ' +
          'as written. Answers the total and the matches - id, type, title, space, an excerpt around ' +
          'the match and a url each; openPage takes the id or the url. limit caps the matches.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number', required: false, default: 20 },
        ],
        returnType: 'Search',
        run: (query, limit) => {
          const asked = typeof query === 'string' ? query.trim() : '';
          if (asked.length === 0) {
            throw new Error('there is nothing to search for');
          }
          /*
           * Plain words become a text search; anything wearing an operator is
           * taken to be CQL already. `~` and `=` are what every CQL clause
           * carries, and neither is anything a person types into a plain
           * search on purpose.
           */
          const cql = /[~=<>]/.test(asked)
            ? asked
            : `text ~ "${asked.replace(/(["\\])/g, '\\$1')}"`;

          const capped = Math.min(Math.max(limit, 1), 100);
          const found = read(this.settings, `/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${capped}`);

          /* The webui links are relative to a base the answer itself names. */
          const base = at(at(found, '_links'), 'base') ?? root(this.settings);
          return {
            total: at(found, 'totalSize'),
            matches: (at(found, 'results') ?? []).map((one) => {
              const content = at(one, 'content');
              const webui = at(at(content, '_links'), 'webui');
              return {
                id: at(content, 'id'),
                type: at(content, 'type'),
                title: plain(at(one, 'title')) ?? at(content, 'title'),
                space: at(at(one, 'resultGlobalContainer'), 'title'),
                excerpt: plain(at(one, 'excerpt')),
                updated: at(one, 'lastModified'),
                url: typeof webui === 'string' ? base + webui : null,
              };
            }),
          };
        },
      }),

      new OrknuxFunction({
        name: 'openPage',
        description:
          'Opens one Confluence page whole: title, space, version, who last changed it and when, a url, ' +
          'and the body. Pass the page\'s id, or any url that names it - a Cloud /spaces/KEY/pages/123/ ' +
          'link or a Server ?pageId=123 one. The body is Confluence storage format, which is XHTML: ' +
          'read it as HTML.',
        params: [{ name: 'page', type: 'string' }],
        returnType: 'Page',
        run: (page) => {
          const id = pageId(page);
          const opened = read(
            this.settings,
            `/rest/api/content/${encodeURIComponent(id)}?expand=body.storage,space,version`,
          );
          const links = at(opened, '_links');
          const webui = at(links, 'webui');
          return {
            id: at(opened, 'id'),
            title: at(opened, 'title'),
            space: at(at(opened, 'space'), 'key'),
            version: at(at(opened, 'version'), 'number'),
            updated: at(at(opened, 'version'), 'when'),
            by: at(at(at(opened, 'version'), 'by'), 'displayName'),
            body: at(at(at(opened, 'body'), 'storage'), 'value'),
            url: typeof webui === 'string' ? (at(links, 'base') ?? root(this.settings)) + webui : null,
          };
        },
      }),
    ];
  }
}
