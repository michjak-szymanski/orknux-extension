import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_OBJECTS, OrknuxObject, OrknuxPlugin, validateObjects } from '../dist/index.js';

/**
 * The objects contract: a plugin exports its own shapes, so its functions have
 * something to pass around that is not a bare map.
 *
 * Two checks live in two places, and the split is the design. Everything about
 * one field - a kind that is not a kind, an `of` on something that cannot
 * point at anything - fails at the line that declared it, because that is
 * where somebody can see it. Whether an `of` names an object the plugin
 * actually declares needs the whole set, so it is the loader's, and this
 * package's `validateObjects` is the local copy of that answer.
 */

test('a plugin with no objects exports none, which is the default', () => {
  class Bare extends OrknuxPlugin {
    id() {
      return 'bare';
    }
    apiVersion() {
      return 1;
    }
  }
  assert.deepEqual(new Bare().objects(), []);
});

test('an object needs a name and an array of properties', () => {
  assert.throws(() => new OrknuxObject({ properties: [] }), /needs a name/);
  assert.throws(() => new OrknuxObject({ name: 'Issue', properties: 'many' }), /needs properties/);
});

test('a kind that is not a kind fails where it was written', () => {
  assert.throws(
    () => new OrknuxObject({ name: 'Issue', properties: [{ name: 'key', kind: 'text' }] }),
    /which is not one of/,
  );
});

test('a thing that points needs an of, and a thing that does not may not have one', () => {
  assert.throws(
    () => new OrknuxObject({ name: 'Issue', properties: [{ name: 'reporter', kind: 'object' }] }),
    /needs an `of`/,
  );
  assert.throws(
    () => new OrknuxObject({ name: 'Issue', properties: [{ name: 'labels', kind: 'array' }] }),
    /needs an `of`/,
  );
  assert.throws(
    () => new OrknuxObject({ name: 'Issue', properties: [{ name: 'key', kind: 'string', of: 'User' }] }),
    /names an `of` but is a string/,
  );
});

test('a whole shape holds together, arrays of scalars and of objects alike', () => {
  const declared = [
    {
      name: 'User',
      properties: [{ name: 'email', kind: 'string', description: 'Who they are.' }],
    },
    {
      name: 'Issue',
      description: 'One tracker issue.',
      properties: [
        { name: 'key', kind: 'string' },
        { name: 'labels', kind: 'array', of: 'string' },
        { name: 'reporter', kind: 'object', of: 'User' },
        { name: 'watchers', kind: 'array', of: 'User' },
      ],
    },
  ];
  // Each one builds, and the set holds together.
  declared.forEach((one) => new OrknuxObject(one));
  assert.deepEqual(validateObjects(declared), []);
});

test('an of that points at nothing is the loader’s refusal, and this is the local copy of it', () => {
  const problems = validateObjects([
    { name: 'Issue', properties: [{ name: 'reporter', kind: 'object', of: 'User' }] },
  ]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].part, 'objects');
  assert.match(problems[0].message, /points at "User", which objects\(\) does not declare/);
});

test('an array of arrays has no shape on this server', () => {
  const problems = validateObjects([
    { name: 'Grid', properties: [{ name: 'rows', kind: 'array', of: 'array' }] },
  ]);
  assert.match(problems[0].message, /array of arrays/);
});

test('the same object twice is refused, and so is a name that is not usable', () => {
  const twice = validateObjects([
    { name: 'Issue', properties: [] },
    { name: 'Issue', properties: [] },
  ]);
  assert.match(twice[0].message, /more than once/);

  const bad = validateObjects([{ name: '2Issue', properties: [] }]);
  assert.match(bad[0].message, /not a usable object name/);
});

test('the bound is the server’s', () => {
  const many = Array.from({ length: MAX_OBJECTS + 1 }, (_unused, at) => ({
    name: `Shape${at}`,
    properties: [],
  }));
  assert.match(validateObjects(many)[0].message, new RegExp(`more than ${MAX_OBJECTS} objects`));
});
