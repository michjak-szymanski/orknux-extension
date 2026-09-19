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
 * 1. Load this plugin and accept TEXT_ENCODING and NETWORK_REQUEST.
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
 * ## Why base64 is written out longhand
 *
 * Basic authentication is base64, and the sandbox hands out language builtins
 * and nothing else — no `btoa`, on purpose. So base64 is here, in the plugin,
 * which is exactly what "a plugin declares the JavaScript it needs" means. The
 * bytes come from TextEncoder, so an email with anything past ASCII in it is
 * encoded the way the other end will decode it.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The alphabet of RFC 4648's base64, in order. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of some bytes — the sandbox has no btoa. */
function base64(bytes) {
  let written = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const one = bytes[index];
    const two = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const three = index + 2 < bytes.length ? bytes[index + 2] : 0;
    written += BASE64[one >> 2] + BASE64[((one & 3) << 4) | (two >> 4)];
    written += index + 1 < bytes.length ? BASE64[((two & 15) << 2) | (three >> 6)] : '=';
    written += index + 2 < bytes.length ? BASE64[three & 63] : '=';
  }
  return written;
}

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
    return 'Basic ' + base64(new TextEncoder().encode(`${email}:${token}`));
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
    // TextEncoder, for turning `email:token` into the bytes base64 works on.
    return ['TEXT_ENCODING'];
  }

  capabilities() {
    // The widest capability there is, asked for because this plugin is about
    // exactly one outside service: every request goes to the url above.
    return ['NETWORK_REQUEST'];
  }

  /* The two shapes this plugin answers. */
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
          'the match and a url each; openPage takes the id or the url. limit caps the matches, 0 for ' +
          'the default.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number' },
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

          const capped = typeof limit === 'number' && limit > 0 ? Math.min(limit, 100) : 20;
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
