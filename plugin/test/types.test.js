import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_TYPES,
  OrknuxParameter,
  OrknuxPlugin,
  OrknuxType,
  definePlugin,
  validate,
  validateTypes,
} from '../dist/index.js';

/*
 * A value type a plugin defines: a name over string, number or boolean, what
 * it needs to be told, and up to two functions the server calls on the
 * plugin's behalf. What is pinned here is the local copy of the loader's
 * rules, wording included - a plugin that passes here is one the upload takes.
 */

test('a plugin with no types defines none, which is the default', () => {
  class Bare extends OrknuxPlugin {
    id() {
      return 'bare';
    }
    apiVersion() {
      return 1;
    }
  }
  assert.deepEqual(new Bare().types(), []);
});

test('a type needs a name and one of the three bases', () => {
  assert.throws(() => new OrknuxType({ base: 'string' }), /needs a name/);
  assert.throws(() => new OrknuxType({ name: 'Thing', base: 'object' }), /not one of string, number, boolean/);
  assert.throws(() => new OrknuxType({ name: 'Thing' }), /not one of string, number, boolean/);
});

test('its parameters go through OrknuxParameter, and none may be a secret', () => {
  const told = new OrknuxType({
    name: 'SlackUser',
    base: 'string',
    parameters: [{ name: 'slack', type: 'connection', connectionType: 'SLACK' }],
  });
  assert.equal(told.parameters.length, 1);
  assert.equal(told.parameters[0].connectionType, 'SLACK');

  /* An instance is taken as it is. */
  const given = new OrknuxParameter({ name: 'shade', type: 'string', required: false });
  assert.equal(new OrknuxType({ name: 'Colour', base: 'string', parameters: [given] }).parameters[0], given);

  assert.throws(
    () =>
      new OrknuxType({
        name: 'Keyed',
        base: 'string',
        parameters: [{ name: 'apiKey', type: 'string', secret: true }],
      }),
    /cannot be told one/,
  );
  /* And a parameter that would not pass on its own does not pass here. */
  assert.throws(
    () => new OrknuxType({ name: 'Keyed', base: 'string', parameters: [{ name: 'c', type: 'connection' }] }),
    /needs a connectionType/,
  );
});

test('suggest and validate are optional, and have to be functions when given', () => {
  const bare = new OrknuxType({ name: 'Weight', base: 'number' });
  assert.equal(bare.suggest, undefined);
  assert.equal(bare.validate, undefined);

  const both = new OrknuxType({
    name: 'Colour',
    base: 'string',
    suggest: (typed) => [{ value: typed }],
    validate: (value) => ({ ok: value === 'red' }),
  });
  assert.deepEqual(both.suggest('re'), [{ value: 're' }]);
  assert.deepEqual(both.validate('red'), { ok: true });

  assert.throws(() => new OrknuxType({ name: 'Colour', base: 'string', suggest: 'later' }), /suggest that is not a function/);
  assert.throws(() => new OrknuxType({ name: 'Colour', base: 'string', validate: true }), /validate that is not a function/);
});

test('validateTypes is the local copy of the loader’s refusals', () => {
  assert.deepEqual(
    validateTypes([
      { name: 'Colour', base: 'string', parameters: [{ name: 'shade', type: 'string', required: false }] },
    ]),
    [],
  );

  const bad = validateTypes([{ name: '2Colour', base: 'string' }]);
  assert.equal(bad[0].part, 'types');
  assert.match(bad[0].message, /not a usable type name/);

  const twice = validateTypes([
    { name: 'Colour', base: 'string' },
    { name: 'Colour', base: 'string' },
  ]);
  assert.match(twice[0].message, /more than once/);

  const base = validateTypes([{ name: 'Thing', base: 'map' }]);
  assert.match(base[0].message, /one of string, number, boolean with a name on it/);

  const secret = validateTypes([
    { name: 'Keyed', base: 'string', parameters: [{ name: 'apiKey', type: 'string', required: true, secret: true }] },
  ]);
  assert.match(secret[0].message, /cannot be told one/);

  const many = validateTypes(Array.from({ length: MAX_TYPES + 1 }, (_, at) => ({ name: `T${at}`, base: 'string' })));
  assert.match(many[0].message, /more than/);
});

test('validate() takes the types along with everything else', () => {
  const problems = validate({
    id: 'palette',
    apiVersion: 1,
    functions: [],
    types: [{ name: 'Thing', base: 'map' }],
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].part, 'types');
});

test('definePlugin carries the types through', () => {
  const Colour = new OrknuxType({ name: 'Colour', base: 'string' });
  const Palette = definePlugin({ id: 'palette', types: [Colour] });
  assert.deepEqual(new Palette().types(), [Colour]);
});
