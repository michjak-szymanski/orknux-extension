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

test('the web plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('web'));

  assert.equal(inspected.id, 'web');
  assert.deepEqual(validate(inspected), []);

  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.name),
    ['apiKey', 'answer'],
  );
  /* The key is the one secret; the answer toggle is a plain setting. */
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.secret),
    [true, false],
  );
  assert.deepEqual(
    inspected.parameters.map((parameter) => parameter.required),
    [true, false],
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

test('a web search refuses an empty query and a missing key, before reaching anything', async () => {
  const url = new URL(`../../plugins/web/web.js`, import.meta.url);
  const { default: Web } = await import(url.href);
  const declared = new Web().functions().find((one) => one.name === 'search');

  /* Nothing to search for is decided before the key is even looked at. */
  assert.throws(() => declared.run('   ', 0), /nothing to search for/);
  /* And a real query with no key says which parameter, rather than failing at the door. */
  assert.throws(() => declared.run('what happened today', 0), /apiKey parameter is not set/);
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
