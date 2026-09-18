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
 * accepts what the server accepts" true of the three plugins people actually
 * load, not only of fixtures written to pass.
 */

const shipped = (name) =>
  fileURLToPath(new URL(`../../plugins/${name}/${name}.js`, import.meta.url));

test('the github plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('github'));

  assert.equal(inspected.id, 'github');
  assert.equal(inspected.apiVersion, 1);
  assert.deepEqual(validate(inspected), []);

  /* The webhook secret is a secret: a typed-in value is refused by the server. */
  assert.deepEqual(inspected.parameters, [
    {
      name: 'webhookSecret',
      description: "The secret set on the repository's webhook, which every delivery is signed with.",
      type: 'string',
      required: true,
      secret: true,
      connectionType: null,
    },
  ]);
  assert.deepEqual(inspected.permissions, ['TEXT_ENCODING']);
  assert.deepEqual(inspected.capabilities, []);
  assert.deepEqual(inspected.tools, []);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['verify', 'describe'],
  );
});

test('the slack plugin declares what the server would accept', async () => {
  const inspected = await inspect(shipped('slack'));

  assert.equal(inspected.id, 'slack');
  assert.deepEqual(validate(inspected), []);

  /* A connection parameter: answered by pointing at a row, never typed in. */
  assert.equal(inspected.parameters.length, 1);
  assert.equal(inspected.parameters[0].name, 'slack');
  assert.equal(inspected.parameters[0].type, 'connection');
  assert.equal(inspected.parameters[0].connectionType, 'SLACK');
  assert.equal(inspected.parameters[0].required, false);

  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, [
    'SLACK_READ_THREAD',
    'SLACK_READ_MESSAGE',
    'SLACK_READ_USER',
    'SLACK_MENTION',
  ]);
  assert.deepEqual(
    inspected.functions.map((declared) => declared.name),
    ['isFirstReply', 'readMessage', 'whoIs', 'mention'],
  );

  /*
   * The agents' surface: the three lookups, each an OrknuxFunctionTool the
   * inspection resolved — so every tool carries its function's own params,
   * return type and description, and `isFirstReply` stays a workflow's gate.
   */
  assert.deepEqual(
    inspected.tools.map((declared) => declared.name),
    ['readMessage', 'whoIs', 'mention'],
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
