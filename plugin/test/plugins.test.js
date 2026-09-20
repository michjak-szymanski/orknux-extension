import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
  assert.equal(inspected.parameters.length, 3);
  assert.equal(inspected.parameters[0].name, 'slack');
  assert.equal(inspected.parameters[0].type, 'connection');
  assert.equal(inspected.parameters[0].connectionType, 'SLACK');
  assert.equal(inspected.parameters[0].required, false);
  /*
   * Two tokens, because Slack needs two: a bot token uploads files as the bot,
   * and search will not answer to one at all. Both secret, both optional — a
   * workspace that only reads and posts sets neither.
   */
  assert.equal(inspected.parameters[1].name, 'botToken');
  assert.equal(inspected.parameters[1].secret, true);
  assert.equal(inspected.parameters[1].required, false);
  assert.equal(inspected.parameters[2].name, 'userToken');
  assert.equal(inspected.parameters[2].secret, true);
  assert.equal(inspected.parameters[2].required, false);

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
    /*
     * Every one is its function, with a single deliberate exception: the
     * agents' uploadBinary is a tool of its own so that it can have no base64
     * argument at all. A model has a key every time — everything that makes
     * bytes answers one — and an argument it should never fill is an argument
     * that should not be in front of it. A workflow node has no session and so
     * never had a key, which is why the function this does not proxy keeps
     * taking bytes.
     */
    if (declared.name === 'uploadBinary') {
      assert.equal(declared.proxyOf, null, 'the agents\' uploadBinary is its own tool');
      assert.deepEqual(
        declared.params.map((param) => param.name),
        ['channel', 'filename', 'contentKey', 'comment', 'threadTs'],
      );
      continue;
    }
    /*
     * And the second: readAttachment answers a model the key for a file's
     * bytes rather than the base64 itself, for the same reason - what crosses
     * to a model should be what a model can use. Its arguments are the
     * function's; only the answer differs, which is why it cannot be a proxy.
     */
    /*
     * And the third: `post` takes an attachment as a map, and one of those
     * could carry base64 - the last way bytes could be typed into a call by a
     * model. Its tool refuses that and names contentKey instead; the function
     * still takes bytes, for the workflow node with no session to have kept
     * them in.
     */
    if (declared.name === 'post') {
      assert.equal(declared.proxyOf, null, "the agents' post is its own tool");
      const behind = inspected.functions.find((one) => one.name === 'post');
      assert.deepEqual(declared.params, behind.params, 'taking the same arguments');
      continue;
    }
    if (declared.name === 'readAttachment') {
      assert.equal(declared.proxyOf, null, "the agents' readAttachment is its own tool");
      const behind = inspected.functions.find((one) => one.name === 'readAttachment');
      assert.deepEqual(declared.params, behind.params, 'taking the same argument');
      assert.equal(declared.returnType, behind.returnType, 'and answering the same shape');
      continue;
    }
    assert.equal(declared.proxyOf, declared.name);
    const fronted = inspected.functions.find((one) => one.name === declared.proxyOf);
    assert.deepEqual(declared.params, fronted.params);
    assert.equal(declared.returnType, fronted.returnType);
    assert.equal(declared.description, fronted.description);
  }

  /* And the function it does not proxy still takes bytes, for the caller that has them. */
  const bytes = inspected.functions.find((one) => one.name === 'uploadBinary');
  assert.ok(
    bytes.params.some((param) => param.name === 'base64'),
    'the workflow surface keeps its base64',
  );
});

test('post writes mrkdwn, and leaves alone what already was', async () => {
  const url = new URL(`../../plugins/slack/slack.js`, import.meta.url);
  const { default: Slack } = await import(url.href);
  const post = new Slack().functions().find((one) => one.name === 'post').run;

  /* The one call this plugin makes, stood in for, so the text can be read. */
  const slack = globalThis.orknux.slack;
  let sent = null;
  globalThis.orknux.slack = {
    post: (connection, channel, text) => {
      sent = text;
      return { channel: channel, ts: '1' };
    },
  };

  try {
    const say = (text) => {
      post('c', 'C1', text, '', []);
      return sent;
    };

    /*
     * The five shapes that are never valid mrkdwn. Slack shows each of these
     * as the punctuation it is, and whatever wrote the message cannot see it
     * afterwards - which is why this happens on the way out rather than being
     * somebody's job to remember.
     */
    assert.equal(say('**bold**'), '*bold*');
    assert.equal(say('~~gone~~'), '~gone~');
    assert.equal(say('[text](https://x.com)'), '<https://x.com|text>');
    assert.equal(say('# Heading'), '*Heading*');
    assert.equal(say('*  item'), '•  item');
    assert.equal(say('- item'), '•  item');
    assert.equal(say('***very***'), '*_very_*');

    /*
     * And the property the whole design rests on: a single asterisk is bold in
     * mrkdwn and a single underscore is italic, so text that was already right
     * has to come through untouched. Converting those would break the messages
     * that needed no fixing, which is worse than the fault being fixed.
     */
    for (const already of [
      '*bold* and _italic_ and ~struck~',
      '<https://x.com|a link>',
      'a * b * c',
      '2 * 3 = 6',
    ]) {
      assert.equal(say(already), already, `left alone: ${already}`);
    }

    /* Code says what it says: a message about **bold** still reads **bold**. */
    assert.equal(say('Write `**bold**` for bold.'), 'Write `**bold**` for bold.');
    assert.equal(say('```\n**kept**\n```'), '```\n**kept**\n```');

    /* The whole of the message from the channel that prompted this. */
    assert.equal(
      say('I found:\n*  **orknux-extension**: Plugins and SDK\n*  **orknux-ui**'),
      'I found:\n•  *orknux-extension*: Plugins and SDK\n•  *orknux-ui*',
    );
  } finally {
    globalThis.orknux.slack = slack;
  }
});

test('the agents post refuses an attachment carrying bytes', async () => {
  const url = new URL(`../../plugins/slack/slack.js`, import.meta.url);
  const { default: Slack } = await import(url.href);
  const made = new Slack();
  const tool = made.tools().find((one) => one.name === 'post' && one.run !== undefined);
  const behind = made.functions().find((one) => one.name === 'post');

  /*
   * The refusal names the fix, because a model reads it at the moment it
   * matters - which a description, read once at the top, does not manage.
   */
  assert.throws(
    () => tool.run('', 'C1', 'hi', '', [{ filename: 'a.png', base64: 'UE5H' }]),
    /cannot carry base64 here: pass contentKey/,
  );

  /*
   * A key gets past it and reaches the token check, which is as far as
   * anything gets here without a Slack to talk to. The function takes the
   * bytes it refuses, and reaches the same place.
   */
  assert.throws(
    () => tool.run('', 'C1', 'hi', '', [{ filename: 'a.png', contentKey: 'k' }]),
    /nothing is kept under k in this session/,
    'a key goes down the key path, and says so when it names nothing',
  );

  /* And the function takes the bytes its tool refuses, reaching the token check. */
  assert.throws(
    () => behind.run('', 'C1', 'hi', '', [{ filename: 'a.png', base64: 'UE5H' }]),
    /botToken parameter is not set/,
    'the workflow surface still carries bytes',
  );
});

test('the agents uploadBinary takes a key and has nowhere to put bytes', async () => {
  const url = new URL(`../../plugins/slack/slack.js`, import.meta.url);
  const { default: Slack } = await import(url.href);
  const made = new Slack();
  const tool = made.tools().find((one) => one.name === 'uploadBinary' && one.run !== undefined);

  /* Nothing named, nothing to upload — and the sentence says what to do instead. */
  assert.throws(
    () => tool.run('C1', 'report.pdf', '', 'here', ''),
    /takes a contentKey, not bytes/,
  );

  /* A key naming nothing is a session that has moved on, not a missing argument. */
  assert.throws(
    () => tool.run('C1', 'report.pdf', 'pdf.nothing', 'here', ''),
    /nothing is kept under pdf.nothing/,
  );

  /*
   * And with something kept under it, the key resolves and the upload is
   * attempted — reaching the token check, which is as far as anything gets
   * without a Slack to talk to.
   */
  const held = new Map([['pdf.abc', 'UE5H']]);
  const store = globalThis.orknux.session.store;
  globalThis.orknux.session.store = {
    put: () => ({ ok: true }),
    get: (key) => (held.has(key) ? held.get(key) : null),
  };
  try {
    assert.throws(
      () => tool.run('C1', 'report.pdf', 'pdf.abc', 'here', ''),
      /botToken parameter is not set/,
      'the key resolved and the upload was attempted',
    );
  } finally {
    globalThis.orknux.session.store = store;
  }
});

test('readAttachment answers a key beside what it read', async () => {
  const inspected = await inspect(shipped('slack'));
  const shape = inspected.objects.find((one) => one.name === 'AttachmentContent');

  /*
   * Both halves of the answer can be handed straight on - text to `upload` as
   * its contentKey, bytes to `uploadBinary` as the only thing that one takes -
   * so reading a PDF out of one thread and putting it in another channel costs
   * nobody a retyped kilobyte.
   */
  assert.deepEqual(
    shape.properties.map((property) => property.name),
    ['name', 'mimetype', 'size', 'content', 'base64', 'key'],
  );

  /*
   * Two things here are not reachable from a test, for one reason: every path
   * past the token check needs `this.settings`, and the contract's own
   * fallback freezes those empty and non-configurable on purpose. So neither
   * how the branches fill this answer, nor how the agents' tool strips the
   * base64 out of it, can be driven from here - the tool closes over its own
   * declaration, so there is nothing to stand in for either. What a test can
   * hold is the shape above, the declaration in the loop further up, and the
   * refusal below.
   */
  const url = new URL(`../../plugins/slack/slack.js`, import.meta.url);
  const { default: Slack } = await import(url.href);
  const read = new Slack().functions().find((one) => one.name === 'readAttachment').run;
  assert.throws(() => read('F1'), /botToken parameter is not set/);
});

test('the makers of bytes answer their agents a key, not the bytes', async () => {
  /*
   * An answer reaches a model by being read, every character of it. A rendered
   * diagram is four thousand characters and a PDF is three hundred thousand,
   * all of it read on the way to a key a dozen characters long naming the very
   * same bytes on the server — so each of these three has a tool of its own
   * that answers the key and leaves the bytes where they are.
   *
   * The function is untouched, because a workflow node has no session to read
   * a key from and the bytes in its answer are all it will ever get.
   */
  const store = globalThis.orknux.session.store;
  const render = globalThis.orknux.render;
  const held = new Map();
  let inSession = true;
  globalThis.orknux.session.store = {
    put: (key, value) => {
      if (!inSession) return { error: 'there is no session store here' };
      held.set(key, value);
      return { ok: true };
    },
    get: (key) => (held.has(key) ? held.get(key) : null),
  };
  /* The rasteriser is the server's; out here it is whatever this says it is. */
  globalThis.orknux.render = { pngFromSvg: () => ({ base64: 'UE5H'.repeat(500), bytes: 1500 }) };

  try {
    const cases = [
      { plugin: 'mermaid', call: 'render', args: ['graph TD\n  A-->B', '', 'svg', 0], payload: 'svg' },
      { plugin: 'nomnoml', call: 'render', args: ['[a] -> [b]', '', '', 'svg', 0], payload: 'svg' },
      /*
       * Not compared across two runs: jsPDF stamps a creation date into the
       * file, so the same html twice is not the same bytes and not the same
       * key. That is a fact about PDFs rather than a fault here.
       */
      { plugin: 'pdf', call: 'fromHtml', args: ['<h1>Q3</h1>', ''], payload: 'base64', stamped: true },
    ];

    for (const { plugin, call, args, payload, stamped } of cases) {
      const url = new URL(`../../plugins/${plugin}/${plugin}.js`, import.meta.url);
      const { default: Plugin } = await import(url.href);
      const made = new Plugin();
      const declared = made.functions().find((one) => one.name === call);
      const tool = made.tools().find((one) => one.name === call && one.run !== undefined);

      assert.ok(tool, `${plugin}: ${call} is a tool of its own, not a proxy`);
      assert.deepEqual(tool.params, declared.params, `${plugin}: same arguments either way`);
      assert.equal(tool.returnType, declared.returnType, `${plugin}: same shape either way`);

      inSession = true;
      held.clear();
      const answered = declared.run(...args);
      const asked = tool.run(...args);

      assert.ok(answered[payload].length > 0, `${plugin}: the function answers the bytes`);
      assert.equal(asked[payload], '', `${plugin}: the tool does not`);
      assert.ok(asked.key.startsWith(`${plugin}.`), `${plugin}: and names them instead`);
      assert.ok(held.get(asked.key).length > 0, `${plugin}: and the store holds what it names`);
      if (stamped !== true) {
        assert.equal(
          held.get(asked.key).length,
          answered[payload].length,
          `${plugin}: what the key names is the whole of it`,
        );
      }
      /* Everything that is not the payload survives — the counts, the links. */
      assert.equal(asked.bytes, answered.bytes, `${plugin}: the size is still answered`);

      /*
       * And where there is nowhere to keep it, the bytes come back: a key that
       * names nothing plus no bytes would be an answer to nothing at all.
       */
      inSession = false;
      held.clear();
      const outside = tool.run(...args);
      assert.equal(outside.key, '', `${plugin}: no session, no key`);
      assert.ok(outside[payload].length > 0, `${plugin}: so the bytes are the answer`);
    }
  } finally {
    globalThis.orknux.session.store = store;
    globalThis.orknux.render = render;
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

  /* None: `orknux.encoding` turns the credential into base64, and is ungranted. */
  assert.deepEqual(inspected.permissions, []);
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

  /* None: `orknux.encoding` turns the credential into base64, and is ungranted. */
  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, ['NETWORK_REQUEST']);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['search', 'openIssue', 'comment', 'transition', 'createIssue'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['search', 'openIssue', 'comment', 'transition', 'createIssue'],
  );

  /*
   * The first shipped plugin to export a shape, which is what objects() was
   * added for: `openIssue` answers `Issue` rather than a bare map, and the
   * tool fronting it inherits that return because a proxy carries the
   * function's own.
   */
  assert.deepEqual(
    inspected.objects.map((shape) => shape.name),
    ['Search', 'Comment', 'Moved', 'Raised', 'Issue'],
  );
  const issue = inspected.objects.find((shape) => shape.name === 'Issue');
  assert.equal(issue.properties.length, 13);
  /* `of` is what stops a shape being flat, and labels is the one that has it. */
  const labels = issue.properties.find((property) => property.name === 'labels');
  assert.equal(labels.kind, 'array');
  assert.equal(labels.of, 'string');
  /* Every field says what belongs in it; a name alone tells a model nothing. */
  for (const property of issue.properties) {
    assert.ok(
      typeof property.description === 'string' && property.description.length > 0,
      `Issue.${property.name} has no description`,
    );
  }

  assert.deepEqual(
    inspected.functions.map((one) => one.returnType),
    ['Search', 'Issue', 'Comment', 'Moved', 'Raised'],
  );
  /* A proxy carries its function's own return, so the tools agree by construction. */
  assert.deepEqual(
    inspected.tools.map((one) => one.returnType),
    ['Search', 'Issue', 'Comment', 'Moved', 'Raised'],
  );
  /* `Search` holds the same shape `openIssue` answers, rather than a second one. */
  const search = inspected.objects.find((shape) => shape.name === 'Search');
  const issues = search.properties.find((property) => property.name === 'issues');
  assert.equal(issues.kind, 'array');
  assert.equal(issues.of, 'Issue');
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
  /* None: `orknux.encoding` turns the credential into base64, and is ungranted. */
  assert.deepEqual(inspected.permissions, []);
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
  /*
   * The layout engine is bundled in, so nothing is ever fetched — and the one
   * capability is for the one thing this sandbox cannot do for itself: turn
   * the markup into a picture. It reaches nothing; markup goes out and bytes
   * computed from it come back.
   */
  assert.deepEqual(inspected.capabilities, ['RENDER_PNG']);
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
  const drawn = one('render').run(
    'graph TD\n  A[start] --> B{ok?}\n  B -->|yes| C[done]',
    '',
    'svg',
    0,
  );
  assert.ok(drawn.svg.includes('<svg'), 'renders svg');
  assert.ok(drawn.svg.includes('start'), 'the nodes are in the drawing');
  assert.ok(!drawn.svg.includes('@import'), 'no outward reference survives');
  assert.equal(drawn.bytes, drawn.svg.length);

  const themed = one('render').run('sequenceDiagram\n  A->>B: hi', 'nord', 'svg', 0);
  assert.ok(themed.svg.includes('#2e3440'), 'the theme colors the drawing');

  assert.throws(
    () => one('render').run('graph TD\n  A-->B', 'nope', 'svg', 0),
    /no theme called nope/,
  );
  assert.throws(
    () => one('render').run('pie\n  "a" : 1', '', 'svg', 0),
    /could not render the diagram/,
  );
  assert.throws(() => one('render').run('   ', '', 'svg', 0), /no diagram source/);

  /*
   * A picture is what `render` answers when nothing says otherwise, because a
   * picture is what a person can see — and out here there is no renderer to
   * draw one, so the fallback's own sentence is what comes back rather than a
   * drawing that silently is not one.
   */
  assert.throws(
    () => one('render').run('graph TD\n  A-->B', ''),
    /could not draw the diagram: there is no renderer here/,
  );

  /* Given a renderer, the picture is the answer and the markup is not. */
  const renderer = globalThis.orknux.render;
  let drawnFrom = null;
  globalThis.orknux.render = {
    pngFromSvg: (svg) => {
      drawnFrom = svg;
      return { base64: 'UE5H', bytes: 3 };
    },
  };
  try {
    const picture = one('render').run('graph TD\n  A-->B', '', 'png', 0);
    assert.equal(picture.png, 'UE5H', 'the picture comes back as base64');
    assert.equal(picture.svg, '', 'and the markup does not come with it');
    assert.ok(drawnFrom.includes('<svg'), 'what was drawn is the markup it just rendered');
  } finally {
    globalThis.orknux.render = renderer;
  }

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
  /*
   * Writer, layout, fonts and the diagram renderer are all bundled in, so
   * making a document asks the server for nothing. Looking at one is the
   * opposite - rasterising needs a rasteriser - which is the single capability
   * here, and the reason this plugin stopped asking for none at all.
   */
  assert.deepEqual(inspected.capabilities, ['RENDER_PDF']);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['preview', 'fromHtml'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['fromHtml', 'preview'],
  );
  /* Neither tool is its function: one strips the document, one takes a key. */
  for (const declared of inspected.tools) {
    assert.equal(declared.proxyOf, null, `${declared.name} is its own tool`);
  }
});

test('pdf preview draws a page: bytes on the function, a key on the tool', async () => {
  const url = new URL(`../../plugins/pdf/pdf.js`, import.meta.url);
  const { default: Pdf } = await import(url.href);
  const made = new Pdf();
  const fromHtml = made.functions().find((one) => one.name === 'fromHtml').run;
  const declared = made.functions().find((one) => one.name === 'preview').run;
  const tool = made.tools().find((one) => one.name === 'preview' && one.run !== undefined);

  const held = new Map();
  const store = globalThis.orknux.session.store;
  const render = globalThis.orknux.render;
  let handed = null;

  globalThis.orknux.session.store = {
    put: (key, value) => {
      held.set(key, value);
      return { ok: true };
    },
    get: (key) => (held.has(key) ? held.get(key) : null),
  };
  /*
   * The rasteriser is the server's. Here it records what it was handed and
   * refuses a page past the end the way the contract says it does - by name,
   * rather than by rounding into the first.
   */
  globalThis.orknux.render = {
    pngFromPdf: (pdf, page, width) => {
      handed = { chars: pdf.length, page: page, width: width };
      if (page > 3) return { error: `page ${page} of 3` };
      return { base64: 'iVBOR', bytes: 5, width: width ?? 595, height: 842, pages: 3 };
    },
  };

  try {
    const doc = fromHtml('<h1>Report</h1><p>Some prose.</p>', '');

    /* The tool takes the key the document came back with, and nothing else. */
    const seen = tool.run(doc.key, 1, 800);
    assert.equal(seen.png, 'iVBOR', 'the picture comes back in full - looking at it is the point');
    assert.equal(seen.pages, 3, "and the document's page count, not this page's number");
    assert.equal(seen.width, 800);
    assert.equal(seen.height, 842);
    assert.equal(held.get(seen.key), 'iVBOR', 'the picture is kept under its own key');
    assert.equal(handed.chars, doc.base64.length, 'the whole document reached the renderer');

    /* The function takes the bytes the tool has nowhere to put. */
    assert.deepEqual(
      tool.params.map((one) => one.name),
      ['contentKey', 'page', 'width'],
    );
    assert.equal(
      made.functions().find((one) => one.name === 'preview').params[0].name,
      'base64',
      'the workflow surface still takes a document',
    );
    assert.equal(declared(doc.base64, 1, 800).png, 'iVBOR');

    /* Each refusal names what to do instead, or what was actually there. */
    assert.throws(() => tool.run('', 1, 0), /takes a contentKey, not a document/);
    assert.throws(() => tool.run('pdf.nope', 1, 0), /nothing is kept under pdf.nope/);
    assert.throws(() => tool.run(doc.key, 7, 0), /could not draw the page: page 7 of 3/);
    assert.throws(() => declared('', 1, 0), /no document to draw/);
  } finally {
    globalThis.orknux.session.store = store;
    globalThis.orknux.render = render;
  }
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
  assert.ok(raw.includes('The Report'), 'the title metadata is set');

  /*
   * Nothing here is past ASCII, so nothing is embedded: the two DejaVu faces
   * are 1.4 MB of TTF that jsPDF parses and writes into every file asking for
   * them, and a page of English does not need a letter they have and
   * Helvetica lacks. It is the difference between four kilobytes and two
   * hundred and seventy-seven, and between one millisecond and a hundred —
   * which in a sandbox that interprets was the difference between a PDF and a
   * timeout.
   */
  assert.ok(!raw.includes('DejaVu'), 'an ascii document embeds no font');
  assert.ok(raw.includes('Helvetica'), 'and is set in the one jsPDF already has');
  assert.ok(made.bytes < 20000, `an ascii page should be small, got ${made.bytes}`);

  /*
   * And real diacritics still get the face that has them. Folding ż to z is
   * the thing DejaVu is carried for, so this must both embed and not throw.
   */
  const polish = declared.run('<p>Zażółć gęślą jaźń</p>', '');
  assert.ok(polish.bytes > 0);
  assert.ok(
    Buffer.from(polish.base64, 'base64').toString('latin1').includes('DejaVu'),
    'a document past ascii embeds the face that can set it',
  );

  /* A mermaid block becomes vector drawing in the page, still offline. */
  const diagrammed = declared.run(
    '<h2>Flow</h2><pre class="mermaid">graph TD\n  A[start] --> B{ok?}\n  B -->|yes| C[done]</pre><p>After.</p>',
    '',
  );
  assert.equal(diagrammed.pages, 1);
  assert.ok(diagrammed.bytes > made.bytes, 'the drawing weighs something');
  /*
   * A diagram that will not draw costs the diagram and not the document.
   *
   * This used to throw, and what a caller did with that was call again
   * with the diagram written slightly differently, three or four times,
   * before saying PDFs were unavailable - having already been handed a
   * working document and thrown it away. The page says what happened,
   * where the drawing would have been, and the rest is written.
   */
  const refused = declared.run(
    '<h1>Report</h1><pre class="mermaid">gantt\n  title x</pre><p>The rest of it.</p>',
    '',
  );
  assert.equal(refused.pages, 1, 'the document is still written');
  const inked = Buffer.from(refused.base64, 'base64').toString('latin1');
  assert.ok(inked.includes('diagram not drawn'), 'and says where the drawing would have been');

  /*
   * And the answer says so, which is the part that matters: a note in the page
   * is for whoever reads the PDF and the log is for whoever runs the server,
   * and neither is read by the thing that called this. An answer that looks
   * like success while a diagram is missing out of the middle of the document
   * is worse than the error this replaced.
   */
  assert.equal(refused.problems.length, 1, 'the answer reports it');
  assert.match(refused.problems[0], /a diagram was not drawn/);

  /* Nothing wrong, nothing reported. */
  assert.deepEqual(declared.run('<p>All fine.</p>', '').problems, []);

  /* A letter the bundled face cannot set is the same kind of thing. */
  const cyrillic = declared.run('<p>Привет</p>', '');
  assert.equal(cyrillic.problems.length, 1, 'unsettable characters are reported too');
  assert.match(cyrillic.problems[0], /cannot be set and are blank/);
  /* Words are placed one at a time, so the prose is checked a word at a time. */
  for (const word of ['Report', 'rest']) {
    assert.ok(inked.includes(word), `${word} survived the diagram failing`);
  }

  /*
   * Every kind the plugin says it draws, drawn. Only the flowchart was
   * covered here, and `erDiagram` had been throwing the whole time: its
   * SVG writes dy="0.35em" where the others write a bare number, Number()
   * made that NaN, and jsPDF answers NaN by refusing the call and taking
   * the document down with it.
   */
  for (const [kind, source] of Object.entries({
    flowchart: 'graph TD\n  A[start] --> B{ok?}\n  B -->|yes| C[done]',
    sequence: 'sequenceDiagram\n  A->>B: hi\n  B-->>A: hello',
    state: 'stateDiagram-v2\n  [*] --> queued\n  queued --> running\n  running --> [*]',
    class: 'classDiagram\n  Plugin <|-- Slack\n  Plugin : +id()',
    er: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains',
  })) {
    const drawn = declared.run(`<h2>${kind}</h2><pre class="mermaid">${source}</pre>`, '');
    assert.ok(drawn.bytes > 0, `${kind} draws into a page`);
    assert.equal(
      Buffer.from(drawn.base64, 'base64').subarray(0, 5).toString('latin1'),
      '%PDF-',
      `${kind} produces a readable file`,
    );
  }

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

  /*
   * The one parameter here that is a closed choice says so, rather than
   * checking the string itself and throwing a sentence listing the two. The
   * runtime refusal stays until a settings page draws the picker — a text box
   * can still hold a typo, and falling through to the wrong backend silently
   * would be worse than being told.
   */
  assert.deepEqual(inspected.parameters[0].options, ['tavily', 'brave']);
  /* And nothing else names a set: a secret may not, and a key is not a choice. */
  assert.equal(inspected.parameters[1].options, null);
  assert.equal(inspected.parameters[2].options, null);

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

test('the github plugin verifies a real signature, and refuses a wrong one', async () => {
  /*
   * Testable at all only because crypto is not a granted capability: the
   * tooling hosts a real implementation outside the sandbox, so the one thing
   * actually worth checking about the webhook half — that a delivery GitHub
   * signed is accepted and one it did not is not — can be checked here rather
   * than only on a server.
   */
  const url = new URL(`../../plugins/github/github.js`, import.meta.url);
  const { default: Github } = await import(url.href);

  const secret = 'it is a secret to everybody';
  const configured = () => {
    const plugin = Object.create(Github.prototype);
    Object.defineProperty(plugin, 'settings', { value: Object.freeze({ webhookSecret: secret }) });
    return plugin.functions().find((one) => one.name === 'verify');
  };

  /* Signed the way GitHub signs it: HMAC-SHA256 over the exact bytes, as hex. */
  const body = JSON.stringify({ action: 'opened', number: 7 });
  const signed = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  assert.equal(configured().run({ 'x-hub-signature-256': `sha256=${signed}` }, body), true);

  /* A body that changed by one character is a different signature. */
  assert.equal(
    configured().run({ 'x-hub-signature-256': `sha256=${signed}` }, body.replace('7', '8')),
    false,
  );
  /* And so is one signed with somebody else's secret. */
  const forged = createHmac('sha256', 'not the secret').update(body, 'utf8').digest('hex');
  assert.equal(configured().run({ 'x-hub-signature-256': `sha256=${forged}` }, body), false);

  /* Unsigned, wrongly-signed and malformed deliveries are all refused. */
  assert.equal(configured().run({}, body), false);
  /* The SHA-1 header GitHub still sends for compatibility is not accepted. */
  assert.equal(configured().run({ 'x-hub-signature': `sha1=${signed}` }, body), false);
  assert.equal(configured().run({ 'x-hub-signature-256': 'sha256=nothex' }, body), false);
});

test('the teams plugin verifies a real signature, and refuses a wrong one', async () => {
  const url = new URL(`../../plugins/teams/teams.js`, import.meta.url);
  const { default: Teams } = await import(url.href);

  /* Teams hands out the secret as base64, and signs with those bytes. */
  const secret = Buffer.from('the security token Teams showed').toString('base64');
  const configured = () => {
    const plugin = Object.create(Teams.prototype);
    Object.defineProperty(plugin, 'settings', { value: Object.freeze({ webhookSecret: secret }) });
    return plugin.functions().find((one) => one.name === 'verify');
  };

  const body = JSON.stringify({ type: 'message', text: 'hello' });
  const signed = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(body, 'utf8')
    .digest('base64');

  assert.equal(configured().run({ authorization: `HMAC ${signed}` }, body), true);
  /* Teams' own spelling is upper case, and the scheme is matched either way. */
  assert.equal(configured().run({ authorization: `hmac ${signed}` }, body), true);

  /* A changed body, a wrong secret, and a missing header are all refused. */
  assert.equal(configured().run({ authorization: `HMAC ${signed}` }, `${body} `), false);
  const forged = createHmac('sha256', Buffer.from('not it')).update(body, 'utf8').digest('base64');
  assert.equal(configured().run({ authorization: `HMAC ${forged}` }, body), false);
  assert.equal(configured().run({}, body), false);
  /* And a header that is not the scheme Teams sends. */
  assert.equal(configured().run({ authorization: `Bearer ${signed}` }, body), false);
});

test('the sentinel convention is gone from the parameters that could carry a default', async () => {
  /*
   * Thirty-six places used to say "0 for the default" or "an empty string to
   * use the configured one", each a workaround for every positional argument
   * having to be supplied. Those sentences lived in tool descriptions a model
   * reads on every call, so the convention cost context repeatedly — and
   * "pass 0 to mean default" is exactly the instruction a model gets wrong.
   */
  const optional = [];
  for (const key of ['confluence', 'date', 'github', 'jira', 'mermaid', 'pdf', 'prometheus', 'slack', 'web']) {
    const inspected = await inspect(shipped(key));
    for (const declared of [...inspected.functions, ...inspected.tools]) {
      for (const param of declared.params) {
        if (param.required === false) {
          optional.push(`${key}.${declared.name}.${param.name}`);
        }
      }
    }
  }
  assert.ok(optional.length >= 20, `only ${optional.length} parameters are optional`);

  /*
   * And every one of them is last, or followed only by others that are. An
   * argument is positional, so "may be left out" means nothing in the middle —
   * validate refuses that, and this is the shipped proof it never happens.
   */
  for (const key of ['confluence', 'date', 'github', 'jira', 'mermaid', 'pdf', 'prometheus', 'slack', 'web']) {
    const inspected = await inspect(shipped(key));
    for (const declared of inspected.functions) {
      let seenOptional = false;
      for (const param of declared.params) {
        if (param.required === false) seenOptional = true;
        else {
          assert.ok(
            !seenOptional,
            `${key}.${declared.name} has a required ${param.name} after an optional one`,
          );
        }
      }
    }
  }
});

test('a default is of the type its parameter declared', async () => {
  /* Refused at load rather than at the call that would have found it. */
  for (const key of ['github', 'slack', 'web', 'date', 'mermaid', 'pdf', 'confluence', 'jira', 'prometheus']) {
    const inspected = await inspect(shipped(key));
    for (const declared of inspected.functions) {
      for (const param of declared.params) {
        if (param.default === undefined) continue;
        const kind = param.type === 'number' ? 'number' : param.type === 'boolean' ? 'boolean' : 'string';
        assert.equal(
          typeof param.default,
          kind,
          `${key}.${declared.name}.${param.name} is a ${param.type} with a ${typeof param.default} default`,
        );
      }
    }
  }
});

test('the nomnoml plugin declares what the server would accept, and renders offline', async () => {
  const inspected = await inspect(shipped('nomnoml'));

  assert.equal(inspected.id, 'nomnoml');
  assert.deepEqual(validate(inspected), []);
  assert.deepEqual(inspected.parameters, []);
  /*
   * No permission at all — it measures text from metrics it carries rather
   * than through a builtin behind one — and exactly one capability, for the
   * one thing this sandbox cannot do: turn the markup into a picture. The
   * layout is still entirely local; nothing is ever fetched.
   */
  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, ['RENDER_PNG']);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['render'],
  );
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['render'],
  );

  const url = new URL(`../../plugins/nomnoml/nomnoml.js`, import.meta.url);
  const { default: Nomnoml } = await import(url.href);
  const functions = new Nomnoml().functions();
  const render = functions.find((declared) => declared.name === 'render').run;

  /* Drawn right here, in a Node with no DOM — the sandbox's own situation. */
  const drawn = render('[<actor>User] -> [<usecase>Load a plugin]', '', '', 'svg', 0);
  assert.ok(drawn.svg.includes('<svg'), 'renders svg');
  assert.ok(drawn.svg.includes('Load a plugin'), 'the nodes are in the drawing');
  assert.equal(drawn.bytes, drawn.svg.length);

  /* And carrying no outward reference, so the drawing is as offline as the drawing was. */
  assert.ok(!drawn.svg.includes('@import'), 'no font import');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(drawn.svg), 'no remote reference');

  /* A theme is directives put in front of the source, so it colours the result. */
  assert.ok(
    render('[a] -> [b]', 'dark', '', 'svg', 0).svg.includes('#1e232b'),
    'the theme colours the drawing',
  );

  /*
   * And the caller's own directives beat the argument, because they come
   * after it — the argument is the convenience, the source is the statement.
   */
  const asked = render('[a] -> [b]', '', 'right', 'svg', 0);
  const said = render('#direction: down\n[a] -> [b]', '', 'right', 'svg', 0);
  assert.notEqual(asked.svg, said.svg, 'a direction in the source overrides the argument');

  assert.throws(() => render('[a] -> [b]', 'solarized', '', 'svg', 0), /no theme called solarized/);
  assert.throws(() => render('[a] -> [b]', '', 'sideways', 'svg', 0), /no direction called sideways/);
  assert.throws(() => render('[a] -> [b]', '', '', 'jpeg', 0), /no format called jpeg/);
  assert.throws(() => render('[a] ->', '', '', 'svg', 0), /could not render the diagram: Parse error/);
  assert.throws(() => render('   ', '', '', 'svg', 0), /no diagram source/);

  /* The editor url escapes the way nomnoml's own does — quotes spelled out. */
  assert.ok(
    render("[<note>it's here]", '', '', 'svg', 0).editor.startsWith('https://www.nomnoml.com/#view/'),
    'the editor url points at the editor',
  );
  assert.ok(
    render("[<note>it's here]", '', '', 'svg', 0).editor.includes('%27'),
    'an apostrophe is escaped',
  );

  /*
   * A picture is the default, and out here there is no renderer to draw one —
   * so the fallback's sentence is what a caller gets, rather than a drawing
   * that silently is not one.
   */
  assert.throws(() => render('[a] -> [b]'), /could not draw the diagram: there is no renderer here/);

  /* Outside a session the fallback store keeps nothing, and the key says so. */
  assert.equal(drawn.key, '', 'no session, no key');

  /* Given one, the key names exactly the bytes that were answered. */
  const held = new Map();
  const store = globalThis.orknux.session.store;
  globalThis.orknux.session.store = {
    put: (key, value) => {
      held.set(key, value);
      return { ok: true };
    },
    get: (key) => (held.has(key) ? held.get(key) : null),
  };
  try {
    const kept = render('[a] -> [b]', '', '', 'svg', 0);
    assert.ok(kept.key.startsWith('nomnoml.'), 'the key is named for its plugin');
    assert.equal(held.get(kept.key), kept.svg, 'what is kept is what was answered');
    /* Content-derived, so the same diagram twice overwrites itself rather than piling up. */
    assert.equal(
      render('[a] -> [b]', '', '', 'svg', 0).key,
      kept.key,
      'the same source lands on the same key',
    );

    /*
     * And with a renderer, the picture is what comes back: png carries the
     * base64, svg is empty, and the key names the bytes rather than the
     * markup — because the png is what a caller goes on to upload.
     */
    const renderer = globalThis.orknux.render;
    let drawnFrom = null;
    let widthAsked;
    globalThis.orknux.render = {
      pngFromSvg: (svg, width) => {
        drawnFrom = svg;
        widthAsked = width;
        return { base64: 'UE5H', bytes: 3 };
      },
    };
    try {
      const picture = render('[a] -> [b]', 'dark', '', 'png', 640);
      assert.equal(picture.png, 'UE5H', 'the picture comes back as base64');
      assert.equal(picture.svg, '', 'and the markup does not come with it');
      assert.equal(picture.bytes, 3, 'the byte count is the picture(s)');
      assert.equal(held.get(picture.key), 'UE5H', 'the key names the picture, not the markup');
      assert.ok(drawnFrom.includes('#1e232b'), 'the themed markup is what was drawn');
      assert.equal(widthAsked, 640, 'the width is passed through');

      /* A width of zero is no width at all, which is the size the svg declares. */
      render('[a] -> [b]', '', '', 'png', 0);
      assert.equal(widthAsked, undefined, 'zero asks for no particular width');
    } finally {
      globalThis.orknux.render = renderer;
    }
  } finally {
    globalThis.orknux.session.store = store;
  }
});
