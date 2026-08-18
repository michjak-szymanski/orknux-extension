import assert from 'node:assert/strict';
import { test } from 'node:test';

import { API_VERSION, definePlugin, fn, OrknuxFunction, OrknuxPlugin } from '../dist/index.js';

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
