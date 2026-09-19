import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { inspect } from '../dist/tooling.js';

/**
 * Every shipped plugin's marketplace manifest, held to the shape the
 * marketplace's own schema describes — `plugins/plugin.schema.json`, which is
 * that service's file, copied here for editors and for this.
 *
 * The marketplace reads prose and checks one claim: that `key` is what `id()`
 * answers, because a listing keyed differently from the code is a listing
 * that installs as something else. That check is the reason this file exists;
 * it costs nothing here and catches a rename that would otherwise be found by
 * somebody installing the wrong thing.
 *
 * The rest is what a manifest cannot be trusted to get right on its own: the
 * files it names have to be there, because `descriptionPath` pointing at a
 * README nobody wrote is a listing with an empty details pane.
 */

const root = fileURLToPath(new URL('../../plugins/', import.meta.url));

/** Every directory under `plugins/` is a plugin; the loose files beside them are not. */
const shipped = readdirSync(root).filter((name) => {
  try {
    return statSync(root + name).isDirectory();
  } catch {
    return false;
  }
});

/** The pattern the schema holds `key` to. */
const KEY = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * The repository's own catalog, which the marketplace reads. A plugin's
 * `plugin.json` is deliberately one entry of this with its paths made
 * relative to the plugin's own folder — so a folder zipped out of here, with
 * its manifest beside it, needs nothing retyped. The two saying different
 * things about the same plugin is the drift this catches: whichever the
 * marketplace happened to read would be the truth, and nobody would know
 * which.
 */
const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../marketplace.json', import.meta.url)), 'utf8'),
);

test('the catalog and the plugins agree on who is offered', () => {
  assert.deepEqual(
    [...catalog.map((entry) => entry.key)].sort(),
    [...shipped].sort(),
    'the catalog lists plugins the repository does not have, or misses some it does',
  );
});

for (const entry of catalog) {
  test(`the ${entry.key} catalog entry and its manifest say the same thing`, () => {
    const manifest = JSON.parse(readFileSync(`${root}${entry.key}/plugin.json`, 'utf8'));

    /* The prose is the same words in both places, not two descriptions. */
    for (const field of ['key', 'name', 'author', 'summary', 'version']) {
      assert.equal(manifest[field], entry[field], `${field} differs between the two`);
    }

    /*
     * The paths are the same files said two ways: the catalog from the
     * repository root, the manifest from inside the plugin's own folder.
     */
    for (const field of ['icon', 'descriptionPath', 'path']) {
      if (entry[field] === undefined) continue;
      const named = manifest[field] ?? `${entry.key}.js`;
      assert.equal(
        entry[field],
        `plugins/${entry.key}/${named}`,
        `${field} names a different file in each`,
      );
    }
  });
}

test('every plugin ships a manifest, and there is one to copy', () => {
  assert.ok(shipped.length > 0, 'no plugins found');
  for (const name of shipped) {
    assert.ok(
      readdirSync(root + name).includes('plugin.json'),
      `${name} has no plugin.json`,
    );
  }
  /* The schema itself and a filled-in example, for a plugin written next. */
  const beside = readdirSync(root);
  assert.ok(beside.includes('plugin.schema.json'), 'the schema is not beside the plugins');
  assert.ok(beside.includes('plugin.example.json'), 'there is no example to copy');
});

for (const name of shipped) {
  test(`the ${name} manifest says what the marketplace would take`, async () => {
    const manifest = JSON.parse(readFileSync(`${root}${name}/plugin.json`, 'utf8'));

    /* Required, and shaped, as the schema has it. */
    for (const field of ['key', 'name', 'summary', 'version']) {
      assert.equal(typeof manifest[field], 'string', `${field} is missing`);
      assert.ok(manifest[field].length > 0, `${field} is empty`);
    }
    assert.match(manifest.key, KEY);
    assert.ok(manifest.name.length <= 120, 'name is longer than the schema allows');
    assert.ok(manifest.summary.length <= 300, 'summary is longer than the schema allows');
    assert.ok(manifest.version.length <= 32, 'version is longer than the schema allows');
    if (manifest.author !== undefined) {
      assert.ok(manifest.author.length <= 120, 'author is longer than the schema allows');
    }

    /*
     * `path` names the file the server loads. Where a plugin is a build, its
     * source sits in `src/` under the same name — so this is the one field
     * that keeps an archive from being published with the unbundled source,
     * which imports libraries and could not load at all.
     */
    const file = manifest.path ?? `${name}.js`;
    const held = readdirSync(root + name);
    assert.ok(held.includes(file), `${file} is not there to load`);

    /* The one claim the marketplace checks against the code. */
    const inspected = await inspect(`${root}${name}/${file}`);
    assert.equal(
      manifest.key,
      inspected.id,
      `the manifest says ${manifest.key} and the code answers ${inspected.id}`,
    );

    /* And the description it names has to exist, or the listing has none. */
    const described = manifest.descriptionPath ?? 'README.md';
    assert.ok(held.includes(described), `${described} is named but not there`);
    assert.ok(
      readFileSync(`${root}${name}/${described}`, 'utf8').trim().length > 0,
      `${described} is empty`,
    );

    /*
     * An icon may be an emoji standing as itself, a URL, or an SVG in the
     * archive — and where it is the third, it has to be a file that is there
     * and an SVG that is one. Drawn in `currentColor`, because a listing is
     * shown on a light page and a dark one and a single file has to suit
     * both; a hard-coded colour is only right on one of them.
     */
    const icon = manifest.icon;
    if (typeof icon === 'string') {
      assert.ok(icon.length <= 400, 'icon is longer than the schema allows');
      if (icon.endsWith('.svg') && !/^(https?|data):/.test(icon)) {
        assert.ok(held.includes(icon), `${icon} is named but not there`);
        const drawn = readFileSync(`${root}${name}/${icon}`, 'utf8');
        assert.match(drawn, /<svg[\s>]/, `${icon} is not an svg`);
        assert.match(drawn, /currentColor/, `${icon} does not take the colour of the list`);
      }
    }
  });
}
