import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  definePlugin,
  LIBRARY_PATH,
  MAX_LIBRARIES,
  OrknuxPlugin,
  validateLibraries,
} from '../dist/index.js';

/**
 * The libraries contract: a plugin declares the files it ships with, as
 * relative paths, and nothing that could name a file outside what travels
 * with the plugin passes. The path shape is the whole of the safety here -
 * the server resolves these against a zip's entries or a plugin's URL, so a
 * path that could climb out or point elsewhere must be refused before it is
 * ever resolved.
 */

test('a plugin with no libraries declares none, which is the default', () => {
  class Bare extends OrknuxPlugin {
    id() {
      return 'bare';
    }
    apiVersion() {
      return 1;
    }
  }
  assert.deepEqual(new Bare().libraries(), []);
});

test('a defined plugin carries its declared libraries, as copies', () => {
  const Defined = definePlugin({ id: 'shipped', libraries: ['lib/util.js', './lib/deep/more.js'] });
  const plugin = new Defined();

  const first = plugin.libraries();
  first.push('sneaked.js');
  assert.deepEqual(plugin.libraries(), ['lib/util.js', './lib/deep/more.js']);
});

test('good paths pass: plain, ./-prefixed, nested, dotted names', () => {
  assert.deepEqual(
    validateLibraries(['lib/util.js', './helpers.js', 'a/b/c/d.js', 'name.v2.js']),
    [],
  );
});

test('everything that could name a file elsewhere is refused', () => {
  const refused = [
    '/etc/passwd.js', // absolute
    'C:/anything.js', // matches shape but a colon is not in the alphabet
    'https://evil.example/x.js', // URL
    '../outside.js', // climbing out
    'lib/../../outside.js', // climbing out from below
    'lib\\windows.js', // backslashes
    'lodash', // bare specifier
    'lib/util.ts', // not the language the sandbox runs
    '', // nothing
  ];
  for (const path of refused) {
    assert.ok(
      validateLibraries([path]).length > 0,
      `"${path}" should have been refused and was not`,
    );
  }
});

test('the same file spelled two ways is one file, said once', () => {
  const problems = validateLibraries(['lib/util.js', './lib/util.js']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /more than once/);
});

test('a list too long to read is refused as a list', () => {
  const many = Array.from({ length: MAX_LIBRARIES + 1 }, (unused, at) => `lib/f${at}.js`);
  const problems = validateLibraries(many);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, new RegExp(String(MAX_LIBRARIES)));
});

test('the exported pattern is the one the validation applies', () => {
  assert.ok(LIBRARY_PATH.test('lib/util.js'));
  assert.ok(!LIBRARY_PATH.test('../lib/util.js'));
});
