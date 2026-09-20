/*
 * Web search, as a plugin — one call, and a workspace picks whose index answers it.
 *
 * A model asked about anything that happened after it was trained has two
 * honest moves: say it does not know, or look. This is the looking. A plugin
 * has no network, deliberately and permanently, so the request is made by the
 * *server* on the plugin's behalf, under the NETWORK_REQUEST capability a
 * person accepted, against whichever search API the `backend` parameter names.
 *
 * ## The two backends
 *
 * - **tavily** — a search API built for models rather than for browsers: what
 *   comes back per result is cleaned, quotable content instead of the
 *   marketing fragment a search page shows, and it will compose a short answer
 *   over the results when `answer` is on.
 * - **brave** — an independent index, answering ranked web results the way a
 *   search page does, with further excerpts from the same page where it has
 *   them. Cheaper per query, and the closest thing left to a plain web search.
 *
 * Both want a key, and the same `apiKey` parameter holds whichever one the
 * chosen backend takes — one backend is configured at a time, so a second key
 * would only be a second thing to keep right.
 *
 * ## The two that are not here
 *
 * Worth writing down so nobody spends an afternoon rediscovering it:
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
 * A third backend is one more function shaped like [tavily] or [brave], its
 * name in [BACKENDS], and a line in the dispatch below. Google Programmable
 * Search would be about twenty of them.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept NETWORK_REQUEST.
 * 2. Set `backend` to `tavily` or `brave`.
 * 3. Put that service's key in one of the workspace's variables and point
 *    `apiKey` at it. It is declared as a secret, so a variable is the only
 *    answer it takes.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Every index this file knows how to ask, and what a refusal names. */
const BACKENDS = ['tavily', 'brave'];

/** More results than anybody reads, and what both APIs cap a page at. */
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

/**
 * One search, asked of Brave. The key travels in a header rather than the
 * query string, which is the one thing to get right here.
 *
 * `extra_snippets` are further excerpts from the same page where Brave has
 * them; joined onto the description rather than answered beside it, because
 * what a reader wants is the passage, not its provenance within the page.
 */
function brave(key, query, limit) {
  const answered = orknux.http.get(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
    { accept: 'application/json', 'x-subscription-token': key },
  );
  if (answered.error !== undefined) {
    throw new Error(`could not reach Brave: ${answered.error}`);
  }
  if (answered.status >= 400) {
    /* Brave wraps its refusal in `error`, with the sentence under `detail`. */
    const refused = at(answered.json, 'error');
    const said = at(refused, 'detail') ?? at(at(refused, 'meta'), 'message');
    throw new Error(
      `Brave answered ${answered.status}${typeof said === 'string' ? ': ' + said : ''}`,
    );
  }

  return {
    /* Brave returns results and nothing composed over them. */
    answer: null,
    results: (at(at(answered.json, 'web'), 'results') ?? []).map((one) => {
      const described = at(one, 'description');
      const more = at(one, 'extra_snippets');
      const passages = [described, ...(Array.isArray(more) ? more : [])].filter(
        (part) => typeof part === 'string' && part.length > 0,
      );
      return {
        title: at(one, 'title'),
        url: at(one, 'url'),
        snippet: passages.length > 0 ? passages.join(' … ') : null,
        score: null,
        published: at(one, 'page_age'),
      };
    }),
  };
}

/**
 * Brave's image index, which answers the picture and where it came from.
 *
 * A different endpoint from the web one and a different shape: the result's
 * `url` is the *page* the picture sits on, and the picture itself is under
 * `properties.url`. Answered the other way round here, because what a caller
 * wants is the image - the page is where it came from.
 */
function braveImages(key, query, limit) {
  const answered = orknux.http.get(
    `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=${limit}`,
    { accept: 'application/json', 'x-subscription-token': key },
  );
  if (answered.error !== undefined) {
    throw new Error(`could not reach Brave: ${answered.error}`);
  }
  if (answered.status >= 400) {
    const refused = at(answered.json, 'error');
    const said = at(refused, 'detail') ?? at(at(refused, 'meta'), 'message');
    throw new Error(
      `Brave answered ${answered.status}${typeof said === 'string' ? ': ' + said : ''}`,
    );
  }

  return (at(answered.json, 'results') ?? []).map((one) => ({
    url: at(at(one, 'properties'), 'url') ?? at(one, 'url'),
    title: at(one, 'title'),
    source: at(one, 'source') ?? at(one, 'url'),
    thumbnail: at(at(one, 'thumbnail'), 'src'),
  }));
}

/**
 * Tavily's images, which come out of a search rather than an image index.
 *
 * It has no image endpoint: `include_images` adds pictures to an ordinary
 * search, and `include_image_descriptions` makes them objects with a sentence
 * instead of bare urls. So the title is a description of the picture rather
 * than a caption somebody wrote, there is no separate thumbnail, and the page
 * it came from is not answered at all - nulls rather than invention.
 */
function tavilyImages(key, query, limit) {
  const answered = orknux.http.request({
    url: 'https://api.tavily.com/search',
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: {
      query: query,
      max_results: limit,
      include_images: true,
      include_image_descriptions: true,
    },
  });
  if (answered.error !== undefined) {
    throw new Error(`could not reach Tavily: ${answered.error}`);
  }
  if (answered.status >= 400) {
    const said = at(answered.json, 'detail') ?? at(answered.json, 'error');
    throw new Error(
      `Tavily answered ${answered.status}${typeof said === 'string' ? ': ' + said : ''}`,
    );
  }

  return (at(answered.json, 'images') ?? []).slice(0, limit).map((one) =>
    typeof one === 'string'
      ? { url: one, title: null, source: null, thumbnail: null }
      : { url: at(one, 'url'), title: at(one, 'description'), source: null, thumbnail: null },
  );
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
        name: 'backend',
        description: 'Whose index answers a search.',
        type: 'string',
        required: true,
        /*
         * The two this file knows how to ask, declared rather than described.
         * A choice that cannot be typed cannot be mistyped — and where the
         * settings page draws a picker for it, the refusal below stops being
         * something anybody meets.
         */
        options: BACKENDS,
      }),
      new OrknuxParameter({
        name: 'apiKey',
        description:
          'The key the backend above takes — a Tavily API key, or a Brave subscription token.',
        type: 'string',
        required: true,
        secret: true,
      }),
      new OrknuxParameter({
        name: 'answer',
        description:
          'Ask for a short answer composed over the results as well. Tavily only, ' +
          'and off by default: it costs more than a plain search.',
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
    // installation's proxy rules; what this file asks for is one of the two
    // search APIs above and nothing else.
    return ['NETWORK_REQUEST'];
  }

  /* The shapes a search answers, so a caller need not read this file to know them. */
  objects() {
    return [
      new OrknuxObject({
        name: 'Result',
        description: 'One page a search turned up.',
        properties: [
          { name: 'title', kind: 'string', description: 'The title, as the index has it.' },
          { name: 'url', kind: 'string', description: 'Cite this rather than answering from memory.' },
          { name: 'snippet', kind: 'string', description: 'A readable passage from the page.' },
          {
            name: 'score',
            kind: 'number',
            description: 'How well it matched, where the backend says so. Null from Brave.',
          },
          { name: 'published', kind: 'string', description: 'When the page is dated, where that is known.' },
        ],
      }),

      new OrknuxObject({
        name: 'Image',
        description: 'One picture a search found, and where it came from.',
        properties: [
          {
            name: 'url',
            kind: 'string',
            description:
              'The picture itself. Hand it to slack_uploadFromUrl and the channel gets the ' +
              'image rather than a link to it.',
          },
          {
            name: 'title',
            kind: 'string',
            description:
              'What it is: a caption where the backend had one, a description of the picture ' +
              'where it did not.',
          },
          {
            name: 'source',
            kind: 'string',
            description: 'The page it sits on, for crediting it. Null where the backend does not say.',
          },
          {
            name: 'thumbnail',
            kind: 'string',
            description: 'A smaller copy, where there is one. Null otherwise.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'ImageSearch',
        description: 'What an image search came to.',
        properties: [
          { name: 'backend', kind: 'string', description: 'Which index answered.' },
          { name: 'query', kind: 'string', description: 'What was asked, after trimming.' },
          { name: 'images', kind: 'array', of: 'Image', description: 'Best first, capped by limit.' },
        ],
      }),

      new OrknuxObject({
        name: 'Search',
        description: 'What one web search came to.',
        properties: [
          { name: 'backend', kind: 'string', description: 'Which index answered: tavily or brave.' },
          { name: 'query', kind: 'string', description: 'What was actually searched for.' },
          {
            name: 'answer',
            kind: 'string',
            description: 'A summary composed over the results, where the workspace turned that on.',
          },
          { name: 'results', kind: 'array', of: 'Result', description: 'Best first, capped by limit.' },
        ],
      }),
    ];
  }

  /* The agents' surface: both calls, fronted. Proxies, so everything stays the functions' own. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'search' }),
      new OrknuxFunctionTool({ function: 'searchImages' }),
    ];
  }

  /*
   * Which index to ask, matched forgivingly and refused by name.
   *
   * The settings page draws a picker for a parameter that names its values, so
   * a typo is no longer reachable from the form - but a workspace variable can
   * hold anything, and answering the wrong index quietly is worse than being
   * told. Shared by both searches rather than written twice.
   */
  backend() {
    const named =
      typeof this.settings.backend === 'string' ? this.settings.backend.trim().toLowerCase() : '';
    if (!BACKENDS.includes(named)) {
      throw new Error(
        named.length === 0
          ? `the plugin's backend parameter is not set: it takes ${BACKENDS.join(' or ')}`
          : `no search backend called ${named}: it takes ${BACKENDS.join(' or ')}`,
      );
    }
    return named;
  }

  /** The credential that backend takes, or the sentence naming what is missing. */
  key(named) {
    const held = this.settings.apiKey;
    if (typeof held !== 'string' || held.length === 0) {
      throw new Error(`the plugin's apiKey parameter is not set, and ${named} needs one`);
    }
    return held;
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'searchImages',
        description:
          'Searches the web for pictures and answers the url of each, what it is, and the page ' +
          'it came from. Use it when somebody asks what something looks like, for cover art, a ' +
          'screenshot, a photograph, a logo - anything where a picture is the answer and a ' +
          'paragraph is not. Every url can go straight to slack_uploadFromUrl, which copies the ' +
          'picture into a channel so people see it rather than a link they have to click. limit ' +
          'caps how many come back, 5 if not given. Brave answers a caption, the page and a ' +
          'thumbnail; Tavily has no image index and answers pictures from an ordinary search, so ' +
          'its title is a description and its source and thumbnail are null.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number', required: false, default: DEFAULT_RESULTS },
        ],
        returnType: 'ImageSearch',
        run: (query, limit) => {
          const asked = typeof query === 'string' ? query.trim() : '';
          if (asked.length === 0) {
            throw new Error('there is nothing to search for');
          }

          const named = this.backend();
          const key = this.key(named);
          const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);

          return {
            backend: named,
            query: asked,
            images: named === 'tavily'
              ? tavilyImages(key, asked, capped)
              : braveImages(key, asked, capped),
          };
        },
      }),

      new OrknuxFunction({
        name: 'search',
        description:
          'Searches the web and answers the results: title, url and a readable snippet of each page, ' +
          'best first. Use it for anything that happened recently, anything you are unsure of, and ' +
          'anything the user asks you to look up - then read the snippets and cite the urls rather ' +
          `than answering from memory. limit caps how many come back, ${DEFAULT_RESULTS} if not given. ` +
          'answer carries a summary composed over the results where the workspace turned that on, ' +
          'and is null where it did not.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number', required: false, default: DEFAULT_RESULTS },
        ],
        returnType: 'Search',
        run: (query, limit) => {
          const asked = typeof query === 'string' ? query.trim() : '';
          if (asked.length === 0) {
            throw new Error('there is nothing to search for');
          }

          const named = this.backend();
          const key = this.key(named);

          /* The server put the default in, so this only has to cap it. */
          const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
          const found =
            named === 'tavily'
              ? tavily(key, asked, capped, this.settings.answer === true)
              : brave(key, asked, capped);

          return {
            backend: named,
            query: asked,
            answer: found.answer,
            results: found.results,
          };
        },
      }),
    ];
  }
}
