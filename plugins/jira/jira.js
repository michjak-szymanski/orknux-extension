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
 * ## The fields a project adds
 *
 * A project can make fields of its own mandatory on a new issue — "Occurs on:
 * PROD, UAT or DEV", "Kind of work: one of six" — and Jira refuses a create
 * that leaves one out. Those fields are `customfield_10123` on the wire, with
 * a shape per kind: a choice is `{ id }`, a user is `{ accountId }` or
 * `{ name }` by deployment, a list is a list of those. Nobody calling from a
 * workflow, and no model calling from an agent, should have to know any of
 * that.
 *
 * So `form` reads the create metadata for a project and issue type — every
 * field, by name, with the values a choice takes — and `createIssue` takes a
 * `fields` map keyed by those names, resolves each against the same
 * metadata, and builds Jira's shape itself. "Occurs on": "DEV" becomes
 * `customfield_10123: { id: "10201" }`, and a value that is not one of the
 * choices is refused here, with the choices, rather than by Jira with an id.
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
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

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
    /*
     * `orknux.encoding` rather than a hand-rolled alphabet and a TextEncoder:
     * the server does the UTF-8 and the base64, so this plugin needs no
     * permission to turn a string into its own bytes.
     */
    const pair = orknux.encoding.encodeBase64(`${settings.email}:${token}`);
    if (pair.error !== undefined) {
      throw new Error(`could not encode the credential: ${pair.error}`);
    }
    return 'Basic ' + pair.base64;
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
    /*
     * All of them, not the first: a project that insists on two fields says
     * so in one answer, and reporting one of them is a second round trip
     * to learn the other.
     */
    const said = [
      ...(Array.isArray(messages) ? messages : []),
      ...(fields !== null && typeof fields === 'object'
        ? Object.entries(fields).map(([field, why]) => `${field}: ${why}`)
        : []),
    ].filter((one) => typeof one === 'string' && one.length > 0);
    throw new Error(
      `Jira answered ${answered.status}${said.length > 0 ? ': ' + said.join('; ') : ''} for ${asked.path.split('?')[0]}`,
    );
  }
  return answered.json;
}

/** What one of a field's allowed values is called, whichever of Jira's spellings it carries. */
function labelOf(allowed) {
  const said = at(allowed, 'value') ?? at(allowed, 'name') ?? at(allowed, 'key') ?? at(allowed, 'id');
  return said === null ? null : String(said);
}

/** The allowed value a caller meant, by its label or its id, whatever the capitals. */
function allowedNamed(allowedValues, wanted) {
  const asked = String(wanted).trim().toLowerCase();
  return (
    allowedValues.find((one) => (labelOf(one) ?? '').toLowerCase() === asked) ??
    allowedValues.find((one) => String(at(one, 'id') ?? '').toLowerCase() === asked) ??
    null
  );
}

/**
 * The create form for one issue type in one project, read from Jira's create
 * metadata: what the plugin's `form` answers, and what `createIssue` resolves
 * a `fields` map against.
 *
 * Two calls, because that is how the endpoint is shaped: the issue types a
 * project offers, then the fields one of them takes. The type is matched by
 * name whatever the capitals, or by its id for a caller that has one. Cloud
 * answers `issueTypes` and `fields`; Data Center answers `values` for both,
 * so both spellings are read.
 *
 * Each entry keeps Jira's own `schema` and `allowedValues` beside the
 * declared `Field`, because resolving "DEV" to `{ id: "10201" }` needs the
 * ids the shape deliberately leaves out.
 */
function formOf(settings, project, type) {
  const base = `/rest/api/2/issue/createmeta/${encodeURIComponent(project)}/issuetypes`;
  const listed = call(settings, { path: `${base}?maxResults=200` });
  const types = at(listed, 'issueTypes') ?? at(listed, 'values') ?? [];
  const wanted = String(type).trim().toLowerCase();
  const found =
    types.find((one) => String(at(one, 'name') ?? '').toLowerCase() === wanted) ??
    types.find((one) => String(at(one, 'id') ?? '') === wanted) ??
    null;
  if (found === null) {
    const offered = types.map((one) => at(one, 'name')).filter((name) => typeof name === 'string');
    throw new Error(
      `${project} has no issue type "${type}"` + (offered.length > 0 ? `; it has ${offered.join(', ')}` : ''),
    );
  }

  const read = call(settings, {
    path: `${base}/${encodeURIComponent(String(at(found, 'id')))}?maxResults=200`,
  });
  const entries = (at(read, 'fields') ?? at(read, 'values') ?? []).map((one) => {
    const schema = at(one, 'schema');
    const allowedValues = Array.isArray(at(one, 'allowedValues')) ? at(one, 'allowedValues') : [];
    return {
      schema: schema,
      allowedValues: allowedValues,
      field: {
        id: at(one, 'fieldId') ?? at(one, 'key'),
        name: at(one, 'name'),
        required: at(one, 'required') === true,
        kind: at(schema, 'type'),
        of: at(schema, 'items'),
        allowed: allowedValues.map(labelOf).filter((label) => label !== null),
        hasDefault: at(one, 'hasDefaultValue') === true,
      },
    };
  });
  return { project: project, type: at(found, 'name'), entries: entries };
}

/** The project a call is about: what was passed, or the configured one. */
function projectOr(settings, project) {
  if (typeof project === 'string' && project.trim().length > 0) {
    return project.trim();
  }
  const fallback = settings.project;
  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    return fallback.trim();
  }
  throw new Error('no project was passed and no default project is configured');
}

/** The issue type a call is about: what was passed, or a Task. */
function typeOr(type) {
  return typeof type === 'string' && type.trim().length > 0 ? type.trim() : 'Task';
}

/** The form entry a `fields` key names: a field id as Jira spells it, or a name whatever the capitals. */
function entryNamed(form, key) {
  const asked = String(key).trim().toLowerCase();
  return (
    form.entries.find((one) => String(one.field.id ?? '').toLowerCase() === asked) ??
    form.entries.find((one) => String(one.field.name ?? '').toLowerCase() === asked) ??
    null
  );
}

/** A user as Jira wants one named: by account id on Cloud, by username on Server. */
function userOf(settings, given) {
  if (given !== null && typeof given === 'object') {
    return given;
  }
  return isCloud(settings) ? { accountId: String(given) } : { name: String(given) };
}

/**
 * One field's value as Jira takes it, built from what a caller said.
 *
 * The rule is the field's own schema. A choice — an option, a priority, a
 * component, anything the form lists values for — is matched by label and
 * sent as `{ id }`, and a label that matches nothing is refused with the
 * labels that would have. A list takes a list, or one string with commas in
 * it, and resolves each item the same way. A number is checked to be one.
 * A user is named the way this deployment names users. Everything else —
 * text, dates — goes as it was said.
 *
 * An object goes through untouched whatever the field, so a caller who
 * knows Jira's shape for something this does not cover can still say it.
 */
function valueFor(settings, entry, given) {
  const { schema, allowedValues, field } = entry;
  if (given !== null && typeof given === 'object' && !Array.isArray(given)) {
    return given;
  }
  const choice = (one) => {
    if (one !== null && typeof one === 'object') {
      return one;
    }
    const matched = allowedNamed(allowedValues, one);
    if (matched === null) {
      throw new Error(`"${one}" is not one of ${field.name}'s values: ${field.allowed.join(', ')}`);
    }
    return { id: String(at(matched, 'id')) };
  };

  const kind = at(schema, 'type');
  if (kind === 'array') {
    const items = Array.isArray(given)
      ? given
      : String(given).split(',').map((one) => one.trim()).filter((one) => one.length > 0);
    const of = at(schema, 'items');
    if (of === 'user') {
      return items.map((one) => userOf(settings, one));
    }
    if (allowedValues.length > 0) {
      return items.map(choice);
    }
    return of === 'string' ? items.map(String) : items;
  }
  if (kind === 'number') {
    const number = Number(given);
    if (Number.isNaN(number)) {
      throw new Error(`${field.name} takes a number, and "${given}" is not one`);
    }
    return number;
  }
  if (kind === 'user') {
    return userOf(settings, given);
  }
  if (allowedValues.length > 0) {
    return choice(given);
  }
  return given;
}

/** One issue as the declared `Issue` shape — see objects(). */
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
    /*
     * The three a search does not ask Jira for, present and empty rather than
     * missing: `Issue` is one shape, and a caller reading `labels` should get
     * a list either way instead of finding out which call it came from.
     */
    description: plainOf(at(fields, 'description')),
    labels: at(fields, 'labels') ?? [],
    resolution: at(at(fields, 'resolution'), 'name'),
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
    // None. Turning `email:token` into base64 is `orknux.encoding`'s job now,
    // and that is ungranted — it reaches nothing, the way a digest does not.
    return [];
  }

  capabilities() {
    // The widest capability there is, asked for because this plugin is about
    // exactly one outside service: every request goes to the url above.
    return ['NETWORK_REQUEST'];
  }

  /*
   * The shapes this plugin's answers actually have.
   *
   * `map` was the old answer and it is a weak one: it says a structure came
   * back and nothing about what is in it, so every caller reads the code — or
   * guesses — to find out that `status` is a string and `labels` is a list.
   * Declared here, the shape travels with the plugin and arrives in a
   * workspace as `jira_Issue`, and a workflow can be built against it.
   *
   * `Issue` carries the fields `search` answers for each hit; `openIssue`
   * answers the same shape with `description`, `labels` and `resolution`
   * filled in, which are null in a search rather than absent. One shape for
   * both, because two that differ by three fields is two things to keep right.
   */
  objects() {
    return [
      new OrknuxObject({
        name: 'Search',
        description: 'What a JQL search came to.',
        properties: [
          {
            name: 'total',
            kind: 'number',
            description: 'How many the whole search holds. Null on Cloud, which no longer says.',
          },
          { name: 'issues', kind: 'array', of: 'Issue', description: 'Capped by limit.' },
        ],
      }),

      new OrknuxObject({
        name: 'Comment',
        description: 'A comment that was added to an issue.',
        properties: [
          { name: 'id', kind: 'string', description: 'What Jira calls it.' },
          { name: 'url', kind: 'string', description: 'A link that opens the issue at this comment.' },
        ],
      }),

      new OrknuxObject({
        name: 'Moved',
        description: 'An issue after it was transitioned.',
        properties: [
          { name: 'key', kind: 'string', description: 'The issue that moved.' },
          { name: 'status', kind: 'string', description: 'Where it ended up.' },
          { name: 'url', kind: 'string', description: 'The link for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Raised',
        description: 'An issue that was just created.',
        properties: [
          { name: 'key', kind: 'string', description: 'PROJ-123, which every other call takes.' },
          { name: 'url', kind: 'string', description: 'The link for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Field',
        description: 'One field on the form a new issue in a project fills in.',
        properties: [
          { name: 'id', kind: 'string', description: 'What Jira calls it on the wire: summary, or customfield_10123.' },
          { name: 'name', kind: 'string', description: 'What people call it, and what createIssue\'s fields map takes.' },
          { name: 'required', kind: 'boolean', description: 'Whether a create without it is refused.' },
          {
            name: 'kind',
            kind: 'string',
            description: 'Jira\'s type: string, number, option, array, user, date, datetime, priority…',
          },
          { name: 'of', kind: 'string', description: 'What an array holds - option, string, user, component. Null otherwise.' },
          {
            name: 'allowed',
            kind: 'array',
            of: 'string',
            description: 'The values a choice takes, by label. Empty where the field is free text.',
          },
          { name: 'hasDefault', kind: 'boolean', description: 'Whether Jira fills it in when nobody does.' },
        ],
      }),

      new OrknuxObject({
        name: 'Form',
        description: 'What a new issue of one type in one project has to say, and may say.',
        properties: [
          { name: 'project', kind: 'string', description: 'The project key asked about.' },
          { name: 'type', kind: 'string', description: 'The issue type, as Jira spells it.' },
          {
            name: 'required',
            kind: 'array',
            of: 'string',
            description: 'The names of the fields a create must fill in - the short answer.',
          },
          { name: 'fields', kind: 'array', of: 'Field', description: 'Every field on the form, required or not.' },
        ],
      }),

      new OrknuxObject({
        name: 'Issue',
        description: 'One Jira issue, as this plugin answers it.',
        properties: [
          { name: 'key', kind: 'string', description: 'PROJ-123, which every other call takes.' },
          { name: 'summary', kind: 'string', description: 'The one-line title.' },
          { name: 'description', kind: 'string', description: 'The body, as text. Null from a search.' },
          { name: 'status', kind: 'string', description: 'Where it sits in its workflow — "In Progress".' },
          { name: 'type', kind: 'string', description: 'Task, Bug, Story.' },
          { name: 'priority', kind: 'string', description: 'Null where the project does not use them.' },
          { name: 'assignee', kind: 'string', description: 'Display name, or null where nobody holds it.' },
          { name: 'reporter', kind: 'string', description: 'Display name of whoever raised it.' },
          { name: 'labels', kind: 'array', of: 'string', description: 'Empty from a search.' },
          { name: 'resolution', kind: 'string', description: 'Why it closed, or null while it is open.' },
          { name: 'created', kind: 'string', description: 'ISO 8601, as Jira gives it.' },
          { name: 'updated', kind: 'string', description: 'ISO 8601. What "recently touched" is read off.' },
          { name: 'url', kind: 'string', description: 'The browse link, for a person to open.' },
        ],
      }),
    ];
  }

  /*
   * JQL is the part a model gets wrong, and it gets it wrong silently: a
   * query with a mistaken field name does not fail, it returns nothing, and
   * "there are no issues" reads exactly like "I searched badly". So the page
   * an agent reads is mostly a query cookbook, plus the two moves that change
   * somebody else's board and deserve a moment's thought first.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Finding and moving Jira issues',
        description:
          'How to write JQL that finds what you meant, and what to check before changing a ticket.',
        content: `# Finding and moving Jira issues

## An empty result is usually a bad query

JQL does not fail on a query that means nothing useful — it returns nothing.
So "no issues found" and "I asked the wrong question" look identical from
here, and the difference matters.

Before believing an empty answer, widen it: drop the narrowest clause and
search again. If \`project = PROJ AND status = "In Review" AND assignee = x\`
is empty, try it without the assignee. If that is empty too, try
\`project = PROJ ORDER BY updated DESC\` and see what the statuses are actually
called on this board. They are rarely what you assumed.

## Queries worth knowing

\`\`\`
project = PROJ AND status != Done ORDER BY updated DESC
assignee = currentUser() AND status != Done
project = PROJ AND created >= -7d
text ~ "connection timeout" AND project = PROJ
labels = urgent AND status = "In Progress"
project = PROJ AND status CHANGED TO Done AFTER -1w
"Epic Link" = PROJ-100
\`\`\`

Things that catch people out:

- **Quote anything with a space.** \`status = In Review\` is a syntax error;
  \`status = "In Review"\` is not.
- **\`~\` is text search, \`=\` is exact.** \`summary ~ "timeout"\` finds it in a
  sentence; \`summary = "timeout"\` wants the whole summary to be that word.
- **Relative dates are \`-7d\`, \`-2w\`, \`-1M\`** — capital M is months, lowercase
  m is minutes, and that one bites.
- **\`ORDER BY\` goes last**, always, after every clause.
- **Status names are per-workflow.** "Done" on one board is "Closed" on the
  next. Look before you assume.

## Read before you write

\`jira_openIssue(key)\` before commenting on or moving anything. The summary is
not the ticket: the description says what was actually asked for, the comments
say what has been tried, and the status says whether somebody is already on it.
Acting on the summary alone is how a duplicate comment gets added to a ticket
that was closed last week.

## Moving an issue

\`jira_transition(key, to)\` takes a **name**, not an id, and which names are
available depends on where the issue is right now — a board can forbid going
straight from "To Do" to "Done". If the name you want is refused, the refusal
lists what *is* possible from here; pick from that list rather than trying
synonyms.

Say why in a comment when you move something. A status change with no comment
is a mystery to whoever sees it in their morning filter.

## Raising one

Search first. \`jira_createIssue\` will happily make a second copy of a bug that
is already open, and a duplicate is worse than no ticket: it splits the
discussion and somebody has to close it by hand.

Write the description as plain text. Jira renders its own wiki markup, not
markdown, so asterisks and backticks arrive as asterisks and backticks. Put
what happened, what was expected, and how to see it — in that order.

## When a project insists on more

A project can make fields of its own mandatory — "Occurs on: PROD, UAT or
DEV", "Kind of work: one of six" — and a create that leaves one out is
refused, naming the field. Do not give up there, and do not guess at values.

\`jira_form(project, type)\` answers the whole form: every field by name, which
ones are required, and the values each choice takes. Then pass them to
\`jira_createIssue\` in \`fields\`, keyed by name, valued by label:

\`\`\`
fields: { "Occurs on": "DEV", "Kind of work": "Maintenance" }
\`\`\`

A list takes a list, or one string with commas in it. A value that is not one
of the choices is refused here, with the choices — so if the person said
"dev", the answer is the label spelled as the form spells it.`,
      }),
    ];
  }

  /* The agents' surface: all of it. Reading a ticket and moving it are the same job. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'search' }),
      new OrknuxFunctionTool({ function: 'openIssue' }),
      new OrknuxFunctionTool({ function: 'comment' }),
      new OrknuxFunctionTool({ function: 'transition' }),
      new OrknuxFunctionTool({ function: 'form' }),
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
          'no longer tells anybody and so comes back null there. limit caps the issues, 25 if not given.',
        params: [
          { name: 'jql', type: 'string' },
          { name: 'limit', type: 'number', required: false, default: 25 },
        ],
        returnType: 'Search',
        run: (jql, limit) => {
          const asked = typeof jql === 'string' ? jql.trim() : '';
          if (asked.length === 0) {
            throw new Error('there is no JQL to search with');
          }
          const capped = Math.min(Math.max(limit, 1), 100);
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
        /* The shape declared above, not a map — see objects(). */
        returnType: 'Issue',
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
          /*
           * The same shape a search answers — `listed` already reads the three
           * fields a search leaves empty, and here they are actually there.
           */
          return listed(issue, site);
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
        returnType: 'Comment',
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
        returnType: 'Moved',
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
        name: 'form',
        description:
          'What a new issue in a project has to say: every field on its create form by name, which ' +
          'are required, and the values each choice takes. Pass the project key (PROJ) - or an empty ' +
          'project for the configured one - and the issue type by name ("Task", "Bug", "Story"). Read ' +
          'it when a create was refused for a missing field, or before creating in a project you do ' +
          'not know; createIssue takes the answers in its fields map, keyed by these names.',
        params: [
          { name: 'project', type: 'string' },
          { name: 'type', type: 'string' },
        ],
        returnType: 'Form',
        run: (project, type) => {
          const read = formOf(this.settings, projectOr(this.settings, project), typeOr(type));
          const fields = read.entries.map((one) => one.field);
          return {
            project: read.project,
            type: read.type,
            required: fields.filter((one) => one.required).map((one) => one.name),
            fields: fields,
          };
        },
      }),

      new OrknuxFunction({
        name: 'createIssue',
        description:
          'Raises a new issue. Pass the project key (PROJ) - or an empty project for the configured ' +
          'one - the issue type by name ("Task", "Bug", "Story"), a one-line summary, and the ' +
          'description as plain text. fields carries anything else the project asks for, keyed by ' +
          'field name as form lists it and valued by label - {"Occurs on": "DEV", "Priority": "High"}; ' +
          'a list takes a list or a comma-separated string. Answers the new issue\'s key and a url. ' +
          'Search first: raising a duplicate of something already open is worse than not raising it.',
        params: [
          { name: 'project', type: 'string' },
          { name: 'type', type: 'string' },
          { name: 'summary', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'fields', type: 'map', required: false, default: {} },
        ],
        returnType: 'Raised',
        run: (project, type, summary, description, extra) => {
          const said = typeof summary === 'string' ? summary.trim() : '';
          if (said.length === 0) {
            throw new Error('a new issue needs a summary');
          }
          const where = projectOr(this.settings, project);
          const kind = typeOr(type);

          /*
           * The project's own fields first, resolved against its form, so
           * that "Occurs on": "DEV" leaves here as customfield_10123: { id }.
           * The form is only read when there is something to resolve: a
           * create that says nothing extra stays one request.
           */
          const fields = {};
          const asked = extra !== null && typeof extra === 'object' ? Object.entries(extra) : [];
          if (asked.length > 0) {
            const form = formOf(this.settings, where, kind);
            for (const [name, value] of asked) {
              const entry = entryNamed(form, name);
              if (entry === null) {
                throw new Error(
                  `the ${where} ${form.type} form has no field "${name}"; form("${where}", "${form.type}") lists what it has`,
                );
              }
              fields[entry.field.id] = valueFor(this.settings, entry, value);
            }
          }

          fields.project = { key: where };
          fields.issuetype = { name: kind };
          fields.summary = said;
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
