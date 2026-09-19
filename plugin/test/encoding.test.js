import assert from 'node:assert/strict';
import { test } from 'node:test';

/* Importing the tooling is what installs the hosted implementations. */
import '../dist/tooling.js';

/**
 * `orknux.encoding`, and why it is not `orknux.crypto`.
 *
 * Base64 is an encoding: nothing about it is secret, keyed or one-way. Kept
 * under `crypto` it would teach the misconception that causes real incidents —
 * that base64 is a kind of protection — so it lives in its own namespace, and
 * these tests are here rather than beside the digests for the same reason.
 *
 * Ungranted, like crypto, because it reaches nothing. That is what lets a
 * plugin build a Basic credential without asking for `TEXT_ENCODING`, which is
 * exactly what confluence, jira and prometheus now do.
 */

test('text goes to base64 and comes back', () => {
  const encoded = orknux.encoding.encodeBase64('hello');
  assert.equal(encoded.base64, 'aGVsbG8=');
  assert.equal(orknux.encoding.decodeBase64('aGVsbG8=').text, 'hello');
});

test('it is UTF-8, so an accent survives the round trip', () => {
  /* The case a hand-rolled encoder gets wrong, and a credential hits daily. */
  const pair = 'michał@example.com:tökén';
  const encoded = orknux.encoding.encodeBase64(pair);
  assert.equal(Buffer.from(encoded.base64, 'base64').toString('utf8'), pair);
  assert.equal(orknux.encoding.decodeBase64(encoded.base64).text, pair);
});

test('bytes that spell no text are refused, not answered in replacement marks', () => {
  /*
   * 0xFF is not the start of any UTF-8 sequence. Node would hand back U+FFFD
   * silently, which looks like data — so the refusal is the whole point.
   */
  const notText = Buffer.from([0xff, 0xfe, 0xfd]).toString('base64');
  const read = orknux.encoding.decodeBase64(notText);
  assert.equal(read.text, undefined);
  assert.match(read.error, /not text/);
});

test('a refusal is data, never a throw', () => {
  /* The shape every helper here shares: `{ error }` a plugin can say something about. */
  assert.match(orknux.encoding.encodeBase64(42).error, /takes a string/);
  assert.match(orknux.encoding.decodeBase64(null).error, /takes a string/);
});

test('the digests live next door, and are not this', () => {
  /* Both ungranted, both arithmetic — and deliberately not the same namespace. */
  assert.equal(typeof orknux.encoding.encodeBase64, 'function');
  assert.equal(typeof orknux.crypto.hash, 'function');
  assert.equal(orknux.crypto.encodeBase64, undefined);
  assert.equal(orknux.encoding.hash, undefined);
});
