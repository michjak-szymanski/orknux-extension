import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  API_VERSION,
  definePlugin,
  fn,
  orknux,
  OrknuxFunction,
  OrknuxParameter,
  OrknuxPlugin,
  param,
} from '../dist/index.js';

/**
 * What `definePlugin` returns has to be a class extending the sandbox's own
 * `OrknuxPlugin`, because the server checks the prototype and refuses anything
 * else however right its keys are. That check is the one worth writing down.
 */

const isTeammate = () =>
  fn({
    name: 'isTeammate',
    params: [{ name: 'email', type: 'string' }],
    returnType: 'boolean',
    run: (email) => email.endsWith('@example.com'),
  });

test('a defined plugin is a class extending OrknuxPlugin', () => {
  const Defined = definePlugin({ id: 'teammates', functions: [isTeammate()] });

  assert.equal(typeof Defined, 'function');
  assert.ok(Defined.prototype instanceof OrknuxPlugin);

  const plugin = new Defined();
  assert.equal(plugin.id(), 'teammates');
  assert.equal(plugin.apiVersion(), API_VERSION);
  assert.equal(plugin.functions().length, 1);
});

test('what it answers with cannot be edited from under it', () => {
  const Defined = definePlugin({ id: 'teammates', functions: [isTeammate()] });
  const plugin = new Defined();

  plugin.functions().push(isTeammate());
  assert.equal(plugin.functions().length, 1);
});

test('an id that could not prefix a function name is refused where it is written', () => {
  assert.throws(() => definePlugin({ id: 'team mates' }), /cannot be a plugin id/);
});

test('declaring one name twice is refused where it is written', () => {
  assert.throws(
    () => definePlugin({ id: 'teammates', functions: [isTeammate(), isTeammate()] }),
    /declares isTeammate more than once/,
  );
});

test('a function with nothing to run is refused as it is constructed', () => {
  assert.throws(
    () => new OrknuxFunction({ name: 'isTeammate', returnType: 'boolean' }),
    /needs a run function/,
  );
});

test('a function with no name is refused as it is constructed', () => {
  assert.throws(() => new OrknuxFunction({ returnType: 'boolean', run: () => true }), /needs a name/);
});

test('an absent description is null and absent parameters are none', () => {
  const declared = new OrknuxFunction({ name: 'now', returnType: 'number', run: () => 1 });

  assert.equal(declared.description, null);
  assert.deepEqual(declared.params, []);
});

test('what a defined plugin was told to declare is what it answers', () => {
  const Defined = definePlugin({
    id: 'slackish',
    parameters: [param({ name: 'slack', type: 'connection', connectionType: 'SLACK' })],
    permissions: ['TEXT_ENCODING'],
    capabilities: ['SLACK_READ_THREAD'],
  });
  const plugin = new Defined();

  assert.deepEqual(plugin.permissions(), ['TEXT_ENCODING']);
  assert.deepEqual(plugin.capabilities(), ['SLACK_READ_THREAD']);
  assert.equal(plugin.parameters().length, 1);
  assert.equal(plugin.parameters()[0].name, 'slack');
});

test('declaring nothing is answering none, as the base class does', () => {
  const Defined = definePlugin({ id: 'quiet' });
  const plugin = new Defined();

  assert.deepEqual(plugin.parameters(), []);
  assert.deepEqual(plugin.permissions(), []);
  assert.deepEqual(plugin.capabilities(), []);
});

test('declaring one parameter twice is refused where it is written', () => {
  const token = () => param({ name: 'token', type: 'string' });
  assert.throws(
    () => definePlugin({ id: 'twice', parameters: [token(), token()] }),
    /declares the parameter token more than once/,
  );
});

test('a parameter fills its defaults in the way the sandbox does', () => {
  const declared = new OrknuxParameter({ name: 'teamDomain', type: 'string' });

  assert.equal(declared.description, null);
  assert.equal(declared.required, true);
  assert.equal(declared.secret, false);
  assert.equal(declared.connectionType, null);
});

test('a connection that does not say which kind is refused as it is constructed', () => {
  assert.throws(
    () => new OrknuxParameter({ name: 'slack', type: 'connection' }),
    /slack is a connection, so it needs a connectionType/,
  );
});

test('a connection kind on something that is not a connection is refused too', () => {
  assert.throws(
    () => new OrknuxParameter({ name: 'token', type: 'string', connectionType: 'SLACK' }),
    /token names a connectionType but is not a connection/,
  );
});

test('outside the sandbox the settings are there, empty, and frozen', () => {
  const Defined = definePlugin({ id: 'quiet' });
  const plugin = new Defined();

  assert.deepEqual(plugin.settings, {});
  assert.ok(Object.isFrozen(plugin.settings));
});

test('an ungranted helper answers a sentence as data, never a throw', () => {
  const read = orknux.slack.thread({ id: 1, type: 'SLACK' }, 'C123', '1.2');
  assert.equal(read.error, 'this plugin was not granted SLACK_READ_THREAD');

  const answered = orknux.http.get('https://example.com');
  assert.equal(answered.error, 'this plugin was not granted NETWORK_REQUEST');
});
