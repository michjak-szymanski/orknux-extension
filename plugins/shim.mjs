/*
 * What a bundle needs before its own first line runs.
 *
 * A plugin is read before it is granted anything: the server has to load the
 * module to ask what permissions it wants, and it cannot hand over a
 * permission in order to find out whether to hand it over. So the module body
 * runs in a context with nothing switched on — which is fine for a plugin
 * somebody wrote by hand, and not fine for two megabytes of inlined library
 * that builds an encoder at module scope on the way past.
 *
 * Both of these shipped broken for exactly that reason and neither could be
 * installed at all:
 *
 *   pdf      ReferenceError: TextEncoder is not defined
 *   mermaid  ReferenceError: Buffer is not defined
 *
 * The second is now answered by the sandbox itself, which defines `atob` —
 * base64 is arithmetic and reaches nothing, so there was never anything to
 * grant. This file answers the first, and it answers it in the bundle rather
 * than in the sandbox on purpose: `TextEncoder` is a permission a person
 * accepts, and the honest way for a plugin to load without it is to bring its
 * own rather than to have the boundary quietly moved.
 *
 * Every definition here is conditional. Where the permission *was* granted the
 * engine's own is already in place and is left exactly as it is; this is only
 * ever the floor under a module body that would otherwise not load.
 */

/*
 * Something for a bundle to call the global object.
 *
 * A library that has to work in a browser, in a worker and in Node sniffs for
 * one of their names, and the usual chain is
 *
 *   typeof window < 'u' ? window : typeof global < 'u' ? global : typeof self < 'u' ? self : this
 *
 * An ES module's `this` is undefined and none of the three names exists here,
 * so the whole expression came out undefined and jsPDF's next line - reading
 * `.saveAs` off it - threw before the plugin could be read.
 *
 * `self` rather than `window`, deliberately. Both would satisfy the sniff, but
 * `window` is the name that tells a library it has a DOM, and it would go on
 * to reach for `document` and fail further in, where the reason is harder to
 * see. `self` is the worker's name for the same object: a global exists, and
 * there is no page.
 */
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

if (typeof globalThis.TextEncoder !== 'function') {
  /** UTF-8, the only encoding anything here asks for. */
  globalThis.TextEncoder = class TextEncoder {
    get encoding() {
      return 'utf-8';
    }

    encode(input = '') {
      const text = String(input);
      const out = [];
      for (let at = 0; at < text.length; at += 1) {
        let point = text.codePointAt(at);

        // A surrogate pair is one character and two units; the second is
        // consumed here rather than encoded as a lone surrogate.
        if (point > 0xffff) at += 1;

        if (point < 0x80) {
          out.push(point);
        } else if (point < 0x800) {
          out.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
        } else if (point < 0x10000) {
          out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
        } else {
          out.push(
            0xf0 | (point >> 18),
            0x80 | ((point >> 12) & 0x3f),
            0x80 | ((point >> 6) & 0x3f),
            0x80 | (point & 0x3f),
          );
        }
      }
      return Uint8Array.from(out);
    }

    encodeInto(input, into) {
      const bytes = this.encode(input);
      const written = Math.min(bytes.length, into.length);
      into.set(bytes.subarray(0, written));
      return { read: String(input).length, written };
    }
  };
}

if (typeof globalThis.TextDecoder !== 'function') {
  globalThis.TextDecoder = class TextDecoder {
    constructor(label = 'utf-8') {
      const asked = String(label).toLowerCase();
      /*
       * Two encodings, because two are asked for. jsPDF reads its font tables
       * as latin1 - one byte, one code point, no decoding to speak of - and
       * everything else here is utf-8. A third would be a real table and is
       * not worth carrying until something wants it.
       */
      if (asked === 'latin1' || asked === 'iso-8859-1' || asked === 'binary') {
        this.label = 'latin1';
      } else if (asked === 'utf-8' || asked === 'utf8' || asked === 'unicode-1-1-utf-8') {
        this.label = 'utf-8';
      } else {
        throw new RangeError(`this sandbox decodes utf-8 and latin1 only, not ${label}`);
      }
    }

    get encoding() {
      return this.label;
    }

    decode(input) {
      if (input === undefined) return '';
      const bytes =
        input instanceof Uint8Array ? input : new Uint8Array(input.buffer ?? input);

      if (this.label === 'latin1') {
        let said = '';
        for (const byte of bytes) said += String.fromCharCode(byte);
        return said;
      }

      let out = '';
      for (let at = 0; at < bytes.length; ) {
        const first = bytes[at];
        let point;
        let length;

        if (first < 0x80) {
          point = first;
          length = 1;
        } else if ((first & 0xe0) === 0xc0) {
          point = first & 0x1f;
          length = 2;
        } else if ((first & 0xf0) === 0xe0) {
          point = first & 0x0f;
          length = 3;
        } else if ((first & 0xf8) === 0xf0) {
          point = first & 0x07;
          length = 4;
        } else {
          // Not a lead byte. The replacement character is what a decoder is
          // required to produce rather than throwing, so a damaged file reads
          // as damaged text instead of failing the whole run.
          out += '�';
          at += 1;
          continue;
        }

        if (at + length > bytes.length) {
          out += '�';
          break;
        }

        for (let more = 1; more < length; more += 1) {
          point = (point << 6) | (bytes[at + more] & 0x3f);
        }

        out += String.fromCodePoint(point);
        at += length;
      }
      return out;
    }
  };
}
