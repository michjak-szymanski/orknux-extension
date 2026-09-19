# Web Search

A model asked about anything that happened after it was trained has two honest
moves: say it does not know, or look. This is the looking — one `search`,
fronted as a tool, answering title, url and a readable snippet per result.

Searches go through **Tavily**, a search API built for models rather than for
browsers: what comes back per result is cleaned, quotable content instead of
the marketing fragment a search page shows. Turn `answer` on and it composes a
short summary over the results as well, at more than a plain search costs.

Put a Tavily key in a workspace variable and point `apiKey` at it — it is a
secret, so a variable is the only answer it takes — and accept
`NETWORK_REQUEST`. The server makes the call; the plugin never holds the key.

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

Adding a second backend — Brave and Google Programmable Search both publish a
documented key-and-GET API — is one more function shaped like `tavily()`, a
name beside it, and a parameter saying which to ask. The file is left ready for
that and nothing more.
