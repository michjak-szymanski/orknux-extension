/*
 * HTTP, as a plugin — the API nobody has written a plugin for yet.
 *
 * Every other plugin here is about one service and asks for NETWORK_REQUEST to
 * reach it. This one is about whichever service a workspace points it at, and
 * that is the whole of its usefulness and the whole of its risk: an internal
 * API, a status endpoint, a vendor with no plugin of its own, reachable from a
 * workflow without anybody writing JavaScript.
 *
 * ## Where a request may go
 *
 * Two fences, and the outer one is not this file's.
 *
 * The installation's proxy rules decide what the server will reach at all, and
 * a plugin cannot see them or argue with them. Inside that, `hosts` is this
 * plugin's own fence: name the hosts a workspace means to talk to and anything
 * else is refused here, before a request is made. Left empty it refuses
 * nothing, which is a choice a workspace should make deliberately rather than
 * find out about.
 *
 * ## Where a credential may go
 *
 * `token` is attached only to a host this plugin was told about — `baseUrl`'s
 * own host, or one named in `hosts`. Never to anything else, and a token with
 * neither configured is refused rather than sent.
 *
 * That rule is the reason this plugin is worth having over telling somebody to
 * write their own. The caller names a url; the credential is not theirs to
 * place. Without the rule, a model persuaded to fetch `https://elsewhere/` by
 * something it read in a page would send the workspace's API key there — and
 * an agent reads pages for a living.
 *
 * ## Bytes
 *
 * `download` answers a key rather than base64, the way everything here that
 * makes bytes does: what it fetched stays on the server and the key names it,
 * so `slack_uploadBinary` can take it without a model retyping a megabyte.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** A nested field, or null rather than a thrown error on the way down. */
function at(holder, name) {
  if (holder === null || typeof holder !== 'object') {
    return null;
  }
  const held = holder[name];
  return held === undefined ? null : held;
}

/** What a caller may ask for. Anything else is a typo, not a method. */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/**
 * A short name for some bytes, derived from the bytes.
 *
 * Content rather than a counter or a clock: fetching the same file twice lands
 * on the same key and overwrites itself, and nothing here has to ask what time
 * it is or keep a number between calls.
 */
function keyFor(text) {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `http.${hash.toString(36)}`;
}

/** The host part of an absolute url, lower-cased, or null where there is none. */
function hostOf(url) {
  const found = /^https?:\/\/([^/?#]+)/i.exec(String(url).trim());
  if (found === null) {
    return null;
  }
  /* Ports and credentials are not the host: api.example.com:8443 is api.example.com. */
  return found[1].split('@').pop().split(':')[0].toLowerCase();
}

/** The hosts a workspace named, lower-cased, with the blank entries dropped. */
function namedHosts(settings) {
  const written = typeof settings.hosts === 'string' ? settings.hosts : '';
  return written
    .split(/[,\s]+/)
    .map((one) => one.trim().toLowerCase())
    .filter((one) => one.length > 0);
}

/**
 * The url this call is actually for, absolute and allowed.
 *
 * A relative path is resolved against `baseUrl`, which is how a workspace that
 * points this at one API lets its callers say `/v1/issues` instead of repeating
 * the origin - and what makes the host fence mean something, since a caller
 * naming only a path cannot name another host at all.
 */
function target(settings, url) {
  const asked = typeof url === 'string' ? url.trim() : '';
  if (asked.length === 0) {
    throw new Error('there is no url to fetch');
  }

  /* A scheme this cannot speak is said so by name, not called a relative path. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(asked) && !/^https?:/i.test(asked)) {
    throw new Error(`${asked.split(':')[0]} is not a scheme this can fetch: it speaks http and https`);
  }

  const base = typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '';
  let whole = asked;
  if (!/^https?:\/\//i.test(asked)) {
    if (base.length === 0) {
      throw new Error(
        `${asked} is not an absolute url, and no baseUrl is configured to resolve it against`,
      );
    }
    whole = `${base.replace(/\/+$/, '')}/${asked.replace(/^\/+/, '')}`;
  }

  const host = hostOf(whole);
  if (host === null) {
    throw new Error(`${whole} is not an http or https url`);
  }

  /*
   * The fence, where a workspace put one up. Refused here rather than sent and
   * refused by a proxy, because the sentence is better: a caller learns which
   * hosts it may ask for instead of learning that something, somewhere, said
   * no.
   */
  const allowed = namedHosts(settings);
  const baseHost = hostOf(base);
  if (baseHost !== null && !allowed.includes(baseHost)) {
    allowed.push(baseHost);
  }
  if (allowed.length > 0 && !allowed.includes(host)) {
    throw new Error(
      `${host} is not a host this plugin may reach: it is configured for ${allowed.join(', ')}`,
    );
  }

  return { url: whole, host: host, allowed: allowed };
}

/**
 * The headers to send: the caller's, and the credential where it belongs.
 *
 * The credential goes only to a host the workspace named. A token configured
 * with nowhere named is refused rather than sent, because "send this key to
 * whichever url somebody asks for" is not a configuration anybody means.
 */
function headersFor(settings, where, given) {
  const sending = {};
  if (given !== null && typeof given === 'object' && !Array.isArray(given)) {
    for (const [name, value] of Object.entries(given)) {
      if (typeof value === 'string') {
        sending[name.toLowerCase()] = value;
      }
    }
  }

  const token = settings.token;
  if (typeof token !== 'string' || token.length === 0) {
    return sending;
  }

  if (where.allowed.length === 0) {
    throw new Error(
      'a token is configured but no baseUrl and no hosts are, so there is nowhere it may safely ' +
        'be sent: name the hosts this plugin talks to',
    );
  }

  const named = typeof settings.authHeader === 'string' && settings.authHeader.length > 0
    ? settings.authHeader.toLowerCase()
    : 'authorization';
  const scheme = typeof settings.authScheme === 'string' ? settings.authScheme.trim() : 'Bearer';

  /* A caller's own header wins: it is saying it has a better credential. */
  if (sending[named] === undefined) {
    sending[named] = scheme.length > 0 ? `${scheme} ${token}` : token;
  }
  return sending;
}

/** One call, made and read, or the sentence saying why it was not. */
function call(settings, url, method, body, headers) {
  const where = target(settings, url);
  const asked = typeof method === 'string' && method.length > 0 ? method.trim().toUpperCase() : 'GET';
  if (!METHODS.includes(asked)) {
    throw new Error(`no method called ${method}: it is ${METHODS.join(', ')}`);
  }

  const answered = orknux.http.request({
    url: where.url,
    method: asked,
    headers: headersFor(settings, where, headers),
    body: body === '' || body === null ? undefined : body,
  });
  if (answered.error !== undefined) {
    throw new Error(`could not reach ${where.host}: ${answered.error}`);
  }

  return {
    status: answered.status,
    ok: answered.status < 400,
    headers: answered.headers ?? {},
    body: answered.body ?? '',
    /*
     * Only where the answer parsed as an object. A JSON array parses too, and
     * would not fit a map - `body` still has it, and whoever wanted an array
     * knows they asked for one.
     */
    json:
      answered.json !== undefined && answered.json !== null && !Array.isArray(answered.json)
        ? answered.json
        : null,
  };
}

export default class Http extends OrknuxPlugin {

  id() {
    return 'http';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'baseUrl',
        description:
          'The API this is pointed at, so a caller can say /v1/issues instead of the whole url. ' +
          'Its host is always reachable. Leave empty to make every call name an absolute url.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'hosts',
        description:
          'The hosts this plugin may reach, separated by commas - api.example.com, ' +
          'status.example.com. Anything else is refused before a request is made. Empty means ' +
          'no fence of this plugin\'s own, which leaves only the installation\'s proxy rules.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'token',
        description:
          'A credential for the hosts above, sent on every call to one of them and never to ' +
          'anything else. A token with no baseUrl and no hosts is refused rather than sent.',
        type: 'string',
        required: false,
        secret: true,
      }),
      new OrknuxParameter({
        name: 'authHeader',
        description: 'Which header carries it. Empty for authorization.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'authScheme',
        description:
          'What goes before it - Bearer, Basic, Token. Empty sends the credential on its own, ' +
          'which is what an x-api-key header wants.',
        type: 'string',
        required: false,
      }),
    ];
  }

  permissions() {
    // None. The server makes the call; this file only says what to ask for.
    return [];
  }

  capabilities() {
    /*
     * The widest capability there is, and the only plugin here asking for it
     * without naming the service it is for - because naming one is a
     * workspace's job in `baseUrl` and `hosts` rather than this file's.
     *
     * Worth weighing before accepting: with no hosts configured, anything the
     * installation's proxy rules permit is reachable by whoever can call a
     * workflow. With them configured it is exactly as wide as the list.
     */
    return ['NETWORK_REQUEST'];
  }

  /*
   * One shape, where there could have been two.
   *
   * An answer's headers and its parsed body are maps of whatever the other end
   * decided to send, and a declared object cannot hold one: a property of kind
   * `object` has to name the object it points at, and there is no naming the
   * shape of somebody else's JSON. So the three calls answer an untyped map
   * and say in their descriptions what is in it, the way `prometheus_query`
   * does for the same reason. `Fetched` is declarable because every field of
   * it is a scalar.
   */
  objects() {
    return [
      new OrknuxObject({
        name: 'Fetched',
        description: 'Bytes fetched and kept, named rather than handed over.',
        properties: [
          { name: 'status', kind: 'number', description: 'The HTTP status.' },
          {
            name: 'key',
            kind: 'string',
            description:
              'Where the bytes are kept for the rest of this session. Hand it to ' +
              'slack_uploadBinary as contentKey. Empty where there was no session to keep them in.',
          },
          { name: 'size', kind: 'number', description: 'How many bytes were fetched.' },
          {
            name: 'contentType',
            kind: 'string',
            description: 'What the answer said it was, or null where it said nothing.',
          },
          {
            name: 'base64',
            kind: 'string',
            description:
              'The bytes themselves, for a workflow node with no session to read a key from. ' +
              'Empty on the agents\' surface, where the key is what to pass.',
          },
        ],
      }),
    ];
  }

  tools() {
    const fetched = this.functions().find((one) => one.name === 'download');
    return [
      new OrknuxFunctionTool({ function: 'get' }),
      new OrknuxFunctionTool({ function: 'post' }),
      new OrknuxFunctionTool({ function: 'request' }),

      /*
       * `download` is a tool of its own so that its answer can leave the bytes
       * behind. A model reads every character of an answer, and a megabyte of
       * base64 read on the way to a twelve-character key is the one thing that
       * does not survive the trip to the next call.
       */
      new OrknuxTool({
        name: 'download',
        description:
          fetched.description +
          ' The answer names the bytes rather than carrying them: pass its key to ' +
          'slack_uploadBinary as contentKey. Where there is no session to keep them in, the ' +
          'base64 comes back instead, because then it is the only copy there is.',
        params: fetched.params,
        returnType: fetched.returnType,
        run: (url, headers) => {
          const got = fetched.run(url, headers);
          return got.key.length === 0 ? got : { ...got, base64: '' };
        },
      }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'get',
        description:
          'Fetches a url and answers the status, the headers, the body as text and the body ' +
          'parsed where it was a JSON object. Pass an absolute url, or a path if the plugin has ' +
          'a baseUrl - and headers as a map where the call needs any of its own; the configured ' +
          'credential is added for you and is never sent to a host the plugin was not told ' +
          'about. Use it to read an API a workflow needs and nothing here has a plugin for. The ' +
          'answer carries status, ok (below 400), headers, body as text, and json - the body ' +
          'parsed where it was a JSON object, null otherwise, including for an array, which body ' +
          'still holds.',
        params: [
          { name: 'url', type: 'string' },
          { name: 'headers', type: 'map', required: false, default: {} },
        ],
        returnType: 'map',
        run: (url, headers) => call(this.settings, url, 'GET', undefined, headers),
      }),

      new OrknuxFunction({
        name: 'post',
        description:
          'Posts to a url and answers what came back. body goes as JSON with the content type ' +
          'set when it is a map, and exactly as written when it is a string - which is how a ' +
          'form-encoded or plain-text body is sent. Everything else is as get: a path resolves ' +
          'against baseUrl, and the configured credential is added for hosts the plugin knows. ' +
          'The answer is the same shape get gives: status, ok, headers, body and json.',
        params: [
          { name: 'url', type: 'string' },
          { name: 'body', type: 'map', required: false, default: {} },
          { name: 'headers', type: 'map', required: false, default: {} },
        ],
        returnType: 'map',
        run: (url, body, headers) => call(this.settings, url, 'POST', body, headers),
      }),

      new OrknuxFunction({
        name: 'request',
        description:
          'The same call with the method named: GET, POST, PUT, PATCH, DELETE or HEAD. Use it ' +
          'for the ones get and post do not cover - a PUT that replaces something, a DELETE. ' +
          'body is ignored where the method carries none. The answer is the same shape get ' +
          'gives: status, ok, headers, body and json.',
        params: [
          { name: 'url', type: 'string' },
          { name: 'method', type: 'string' },
          { name: 'body', type: 'map', required: false, default: {} },
          { name: 'headers', type: 'map', required: false, default: {} },
        ],
        returnType: 'map',
        run: (url, method, body, headers) => call(this.settings, url, method, body, headers),
      }),

      new OrknuxFunction({
        name: 'download',
        description:
          'Fetches bytes rather than text - a PDF, an image, a zip - and keeps them, answering ' +
          'the size, what the answer said they were, and a short key they are kept under for ' +
          'this session. Up to 5 MB. The key is what slack_uploadBinary takes, so a file goes ' +
          'from an API into a channel without passing through anybody.',
        params: [
          { name: 'url', type: 'string' },
          { name: 'headers', type: 'map', required: false, default: {} },
        ],
        returnType: 'Fetched',
        run: (url, headers) => {
          const where = target(this.settings, url);
          const got = orknux.http.download(where.url, headersFor(this.settings, where, headers));
          if (got.error !== undefined) {
            throw new Error(`could not fetch from ${where.host}: ${got.error}`);
          }
          if (got.status >= 400) {
            throw new Error(`${where.host} answered ${got.status}`);
          }

          const key = keyFor(got.base64);
          const kept = orknux.session.store.put(key, got.base64);
          return {
            status: got.status,
            key: kept.error === undefined ? key : '',
            size: got.size,
            contentType: got.contentType,
            base64: got.base64,
          };
        },
      }),
    ];
  }
}
