# Web Search

A model asked about anything that happened after it was trained has two honest
moves: say it does not know, or look. This is the looking — one `search`,
fronted as a tool, answering title, url and a readable snippet per result.

Which index answers is the workspace's choice:

**tavily** is a search API built for models rather than for browsers: what
comes back per result is cleaned, quotable content instead of the marketing
fragment a search page shows. Turn `answer` on and it composes a short summary
over the results as well, at more than a plain search costs.

**brave** is an independent index answering ranked web results the way a search
page does, with further excerpts from the same page where it has them. Cheaper
per query, and the closest thing left to a plain web search.

Set `backend` to one of the two, put that service's key in a workspace variable
and point `apiKey` at it — it is a secret, so a variable is the only answer it
takes — and accept `NETWORK_REQUEST`. The server makes the call; the plugin
never holds the key.

## Two searches, one key

| Function | Answers |
|---|---|
| `search(query, limit)` | Pages: `title`, `url`, a readable `snippet`, and `answer` where the workspace turned that on. |
| `searchImages(query, limit)` | Pictures: the image `url`, what it is, the `source` page and a `thumbnail`. |

Both use the same `backend` and the same `apiKey`, so turning on image search
costs nothing beyond what is already configured.

### Getting a picture in front of somebody

An image `url` goes straight to `slack_uploadFromUrl`, which copies the picture
into a channel rather than posting a link somebody has to click:

```
web_searchImages("Marvel's Wolverine PS5 cover art", 3)
  -> { images: [{ url: 'https://…/cover.jpg', title: 'Cover art', source: '…' }] }

slack_uploadFromUrl(channel, 'https://…/cover.jpg', 'cover.jpg', 'Here it is', threadTs)
```

The bytes never pass through the sandbox or through a model: the server
fetches the url and hands it to Slack.

### What each backend can actually do

**Brave has an image index.** `search/images` answers a caption, the page the
picture sits on, and a thumbnail — the whole shape.

**Tavily has none.** `include_images` adds pictures to an ordinary web search,
so `title` is a description of the picture rather than a caption somebody
wrote, and `source` and `thumbnail` come back `null`. That is the backend
saying it does not know, rather than this plugin inventing something.

Worth knowing when choosing: if pictures matter, Brave is the one that indexes
them.

## The two free alternatives, and why neither is here

Worth writing down so nobody spends an afternoon rediscovering it:

**DuckDuckGo has no search API.** What it publishes is the Instant Answer API,
which returns the boxed abstract above the results and no ranked links at all —
useful for "what is X", useless as web search. The only way to its actual
results is to scrape `html.duckduckgo.com`, which is unofficial, rate-limited,
against the spirit of their terms, and breaks whenever the markup moves.

**Bing's search API no longer exists.** Microsoft retired it on 11 August 2025.
Its replacement, "Grounding with Bing Search", hands an agent grounded prose
with citations rather than results a caller can read, and wants an Azure AI
Foundry project standing behind it.

A third backend is one more function shaped like `tavily()` or `brave()`, its
name in `BACKENDS`, and a line in the dispatch — Google Programmable Search
would be about twenty of them.
