import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

import { orknux } from './contract.js';
import {
  DIGEST_ALGORITHMS,
  MAX_CRYPTO_INPUT_BYTES,
  MAX_DERIVED_BYTES,
  MAX_PBKDF2_ITERATIONS,
} from './limits.js';
import type { OrknuxComparison, OrknuxCryptoInput, OrknuxDigest } from './types.js';

/**
 * `orknux.crypto`, computed by Node, for everywhere that is not the sandbox.
 *
 * This is the one helper the fallbacks in `contract.ts` cannot honestly stand
 * in for. The Slack calls and the HTTP door refuse outside the sandbox because
 * they genuinely reach something a test has no business reaching. Crypto
 * reaches nothing: it is arithmetic, it needs no grant, and a plugin that
 * verifies a webhook signature is untestable while it refuses — which would
 * mean the one thing worth testing about the github and teams plugins could
 * only be tested on a server.
 *
 * So the Node-only entry point replaces it with a real implementation, bounded
 * exactly as the server bounds it, and `check` and the suite behave the way an
 * installation will.
 *
 * **This file may never be reached from `src/index.ts`.** It imports
 * `node:crypto`, and the main entry has to stay bundle-safe — a plugin bundle
 * that inlined this would be a plugin bundle trying to import Node. It lives
 * behind `@orknux/plugin/tooling`, which a plugin never imports.
 */

/** The refusal shape every call here shares. */
function refuse(why: string): { error: string } {
  return { error: why };
}

/** A crypto argument as the bytes it stands for, or the refusal it earns. */
function bytesOf(input: OrknuxCryptoInput, what: string): Buffer | { error: string } {
  if (input === null || typeof input !== 'object') {
    return refuse(`${what} has to be { base64 } or { text }`);
  }

  const held = input as { base64?: unknown; text?: unknown };
  let bytes: Buffer;
  if (typeof held.base64 === 'string') {
    bytes = Buffer.from(held.base64, 'base64');
  } else if (typeof held.text === 'string') {
    bytes = Buffer.from(held.text, 'utf8');
  } else {
    return refuse(`${what} has to be { base64 } or { text }`);
  }

  if (bytes.byteLength > MAX_CRYPTO_INPUT_BYTES) {
    return refuse(`${what} is larger than ${MAX_CRYPTO_INPUT_BYTES} bytes`);
  }
  return bytes;
}

/** Whether a read of `bytesOf` refused. */
function refused(read: Buffer | { error: string }): read is { error: string } {
  return !Buffer.isBuffer(read);
}

/** The algorithm, or the refusal naming what there is. */
function named(algorithm: string): string | { error: string } {
  const written = typeof algorithm === 'string' ? algorithm.trim().toLowerCase() : '';
  return (DIGEST_ALGORITHMS as readonly string[]).includes(written)
    ? written
    : refuse(`no algorithm called ${algorithm}: it takes ${DIGEST_ALGORITHMS.join(', ')}`);
}

/**
 * Puts a working `orknux.crypto` on the global, over the one that refuses.
 *
 * Called for its effect when this module is imported, which is what makes
 * `inspect` and the suite see it.
 */
export function hostCrypto(): void {
  const helpers = orknux as unknown as { crypto: Record<string, unknown> };

  helpers.crypto = {
    hash(algorithm: string, input: OrknuxCryptoInput): OrknuxDigest {
      const how = named(algorithm);
      if (typeof how !== 'string') return how;
      const bytes = bytesOf(input, 'the input');
      if (refused(bytes)) return bytes;
      return { base64: createHash(how).update(bytes).digest('base64') };
    },

    hmac(algorithm: string, key: OrknuxCryptoInput, input: OrknuxCryptoInput): OrknuxDigest {
      const how = named(algorithm);
      if (typeof how !== 'string') return how;
      const keyed = bytesOf(key, 'the key');
      if (refused(keyed)) return keyed;
      const bytes = bytesOf(input, 'the input');
      if (refused(bytes)) return bytes;
      return { base64: createHmac(how, keyed).update(bytes).digest('base64') };
    },

    pbkdf2(
      algorithm: string,
      password: OrknuxCryptoInput,
      salt: OrknuxCryptoInput,
      iterations: number,
      length: number,
    ): OrknuxDigest {
      const how = named(algorithm);
      if (typeof how !== 'string') return how;
      const secret = bytesOf(password, 'the password');
      if (refused(secret)) return secret;
      const salted = bytesOf(salt, 'the salt');
      if (refused(salted)) return salted;

      if (!Number.isInteger(iterations) || iterations < 1) {
        return refuse('iterations has to be a whole number of rounds');
      }
      /*
       * Refused rather than clamped, as the server refuses it: a plugin that
       * believes it did ten million rounds and got one million has a security
       * bug nobody can see.
       */
      if (iterations > MAX_PBKDF2_ITERATIONS) {
        return refuse(`iterations is more than ${MAX_PBKDF2_ITERATIONS}`);
      }
      if (!Number.isInteger(length) || length < 1 || length > MAX_DERIVED_BYTES) {
        return refuse(`length has to be between 1 and ${MAX_DERIVED_BYTES} bytes`);
      }
      return { base64: pbkdf2Sync(secret, salted, iterations, length, how).toString('base64') };
    },

    random(bytes: number): OrknuxDigest {
      if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_DERIVED_BYTES) {
        return refuse(`bytes has to be between 1 and ${MAX_DERIVED_BYTES}`);
      }
      return { base64: randomBytes(bytes).toString('base64') };
    },

    timingSafeEqual(a: OrknuxCryptoInput, b: OrknuxCryptoInput): OrknuxComparison {
      const mine = bytesOf(a, 'the first');
      if (refused(mine)) return mine;
      const theirs = bytesOf(b, 'the second');
      if (refused(theirs)) return theirs;
      /*
       * Node's own comparison throws on a length mismatch rather than
       * answering false, and a length is not a secret — so it is checked
       * first and answered plainly.
       */
      if (mine.byteLength !== theirs.byteLength) {
        return { equal: false };
      }
      return { equal: timingSafeEqual(mine, theirs) };
    },
  };
}
