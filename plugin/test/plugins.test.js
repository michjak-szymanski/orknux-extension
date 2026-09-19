import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../dist/index.js';
import { inspect } from '../dist/tooling.js';

/**
 * The production plugins in this repository, held to the contract this package
 * mirrors. Each is a single file already in the shape the server takes, so
 * there is nothing to bundle: it is loaded as it stands and asked what it is,
 * exactly the way an upload would ask — which is what keeps "the library
 * accepts what the server accepts" true of the plugins people actually
 * load, not only of fixtures written to pass.
 */

const shipped = (name) =>
  fileURLToPath(new URL(`../../plugins/${name}/${name}.js`, import.meta.url));

test('the github plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('github'));

  assert.equal(inspected.id, 'github');
  assert.equal(inspected.apiVersion, 1);
  assert.deepEqual(validate(inspected), []);

  /*
   * Both credentials are secrets: a typed-in value is refused by the server.
   * Neither is required, because the plugin has two halves — a webhook-only
   * workspace never sets the token, an API-only one never sets the secret.
   */
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['webhookSecret', 'token', 'organization', 'apiUrl'],
  );
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.secret),
    [true, true, false, false],
  );
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.required),
    [false, false, false, false],
  );

  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  assert.deepEqual(inspected.capabilities, ['NETWORK_REQUEST']);

  const surface = [
    'searchPulls',
    'listRepos',
    'listFiles',
    'openPull',
    'searchCode',
    'searchCommits',
    'openCommit',
    'buildStatus',
    'openFile',
    'fileHistory',
    'createAgentTask',
    'agentTask',
    'agentTaskLogs',
    'messageAgentTask',
    'comment',
    'reviewComment',
    'replyToComment',
  ];
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['verify', 'describe', ...surface],
  );

  /*
   * The agents' surface is the API half, each an OrknuxFunctionTool the
   * inspection resolved — and never the webhook machinery, which a model has
   * no delivery to call with.
   */
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    surface,
  );
  for (const declared of inspected.tools) {
    assert.equal(declared.proxyOf, declared.name);
    const fronted = inspected.functions.find((one) => one.name === declared.proxyOf);
    assert.deepEqual(declared.params, fronted.params);
    assert.equal(declared.returnType, fronted.returnType);
    assert.equal(declared.description, fronted.description);
  }
});

test('a github api call without a token is a thrown sentence, not a request', async () => {
  /*
   * The token is optional at load so the webhook half can stand alone — which
   * makes "unset but called" a case every API function has to answer well:
   * with the parameter's name, before anything reaches for the network.
   */
  const url = new URL(`../../plugins/github/github.js`, import.meta.url);
  const { default: Github } = await import(url.href);
  const declared = new Github().functions().find((one) => one.name === 'searchPulls');

  assert.throws(() => declared.run('anything', 0), /token parameter is not set/);
});

test('the slack plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('slack'));

  assert.equal(inspected.id, 'slack');
  assert.deepEqual(validate(inspected), []);

  /* A connection parameter: answered by pointing at a row, never typed in. */
  assert.equal(inspected.parameters.length, 2);
  assert.equal(inspected.parameters[0].name, 'slack');
  assert.equal(inspected.parameters[0].type, 'connection');
  assert.equal(inspected.parameters[0].connectionType, 'SLACK');
  assert.equal(inspected.parameters[0].required, false);
  /* The upload half's token: a secret, and optional so everything else stays tokenless. */
  assert.equal(inspected.parameters[1].name, 'botToken');
  assert.equal(inspected.parameters[1].secret, true);
  assert.equal(inspected.parameters[1].required, false);

  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  assert.deepEqual(inspected.capabilities, [
    'SLACK_READ_THREAD',
    'SLACK_READ_MESSAGE',
    'SLACK_READ_USER',
    'SLACK_MENTION',
    'SLACK_POST_MESSAGE',
    'SLACK_ADD_REACTION',
    'SLACK_SEARCH',
    'NETWORK_REQUEST',
  ]);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    [
      'isFirstReply',
      'readMessage',
      'whoIs',
      'readThread',
      'post',
      'react',
      'search',
      'mention',
      'upload',
      'uploadBinary',
      'uploadFromUrl',
      'remoteFile',
      'listAttachments',
      'readAttachment',
    ],
  );

  /*
   * The agents' surface: every call the plugin wraps, each an
   * OrknuxFunctionTool the inspection resolved — so every tool carries its
   * function's own params, return type and description, and `isFirstReply`
   * stays a workflow's gate.
   */
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    [
      'readMessage',
      'whoIs',
      'mention',
      'readThread',
      'post',
      'react',
      'search',
      'upload',
      'uploadBinary',
      'uploadFromUrl',
      'remoteFile',
      'listAttachments',
      'readAttachment',
    ],
  );
  for (const declared of inspected.tools) {
    assert.equal(declared.proxyOf, declared.name);
    const fronted = inspected.functions.find((one) => one.name === declared.proxyOf);
    assert.deepEqual(declared.params, fronted.params);
    assert.equal(declared.returnType, fronted.returnType);
    assert.equal(declared.description, fronted.description);
  }
});

test('the teams plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('teams'));

  assert.equal(inspected.id, 'teams');
  assert.deepEqual(validate(inspected), []);

  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['webhookSecret', 'webhookName'],
  );
  assert.equal(inspected.parameters[0].secret, true);
  /* It asks for nothing at all — the hashing is written out so that holds. */
  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, []);
  assert.deepEqual(inspected.tools, []);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['verify', 'text', 'sender', 'message', 'channelUrl', 'replyUrl'],
  );
});

test('the confluence plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('confluence'));

  assert.equal(inspected.id, 'confluence');
  assert.deepEqual(validate(inspected), []);

  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['url', 'email', 'token'],
  );
  /* The token is the one secret; the url and the email are plain settings. */
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.secret),
    [false, false, true],
  );
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.required),
    [true, false, true],
  );

  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  assert.deepEqual(inspected.capabilities, ['NETWORK_REQUEST']);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['search', 'openPage'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['search', 'openPage'],
  );
});

test('the confluence plugin reads a page id out of either spelling of a page url', async () => {
  const url = new URL(`../../plugins/confluence/confluence.js`, import.meta.url);
  const { default: Confluence } = await import(url.href);
  const declared = new Confluence().functions().find((one) => one.name === 'openPage');

  /*
   * Neither of these reaches the network: the Cloud and Server spellings are
   * resolved to an id first, and a string that is neither is refused there —
   * before, not after, a request would have gone out.
   */
  assert.throws(() => declared.run('not a page'), /not a page id or a page url/);
  assert.throws(
    () => declared.run('https://x.atlassian.net/wiki/spaces/DOC/pages/12345/T'),
    /url parameter is not set/,
  );
  assert.throws(
    () => declared.run('https://wiki.example.com/pages/viewpage.action?pageId=99'),
    /url parameter is not set/,
  );
});

test('the jira plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('jira'));

  assert.equal(inspected.id, 'jira');
  assert.deepEqual(validate(inspected), []);

  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['url', 'email', 'token', 'project'],
  );
  /* The token is the one secret; the rest are plain settings. */
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.secret),
    [false, false, true, false],
  );
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.required),
    [true, false, true, false],
  );

  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  assert.deepEqual(inspected.capabilities, ['NETWORK_REQUEST']);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['search', 'openIssue', 'comment', 'transition', 'createIssue'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['search', 'openIssue', 'comment', 'transition', 'createIssue'],
  );
});

test('a jira call says what is missing, and picks its search endpoint by deployment', async () => {
  const url = new URL(`../../plugins/jira/jira.js`, import.meta.url);
  const { default: Jira } = await import(url.href);

  const configured = (settings) => {
    const plugin = Object.create(Jira.prototype);
    Object.defineProperty(plugin, 'settings', { value: Object.freeze(settings) });
    const functions = plugin.functions();
    return (name) => functions.find((one) => one.name === name);
  };

  /* Nothing to do with is decided before any setting is read. */
  assert.throws(() => configured({})('search').run('   ', 0), /no JQL to search with/);
  assert.throws(() => configured({})('openIssue').run(''), /no issue key to open/);
  assert.throws(() => configured({})('comment').run('PROJ-1', '  '), /no comment to add/);
  assert.throws(() => configured({})('transition').run('PROJ-1', ''), /no status to move/);
  assert.throws(() => configured({})('createIssue').run('', 'Task', '', ''), /needs a summary/);

  /* Then the settings, each named. */
  assert.throws(() => configured({})('search').run('project = PROJ', 0), /url parameter is not set/);
  assert.throws(
    () => configured({ url: 'https://x.atlassian.net' })('search').run('project = PROJ', 0),
    /token parameter is not set/,
  );
  /* A create with no project and no default says so rather than guessing one. */
  assert.throws(
    () => configured({ url: 'https://x.atlassian.net', token: 't' })('createIssue').run('', 'Task', 'A thing', ''),
    /no project was passed and no default project is configured/,
  );

  /*
   * And the split that matters, watched rather than inferred: Cloud — which is
   * what having an email to send means — must ask the only search endpoint it
   * has left, because Atlassian removed the other one in 2025. Server still
   * has v2. The request is caught on its way out to see which was chosen, and
   * to see that the two authentication schemes differ with it.
   */
  const asked = [];
  const door = globalThis.orknux.http.request;
  globalThis.orknux.http.request = (what) => {
    asked.push(what);
    return { status: 200, headers: {}, body: '{}', json: { issues: [] } };
  };
  try {
    configured({ url: 'https://x.atlassian.net', email: 'a@b.c', token: 't' })('search')
      .run('project = PROJ', 10);
    configured({ url: 'https://jira.example.com', token: 't' })('search')
      .run('project = PROJ', 10);
  } finally {
    globalThis.orknux.http.request = door;
  }

  assert.equal(asked.length, 2);
  const [onCloud, onServer] = asked;

  /* Cloud: the bounded POST, with the fields named because it insists on them. */
  assert.equal(onCloud.url, 'https://x.atlassian.net/rest/api/3/search/jql');
  assert.equal(onCloud.method, 'POST');
  assert.equal(onCloud.body.jql, 'project = PROJ');
  assert.ok(Array.isArray(onCloud.body.fields) && onCloud.body.fields.includes('summary'));
  assert.match(onCloud.headers.authorization, /^Basic /);

  /* Server: the GET that has always been there, and a bearer token. */
  assert.match(onServer.url, /^https:\/\/jira\.example\.com\/rest\/api\/2\/search\?jql=/);
  assert.match(onServer.url, /maxResults=10/);
  assert.equal(onServer.method, 'GET');
  assert.equal(onServer.headers.authorization, 'Bearer t');

  /* The Basic credential is the pair, encoded — base64 written out longhand. */
  assert.equal(
    Buffer.from(onCloud.headers.authorization.slice('Basic '.length), 'base64').toString('utf8'),
    'a@b.c:t',
  );
});

test('the prometheus plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('prometheus'));

  assert.equal(inspected.id, 'prometheus');
  assert.deepEqual(validate(inspected), []);

  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['url', 'username', 'token'],
  );
  assert.equal(inspected.parameters[2].secret, true);
  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  assert.deepEqual(inspected.capabilities, ['NETWORK_REQUEST']);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['listMetrics', 'query'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['listMetrics', 'query'],
  );
});

test('the mermaid plugin declares what the server would accept, and renders offline', async () => {
  const inspected = await inspect(shipped('mermaid'));

  assert.equal(inspected.id, 'mermaid');
  assert.deepEqual(validate(inspected), []);
  assert.deepEqual(inspected.parameters, []);
  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  /* The renderer is bundled in, so nothing is asked of the server at all. */
  assert.deepEqual(inspected.capabilities, []);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['render', 'links'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['render', 'links'],
  );

  const url = new URL(`../../plugins/mermaid/mermaid.js`, import.meta.url);
  const { default: Mermaid } = await import(url.href);
  const functions = new Mermaid().functions();
  const one = (name) => functions.find((declared) => declared.name === name);

  /*
   * `render` draws right here, in a Node with no DOM — the sandbox's own
   * situation — and its SVG must carry no outward reference: the library's
   * Google Fonts @import is stripped on the way out.
   */
  const drawn = one('render').run('graph TD\n  A[start] --> B{ok?}\n  B -->|yes| C[done]', '');
  assert.ok(drawn.svg.includes('<svg'), 'renders svg');
  assert.ok(drawn.svg.includes('start'), 'the nodes are in the drawing');
  assert.ok(!drawn.svg.includes('@import'), 'no outward reference survives');
  assert.equal(drawn.bytes, drawn.svg.length);

  const themed = one('render').run('sequenceDiagram\n  A->>B: hi', 'nord');
  assert.ok(themed.svg.includes('#2e3440'), 'the theme colors the drawing');

  assert.throws(() => one('render').run('graph TD\n  A-->B', 'nope'), /no theme called nope/);
  assert.throws(() => one('render').run('pie\n  "a" : 1', ''), /could not render the diagram/);
  assert.throws(() => one('render').run('   ', ''), /no diagram source/);

  /*
   * `links` still carries the state json the mermaid sites read — decoding
   * the url back is the proof the alphabet and the padding are theirs.
   */
  const linked = one('links').run('graph TD;\n  A-->B', 'dark');
  const encoded = linked.image.slice('https://mermaid.ink/img/'.length, -'?type=png'.length);
  const state = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  assert.equal(state.code, 'graph TD;\n  A-->B');
  assert.equal(state.mermaid.theme, 'dark');
  assert.equal(linked.svg, `https://mermaid.ink/svg/${encoded}`);
  assert.equal(linked.editor, `https://mermaid.live/edit#base64:${encoded}`);
  assert.equal(linked.markdown, `![diagram](${linked.image})`);
});

test('the pdf plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('pdf'));

  assert.equal(inspected.id, 'pdf');
  assert.deepEqual(validate(inspected), []);
  assert.deepEqual(inspected.parameters, []);
  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  /* Writer, fonts and diagram renderer are all bundled in: no capability. */
  assert.deepEqual(inspected.capabilities, []);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['fromHtml'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['fromHtml'],
  );
});

test('the pdf plugin writes a pdf out of html, diagrams and all, without a DOM', async () => {
  const url = new URL(`../../plugins/pdf/pdf.js`, import.meta.url);
  const { default: Pdf } = await import(url.href);
  const declared = new Pdf().functions().find((one) => one.name === 'fromHtml');

  const made = declared.run(
    '<h1>Report</h1><p>Hello <b>world</b> &amp; more</p><hr><ul><li>one</li><li>two</li></ul>',
    'The Report',
  );

  /* The answer is binary wearing base64, and the counts agree with the bytes. */
  const bytes = Buffer.from(made.base64, 'base64');
  assert.equal(made.bytes, bytes.length);
  assert.equal(made.pages, 1);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const raw = bytes.toString('latin1');
  assert.ok(raw.includes('DejaVu'), 'the unicode faces are embedded');
  assert.ok(raw.includes('The Report'), 'the title metadata is set');

  /* Real diacritics now — nothing is folded, so this must simply not throw. */
  const polish = declared.run('<p>Zażółć gęślą jaźń</p>', '');
  assert.ok(polish.bytes > 0);

  /* A mermaid block becomes vector drawing in the page, still offline. */
  const diagrammed = declared.run(
    '<h2>Flow</h2><pre class="mermaid">graph TD\n  A[start] --> B{ok?}\n  B -->|yes| C[done]</pre><p>After.</p>',
    '',
  );
  assert.equal(diagrammed.pages, 1);
  assert.ok(diagrammed.bytes > made.bytes, 'the drawing weighs something');
  assert.throws(
    () => declared.run('<pre class="mermaid">gantt\n  title x</pre>', ''),
    /could not render the diagram/,
  );

  /* Enough paragraphs run past one A4 page. */
  const long = declared.run(`<p>${'word '.repeat(120)}</p>`.repeat(20), '');
  assert.ok(long.pages > 1, `expected more than one page, got ${long.pages}`);

  assert.throws(() => declared.run('<p>   </p>', ''), /no text to lay out/);
});

test('the markdown plugin declares what the server would accept, and converts what Slack reads', async () => {
  const inspected = await inspect(shipped('markdown'));

  assert.equal(inspected.id, 'markdown');
  assert.deepEqual(validate(inspected), []);
  assert.deepEqual(inspected.parameters, []);
  /* String in, string out: there is nothing here to grant. */
  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, []);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['toSlack', 'toText'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['toSlack', 'toText'],
  );

  const url = new URL(`../../plugins/markdown/markdown.js`, import.meta.url);
  const { default: Markdown } = await import(url.href);
  const functions = new Markdown().functions();
  const one = (name) => functions.find((declared) => declared.name === name);
  const slack = (text) => one('toSlack').run(text);

  /* The emphasis pass, which is the one that goes wrong if the order slips. */
  assert.equal(slack('**bold**'), '*bold*');
  assert.equal(slack('__bold__'), '*bold*');
  assert.equal(slack('*italic*'), '_italic_');
  assert.equal(slack('_italic_'), '_italic_');
  assert.equal(slack('***both***'), '*both*');
  assert.equal(slack('~~struck~~'), '~struck~');
  assert.equal(slack('**bold** and *italic*'), '*bold* and _italic_');

  /* Links, which must not meet the emphasis pass at all. */
  assert.equal(slack('[the docs](https://x.example/a_b_c)'), '<https://x.example/a_b_c|the docs>');
  assert.equal(slack('![a chart](https://x.example/c.png)'), '<https://x.example/c.png|a chart>');
  assert.equal(slack('<https://x.example/a_b>'), '<https://x.example/a_b>');

  /* Code, which is literal — the asterisks inside it are asterisks. */
  assert.equal(slack('`a * b`'), '`a * b`');
  assert.equal(slack('```js\nconst a = **1**;\n```'), '```\nconst a = **1**;\n```');

  /*
   * Emphasis inside emphasis, and code inside emphasis: both need the parked
   * pieces to be restored more than once, which is what the bold pass sets up
   * by parking its own output rather than writing it back into the line.
   */
  assert.equal(slack('**bold with *italic* inside**'), '*bold with _italic_ inside*');
  assert.equal(slack('**bold with `code` inside**'), '*bold with `code` inside*');
  assert.equal(slack('# A **bold** heading'), '*A *bold* heading*');

  /* What mrkdwn has no spelling for, left readable rather than dropped. */
  assert.equal(slack('# Heading'), '*Heading*');
  assert.equal(slack('- one\n- two'), '•  one\n•  two');
  assert.equal(slack('1. one\n2. two'), '1.  one\n2.  two');
  assert.equal(slack('| a | b |\n|---|---|\n| 1 | 2 |'), 'a  b\n1  2');

  /* And the escaping, so text cannot become markup. */
  assert.equal(slack('a < b & c > d'), 'a &lt; b &amp; c &gt; d');

  const text = one('toText').run('# Title\n\n**bold** [docs](https://x.example) `code`\n\n- one');
  assert.equal(text, 'Title\n\nbold docs (https://x.example) code\n\n• one');
});

test('the date plugin declares what the server would accept, and counts the calendar correctly', async () => {
  const inspected = await inspect(shipped('date'));

  assert.equal(inspected.id, 'date');
  assert.deepEqual(validate(inspected), []);
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['timezone', 'weekend', 'holidays', 'opensAt', 'closesAt'],
  );
  /* A clock and the zone database — both language builtins, neither a door. */
  assert.deepEqual(inspected.permissions, ['TEMPORAL', 'INTL']);
  assert.deepEqual(inspected.capabilities, []);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['today', 'now', 'describe', 'shift', 'shiftBusinessDays', 'businessDaysBetween', 'between', 'isBusinessHours'],
  );
  assert.deepEqual(inspected.tools.length, 8);

  const url = new URL(`../../plugins/date/date.js`, import.meta.url);
  const { default: OrknuxDate } = await import(url.href);

  /* A workspace's answers, without running the constructor that freezes them. */
  const configured = (settings) => {
    const plugin = Object.create(OrknuxDate.prototype);
    Object.defineProperty(plugin, 'settings', { value: Object.freeze(settings) });
    const functions = plugin.functions();
    return (name) => functions.find((one) => one.name === name);
  };

  const office = configured({
    timezone: 'Europe/Warsaw',
    holidays: '2026-12-25,2026-12-26',
    opensAt: '09:00',
    closesAt: '17:00',
  });

  /* The one question this plugin is asked most: what is the date. */
  const todayThere = office('today').run('');
  assert.match(todayThere, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayThere, office('now').run('').date, 'today is the date now carries');
  /* And it follows the zone it is asked about, not the configured one. */
  assert.match(office('today').run('Pacific/Auckland'), /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => office('today').run('Mars/Olympus'), /no timezone called/);

  /* 2026-09-19 is a Saturday, which is the whole of what a weekend means here. */
  const saturday = office('describe').run('2026-09-19', '');
  assert.equal(saturday.weekday, 'saturday');
  assert.equal(saturday.weekend, true);
  assert.equal(saturday.businessDay, false);
  assert.equal(saturday.quarter, 3);
  assert.equal(saturday.date, '2026-09-19');

  /* Zero lands on the next working day, which is what "due today" means on a Saturday. */
  assert.equal(office('shiftBusinessDays').run('2026-09-19', 0), '2026-09-21');
  /* Friday plus one working day is the Monday. */
  assert.equal(office('shiftBusinessDays').run('2026-09-18', 1), '2026-09-21');
  /* And the Christmas holidays are stepped over: Thu 24th + 1 skips 25th and 26th. */
  assert.equal(office('shiftBusinessDays').run('2026-12-24', 1), '2026-12-28');

  /* Half-open: Monday to the Tuesday after it is one working day. */
  assert.equal(office('businessDaysBetween').run('2026-09-21', '2026-09-22'), 1);
  /* A whole week is five, not seven. */
  assert.equal(office('businessDaysBetween').run('2026-09-21', '2026-09-28'), 5);
  /* Backwards is negative. */
  assert.equal(office('businessDaysBetween').run('2026-09-28', '2026-09-21'), -5);

  /* Month ends clamp rather than overflowing into the next month. */
  assert.match(office('shift').run('2026-01-31', 1, 'months'), /^2026-02-28/);
  assert.match(office('shift').run('2026-09-19', -1, 'years'), /^2025-09-19/);
  assert.match(office('shift').run('2026-09-19', 3, 'days'), /^2026-09-22/);

  /*
   * A day across the end of summer time is 25 hours, so a shift that moved the
   * instant rather than the wall clock would land an hour out. Warsaw falls
   * back on 2026-10-25.
   */
  const acrossDst = office('shift').run('2026-10-24T12:00:00+02:00', 1, 'days');
  assert.match(acrossDst, /^2026-10-25T12:00:00\+01:00$/);

  /* Calendar counting, not an average month length. */
  assert.equal(office('between').run('2026-01-01', '2026-03-01', 'months'), 2);
  assert.equal(office('between').run('2026-01-31', '2026-02-28', 'months'), 0);
  assert.equal(office('between').run('2026-09-19', '2026-09-22', 'days'), 3);

  /* The gate: a working day inside the working hours, and nothing else. */
  assert.equal(office('isBusinessHours').run('2026-09-21T10:00:00+02:00', ''), true);
  assert.equal(office('isBusinessHours').run('2026-09-21T08:59:00+02:00', ''), false);
  assert.equal(office('isBusinessHours').run('2026-09-21T17:00:00+02:00', ''), false);
  /* Saturday is out whatever the clock says, and so is a configured holiday. */
  assert.equal(office('isBusinessHours').run('2026-09-19T10:00:00+02:00', ''), false);
  assert.equal(office('isBusinessHours').run('2026-12-25T10:00:00+01:00', ''), false);

  /* A weekend that is not Saturday and Sunday, because it is not everywhere. */
  const gulf = configured({ timezone: 'Asia/Dubai', weekend: 'fri,sat' });
  assert.equal(gulf('describe').run('2026-09-20', '').weekend, false);
  assert.equal(gulf('describe').run('2026-09-18', '').weekend, true);

  /* And the refusals name what they take. */
  assert.throws(() => office('shift').run('2026-09-19', 1, 'fortnights'), /no unit called fortnights/);
  assert.throws(() => office('describe').run('not a date', ''), /not a date this understands/);
  assert.throws(
    () => configured({ timezone: 'Mars/Olympus' })('now').run(''),
    /no timezone called Mars\/Olympus/,
  );
});

test('the web plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('web'));

  assert.equal(inspected.id, 'web');
  assert.deepEqual(validate(inspected), []);

  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['backend', 'apiKey', 'answer'],
  );
  /* The key is the one secret; the backend and the answer toggle are settings. */
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.secret),
    [false, true, false],
  );
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.required),
    [true, true, false],
  );

  /* Nothing of the language is needed — only the request and what came back. */
  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, ['NETWORK_REQUEST']);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['search'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['search'],
  );
});

test('a web search says which setting is wrong, before reaching anything', async () => {
  const url = new URL(`../../plugins/web/web.js`, import.meta.url);
  const { default: Web } = await import(url.href);

  /*
   * An instance carrying settings. The base class freezes `settings` onto an
   * instance as it constructs one, and does it non-configurably — so a test
   * that wants a workspace's answers builds the object without running that
   * constructor, which is the only door left and is enough: `functions()` is
   * a prototype method and the runs read `this.settings`.
   */
  const configured = (settings) => {
    const plugin = Object.create(Web.prototype);
    Object.defineProperty(plugin, 'settings', { value: Object.freeze(settings) });
    return plugin.functions().find((one) => one.name === 'search');
  };

  /* Nothing to search for is decided before any setting is looked at. */
  assert.throws(() => configured({}).run('   ', 0), /nothing to search for/);

  /* Then the backend, named or not, and the refusal says what it takes. */
  assert.throws(
    () => configured({}).run('what happened today', 0),
    /backend parameter is not set: it takes tavily or brave/,
  );
  assert.throws(
    () => configured({ backend: 'bing' }).run('what happened today', 0),
    /no search backend called bing: it takes tavily or brave/,
  );

  /*
   * And the key last — asked for by the backend's own name, off a setting
   * that was typed into a page and so is matched trimmed and in any case.
   */
  assert.throws(
    () => configured({ backend: '  TAVILY ' }).run('what happened today', 0),
    /apiKey parameter is not set, and tavily needs one/,
  );
  assert.throws(
    () => configured({ backend: 'Brave' }).run('what happened today', 0),
    /apiKey parameter is not set, and brave needs one/,
  );

  /* With both set, the only thing left is the network — which is not granted here. */
  assert.throws(
    () => configured({ backend: 'brave', apiKey: 'nope' }).run('what happened today', 0),
    /could not reach Brave: this plugin was not granted NETWORK_REQUEST/,
  );
  assert.throws(
    () => configured({ backend: 'tavily', apiKey: 'nope' }).run('what happened today', 0),
    /could not reach Tavily: this plugin was not granted NETWORK_REQUEST/,
  );
});

test('the todo plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('todo'));

  assert.equal(inspected.id, 'todo');
  assert.deepEqual(validate(inspected), []);
  assert.deepEqual(inspected.parameters, []);
  /* The session store is not a capability, so this asks for nothing at all. */
  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, []);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['add', 'list', 'reorder', 'note', 'complete'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['add', 'list', 'reorder', 'note', 'complete'],
  );
});

test('the todo plugin outside a session: an empty truth, and thrown sentences', async () => {
  /*
   * Out here the contract's fallback store holds nothing and takes nothing —
   * so `list` answers the empty list that is true, a write is refused in the
   * server's own sentence, and everything that names a task says which task
   * is not there before it would have written.
   */
  const url = new URL(`../../plugins/todo/todo.js`, import.meta.url);
  const { default: Todo } = await import(url.href);
  const functions = new Todo().functions();
  const one = (name) => functions.find((declared) => declared.name === name);

  assert.deepEqual(one('list').run(), { tasks: [], remaining: 0 });
  assert.throws(() => one('add').run(['split the work']), /could not keep the list: there is no session store here/);
  assert.throws(() => one('add').run(['   ', 42]), /no tasks to add/);
  assert.throws(() => one('reorder').run([1]), /there is no task 1/);
  assert.throws(() => one('note').run(1, 'a finding'), /there is no task 1/);
  assert.throws(() => one('note').run(1, '   '), /no note to add/);
  assert.throws(() => one('complete').run(1), /there is no task 1/);
});

test('the todo plugin works a list end to end where a store exists', async () => {
  const url = new URL(`../../plugins/todo/todo.js`, import.meta.url);
  const { default: Todo } = await import(url.href);
  const functions = new Todo().functions();
  const one = (name) => functions.find((declared) => declared.name === name);

  /*
   * A store the way the session's behaves — values make the trip as JSON, so
   * what comes back out is a copy — swapped in under the fallback `orknux`
   * for the length of this test.
   */
  const held = new Map();
  const store = globalThis.orknux.session.store;
  globalThis.orknux.session.store = {
    put: (key, value) => {
      held.set(key, JSON.stringify(value));
      return { ok: true };
    },
    get: (key) => (held.has(key) ? JSON.parse(held.get(key)) : null),
  };
  try {
    const added = one('add').run(['read the code', 'write the fix', 'run the tests']);
    assert.deepEqual(
      added.tasks.map((task) => task.id),
      [1, 2, 3],
    );
    assert.equal(added.remaining, 3);

    /* One id fronts one task; the rest keep their order. Ids never change. */
    const reordered = one('reorder').run([2]);
    assert.deepEqual(
      reordered.tasks.map((task) => task.title),
      ['write the fix', 'read the code', 'run the tests'],
    );

    const noted = one('note').run(2, 'the bug is in the parser');
    assert.deepEqual(noted, {
      id: 2,
      title: 'write the fix',
      done: false,
      notes: ['the bug is in the parser'],
    });

    assert.equal(one('complete').run(2).remaining, 2);
    /* Already-done counts as done, and the list survives as stored state. */
    assert.equal(one('complete').run(2).remaining, 2);
    const listed = one('list').run();
    assert.equal(listed.tasks.find((task) => task.id === 2).done, true);
    assert.deepEqual(listed.tasks.find((task) => task.id === 2).notes, ['the bug is in the parser']);

    /* New work keeps counting from where the ids left off. */
    assert.deepEqual(
      one('add').run(['ship it']).tasks.map((task) => task.id),
      [2, 1, 3, 4],
    );
  } finally {
    globalThis.orknux.session.store = store;
  }
});

test('a slack upload without a bot token is a thrown sentence, not a request', async () => {
  /*
   * The token is optional at load so the tokenless surface can stand alone —
   * which makes "unset but called" a case both upload functions have to
   * answer well: with the parameter's name, before anything reaches for the
   * network.
   */
  const url = new URL(`../../plugins/slack/slack.js`, import.meta.url);
  const { default: Slack } = await import(url.href);
  const functions = new Slack().functions();

  const upload = functions.find((one) => one.name === 'upload');
  assert.throws(
    () => upload.run('C1', 'report.csv', 'a,b\n1,2', '', ''),
    /botToken parameter is not set/,
  );
  const remote = functions.find((one) => one.name === 'remoteFile');
  assert.throws(
    () => remote.run('C1', 'https://example.com/report.pdf', 'The report', 'pdf'),
    /botToken parameter is not set/,
  );
  /* And a remote file that has no url is refused before any of that. */
  assert.throws(() => remote.run('C1', 'not a url', '', ''), /needs the http\(s\) url/);

  const binary = functions.find((one) => one.name === 'uploadBinary');
  assert.throws(() => binary.run('C1', 'a.pdf', 'JVBERi0=', '', ''), /botToken parameter is not set/);
  assert.throws(() => binary.run('C1', 'a.pdf', '   ', '', ''), /no bytes to upload/);

  /* The fetch-and-host door refuses a missing url, then a missing token — before fetching anything. */
  const copied = functions.find((one) => one.name === 'uploadFromUrl');
  assert.throws(() => copied.run('C1', 'not a url', '', '', ''), /fetched by its http\(s\) url/);
  assert.throws(
    () => copied.run('C1', 'https://mermaid.ink/img/abc', '', '', ''),
    /botToken parameter is not set/,
  );
});

test('an ungranted slack call from a shipped plugin is a thrown sentence, not a guess', async () => {
  /*
   * The slack plugin throws where a condition could not be decided, and the
   * fallback helpers answer an ungranted call with the sandbox's own words —
   * so running `isFirstReply` here, outside any grant, has to fail saying so
   * rather than quietly answering false.
   */
  const inspected = await inspect(shipped('slack'));
  assert.ok(inspected.functions.some((declared) => declared.name === 'isFirstReply'));

  const url = new URL(`../../plugins/slack/slack.js`, import.meta.url);
  const { default: Slack } = await import(url.href);
  const declared = new Slack().functions().find((one) => one.name === 'isFirstReply');

  assert.throws(
    () => declared.run.call(new Slack(), { id: 1, type: 'SLACK' }, 'C1', '1.0', '2.0'),
    /could not read the thread: this plugin was not granted SLACK_READ_THREAD/,
  );
});
