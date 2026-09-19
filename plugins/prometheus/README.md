# Prometheus

The question "what is the system doing", asked from a workflow's condition or
an agent's hand: is the error rate above the line, is this job up, what
metrics are there to ask about at all.

Point `url` at the Prometheus server's root; a bare Prometheus needs nothing
more, one behind auth takes `token` (Bearer on its own, Basic with
`username`). Calls run through the server under `NETWORK_REQUEST`, so the
installation's proxy rules govern where they may go.
