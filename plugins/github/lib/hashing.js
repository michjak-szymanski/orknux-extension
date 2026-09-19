/*
 * SHA-256 and HMAC, written out longhand — the github plugin's hashing.
 *
 * A plugin's sandbox has no crypto: it hands out language builtins and nothing
 * else, on purpose, and there is no permission that could be asked for that
 * would open a door to the host. So the hashing a webhook signature check
 * needs is here, in a library the plugin ships and declares — which is exactly
 * what "a plugin declares the JavaScript it needs" means, now spelled as a
 * file beside the plugin rather than a third of the plugin's own.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The round constants of SHA-256, as FIPS 180-4 gives them. */
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The initial hash value of SHA-256. */
const INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** The block size HMAC pads its key out to. */
const BLOCK = 64;

function rotate(word, by) {
  return ((word >>> by) | (word << (32 - by))) >>> 0;
}

/**
 * SHA-256 of some bytes, as bytes.
 *
 * Straight out of the specification, working on a Uint8Array so nothing here
 * depends on how a string was encoded — that decision is the caller's.
 */
export function sha256(bytes) {
  const hash = INITIAL.slice();

  // One 0x80 byte, then zeroes, then the length in bits as 64 big-endian bits:
  // so the message needs at least nine bytes of room past its own end.
  const padded = new Uint8Array(((((bytes.length + 8) / BLOCK) | 0) + 1) * BLOCK);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const schedule = new Uint32Array(64);
  for (let at = 0; at < padded.length; at += BLOCK) {
    for (let index = 0; index < 16; index++) {
      schedule[index] = view.getUint32(at + index * 4);
    }
    for (let index = 16; index < 64; index++) {
      const early = schedule[index - 15];
      const late = schedule[index - 2];
      const mixEarly = rotate(early, 7) ^ rotate(early, 18) ^ (early >>> 3);
      const mixLate = rotate(late, 17) ^ rotate(late, 19) ^ (late >>> 10);
      schedule[index] = (schedule[index - 16] + mixEarly + schedule[index - 7] + mixLate) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let round = 0; round < 64; round++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + sum1 + choose + ROUND_CONSTANTS[round] + schedule[round]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let word = 0; word < 8; word++) {
    out.setUint32(word * 4, hash[word]);
  }
  return digest;
}

/** HMAC-SHA-256, as RFC 2104 gives it. */
export function hmacSha256(key, message) {
  const shortened = key.length > BLOCK ? sha256(key) : key;
  const padded = new Uint8Array(BLOCK);
  padded.set(shortened);

  const inner = new Uint8Array(BLOCK + message.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let at = 0; at < BLOCK; at++) {
    inner[at] = padded[at] ^ 0x36;
    outer[at] = padded[at] ^ 0x5c;
  }
  inner.set(message, BLOCK);
  outer.set(sha256(inner), BLOCK);
  return sha256(outer);
}

/** Bytes as lowercase hex, which is how a signature header spells a digest. */
export function hex(bytes) {
  let written = '';
  for (let at = 0; at < bytes.length; at++) {
    written += (bytes[at] < 0x10 ? '0' : '') + bytes[at].toString(16);
  }
  return written;
}

/**
 * Whether two hex digests are the same, in time that does not depend on where
 * they first differ.
 *
 * A comparison that returns early tells whoever is guessing how much of their
 * guess was right, one byte at a time, which is enough to forge a signature
 * without ever knowing the secret.
 */
export function sameDigest(mine, theirs) {
  if (typeof theirs !== 'string' || mine.length !== theirs.length) {
    return false;
  }
  let differing = 0;
  for (let at = 0; at < mine.length; at++) {
    differing |= mine.charCodeAt(at) ^ theirs.charCodeAt(at);
  }
  return differing === 0;
}
