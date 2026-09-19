import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_SKILLS,
  MAX_SKILL_CHARS,
  OrknuxPlugin,
  OrknuxSkill,
  validateSkills,
} from '../dist/index.js';

/**
 * The skills contract: a plugin brings instruction sets, and they are markdown
 * an agent reads rather than code it runs.
 *
 * What is worth pinning is the kindness in the middle of it. A skill has to
 * carry a frontmatter block, but a plugin that wrote plain markdown and named
 * the skill in its declaration has already said both facts - so the server
 * writes the block from them, and this package must not refuse what the server
 * would accept. What it does refuse is a fence that opens and never closes,
 * which is a mistake rather than an omission.
 */

test('a plugin with no skills brings none, which is the default', () => {
  class Bare extends OrknuxPlugin {
    id() {
      return 'bare';
    }
    apiVersion() {
      return 1;
    }
  }
  assert.deepEqual(new Bare().skills(), []);
});

test('a skill needs a name and a body, and says which is missing', () => {
  assert.throws(() => new OrknuxSkill({ content: 'A page.' }), /needs a name/);
  assert.throws(() => new OrknuxSkill({ name: 'Deploying' }), /needs content/);
  assert.throws(() => new OrknuxSkill({ name: 'Deploying', content: '   ' }), /needs content/);
});

test('what it was given is what it holds, and a missing description is null', () => {
  const held = new OrknuxSkill({ name: 'Deploying', content: 'Stop the rollout first.' });
  assert.equal(held.name, 'Deploying');
  assert.equal(held.description, null);
  assert.equal(held.content, 'Stop the rollout first.');
});

test('plain markdown is accepted: the server writes the frontmatter from the declaration', () => {
  assert.deepEqual(
    validateSkills([{ name: 'Deploying', description: 'How we ship.', content: 'Stop the rollout first.' }]),
    [],
  );
});

test('a fence that opens and never closes is the plugin’s mistake', () => {
  const problems = validateSkills([
    { name: 'Deploying', content: '---\nname: Deploying\n\nStop the rollout first.' },
  ]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].part, 'skills');
  assert.match(problems[0].message, /never closes it/);
});

test('a closed fence passes, which is a skill written the long way', () => {
  assert.deepEqual(
    validateSkills([
      {
        name: 'Deploying',
        content: '---\nname: Deploying\ndescription: How we ship.\n---\n\nStop the rollout first.',
      },
    ]),
    [],
  );
});

test('the same skill twice is refused, however it was cased', () => {
  const problems = validateSkills([
    { name: 'Deploying', content: 'One.' },
    { name: 'deploying', content: 'Two.' },
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /more than once/);
});

test('the bounds are the server’s: too many skills, and one too long', () => {
  const many = Array.from({ length: MAX_SKILLS + 1 }, (_unused, at) => ({
    name: `Skill ${at}`,
    content: 'A page.',
  }));
  assert.match(validateSkills(many)[0].message, new RegExp(`more than ${MAX_SKILLS} skills`));

  const long = [{ name: 'Long', content: 'x'.repeat(MAX_SKILL_CHARS + 1) }];
  assert.match(validateSkills(long)[0].message, new RegExp(`at most ${MAX_SKILL_CHARS}`));
});
