/*
 * Web search, as a plugin.
 *
 * A model asked about anything that happened after it was trained has two
 * honest moves: say it does not know, or look. This is the looking. A plugin
 * has no network, deliberately and permanently, so the request is made by the
 * *server* on the plugin's behalf, under the NETWORK_REQUEST capability a
 * person accepted, against Tavily.
 *
 * ## Why Tavily, and why it is the only one here
 *
 * Tavily is a search API built for models rather than for browsers: it answers
 * cleaned, quotable content per result instead of the marketing fragment a
 * search page shows, and will compose a short answer over the results when
 * `answer` is on.
 *
 * The obvious free alternatives are both gone, and it is worth writing down
 * why so nobody spends an afternoon rediscovering it:
 *
 * - **DuckDuckGo has no search API.** What it publishes is the Instant Answer
 *   API, which returns the boxed abstract above the results and no ranked
 *   links at all — useful for "what is X", useless as web search. The only way
 *   to its actual results is to scrape `html.duckduckgo.com`, which is
 *   unofficial, rate-limited, against the spirit of their terms, and breaks
 *   whenever the markup moves.
 * - **Bing's search API no longer exists.** Microsoft retired it on 11 August
 *   2025. What replaced it, "Grounding with Bing Search", hands an agent
 *   grounded prose with citations rather than results a caller can read, and
 *   wants an Azure AI Foundry project standing behind it.
 *
 * So this file asks one service. Adding a second — Brave and Google
 * Programmable Search both publish a documented key-and-GET API — would be one
 * more function shaped like [tavily] below, a name beside it, and a parameter
 * saying which to ask. The shape is left ready for that and nothing more.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept NETWORK_REQUEST.
 * 2. Put a Tavily key in one of the workspace's variables and point `apiKey`
 *    at it. It is declared as a secret, so a variable is the only answer it
 *    takes.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** More results than anybody reads, and what the API caps a page at. */
const MAX_RESULTS = 20;

/** What a search brings back when nobody said how much. */
const DEFAULT_RESULTS = 5;

/** A nested field, or null rather than a thrown error on the way down. */
function at(holder, name) {
  if (holder === null || typeof holder !== 'object') {
    return null;
  }
  const held = holder[name];
  return held === undefined ? null : held;
}

/**
 * One search, asked of Tavily.
 *
 * `search_depth` stays `basic`: advanced costs a second credit and re-reads
 * each page, which is a thing to ask for deliberately rather than every time.
 */
function tavily(key, query, limit, wantAnswer) {
  const answered = orknux.http.request({
    url: 'https://api.tavily.com/search',
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: {
      query: query,
      max_results: limit,
      search_depth: 'basic',
      include_answer: wantAnswer,
    },
  });
  if (answered.error !== undefined) {
    throw new Error(`could not reach Tavily: ${answered.error}`);
  }
  if (answered.status >= 400) {
    /* Tavily says why in `detail` on a 4xx and in `error` on the rest. */
    const said = at(answered.json, 'detail') ?? at(answered.json, 'error');
    throw new Error(
      `Tavily answered ${answered.status}${typeof said === 'string' ? ': ' + said : ''}`,
    );
  }

  const found = answered.json;
  return {
    answer: at(found, 'answer'),
    results: (at(found, 'results') ?? []).map((one) => ({
      title: at(one, 'title'),
      url: at(one, 'url'),
      snippet: at(one, 'content'),
      score: at(one, 'score'),
      published: at(one, 'published_date'),
    })),
  };
}

export default class Web extends OrknuxPlugin {

  id() {
    return 'web';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'apiKey',
        description: 'A Tavily API key, which every search is made with.',
        type: 'string',
        required: true,
        secret: true,
      }),
      new OrknuxParameter({
        name: 'answer',
        description:
          'Ask Tavily to compose a short answer over the results as well. ' +
          'Off by default: it costs more than a plain search.',
        type: 'boolean',
        required: false,
      }),
    ];
  }

  permissions() {
    // None: there is no hashing and no encoding here, only a request and the
    // reading of what came back.
    return [];
  }

  capabilities() {
    // The widest capability there is. Where a request may get to is the
    // installation's proxy rules; what this file asks for is one search API
    // and nothing else.
    return ['NETWORK_REQUEST'];
  }

  /* The agents' surface: the one call, fronted. A proxy, so everything stays the function's own. */
  tools() {
    return [new OrknuxFunctionTool({ function: 'search' })];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'search',
        description:
          'Searches the web and answers the results: title, url and a readable snippet of each page, ' +
          'best first. Use it for anything that happened recently, anything you are unsure of, and ' +
          'anything the user asks you to look up - then read the snippets and cite the urls rather ' +
          'than answering from memory. limit caps how many come back, 0 for the default of ' +
          `${DEFAULT_RESULTS}. answer carries a composed summary over the results where the workspace ` +
          'turned that on, and is null where it did not.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (query, limit) => {
          const asked = typeof query === 'string' ? query.trim() : '';
          if (asked.length === 0) {
            throw new Error('there is nothing to search for');
          }

          const key = this.settings.apiKey;
          if (typeof key !== 'string' || key.length === 0) {
            throw new Error("the plugin's apiKey parameter is not set, and every search needs it");
          }

          const capped =
            typeof limit === 'number' && limit > 0 ? Math.min(limit, MAX_RESULTS) : DEFAULT_RESULTS;
          const found = tavily(key, asked, capped, this.settings.answer === true);

          return {
            query: asked,
            answer: found.answer,
            results: found.results,
          };
        },
      }),
    ];
  }
}
