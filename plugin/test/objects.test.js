import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_OBJECTS,
  OrknuxObject,
  OrknuxPlugin,
  validate,
  validateObjects,
} from '../dist/index.js';

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

/*
 * What a declared shape is *for*: a function may return one.
 *
 * This is the limitation objects() exists to answer. A plugin's functions
 * belong to every workspace at once, so they may never name a workspace's own
 * definitions — but a shape the plugin declares travels with it, and naming
 * that is the whole point. Inside the plugin it is spelled as it was declared;
 * the loader rewrites the reference to `jira_Issue` when it stores it.
 */

const shaped = (returnType, objects) => ({
  id: 'jira',
  apiVersion: 1,
  objects,
  functions: [{ name: 'openIssue', params: [], returnType }],
});

test('a function may return a shape the plugin declares', () => {
  const issue = { name: 'Issue', properties: [{ name: 'key', kind: 'string' }] };
  assert.deepEqual(validate(shaped('Issue', [issue])), []);
});

test('a tool may return one too, because it is the same answer to a model', () => {
  const issue = { name: 'Issue', properties: [{ name: 'key', kind: 'string' }] };
  const problems = validate({
    ...shaped('map', [issue]),
    tools: [{ name: 'openIssue', params: [], returnType: 'Issue' }],
  });
  assert.deepEqual(problems, []);
});

test('a return naming a shape that is not declared is still refused', () => {
  const problems = validate(shaped('Issue', [{ name: 'User', properties: [] }]));
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /openIssue returns "Issue", which is not a type this server has/);
});

test('a shape is matched exactly, because it is an identifier', () => {
  /* `issue` and `Issue` are two names, and only one of them was declared. */
  const issue = { name: 'Issue', properties: [{ name: 'key', kind: 'string' }] };
  assert.deepEqual(validate(shaped('Issue', [issue])), []);
  assert.equal(validate(shaped('issue', [issue])).length, 1);
});

test('object is still refused as a return, and says why', () => {
  const issue = { name: 'Issue', properties: [{ name: 'key', kind: 'string' }] };
  const problems = validate(shaped('object', [issue]));
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /names one of a workspace's definitions/);
});

test('a parameter still may not name a shape, which is stricter than a return', () => {
  /*
   * Only a return is allowed to. A parameter naming a shape is refused here
   * whatever the server does with it — stricter is the safe direction for a
   * mirror to be wrong in, because it can only refuse something that would
   * have been accepted, never accept something that would have been refused.
   */
  const issue = { name: 'Issue', properties: [{ name: 'key', kind: 'string' }] };
  const problems = validate({
    id: 'jira',
    apiVersion: 1,
    objects: [issue],
    functions: [{ name: 'openIssue', params: [{ name: 'issue', type: 'Issue' }], returnType: 'map' }],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /is a "Issue", which is not a type this server has/);
});
