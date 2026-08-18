import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qualifiedName, validate, validateFunctions } from '../dist/index.js';

/**
 * The rules are the server's, so these tests are written the way the server
 * words them: a declaration that would be accepted produces nothing, and one that
 * would not produces the sentence somebody has to act on.
 */

const teammates = {
  id: 'teammates',
  apiVersion: 1,
  functions: [
    {
      name: 'isTeammate',
      description: 'Whether an email address belongs to a member of this workspace.',
      params: [{ name: 'email', type: 'string' }],
      returnType: 'boolean',
    },
  ],
};

test('a plugin the server would take has nothing wrong with it', () => {
  assert.deepEqual(validate(teammates), []);
});

test('a function is called by the plugin id and its own name', () => {
  assert.equal(qualifiedName('teammates', 'isTeammate'), 'teammates_isTeammate');
});

test('an id that could not prefix a function name is refused', () => {
  const problems = validate({ ...teammates, id: 'team mates' });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].part, 'id');
  assert.match(problems[0].message, /cannot be a plugin id/);
});

test('an API version this package does not know is refused', () => {
  const problems = validate({ ...teammates, apiVersion: 4 });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /plugin API version 4, which this server does not know/);
});

test('a name that is not an identifier is refused', () => {
  const problems = validateFunctions([{ name: 'is teammate', params: [], returnType: 'boolean' }]);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    ['"is teammate" is not a usable function name'],
  );
});

test('the same name twice is refused', () => {
  const one = { name: 'same', params: [], returnType: 'boolean' };
  const problems = validateFunctions([one, { ...one }]);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    ['it declares same more than once'],
  );
});

test('a type the server does not have is refused, and named', () => {
  const problems = validateFunctions([{ name: 'greet', params: [], returnType: 'text' }]);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    ['greet returns "text", which is not a type this server has'],
  );
});

test('returning none is refused, because a function has to answer', () => {
  const problems = validateFunctions([{ name: 'post', params: [], returnType: 'none' }]);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    ['post must return something, not none'],
  );
});

test('an object names one workspace, so a plugin may not use it', () => {
  const problems = validateFunctions([
    { name: 'ticket', params: [{ name: 'issue', type: 'object' }], returnType: 'object' },
  ]);
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.match(problem.message, /use map instead/i);
});

test('a parameter declared twice is refused', () => {
  const problems = validateFunctions([
    {
      name: 'compare',
      params: [
        { name: 'left', type: 'string' },
        { name: 'left', type: 'string' },
      ],
      returnType: 'boolean',
    },
  ]);
  assert.deepEqual(
    problems.map((problem) => problem.message),
    ['compare declares left twice'],
  );
});

test('every problem is reported, not only the first', () => {
  const problems = validateFunctions([
    { name: 'one two', params: [{ name: 'a b', type: 'nope' }], returnType: 'nope' },
  ]);
  assert.equal(problems.length, 4);
});
