/*
 * Jira, as a plugin.
 *
 * The other half of the sentence the github plugin starts. A pull request
 * merging is only half of "the work is done"; the other half is a ticket
 * moving, and a workflow that can read one and not write the other is a
 * workflow somebody finishes by hand. So: find issues by JQL, open one whole,
 * comment on it, move it, and raise a new one.
 *
 * A plugin has no network, deliberately and permanently, so every call is made
 * by the *server* on the plugin's behalf, under the NETWORK_REQUEST capability
 * a person accepted, against the Jira the workspace named.
 *
 * ## Cloud or Server, decided by `email`
 *
 * The same rule the confluence plugin uses, because it is the same company's
 * two products: `email` set means Atlassian Cloud, and the token is sent as
 * Basic `email:token`; `email` empty means Server or Data Center, and the
 * token goes as a Bearer personal access token. That one setting is also what
 * picks the search endpoint below, which is the one place the two genuinely
 * differ.
 *
 * ## Why v2 everywhere except search
 *
 * Jira's v3 API speaks Atlassian Document Format: a description or a comment
 * is not a string but a tree of nodes, and posting a one-line comment would
 * mean building one. v2 takes and answers plain text, so v2 is what this file
 * uses for reading an issue, commenting, transitioning and creating.
 *
 * Search is the exception, and not by choice. Atlassian **removed**
 * `/rest/api/2/search` and `/rest/api/3/search` from Cloud through the second
 * half of 2025 — they answer 410 now — leaving `POST /rest/api/3/search/jql`,
 * which is bounded: it wants an explicit field list, it pages by a cursor
 * rather than an offset, and it does not answer a total at all. Server and
 * Data Center still have v2 search and still answer a total. So `search` picks
 * its endpoint by the same `email` setting, and `total` comes back null on
 * Cloud rather than invented.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept TEXT_ENCODING and NETWORK_REQUEST.
 * 2. Set `url` to the site root — `https://your-site.atlassian.net` for Cloud,
 *    or the base url of a Server install.
 * 3. Put the credential in one of the workspace's variables and point `token`
 *    at it. For Cloud that is an API token and `email` must say whose it is;
 *    for Server it is a personal access token and `email` stays empty.
 * 4. Set `project` to the key new issues belong to unless a call says
 *    otherwise — optional, and one fewer thing to wire.
 *
 * Base64 is written out longhand below because Basic authentication is base64
 * and the sandbox has no `btoa`, on purpose. That is what "a plugin declares
 * the JavaScript it needs" means.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The alphabet of RFC 4648's base64, in order. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The fields a search asks for, because the Cloud endpoint insists on a list. */
const SEARCH_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'updated',
  'created',
];

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

/**
 * A field as readable text.
 *
 * v2 answers a description as a string, which is the whole reason this file
 * uses it. Should an instance ever hand back Atlassian Document Format
 * instead, the tree is walked for its text rather than answered as the
 * `[object Object]` a caller would otherwise be shown.
 */
function plainOf(value) {
  if (typeof value === 'string' || value === null || value === undefined) {
    return value ?? null;
  }
  const said = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (typeof node.text === 'string') {
      said.push(node.text);
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      said.push('\n');
    }
    walk(node.content);
  };
  walk(value);
  return said.join('').trim();
}

/** The site root, without its trailing slash. */
function root(settings) {
  const configured = settings.url;
  if (typeof configured !== 'string' || configured.length === 0) {
    throw new Error("the plugin's url parameter is not set, and every Jira call needs it");
  }
  return configured.endsWith('/') ? configured.slice(0, -1) : configured;
}

/** Whether this is Atlassian Cloud, which is what having an email to send means. */
function isCloud(settings) {
  return typeof settings.email === 'string' && settings.email.length > 0;
}

/** The authorization header: Basic for Cloud, Bearer for Server. */
function authorization(settings) {
  const token = settings.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error("the plugin's token parameter is not set, and every Jira call needs it");
  }
  if (isCloud(settings)) {
    return 'Basic ' + base64(new TextEncoder().encode(`${settings.email}:${token}`));
  }
  return 'Bearer ' + token;
}

/** One call to Jira, authenticated, answered or thrown. */
function call(settings, asked) {
  const answered = orknux.http.request({
    url: root(settings) + asked.path,
    method: asked.method === undefined ? 'GET' : asked.method,
    headers: { accept: 'application/json', authorization: authorization(settings) },
    body: asked.body,
  });
  if (answered.error !== undefined) {
    throw new Error(`could not reach Jira: ${answered.error}`);
  }
  if (answered.status >= 400) {
    /*
     * Jira says why in `errorMessages` for the whole request and in `errors`
     * per field — a rejected create names the field, which is the useful half.
     */
    const messages = at(answered.json, 'errorMessages');
    const fields = at(answered.json, 'errors');
    const said = (Array.isArray(messages) ? messages[0] : null)
      ?? (fields !== null ? Object.values(fields)[0] : null);
    throw new Error(
      `Jira answered ${answered.status}${typeof said === 'string' ? ': ' + said : ''} for ${asked.path.split('?')[0]}`,
    );
  }
  return answered.json;
}

/** One issue as a search answers it: the scalar facts, and where to read it. */
function listed(issue, site) {
  const fields = at(issue, 'fields');
  return {
    key: at(issue, 'key'),
    summary: at(fields, 'summary'),
    status: at(at(fields, 'status'), 'name'),
    type: at(at(fields, 'issuetype'), 'name'),
    priority: at(at(fields, 'priority'), 'name'),
    assignee: at(at(fields, 'assignee'), 'displayName'),
    reporter: at(at(fields, 'reporter'), 'displayName'),
    created: at(fields, 'created'),
    updated: at(fields, 'updated'),
    url: `${site}/browse/${at(issue, 'key')}`,
  };
}

export default class Jira extends OrknuxPlugin {

  id() {
    return 'jira';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'url',
        description:
          'The site root: https://your-site.atlassian.net for Cloud, ' +
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
      new OrknuxParameter({
        name: 'project',
        description:
          'The project key a new issue belongs to when a call does not name one — PROJ. ' +
          'Optional, and one fewer thing to wire.',
        type: 'string',
        required: false,
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

  /* The agents' surface: all of it. Reading a ticket and moving it are the same job. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'search' }),
      new OrknuxFunctionTool({ function: 'openIssue' }),
      new OrknuxFunctionTool({ function: 'comment' }),
      new OrknuxFunctionTool({ function: 'transition' }),
      new OrknuxFunctionTool({ function: 'createIssue' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'search',
        description:
          'Finds issues by JQL, which is Jira\'s own query language: project = PROJ AND status = ' +
          '"In Progress", assignee = currentUser() ORDER BY updated DESC, labels = urgent AND ' +
          'created >= -7d. Answers the issues - key, summary, status, type, priority, assignee, ' +
          'reporter, updated and a url each - and how many the whole search holds, which Jira Cloud ' +
          'no longer tells anybody and so comes back null there. limit caps the issues, 0 for the ' +
          'default.',
        params: [
          { name: 'jql', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (jql, limit) => {
          const asked = typeof jql === 'string' ? jql.trim() : '';
          if (asked.length === 0) {
            throw new Error('there is no JQL to search with');
          }
          const capped = typeof limit === 'number' && limit > 0 ? Math.min(limit, 100) : 25;
          const site = root(this.settings);

          /*
           * The one place Cloud and Server genuinely part. The Cloud endpoint
           * is a POST, wants the fields named, and answers no total; the
           * Server one is the GET that has always been there.
           */
          const found = isCloud(this.settings)
            ? call(this.settings, {
                method: 'POST',
                path: '/rest/api/3/search/jql',
                body: { jql: asked, maxResults: capped, fields: SEARCH_FIELDS },
              })
            : call(this.settings, {
                path:
                  `/rest/api/2/search?jql=${encodeURIComponent(asked)}` +
                  `&maxResults=${capped}&fields=${SEARCH_FIELDS.join(',')}`,
              });

          return {
            total: at(found, 'total'),
            issues: (at(found, 'issues') ?? []).map((one) => listed(one, site)),
          };
        },
      }),

      new OrknuxFunction({
        name: 'openIssue',
        description:
          'Opens one issue whole by its key (PROJ-123): summary, description, status, type, ' +
          'priority, assignee, reporter, labels, resolution, created, updated and a url. The ' +
          'description comes back as text. Read this before commenting on or moving an issue, ' +
          'rather than acting on the summary alone.',
        params: [{ name: 'key', type: 'string' }],
        returnType: 'map',
        run: (key) => {
          const named = typeof key === 'string' ? key.trim() : '';
          if (named.length === 0) {
            throw new Error('there is no issue key to open');
          }
          const site = root(this.settings);
          const issue = call(this.settings, {
            path: `/rest/api/2/issue/${encodeURIComponent(named)}`,
          });
          const fields = at(issue, 'fields');
          return {
            ...listed(issue, site),
            description: plainOf(at(fields, 'description')),
            labels: at(fields, 'labels') ?? [],
            resolution: at(at(fields, 'resolution'), 'name'),
          };
        },
      }),

      new OrknuxFunction({
        name: 'comment',
        description:
          'Adds a comment to an issue. Pass the key (PROJ-123) and what to say, as plain text - ' +
          'Jira renders its own wiki markup, not markdown, so write plainly rather than in ' +
          'asterisks. Answers the comment\'s id and a url to it.',
        params: [
          { name: 'key', type: 'string' },
          { name: 'text', type: 'string' },
        ],
        returnType: 'map',
        run: (key, text) => {
          const named = typeof key === 'string' ? key.trim() : '';
          const said = typeof text === 'string' ? text.trim() : '';
          if (named.length === 0) {
            throw new Error('there is no issue key to comment on');
          }
          if (said.length === 0) {
            throw new Error('there is no comment to add');
          }
          const made = call(this.settings, {
            method: 'POST',
            path: `/rest/api/2/issue/${encodeURIComponent(named)}/comment`,
            body: { body: said },
          });
          return {
            id: at(made, 'id'),
            url: `${root(this.settings)}/browse/${named}?focusedCommentId=${at(made, 'id')}`,
          };
        },
      }),

      new OrknuxFunction({
        name: 'transition',
        description:
          'Moves an issue to another status - what dragging its card to a new column does. Pass the ' +
          'key (PROJ-123) and the status or transition by name ("In Progress", "Done"), matched ' +
          'whatever the capitals. Which moves are possible depends on where the issue is in its ' +
          'workflow, so a name that is not available now is refused with the list of the ones that ' +
          'are. Answers the status it ended in.',
        params: [
          { name: 'key', type: 'string' },
          { name: 'to', type: 'string' },
        ],
        returnType: 'map',
        run: (key, to) => {
          const named = typeof key === 'string' ? key.trim() : '';
          const wanted = typeof to === 'string' ? to.trim().toLowerCase() : '';
          if (named.length === 0) {
            throw new Error('there is no issue key to move');
          }
          if (wanted.length === 0) {
            throw new Error('there is no status to move the issue to');
          }

          /*
           * Asked for by name rather than by id, because an id is a number out
           * of somebody's workflow configuration that nobody knows — and the
           * available moves depend on where the issue currently is, so the
           * list has to be read now rather than assumed.
           */
          const offered = at(
            call(this.settings, { path: `/rest/api/2/issue/${encodeURIComponent(named)}/transitions` }),
            'transitions',
          ) ?? [];
          const found = offered.find((one) => {
            const move = String(at(one, 'name') ?? '').toLowerCase();
            const lands = String(at(at(one, 'to'), 'name') ?? '').toLowerCase();
            return move === wanted || lands === wanted;
          });
          if (found === undefined) {
            const names = offered.map((one) => at(one, 'name')).filter((one) => typeof one === 'string');
            throw new Error(
              names.length === 0
                ? `${named} cannot be moved anywhere from where it is`
                : `${named} cannot be moved to ${to} from where it is: it takes ${names.join(', ')}`,
            );
          }

          call(this.settings, {
            method: 'POST',
            path: `/rest/api/2/issue/${encodeURIComponent(named)}/transitions`,
            body: { transition: { id: at(found, 'id') } },
          });
          return {
            key: named,
            status: at(at(found, 'to'), 'name') ?? at(found, 'name'),
            url: `${root(this.settings)}/browse/${named}`,
          };
        },
      }),

      new OrknuxFunction({
        name: 'createIssue',
        description:
          'Raises a new issue. Pass the project key (PROJ) - or an empty project for the configured ' +
          'one - the issue type by name ("Task", "Bug", "Story"), a one-line summary, and the ' +
          'description as plain text. Answers the new issue\'s key and a url. Search first: raising ' +
          'a duplicate of something already open is worse than not raising it.',
        params: [
          { name: 'project', type: 'string' },
          { name: 'type', type: 'string' },
          { name: 'summary', type: 'string' },
          { name: 'description', type: 'string' },
        ],
        returnType: 'map',
        run: (project, type, summary, description) => {
          const said = typeof summary === 'string' ? summary.trim() : '';
          if (said.length === 0) {
            throw new Error('a new issue needs a summary');
          }

          const where = typeof project === 'string' && project.trim().length > 0
            ? project.trim()
            : typeof this.settings.project === 'string' && this.settings.project.trim().length > 0
              ? this.settings.project.trim()
              : null;
          if (where === null) {
            throw new Error('no project was passed and no default project is configured');
          }
          const kind = typeof type === 'string' && type.trim().length > 0 ? type.trim() : 'Task';

          const fields = {
            project: { key: where },
            issuetype: { name: kind },
            summary: said,
          };
          if (typeof description === 'string' && description.trim().length > 0) {
            fields.description = description;
          }

          const made = call(this.settings, {
            method: 'POST',
            path: '/rest/api/2/issue',
            body: { fields: fields },
          });
          return {
            key: at(made, 'key'),
            url: `${root(this.settings)}/browse/${at(made, 'key')}`,
          };
        },
      }),
    ];
  }
}
