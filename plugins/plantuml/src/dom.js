/*
 * The browser PlantUML's JavaScript build expects, written out.
 *
 * The engine is Java compiled to JavaScript by TeaVM, and what it wants from a
 * browser is small and very specific: a document to build an SVG tree in, a
 * serialiser to turn that tree into the string it hands back, a canvas to
 * measure text with, and a timer to defer its work onto. Four things, none of
 * which the sandbox has and none of which needs a page to be real.
 *
 * So this is not a set of stubs that get the engine far enough to fail
 * politely — it is the actual DOM the diagram is built in, and
 * `serializeToString` below is what produces every SVG this plugin answers.
 *
 * ## The timer is the part that matters
 *
 * There is exactly one `setTimeout` in the engine, and it is how TeaVM's
 * scheduler hands control back to itself. The bundle's own shim — see
 * `plugins/shim.mjs` — answers a missing `setTimeout` by running the callback
 * *inline*, which is right for a layout engine that only ever uses a timer to
 * yield, and wrong here: re-entering the scheduler from inside its own stack
 * makes TeaVM refuse with "Can't enter monitor from another thread
 * synchronously", and nothing renders.
 *
 * What a real event loop does is run each continuation on a fresh stack. So
 * this queues them, and `drain` runs the queue after the call that scheduled
 * them has returned — which is an event loop, turned by hand, inside one
 * synchronous call. That is what lets a plugin's `run` answer with a diagram.
 *
 * This is deliberately unconditional: the banner's inline version is already
 * installed by the time this runs, and leaving it in place would break the
 * engine on the first diagram.
 */

import { heightOf, widthOf } from './metrics.js';

/** What the engine has scheduled and not yet run. */
const pending = [];

globalThis.setTimeout = (run, _after, ...rest) => {
  if (typeof run === 'function') {
    pending.push(() => run(...rest));
  }
  return pending.length;
};
globalThis.clearTimeout = () => undefined;

/**
 * Turn the loop until the work is done.
 *
 * `done` is asked between turns rather than trusted to happen: an engine that
 * finishes without ever scheduling anything leaves the queue empty, and one
 * that goes wrong must not spin here forever. Ten thousand turns is far past
 * what a diagram takes — the ones measured take exactly one — and is a
 * backstop rather than a budget.
 */
export function drain(done) {
  let turns = 0;
  while (pending.length > 0 && !done() && turns < 10000) {
    pending.shift()();
    turns += 1;
  }
  /* Whatever is left belongs to a render that is over; the next one starts clean. */
  pending.length = 0;
  return turns;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Text as XML content: the five characters that are markup if left alone. */
function escaped(text) {
  return String(text).replace(/[&<>"]/g, (one) => ESCAPES[one]);
}

/** A style object as the attribute it serialises to — `fontSize` is `font-size`. */
function styling(style) {
  const written = [];
  for (const name of Object.keys(style)) {
    const value = style[name];
    if (value !== '' && value !== null && value !== undefined) {
      written.push(`${name.replace(/[A-Z]/g, (one) => '-' + one.toLowerCase())}:${value}`);
    }
  }
  return written.join(';');
}

/** What a canvas is for here, which is one question asked many times. */
class Measuring {
  constructor() {
    this.font = '';
  }

  measureText(text) {
    /* `bold 14px sans-serif`, in the order a canvas font shorthand is written. */
    const size = Number((this.font.match(/(\d+(?:\.\d+)?)px/) ?? [])[1]) || 14;
    const family = (this.font.split('px').pop() ?? '').trim();
    const reach = heightOf(size);
    return {
      width: widthOf(text, size, family, this.font),
      actualBoundingBoxAscent: reach.ascent,
      actualBoundingBoxDescent: reach.descent,
      fontBoundingBoxAscent: reach.ascent,
      fontBoundingBoxDescent: reach.descent,
    };
  }
}

/** One node of the tree the diagram is built in. */
class Element {
  constructor(document, tag, namespace) {
    this.ownerDocument = document;
    this.tagName = tag;
    this.nodeName = tag;
    this.namespaceURI = namespace ?? null;
    this.nodeType = 1;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.written = '';
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  setAttributeNS(_namespace, name, value) {
    this.setAttribute(name, value);
  }

  getAttribute(name) {
    const held = this.attributes.get(String(name));
    return held === undefined ? null : held;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  appendChild(child) {
    if (child !== null && child !== undefined) {
      this.childNodes.push(child);
      if (typeof child === 'object') {
        child.parentNode = this;
      }
    }
    return child;
  }

  insertBefore(child, before) {
    const at = this.childNodes.indexOf(before);
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
    return child;
  }

  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) {
      this.childNodes.splice(at, 1);
    }
    return child;
  }

  set textContent(value) {
    this.childNodes = [];
    this.written = value === null || value === undefined ? '' : String(value);
  }

  get textContent() {
    return this.written + this.childNodes.map((one) => one.textContent ?? '').join('');
  }

  /**
   * How much room this text takes, which is the other half of the measuring.
   *
   * A browser answers this by laying the text out for real; here it is the
   * same table the canvas uses, so a diagram is measured one way throughout
   * rather than two ways that disagree by a few pixels each time.
   */
  getBBox() {
    const size = Number(this.getAttribute('font-size')) || 14;
    const family = this.getAttribute('font-family') ?? '';
    const weight = this.getAttribute('font-weight') ?? '';
    const reach = heightOf(size);
    return {
      x: 0,
      y: -reach.ascent,
      width: widthOf(this.textContent, size, family, weight),
      height: reach.ascent + reach.descent,
    };
  }

  getComputedTextLength() {
    return this.getBBox().width;
  }

  getContext() {
    return new Measuring();
  }
}

/** `<?xml …?>`, which the engine puts at the top of a standalone document. */
class Instruction {
  constructor(target, data) {
    this.nodeType = 7;
    this.target = target;
    this.data = data;
    this.childNodes = [];
  }

  get textContent() {
    return '';
  }
}

/** The tree as the string this plugin answers with. */
function serialize(node) {
  if (node === null || node === undefined) {
    return '';
  }
  if (node.nodeType === 7) {
    return `<?${node.target} ${node.data}?>`;
  }
  if (node.nodeType === 9) {
    return node.childNodes.map(serialize).join('');
  }

  let out = `<${node.tagName}`;
  for (const [name, value] of node.attributes) {
    out += ` ${name}="${escaped(value)}"`;
  }
  const styled = styling(node.style);
  if (styled.length > 0) {
    out += ` style="${escaped(styled)}"`;
  }

  const inside = escaped(node.written) + node.childNodes.map(serialize).join('');
  /*
   * An empty element closes itself. `<text/>` and `<text></text>` are the same
   * element to a parser, and the short form is what a browser's own serialiser
   * writes.
   */
  return inside.length === 0 ? `${out}/>` : `${out}>${inside}</${node.tagName}>`;
}

class Document {
  constructor() {
    this.nodeType = 9;
    this.childNodes = [];
    this.documentElement = null;
    this.body = new Element(this, 'body');
    this.head = new Element(this, 'head');
  }

  createElementNS(namespace, tag) {
    return new Element(this, tag, namespace);
  }

  createElement(tag) {
    return new Element(this, tag);
  }

  createTextNode(text) {
    const node = new Element(this, '#text');
    node.written = String(text);
    return node;
  }

  createProcessingInstruction(target, data) {
    return new Instruction(target, data);
  }

  importNode(node) {
    return node;
  }

  /* Only `render` reaches for one, and this plugin calls `renderToString`. */
  getElementById() {
    return null;
  }

  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }

  addEventListener() {}
}

globalThis.window = globalThis;
globalThis.document = new Document();

globalThis.XMLSerializer = class XMLSerializer {
  serializeToString(node) {
    return serialize(node);
  }
};

/*
 * Parsing markup back in is only ever reached for an `<image>` sprite the
 * diagram wants inlined, and the engine checks what it got before using it —
 * so answering "no document" is a sprite that does not appear, rather than a
 * diagram that does not render.
 */
globalThis.DOMParser = class DOMParser {
  parseFromString() {
    return { documentElement: null };
  }
};

/*
 * The standard library and the themes are fetched over HTTP by the browser
 * build. There is no network in a sandbox and there is not going to be one, so
 * a request answers nothing and the engine falls back — an unknown `!theme` is
 * drawn unthemed, and `!include <C4/C4_Context>` is a diagram that says it
 * could not include it. Both are better than a plugin that hangs.
 */
globalThis.XMLHttpRequest = function XMLHttpRequest() {
  this.readyState = 4;
  this.status = 0;
  this.responseText = '';
  this.open = () => undefined;
  this.send = () => undefined;
  this.setRequestHeader = () => undefined;
  this.getAllResponseHeaders = () => '';
};
