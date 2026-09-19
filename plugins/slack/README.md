# Slack

The whole Slack surface, wrapped so workflows and agents call it by name: read
a thread, follow a permalink, say who an id is, resolve a mention, post,
react, search, and the one question the raw API never answers on its own —
*is this the first reply in the thread*, written to be a workflow condition.

Every call goes through the server under a capability somebody accepted, and
through a connection the workspace pointed it at — the plugin never sees a
token. A workspace with two Slacks passes the connection the event came in on
(`trigger.connection`), and the `slack` parameter is the fallback for the
common case of one.

Search is Slack's own caveat, passed through honestly: `search.messages`
answers only for a user token, so the connection's **User Token** field is
what a search runs on.
