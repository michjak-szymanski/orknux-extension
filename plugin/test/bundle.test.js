import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { validate } from '../dist/index.js';
import { bundle, inspect, NotAPluginError } from '../dist/tooling.js';

/**
 * The round trip, which is the only thing that proves the promise: a plugin
 * written in TypeScript against this package, bundled the way the CLI bundles it,
 * is a single ES module the loader can question — and the class it exports is
 * still the sandbox's `OrknuxPlugin`, not a copy the bundler inlined.
 */

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

async function built(fixture) {
  const directory = await mkdtemp(join(tmpdir(), 'orknux-plugin-'));
  const outfile = join(directory, 'plugin.js');
  await bundle({ entry: join(fixtures, fixture), outfile });
  return outfile;
}

test('a plugin written against this package survives being bundled', async () => {
  const outfile = await built('imported.ts');
  const inspected = await inspect(outfile);

  assert.equal(inspected.id, 'imported');
  assert.equal(inspected.apiVersion, 1);
  assert.deepEqual(inspected.functions, [
    {
      name: 'shout',
      description: 'Louder.',
      params: [{ name: 'text', type: 'string' }],
      returnType: 'string',
    },
  ]);
  /* The rest of the declaration survives the trip too, defaults filled in. */
  assert.deepEqual(inspected.parameters, [
    {
      name: 'shoutier',
      description: 'Whether to add emphasis.',
      type: 'boolean',
      required: false,
      secret: false,
      connectionType: null,
    },
  ]);
  assert.deepEqual(inspected.permissions, ['INTL']);
  assert.deepEqual(inspected.capabilities, ['NETWORK_REQUEST']);
  assert.deepEqual(validate(inspected), []);
  assert.ok(inspected.withinSizeLimit);
});

test('the bundle is one module with nothing left to resolve', async () => {
  const source = await readFile(await built('imported.ts'), 'utf8');

  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /require\(/);
  assert.match(source, /export\s*{[\s\S]*as default[\s\S]*}|export default/);
  /* The binding to the sandbox's classes has to still be a read of the global. */
  assert.match(source, /globalThis/);
});

test('a plugin written against the ambient globals loads too', async () => {
  const inspected = await inspect(await built('ambient.js'));

  assert.equal(inspected.id, 'ambient');
  assert.deepEqual(inspected.functions, [
    { name: 'answer', description: null, params: [], returnType: 'number' },
  ]);
  /* Everything it did not declare defaults to none, as the base class answers. */
  assert.deepEqual(inspected.parameters, []);
  assert.deepEqual(inspected.permissions, []);
  assert.deepEqual(inspected.capabilities, []);
});

test('something merely shaped like a plugin is refused', async () => {
  const outfile = await built('shaped.js');

  await assert.rejects(() => inspect(outfile), (failure) => {
    assert.ok(failure instanceof NotAPluginError);
    assert.match(failure.message, /must be a class that extends OrknuxPlugin/);
    return true;
  });
});

test('a plugin reaching for Node is refused by the build, not by the server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orknux-plugin-'));
  await assert.rejects(() =>
    bundle({
      entry: fileURLToPath(new URL('./fixtures/reaching.js', import.meta.url)),
      outfile: join(directory, 'plugin.js'),
    }),
  );
});
