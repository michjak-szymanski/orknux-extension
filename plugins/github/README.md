# GitHub

GitHub is not a connection type and needs no trigger of its own: what an
installation already has is a webhook trigger, and this plugin is the other
half — verify the delivery is really GitHub's, then ask back. Search issues
and code, read a file at a ref, check what a build came to, and leave a
comment where the conversation is.

The functions serve workflows; the tools front them for agents, so a model
can work a repository the way a person does — look first, then speak. Calls
go through the server under `NETWORK_REQUEST`, against the token a workspace
variable holds.
