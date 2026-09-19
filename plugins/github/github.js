/*
 * GitHub, as a plugin.
 *
 * GitHub is not a connection type and there is no GitHub trigger. What this
 * installation already had was a webhook trigger that answers on a path, checks
 * an arriving body against a shape, and asks a function whether the caller may
 * start anything. The first half of this file is that function, and knows
 * GitHub's three payloads well enough to say what one of them is about. The
 * second half faces the other way: functions that ask GitHub's REST API
 * questions — and post answers back — fronted as tools so an agent can work a
 * repository the way a person at the site would.
 *
 * The whole integration is therefore a file somebody loads and a workspace
 * points a trigger at. Nothing about GitHub is in the server, which is the point
 * of it being here: a repository host that changes its signature scheme is a new
 * version of this file, not a release.
 *
 * ## Setting one up
 *
 * 1. Load this plugin (Plugins, Load a plugin) and accept TEXT_ENCODING.
 * 2. Put the webhook secret in one of the workspace's variables, and point the
 *    plugin's `webhookSecret` parameter at it. It is declared as a secret, so a
 *    typed-in value is refused — a variable is the only answer it takes.
 * 3. Make an object with `repository` and `sender` on it, which is what every
 *    payload below has in common and is what the trigger checks an arriving body
 *    against.
 * 4. Make a webhook trigger on that object, authenticating with the function
 *    `github_verify`.
 * 5. In the repository's settings, add a webhook pointing at the trigger's URL,
 *    content type `application/json`, with that same secret, sending pull
 *    requests, pull request review comments and pushes.
 *
 * The run is handed the body, and `webhook.headers` beside it — which is where
 * GitHub says which event this is. `github_describe` turns the pair into one
 * flat answer a condition or an action can read.
 *
 * ## The API surface
 *
 * The webhook half needs no credential of GitHub's; everything else here does.
 * Those functions ask GitHub's REST API — search, repositories, pull requests,
 * commits, builds, files, comments, and the Copilot agent tasks — and a plugin
 * has no network, deliberately and permanently. So each call is made by the
 * *server* on the plugin's behalf, under the NETWORK_REQUEST capability a
 * person accepted, authenticated with the `token` parameter: a fine-grained
 * personal access token (or a GitHub App user token) with read access to the
 * repositories it should see, and write access to pull requests where the
 * commenting and the agent tasks are wanted. Declared as a secret, so it lives
 * in a workspace variable, never typed into a page.
 *
 * `organization` is the owner every function falls back to when a call does not
 * name one — so "search the backlog" does not need the org spelled into every
 * query — and search queries that do not say where to look are scoped to it.
 * `apiUrl` points the whole surface at a GitHub Enterprise Server instead of
 * api.github.com.
 *
 * The agent-task functions drive GitHub's Copilot cloud agent. That API is in
 * public preview and only answers a *user* token — a GitHub App installation
 * token is refused by GitHub, not by this file. Steering a task that is already
 * running is done the way GitHub does it: a comment on the task's pull request
 * mentioning @copilot, which is what `messageAgentTask` posts.
 *
 * ## How the plugin is laid out
 *
 * Two libraries travel with this file, and `libraries()` declares them.
 * `lib/hashing.js` is SHA-256 and HMAC written out longhand — the sandbox has
 * no crypto, on purpose, and there is no permission that could be asked for
 * that would open a door to the host. Hashing costs roughly a thousand
 * statements per 64 bytes, so a payload in the hundreds of kilobytes will run
 * out of the sandbox's statement budget and the caller will be refused — set
 * the repository's webhook to send the events below rather than everything,
 * and nothing it sends comes close. `lib/api.js` is the door every REST call
 * goes through, and the readers every answer is picked apart with. What stays
 * in this file is what the plugin *declares*, which is the part somebody
 * loading it reads.
 *
 * Written as JavaScript rather than as TypeScript compiled to it: the server
 * runs JavaScript, and a plugin somebody may need to load in a hurry should not
 * need a build first.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

import { hmacSha256, hex, sameDigest } from './lib/hashing.js';
import {
  at,
  call,
  changedFile,
  escapedPath,
  header,
  ownerOr,
  pageSize,
  read,
  repoNamed,
  repoPath,
  scoped,
  statusError,
} from './lib/api.js';

export default class Github extends OrknuxPlugin {

  id() {
    return 'github';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'webhookSecret',
        description: 'The secret set on the repository\'s webhook, which every delivery is signed with.',
        type: 'string',
        // Optional since the API surface arrived: a workspace that only asks
        // questions of GitHub never sets up a webhook. `verify` answers false
        // while it is unset, which is the safe reading of not knowing.
        required: false,
        // The webhook's own secret. Declared as a secret so it cannot be typed
        // into the plugins page: the only way to answer it is to point at one of
        // the workspace's variables, which is where this installation encrypts
        // what it keeps.
        secret: true,
      }),
      new OrknuxParameter({
        name: 'token',
        description:
          'A GitHub token — fine-grained PAT or App user token — for the API surface. ' +
          'The agent-task functions only answer a user token.',
        type: 'string',
        // Optional the other way round: a workspace that only verifies webhook
        // deliveries never calls the API. Every API function checks for it and
        // says so when it is missing.
        required: false,
        secret: true,
      }),
      new OrknuxParameter({
        name: 'organization',
        description:
          'The owner every function falls back to when a call does not name one, ' +
          'and the org unqualified searches are scoped to.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'apiUrl',
        description:
          'The API root, for a GitHub Enterprise Server (https://ghes.example.com/api/v3). ' +
          'Left empty, it is api.github.com.',
        type: 'string',
        required: false,
      }),
    ];
  }

  permissions() {
    // TextEncoder, and nothing else. GitHub signs the bytes it sent, so the
    // body has to become bytes the same way it was written — UTF-8 — rather
    // than by whatever a hand-rolled loop happens to do with a character
    // outside the ASCII range. A pull request title with an accent in it is
    // not an edge case.
    return ['TEXT_ENCODING'];
  }

  capabilities() {
    // The widest capability there is, asked for because this plugin is about
    // exactly one outside service: every request the functions below make goes
    // to the API root above, which is GitHub's or the GHES the workspace named.
    return ['NETWORK_REQUEST'];
  }

  libraries() {
    // The files that travel with this one — the complete list, shown to
    // whoever loads the plugin. Every relative import above resolves here.
    return ['lib/hashing.js', 'lib/api.js'];
  }

  /*
   * The agents' surface: every API function, fronted. Proxies rather than
   * copies, so the params, return types and implementations stay the
   * functions' own. `verify` and `describe` are deliberately not here — they
   * are the webhook trigger's machinery, and a model has no delivery to check.
   */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'searchPulls' }),
      new OrknuxFunctionTool({ function: 'listRepos' }),
      new OrknuxFunctionTool({ function: 'listFiles' }),
      new OrknuxFunctionTool({ function: 'openPull' }),
      new OrknuxFunctionTool({ function: 'searchCode' }),
      new OrknuxFunctionTool({ function: 'searchCommits' }),
      new OrknuxFunctionTool({ function: 'openCommit' }),
      new OrknuxFunctionTool({ function: 'buildStatus' }),
      new OrknuxFunctionTool({ function: 'openFile' }),
      new OrknuxFunctionTool({ function: 'fileHistory' }),
      new OrknuxFunctionTool({ function: 'createAgentTask' }),
      new OrknuxFunctionTool({ function: 'agentTask' }),
      new OrknuxFunctionTool({ function: 'agentTaskLogs' }),
      new OrknuxFunctionTool({ function: 'messageAgentTask' }),
      new OrknuxFunctionTool({ function: 'comment' }),
      new OrknuxFunctionTool({ function: 'reviewComment' }),
      new OrknuxFunctionTool({ function: 'replyToComment' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'verify',
        description: 'Whether a delivery really came from GitHub, by its HMAC signature.',
        params: [
          { name: 'headers', type: 'map' },
          { name: 'rawBody', type: 'string' },
        ],
        returnType: 'boolean',

        /*
         * The bytes GitHub signed, not the JSON they parse to.
         *
         * `rawBody` is the request exactly as it arrived, which is what the
         * signature is over. Re-serialising the parsed body would reorder keys
         * and drop whitespace, and the digest of that is a digest of something
         * GitHub never sent.
         */
        run: (headers, rawBody) => {
          const secret = this.settings.webhookSecret;
          if (typeof secret !== 'string' || secret.length === 0) {
            // Unset — a workspace that only uses the API surface never answers
            // it. Answering no is the safe reading of not knowing.
            return false;
          }
          if (typeof rawBody !== 'string') {
            return false;
          }

          const sent = header(headers, 'x-hub-signature-256');
          if (sent === null || sent.indexOf('sha256=') !== 0) {
            // Unsigned, or signed with the SHA-1 scheme GitHub still sends in
            // `X-Hub-Signature` for compatibility. Neither is a delivery this
            // will vouch for: accepting the old header would let a caller
            // choose the weaker of the two.
            return false;
          }

          const encoder = new TextEncoder();
          const mine = hex(hmacSha256(encoder.encode(secret), encoder.encode(rawBody)));
          return sameDigest(mine, sent.slice('sha256='.length));
        },
      }),

      new OrknuxFunction({
        name: 'describe',
        description: 'What a delivery is about: its event, who did it, where, and to what.',
        params: [
          { name: 'headers', type: 'map' },
          { name: 'body', type: 'map' },
        ],
        returnType: 'map',

        /*
         * One answer for the three events the webhook is set up to send, so a
         * condition can ask `kind === 'push'` rather than working out which of
         * GitHub's shapes arrived from which fields happen to be present.
         *
         * `event` is a header rather than a body field, which is why the run is
         * handed `webhook.headers` at all. Anything else GitHub might send is
         * described as far as it has anything in common with these — `other`,
         * with the repository and the actor — rather than refused, because a
         * repository whose webhook was set to send everything should not make
         * this throw.
         */
        run: (headers, body) => {
          const event = header(headers, 'x-github-event');
          const repository = at(body, 'repository');
          const pull = at(body, 'pull_request');
          const comment = at(body, 'comment');

          const described = {
            event: event,
            delivery: header(headers, 'x-github-delivery'),
            kind: 'other',
            action: at(body, 'action'),
            repository: at(repository, 'full_name'),
            actor: at(at(body, 'sender'), 'login'),
            title: null,
            url: null,
            number: null,
            ref: null,
            commits: null,
          };

          if (event === 'pull_request') {
            described.kind = 'pull_request';
            described.number = at(body, 'number');
            described.title = at(pull, 'title');
            described.url = at(pull, 'html_url');
          } else if (event === 'pull_request_review_comment') {
            described.kind = 'review_comment';
            described.number = at(pull, 'number');
            described.title = at(comment, 'body');
            described.url = at(comment, 'html_url');
          } else if (event === 'push') {
            described.kind = 'push';
            described.ref = at(body, 'ref');
            const pushed = at(body, 'commits');
            described.commits = Array.isArray(pushed) ? pushed.length : 0;
            described.title = at(at(body, 'head_commit'), 'message');
            described.url = at(body, 'compare');
          }

          return described;
        },
      }),

      new OrknuxFunction({
        name: 'searchPulls',
        description:
          'Searches pull requests the way the site\'s search box does. GitHub\'s search syntax works: ' +
          'repo:owner/name, author:login, is:open, review:required, "an exact phrase". A query that does ' +
          'not say where to look is scoped to the configured organization. Answers the total and the ' +
          'matches - number, title, state, repository, author, updated and a url each. limit caps the ' +
          'matches, 0 for the default.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (query, limit) => {
          const asked = `${scoped(this.settings, query)} is:pr`;
          const found = read(this.settings, {
            path: `/search/issues?q=${encodeURIComponent(asked)}&per_page=${pageSize(limit, 20)}`,
          }).json;
          return {
            total: at(found, 'total_count'),
            matches: (at(found, 'items') ?? []).map((one) => ({
              number: at(one, 'number'),
              title: at(one, 'title'),
              state: at(one, 'state'),
              draft: at(one, 'draft'),
              repository: repoNamed(at(one, 'repository_url')),
              author: at(at(one, 'user'), 'login'),
              updated: at(one, 'updated_at'),
              url: at(one, 'html_url'),
            })),
          };
        },
      }),

      new OrknuxFunction({
        name: 'listRepos',
        description:
          'Lists repositories, most recently pushed first. Pass an organization or user as owner, or an ' +
          'empty owner for the configured organization - and with neither, the repositories the token ' +
          'itself can see. Answers name, fullName, description, defaultBranch, private, pushed and a url ' +
          'each. limit caps the list, 0 for the default.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (owner, limit) => {
          const query = `per_page=${pageSize(limit, 30)}&sort=pushed`;
          const fallback = this.settings.organization;
          const unnamed =
            (typeof owner !== 'string' || owner.length === 0) &&
            (typeof fallback !== 'string' || fallback.length === 0);

          let answered;
          if (unnamed) {
            answered = read(this.settings, { path: `/user/repos?${query}` });
          } else {
            /*
             * An owner is an organization or a user, and the caller should not
             * have to know which: ask as an org first, and read the one 404
             * that means "not an org" as an instruction to ask again.
             */
            const who = encodeURIComponent(ownerOr(this.settings, owner));
            answered = call(this.settings, { path: `/orgs/${who}/repos?${query}` });
            if (answered.status === 404) {
              answered = read(this.settings, { path: `/users/${who}/repos?${query}` });
            } else if (answered.status >= 400) {
              throw statusError(answered, `/orgs/${who}/repos`);
            }
          }

          const held = Array.isArray(answered.json) ? answered.json : [];
          return {
            repos: held.map((one) => ({
              name: at(one, 'name'),
              fullName: at(one, 'full_name'),
              description: at(one, 'description'),
              defaultBranch: at(one, 'default_branch'),
              private: at(one, 'private'),
              pushed: at(one, 'pushed_at'),
              url: at(one, 'html_url'),
            })),
          };
        },
      }),

      new OrknuxFunction({
        name: 'listFiles',
        description:
          'Lists every file path in a repository at one ref, from its git tree. Pass owner and repo (or ' +
          'the repo as owner/name, or an empty owner for the configured organization) and a branch, tag ' +
          'or commit sha - or an empty ref for the default branch. Answers the ref read, the paths, and ' +
          'truncated=true where the tree was too large for GitHub to give whole.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'ref', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, ref) => {
          const base = repoPath(this.settings, owner, repo);
          let marked = ref;
          if (typeof marked !== 'string' || marked.length === 0) {
            marked = at(read(this.settings, { path: base }).json, 'default_branch');
          }
          const tree = read(this.settings, {
            path: `${base}/git/trees/${encodeURIComponent(marked)}?recursive=1`,
          }).json;
          const files = (at(tree, 'tree') ?? [])
            .filter((one) => at(one, 'type') === 'blob')
            .map((one) => at(one, 'path'));
          return { ref: marked, files: files, count: files.length, truncated: at(tree, 'truncated') === true };
        },
      }),

      new OrknuxFunction({
        name: 'openPull',
        description:
          'Opens one pull request whole: title, body, state, draft, merged, author, baseRef, headRef, ' +
          'headSha, mergeable, additions, deletions, url - and its changed files, each with the patch ' +
          'GitHub shows as the diff. Pass owner and repo (or the repo as owner/name, or an empty owner ' +
          'for the configured organization) and the PR number.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'number', type: 'number' },
        ],
        returnType: 'map',
        run: (owner, repo, number) => {
          const base = repoPath(this.settings, owner, repo);
          const pull = read(this.settings, { path: `${base}/pulls/${number}` }).json;
          const files = read(this.settings, { path: `${base}/pulls/${number}/files?per_page=100` }).json;
          return {
            number: at(pull, 'number'),
            title: at(pull, 'title'),
            body: at(pull, 'body'),
            state: at(pull, 'state'),
            draft: at(pull, 'draft'),
            merged: at(pull, 'merged'),
            author: at(at(pull, 'user'), 'login'),
            baseRef: at(at(pull, 'base'), 'ref'),
            headRef: at(at(pull, 'head'), 'ref'),
            headSha: at(at(pull, 'head'), 'sha'),
            mergeable: at(pull, 'mergeable'),
            additions: at(pull, 'additions'),
            deletions: at(pull, 'deletions'),
            url: at(pull, 'html_url'),
            files: (Array.isArray(files) ? files : []).map(changedFile),
          };
        },
      }),

      new OrknuxFunction({
        name: 'searchCode',
        description:
          'Searches code the way the site\'s search box does. GitHub\'s qualifiers work: repo:owner/name, ' +
          'path:src, language:go, filename:Dockerfile. A query that does not say where to look is scoped ' +
          'to the configured organization. Answers the total and the matches - repository, path, url and ' +
          'the matching fragments each. limit caps the matches, 0 for the default.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (query, limit) => {
          const found = read(this.settings, {
            path: `/search/code?q=${encodeURIComponent(scoped(this.settings, query))}&per_page=${pageSize(limit, 20)}`,
            // The variant that carries the matching fragments, which are the
            // half of a code search worth reading.
            accept: 'application/vnd.github.text-match+json',
          }).json;
          return {
            total: at(found, 'total_count'),
            matches: (at(found, 'items') ?? []).map((one) => ({
              repository: at(at(one, 'repository'), 'full_name'),
              path: at(one, 'path'),
              url: at(one, 'html_url'),
              fragments: (at(one, 'text_matches') ?? []).map((match) => at(match, 'fragment')),
            })),
          };
        },
      }),

      new OrknuxFunction({
        name: 'searchCommits',
        description:
          'Searches commit messages. GitHub\'s qualifiers work: repo:owner/name, author:login, ' +
          'committer-date:>2026-01-01. A query that does not say where to look is scoped to the ' +
          'configured organization. Answers the total and the matches - repository, sha, message, ' +
          'author, date and a url each. limit caps the matches, 0 for the default.',
        params: [
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (query, limit) => {
          const found = read(this.settings, {
            path: `/search/commits?q=${encodeURIComponent(scoped(this.settings, query))}&per_page=${pageSize(limit, 20)}`,
          }).json;
          return {
            total: at(found, 'total_count'),
            matches: (at(found, 'items') ?? []).map((one) => ({
              repository: at(at(one, 'repository'), 'full_name'),
              sha: at(one, 'sha'),
              message: at(at(one, 'commit'), 'message'),
              author: at(at(at(one, 'commit'), 'author'), 'name'),
              date: at(at(at(one, 'commit'), 'author'), 'date'),
              url: at(one, 'html_url'),
            })),
          };
        },
      }),

      new OrknuxFunction({
        name: 'openCommit',
        description:
          'Opens one commit whole: message, author, date, parents, additions, deletions, url - and its ' +
          'changed files, each with the patch GitHub shows as the diff. Pass owner and repo (or the repo ' +
          'as owner/name, or an empty owner for the configured organization) and the sha, or a ref that ' +
          'names one.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'sha', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, sha) => {
          const base = repoPath(this.settings, owner, repo);
          const commit = read(this.settings, {
            path: `${base}/commits/${encodeURIComponent(sha)}`,
          }).json;
          return {
            sha: at(commit, 'sha'),
            message: at(at(commit, 'commit'), 'message'),
            author: at(at(at(commit, 'commit'), 'author'), 'name'),
            login: at(at(commit, 'author'), 'login'),
            date: at(at(at(commit, 'commit'), 'author'), 'date'),
            parents: (at(commit, 'parents') ?? []).map((one) => at(one, 'sha')),
            additions: at(at(commit, 'stats'), 'additions'),
            deletions: at(at(commit, 'stats'), 'deletions'),
            url: at(commit, 'html_url'),
            files: (at(commit, 'files') ?? []).map(changedFile),
          };
        },
      }),

      new OrknuxFunction({
        name: 'buildStatus',
        description:
          'What the builds say about one commit: the combined commit status and every check run, in one ' +
          'answer. Pass owner and repo (or the repo as owner/name, or an empty owner for the configured ' +
          'organization) and a sha, branch or tag. overall is failure, pending, success, or none where ' +
          'nothing has reported; statuses and checks carry each reporter by name.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'ref', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, ref) => {
          const base = repoPath(this.settings, owner, repo);
          const marked = encodeURIComponent(ref);

          /*
           * Both reporting schemes, because CI uses both: the status API is
           * what older integrations set, and check runs are what GitHub
           * Actions and the newer apps write. Reading only one says "success"
           * about a commit the other knows is red.
           */
          const combined = read(this.settings, { path: `${base}/commits/${marked}/status` }).json;
          const runs =
            at(read(this.settings, { path: `${base}/commits/${marked}/check-runs?per_page=100` }).json, 'check_runs') ?? [];

          const statuses = (at(combined, 'statuses') ?? []).map((one) => ({
            context: at(one, 'context'),
            state: at(one, 'state'),
            description: at(one, 'description'),
            url: at(one, 'target_url'),
          }));
          const checks = runs.map((one) => ({
            name: at(one, 'name'),
            status: at(one, 'status'),
            conclusion: at(one, 'conclusion'),
            url: at(one, 'html_url'),
          }));

          const red = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'];
          const state = at(combined, 'state');
          const failing =
            state === 'failure' || state === 'error' || checks.some((one) => red.includes(one.conclusion));
          const running =
            checks.some((one) => one.status !== 'completed') || (statuses.length > 0 && state === 'pending');

          return {
            overall: failing ? 'failure' : running ? 'pending' : statuses.length + checks.length > 0 ? 'success' : 'none',
            sha: at(combined, 'sha'),
            statuses: statuses,
            checks: checks,
          };
        },
      }),

      new OrknuxFunction({
        name: 'openFile',
        description:
          'Reads one file out of a repository, as the text it is. Pass owner and repo (or the repo as ' +
          'owner/name, or an empty owner for the configured organization), the path from the repository ' +
          'root, and a branch, tag or sha - or an empty ref for the default branch.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'path', type: 'string' },
          { name: 'ref', type: 'string' },
        ],
        returnType: 'string',
        run: (owner, repo, path, ref) => {
          const base = repoPath(this.settings, owner, repo);
          const marked = typeof ref === 'string' && ref.length > 0 ? `?ref=${encodeURIComponent(ref)}` : '';
          /*
           * The raw variant, asked for in the accept header, so what comes back
           * is the file — not JSON holding the file as base64, which the
           * sandbox has no atob to open.
           */
          const answered = read(this.settings, {
            path: `${base}/contents/${escapedPath(path)}${marked}`,
            accept: 'application/vnd.github.raw+json',
          });
          return answered.body;
        },
      }),

      new OrknuxFunction({
        name: 'fileHistory',
        description:
          'The commits that touched one file, newest first: sha, message, author, date and a url each. ' +
          'Pass owner and repo (or the repo as owner/name, or an empty owner for the configured ' +
          'organization) and the path from the repository root. limit caps the list, 0 for the default.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'path', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (owner, repo, path, limit) => {
          const base = repoPath(this.settings, owner, repo);
          const commits = read(this.settings, {
            path: `${base}/commits?path=${encodeURIComponent(path)}&per_page=${pageSize(limit, 20)}`,
          }).json;
          return {
            commits: (Array.isArray(commits) ? commits : []).map((one) => ({
              sha: at(one, 'sha'),
              message: at(at(one, 'commit'), 'message'),
              author: at(at(at(one, 'commit'), 'author'), 'name'),
              date: at(at(at(one, 'commit'), 'author'), 'date'),
              url: at(one, 'html_url'),
            })),
          };
        },
      }),

      new OrknuxFunction({
        name: 'createAgentTask',
        description:
          'Starts a GitHub Copilot cloud agent task: the agent works the prompt in its own branch and ' +
          'opens a draft pull request. Pass owner and repo (or the repo as owner/name, or an empty owner ' +
          'for the configured organization), the prompt saying what to do, and a base branch - or an ' +
          'empty baseRef for the default branch. Answers the task\'s id, state and url; follow it with ' +
          'agentTask. Needs a user token with Copilot access.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'prompt', type: 'string' },
          { name: 'baseRef', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, prompt, baseRef) => {
          if (typeof prompt !== 'string' || prompt.trim().length === 0) {
            throw new Error('an agent task needs a prompt saying what to do');
          }
          const base = repoPath(this.settings, owner, repo);
          const body = { prompt: prompt };
          if (typeof baseRef === 'string' && baseRef.length > 0) {
            body.base_ref = baseRef;
          }
          const made = read(this.settings, { method: 'POST', path: `/agents${base}/tasks`, body: body }).json;
          return {
            id: at(made, 'id'),
            state: at(made, 'state'),
            url: at(made, 'html_url') ?? at(made, 'url'),
            created: at(made, 'created_at'),
          };
        },
      }),

      new OrknuxFunction({
        name: 'agentTask',
        description:
          'One Copilot agent task as GitHub sees it now: its state (queued, in_progress, completed, ' +
          'failed, waiting_for_user, ...), its pull request, and its sessions - whose ids agentTaskLogs ' +
          'takes. Pass owner and repo (or the repo as owner/name, or an empty owner for the configured ' +
          'organization) and the task id createAgentTask answered.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'taskId', type: 'string' },
        ],
        returnType: 'map',
        /*
         * Passed through rather than curated: the agent-tasks API is in public
         * preview and its shape still moves, and here a moved shape should be
         * new data in the answer rather than data this file quietly drops.
         */
        run: (owner, repo, taskId) => {
          const base = repoPath(this.settings, owner, repo);
          return read(this.settings, {
            path: `/agents${base}/tasks/${encodeURIComponent(String(taskId))}`,
          }).json;
        },
      }),

      new OrknuxFunction({
        name: 'agentTaskLogs',
        description:
          'The logs of one Copilot agent session: the agent\'s own account of what it read, decided and ' +
          'changed. Pass a session id from agentTask\'s sessions. The answer is the log text itself.',
        params: [{ name: 'sessionId', type: 'string' }],
        returnType: 'string',
        run: (sessionId) => {
          const answered = read(this.settings, {
            path: `/agents/sessions/${encodeURIComponent(String(sessionId))}/logs`,
          });
          return answered.body;
        },
      }),

      new OrknuxFunction({
        name: 'messageAgentTask',
        description:
          'Tells a running or finished Copilot agent task to change course - different approach, more ' +
          'work, a fix. Pass owner and repo (or the repo as owner/name, or an empty owner for the ' +
          'configured organization), the number of the task\'s pull request (agentTask answers it), and ' +
          'what to say. Answers the comment\'s id and url.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'pullNumber', type: 'number' },
          { name: 'message', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, pullNumber, message) => {
          const base = repoPath(this.settings, owner, repo);
          /*
           * Steering is a PR comment that mentions @copilot — that is GitHub's
           * own mechanism, not a workaround — so the mention is guaranteed here
           * rather than hoped for in the message.
           */
          const said = /(^|\s)@copilot\b/i.test(message) ? message : `@copilot ${message}`;
          const made = read(this.settings, {
            method: 'POST',
            path: `${base}/issues/${pullNumber}/comments`,
            body: { body: said },
          }).json;
          return { id: at(made, 'id'), url: at(made, 'html_url') };
        },
      }),

      new OrknuxFunction({
        name: 'comment',
        description:
          'Comments on a pull request or issue - the plain kind, under the conversation. Pass owner and ' +
          'repo (or the repo as owner/name, or an empty owner for the configured organization), the PR ' +
          'or issue number, and the comment as GitHub markdown. Answers the comment\'s id and url. For a ' +
          'comment on a line of the diff, use reviewComment instead.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'number', type: 'number' },
          { name: 'text', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, number, text) => {
          const base = repoPath(this.settings, owner, repo);
          const made = read(this.settings, {
            method: 'POST',
            path: `${base}/issues/${number}/comments`,
            body: { body: text },
          }).json;
          return { id: at(made, 'id'), url: at(made, 'html_url') };
        },
      }),

      new OrknuxFunction({
        name: 'reviewComment',
        description:
          'Comments on a pull request\'s diff - the review kind, anchored to a file. Pass owner and repo ' +
          '(or the repo as owner/name, or an empty owner for the configured organization), the PR ' +
          'number, the file\'s path as openPull lists it, the line in the new version the comment is ' +
          'about - or 0 to speak about the file as a whole - and the comment as GitHub markdown. ' +
          'Answers the comment\'s id and url; replyToComment threads onto it.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'number', type: 'number' },
          { name: 'path', type: 'string' },
          { name: 'line', type: 'number' },
          { name: 'text', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, number, path, line, text) => {
          const base = repoPath(this.settings, owner, repo);
          /*
           * A review comment is anchored to a commit, and the anchor a reader
           * expects is the head of the pull request as it stands — so it is
           * read here rather than asked of the caller.
           */
          const pull = read(this.settings, { path: `${base}/pulls/${number}` }).json;
          const body = { body: text, commit_id: at(at(pull, 'head'), 'sha'), path: path };
          if (typeof line === 'number' && line > 0) {
            body.line = line;
            body.side = 'RIGHT';
          } else {
            body.subject_type = 'file';
          }
          const made = read(this.settings, {
            method: 'POST',
            path: `${base}/pulls/${number}/comments`,
            body: body,
          }).json;
          return { id: at(made, 'id'), url: at(made, 'html_url') };
        },
      }),

      new OrknuxFunction({
        name: 'replyToComment',
        description:
          'Replies in the thread under one review comment. Pass owner and repo (or the repo as ' +
          'owner/name, or an empty owner for the configured organization), the PR number, the id of the ' +
          'review comment being answered - reviewComment answers one, and a review_comment webhook ' +
          'carries one - and the reply as GitHub markdown. Answers the reply\'s id and url.',
        params: [
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'number', type: 'number' },
          { name: 'commentId', type: 'number' },
          { name: 'text', type: 'string' },
        ],
        returnType: 'map',
        run: (owner, repo, number, commentId, text) => {
          const base = repoPath(this.settings, owner, repo);
          const made = read(this.settings, {
            method: 'POST',
            path: `${base}/pulls/${number}/comments/${commentId}/replies`,
            body: { body: text },
          }).json;
          return { id: at(made, 'id'), url: at(made, 'html_url') };
        },
      }),
    ];
  }
}
