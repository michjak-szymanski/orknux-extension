# Microsoft Teams

Teams has no Socket Mode, so the receiving half is a Teams **outgoing
webhook** — the one delivery Teams offers that needs no Azure application, no
Graph consent and no subscription to renew — pointed at one of this
installation's webhook triggers, with the HMAC verified by a function here.
The sending half posts back through an incoming webhook the workspace names.

Wrapped as functions for workflows and fronted as tools for agents, like
every plugin in this repository.
