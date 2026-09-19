/*
 * Prometheus, as a plugin.
 *
 * What this exists for is the question "what is the system doing", asked from a
 * workflow's condition or an agent's hand: is the error rate above the line, is
 * this job up, what metrics are there to ask about at all. Prometheus answers
 * over HTTP, and a plugin has no network, deliberately and permanently — so
 * both calls here are made by the *server* on the plugin's behalf, under the
 * NETWORK_REQUEST capability a person accepted, against the Prometheus the
 * workspace named.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept TEXT_ENCODING and NETWORK_REQUEST.
 * 2. Set `url` to the server's root — `http://prometheus:9090`, or wherever
 *    the installation's proxy rules allow the server to reach.
 * 3. A bare Prometheus needs nothing more. One behind auth takes `token` — sent
 *    as a Bearer token on its own, or as Basic `username:token` when `username`
 *    is set, which is how a Grafana Cloud endpoint is spoken to.
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

/** The server's root, without its trailing slash. */
function root(settings) {
  const configured = settings.url;
  if (typeof configured !== 'string' || configured.length === 0) {
    throw new Error("the plugin's url parameter is not set, and every Prometheus call needs it");
  }
  return configured.endsWith('/') ? configured.slice(0, -1) : configured;
}

/** The headers a call goes out with: json asked for, and whichever auth the parameters describe. */
function headers(settings) {
  const built = { accept: 'application/json' };
  const token = settings.token;
  const username = settings.username;
  if (typeof username === 'string' && username.length > 0) {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('a username is set but no token to go with it');
    }
    const pair = orknux.encoding.encodeBase64(`${username}:${token}`);
    if (pair.error !== undefined) {
      throw new Error(`could not encode the credential: ${pair.error}`);
    }
    built.authorization = 'Basic ' + pair.base64;
  } else if (typeof token === 'string' && token.length > 0) {
    built.authorization = 'Bearer ' + token;
  }
  return built;
}

/**
 * One read of Prometheus's API, answered or thrown.
 *
 * Prometheus wraps every answer in `{status, data}` and says why not in its
 * own `error` field — often beside a 4xx, but checked on its own because a
 * proxy in front can turn anything into a 200.
 */
function read(settings, path) {
  const answered = orknux.http.get(root(settings) + path, headers(settings));
  if (answered.error !== undefined) {
    throw new Error(`could not reach Prometheus: ${answered.error}`);
  }
  const said = at(answered.json, 'error');
  if (answered.status >= 400 || at(answered.json, 'status') === 'error') {
    throw new Error(
      `Prometheus answered ${answered.status}${typeof said === 'string' ? ': ' + said : ''} for ${path.split('?')[0]}`,
    );
  }
  return at(answered.json, 'data');
}

export default class Prometheus extends OrknuxPlugin {

  id() {
    return 'prometheus';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'url',
        description: 'The server\'s root, e.g. http://prometheus:9090.',
        type: 'string',
        required: true,
      }),
      new OrknuxParameter({
        name: 'username',
        description:
          'Set only where the server wants Basic auth - a Grafana Cloud instance id, ' +
          'say - with the token as the password.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'token',
        description:
          'A Bearer token on its own, the Basic password beside a username, ' +
          'or empty for a Prometheus that asks nothing.',
        type: 'string',
        required: false,
        secret: true,
      }),
    ];
  }

  permissions() {
    // None. Turning `username:token` into base64 is `orknux.encoding`'s job now,
    // and that is ungranted — it reaches nothing, the way a digest does not.
    return [];
  }

  capabilities() {
    // The widest capability there is, asked for because this plugin is about
    // exactly one outside service: every request goes to the url above.
    return ['NETWORK_REQUEST'];
  }

  /*
   * One shape, and one deliberate absence.
   *
   * `query` keeps answering a map because its result genuinely has no fixed
   * form: a vector element carries `metric` keyed by whatever labels the
   * series happens to have, and an array here needs an `of` that nothing
   * could supply. Prometheus's own shape, passed through, is the honest
   * answer — and it is the one every PromQL reader already knows.
   */
  objects() {
    return [
      new OrknuxObject({
        name: 'Metrics',
        description: 'The metric names a server knows — the vocabulary a query is written in.',
        properties: [
          { name: 'metrics', kind: 'array', of: 'string', description: 'Alphabetical, capped by limit.' },
          { name: 'count', kind: 'number', description: 'How many there were before limit capped them.' },
        ],
      }),
    ];
  }

  /* The agents' surface: both calls, fronted. Proxies, so everything stays the functions' own. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'listMetrics' }),
      new OrknuxFunctionTool({ function: 'query' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'listMetrics',
        description:
          'Lists the metric names the server knows, alphabetically - the vocabulary a query is written ' +
          'in. match narrows the list to the series a selector matches, like {job="api"} - or pass an ' +
          'empty match for everything. Answers the names and how many there were before limit capped ' +
          'them; leave limit out for no cap.',
        params: [
          { name: 'match', type: 'string' },
          { name: 'limit', type: 'number', required: false, default: 0 },
        ],
        returnType: 'Metrics',
        run: (match, limit) => {
          let path = '/api/v1/label/__name__/values';
          if (typeof match === 'string' && match.length > 0) {
            path += `?match[]=${encodeURIComponent(match)}`;
          }
          const names = read(this.settings, path);
          const metrics = Array.isArray(names) ? names : [];
          /* Zero is this one's real answer rather than a sentinel: no cap. */
          const capped = limit > 0 ? metrics.slice(0, limit) : metrics;
          return { metrics: capped, count: metrics.length };
        },
      }),

      new OrknuxFunction({
        name: 'query',
        description:
          'Executes a PromQL expression as an instant query: rate(http_requests_total[5m]), ' +
          'up{job="api"}, histogram_quantile(0.99, ...) - anything the expression browser takes. ' +
          'Evaluated now, or at `time` when one is given (RFC 3339 or a unix timestamp). Answers Prometheus\'s own result: resultType (vector, matrix, scalar or string) and ' +
          'result, where each vector element is {metric: {labels}, value: [time, "value"]}.',
        params: [
          { name: 'promql', type: 'string' },
          { name: 'time', type: 'string', required: false, default: '' },
        ],
        returnType: 'map',
        run: (promql, time) => {
          if (typeof promql !== 'string' || promql.trim().length === 0) {
            throw new Error('there is no expression to execute');
          }
          let path = `/api/v1/query?query=${encodeURIComponent(promql)}`;
          if (typeof time === 'string' && time.length > 0) {
            path += `&time=${encodeURIComponent(time)}`;
          }
          const data = read(this.settings, path);
          /*
           * The result is Prometheus's own shape, passed through: a value like
           * `[1726000000, "0.95"]` is what every PromQL reader already knows
           * how to read, and flattening it would only invent a second dialect.
           */
          return { resultType: at(data, 'resultType'), result: at(data, 'result') };
        },
      }),
    ];
  }
}
