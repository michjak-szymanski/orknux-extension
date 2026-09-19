/*
 * Slack, as a plugin.
 *
 * What this exists for is the question a workflow cannot answer from the payload
 * alone: what is in this thread. Slack's `message` event carries `thread_ts` and
 * `parent_user_id` and no count, so "is this the first reply" — which is the
 * commonest thing anybody wants to gate a workflow on — is unanswerable from
 * what arrives. Reading the thread is the only way, and reading it needs the
 * network.
 *
 * A plugin has no network, deliberately and permanently: the sandbox is built
 * with `IOAccess.NONE`, and `PluginPermission` is a closed list with no spelling
 * for a socket. So this asks the *server* to read the thread, under a capability
 * a person accepted, through a connection a workspace pointed it at. For all of
 * that surface the plugin never sees a token and could not use one; the two
 * upload functions are the exception, and the section below says why.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept the capabilities it asks for.
 * 2. Point its `slack` parameter at the workspace's Slack connection.
 * 3. Use `slack_isFirstReply` as a function condition.
 *
 * The `orknux.slack` calls are wrapped here on purpose: a workflow's condition
 * and an agent's tool both call by NAME, and a name is exactly what a bare
 * capability call does not have. So each call is declared once as a function -
 * workflows call those - and fronted for agents by an `OrknuxFunctionTool` in
 * `tools()`, one implementation under two surfaces, with descriptions written
 * for the model that reads them. `isFirstReply` is the one thing here the raw
 * API does not answer on its own.
 *
 * ## Why the connection is an argument and not just a setting
 *
 * A workspace with two Slack connections has two Slacks. A reply that arrived on
 * one has to be read through that one — read through the other it is a thread
 * that does not exist, or worse, a different thread with the same timestamp. So
 * every function here takes a connection, and a trigger says which one its event
 * came in on: wire `trigger.connection` to the condition's argument and it is
 * right by construction rather than by whichever connection was configured.
 *
 * Falls back to the `slack` parameter when nothing is passed, which is what a
 * workspace with one Slack wants and is one fewer thing to wire.
 *
 * ## Uploading files
 *
 * The server's capability vocabulary has no spelling for "put a file on Slack",
 * so `upload` and `remoteFile` cannot go through a connection the way the rest
 * of this file does. They go the way the github plugin goes instead: under
 * NETWORK_REQUEST, straight at Slack's Web API, with a bot token the workspace
 * puts in the `botToken` parameter — a secret, so it lives in a variable. Both
 * check for it and say so when it is missing; a workspace that never uploads
 * never sets it, and the rest of the plugin still runs tokenless.
 *
 * What each is for follows from the shapes a sandbox can hold — text, and
 * bytes wearing base64, which is what the http door's `upload` and `download`
 * carry them as:
 *
 * - `upload` puts *text content* on Slack — a CSV, a log, a mermaid source —
 *   through the external upload flow (`files.getUploadURLExternal`, the upload
 *   url, `files.completeUploadExternal`). The scope it needs is `files:write`.
 * - `uploadBinary` puts *bytes* on Slack the same way, passed as base64 — a
 *   PDF the pdf plugin wrote, an image — up to the door's 10 MB.
 * - `uploadFromUrl` copies a file *from a url* onto Slack — a rendered mermaid
 *   diagram, a PDF a build published — fetching up to 5 MB of bytes and
 *   uploading them, so the channel holds the file and not a link.
 * - `remoteFile` attaches a url *without* copying: Slack keeps a pointer and
 *   shows a card, under `remote_files:write` and `remote_files:share`. The
 *   right door when the bytes should stay where they are, or exceed the caps.
 *
 * Reading goes through the same door, and the same shapes come back:
 * `listAttachments` says what files hang on a message (`files:read`, and the
 * history scope of the conversation), and `readAttachment` brings one back —
 * text as text, and binary as base64.
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

/**
 * One call to Slack's Web API, form-encoded, answered or thrown.
 *
 * Form-encoded because that is the one content type every Web API method
 * takes — the upload methods this file calls refuse JSON bodies. Arguments
 * that are undefined or empty are left out, which is how an optional Slack
 * argument is not passed.
 */
/** The bot token, or the sentence that says which parameter is missing. */
function tokenOf(settings) {
  const token = settings.botToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error("the plugin's botToken parameter is not set, and uploading needs it");
  }
  return token;
}

function slackApi(settings, method, args) {
  const token = tokenOf(settings);

  const body = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');

  const answered = orknux.http.request({
    url: `https://slack.com/api/${method}`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });
  if (answered.error !== undefined) {
    throw new Error(`could not reach Slack: ${answered.error}`);
  }
  if (at(answered.json, 'ok') !== true) {
    const said = at(answered.json, 'error');
    throw new Error(`Slack refused ${method}: ${typeof said === 'string' ? said : `status ${answered.status}`}`);
  }
  return answered.json;
}

/**
 * A filename for a fetched url: its last path segment where that reads as a
 * name, else `file` with the extension its content type implies — because a
 * mermaid.ink url's last segment is the whole encoded diagram, not a name.
 */
function namedFromUrl(url, contentType) {
  const tail = url.split(/[?#]/)[0].split('/').slice(3).filter((one) => one.length > 0).pop() ?? '';
  if (tail.length > 0 && tail.length <= 80 && tail.includes('.')) {
    return tail;
  }
  const known = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'text/csv': 'csv',
  };
  const extension = known[String(contentType ?? '').split(';')[0].trim()];
  return extension === undefined ? 'file' : `file.${extension}`;
}

/**
 * The last step of the external upload flow, shared by everything that
 * uploads: the file completed, shared where a channel was named, said
 * something about where a comment was — answered as its id and permalink.
 */
function completed(settings, fileId, filename, channel, comment, threadTs) {
  const done = slackApi(settings, 'files.completeUploadExternal', {
    files: JSON.stringify([{ id: fileId, title: filename }]),
    channel_id: channel || undefined,
    initial_comment: comment || undefined,
    thread_ts: threadTs || undefined,
  });
  const file = (at(done, 'files') ?? [])[0];
  return { id: at(file, 'id'), permalink: at(file, 'permalink') };
}

export default class Slack extends OrknuxPlugin {

  id() {
    return 'slack';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'slack',
        description:
          'The Slack to read through when a function is not handed one. ' +
          'A workspace with two Slacks should pass the connection instead.',
        type: 'connection',
        connectionType: 'SLACK',
        required: false,
      }),
      new OrknuxParameter({
        name: 'botToken',
        description:
          'A bot token for the two upload functions, with files:write - and remote_files:write ' +
          'and remote_files:share for remoteFile. Everything else here runs without it.',
        type: 'string',
        required: false,
        secret: true,
      }),
    ];
  }

  permissions() {
    // TextEncoder, for `upload` alone: Slack is told the file's length in
    // bytes, and the byte length of text is a fact about its UTF-8 encoding,
    // not about its character count.
    return ['TEXT_ENCODING'];
  }

  capabilities() {
    return [
      'SLACK_READ_THREAD',
      'SLACK_READ_MESSAGE',
      'SLACK_READ_USER',
      'SLACK_MENTION',
      'SLACK_POST_MESSAGE',
      'SLACK_ADD_REACTION',
      'SLACK_SEARCH',
      // For the two upload functions only, which the capability vocabulary has
      // no narrower spelling for — the header says why.
      'NETWORK_REQUEST',
    ];
  }

  /*
   * The agents' surface: the three lookups, fronted. A proxy rather than a
   * copy, so the params, return type and implementation - and any edit made
   * to the function on the server - stay the function's own.
   *
   * `isFirstReply` is deliberately not here. It is a workflow's gate, written
   * to be a condition; a model reading a thread has better ways to ask.
   */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'readMessage' }),
      new OrknuxFunctionTool({ function: 'whoIs' }),
      new OrknuxFunctionTool({ function: 'mention' }),
      new OrknuxFunctionTool({ function: 'readThread' }),
      new OrknuxFunctionTool({ function: 'post' }),
      new OrknuxFunctionTool({ function: 'react' }),
      new OrknuxFunctionTool({ function: 'search' }),
      new OrknuxFunctionTool({ function: 'upload' }),
      new OrknuxFunctionTool({ function: 'uploadBinary' }),
      new OrknuxFunctionTool({ function: 'uploadFromUrl' }),
      new OrknuxFunctionTool({ function: 'remoteFile' }),
      new OrknuxFunctionTool({ function: 'listAttachments' }),
      new OrknuxFunctionTool({ function: 'readAttachment' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'isFirstReply',
        description:
          'Whether this message is the first reply in its thread. False for a message that is not in a thread at all.',
        /*
         * `ts` as well as the thread, because the two together are the whole
         * question. A message whose own timestamp *is* the thread's is the
         * parent, not a reply - Slack gives a message outside a thread a
         * `threadTs` of its own `ts`, so without this every top-level message
         * would look like a first reply.
         */
        params: [
          { name: 'connection', type: 'map' },
          { name: 'channel', type: 'string' },
          { name: 'threadTs', type: 'string' },
          { name: 'ts', type: 'string' },
        ],
        returnType: 'boolean',
        run: (connection, channel, threadTs, ts) => {
          if (typeof threadTs !== 'string' || threadTs === '' || threadTs === ts) {
            return false;
          }

          const read = orknux.slack.thread(connection ?? this.settings.slack, channel, threadTs, 2);
          if (read.error !== undefined) {
            /*
             * Thrown rather than answered false. A condition that cannot be
             * decided must not quietly decide: "we could not read the thread"
             * and "this is not the first reply" are different facts, and a
             * workflow that treated them alike would silently stop firing the
             * day a scope was revoked.
             */
            throw new Error(`could not read the thread: ${read.error}`);
          }

          /*
           * Slack's own count, which is of the whole thread rather than of what
           * came back. One reply, and this is it.
           */
          return read.replies === 1;
        },
      }),

      new OrknuxFunction({
        name: 'readMessage',
        description:
          'Reads the Slack message a permalink points at. Use when a message links to another message ' +
          '(https://…slack.com/archives/…) and you need what that message says. Pass the connection the ' +
          'event came in on, or an empty string to use the configured one. Answers channel, ts, user and text.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'link', type: 'string' },
        ],
        returnType: 'map',
        run: (connection, link) => {
          const read = orknux.slack.message(connection || this.settings.slack, link);
          if (read.error !== undefined) {
            throw new Error(`could not read the linked message: ${read.error}`);
          }
          return read;
        },
      }),

      new OrknuxFunction({
        name: 'whoIs',
        description:
          'Says who a Slack user id belongs to. Use when a message carries a mention like <@U0123ABCD> ' +
          'and you need the person behind it; pass the id bare or as the whole <@…> notation. Pass the ' +
          'connection the event came in on, or an empty string to use the configured one. Answers id, ' +
          'name, realName, displayName and whether it is a bot.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'userId', type: 'string' },
        ],
        returnType: 'map',
        run: (connection, userId) => {
          const found = orknux.slack.user(connection || this.settings.slack, userId);
          if (found.error !== undefined) {
            throw new Error(`could not look the user up: ${found.error}`);
          }
          return found;
        },
      }),

      new OrknuxFunction({
        name: 'readThread',
        description:
          'Reads a Slack thread: the messages under one parent, oldest first, and how many replies the ' +
          'whole thread holds. Pass the channel id and the thread\'s ts (threadTs on an event; a message\'s ' +
          'own ts when it is the parent). Pass the connection the event came in on, or an empty string to ' +
          'use the configured one. limit caps how many messages come back; pass 0 for the default.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'channel', type: 'string' },
          { name: 'threadTs', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (connection, channel, threadTs, limit) => {
          const read = orknux.slack.thread(connection || this.settings.slack, channel, threadTs, limit || 20);
          if (read.error !== undefined) {
            throw new Error(`could not read the thread: ${read.error}`);
          }
          return read;
        },
      }),

      new OrknuxFunction({
        name: 'post',
        description:
          'Posts a message to a Slack channel. Pass the channel id (or a #name), what to say, and a ' +
          'threadTs to reply inside a thread - or an empty threadTs to post to the channel itself. ' +
          'attachments takes permalinks of files already hosted on Slack (a file\'s permalink, as an ' +
          'event or readThread carries it) and attaches each to the message - pass an empty array for ' +
          'none. Pass the connection the event came in on, or an empty string to use the configured ' +
          'one. Answers the channel and the new message\'s ts.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'channel', type: 'string' },
          { name: 'text', type: 'string' },
          { name: 'threadTs', type: 'string' },
          { name: 'attachments', type: 'array' },
        ],
        returnType: 'map',
        run: (connection, channel, text, threadTs, attachments) => {
          /*
           * Slack attaches a hosted file to a message when the message carries
           * the file's permalink — that is Slack's own mechanism, so it needs
           * nothing beyond SLACK_POST_MESSAGE. The `| ` label keeps the raw
           * url out of the text people read; the preview still unfurls.
           */
          let said = text;
          const linked = Array.isArray(attachments)
            ? attachments.filter((one) => typeof one === 'string' && one.length > 0)
            : [];
          if (linked.length > 0) {
            said = `${said}${linked.map((one) => ` <${one}| >`).join('')}`;
          }

          const posted = orknux.slack.post(connection || this.settings.slack, channel, said, threadTs || undefined);
          if (posted.error !== undefined) {
            throw new Error(`could not post the message: ${posted.error}`);
          }
          return posted;
        },
      }),

      new OrknuxFunction({
        name: 'react',
        description:
          'Adds an emoji reaction to a Slack message. Pass the channel id, the message\'s own ts, and the ' +
          'emoji\'s short name with or without the colons. Already-reacted counts as done. Pass the ' +
          'connection the event came in on, or an empty string to use the configured one.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'channel', type: 'string' },
          { name: 'ts', type: 'string' },
          { name: 'emoji', type: 'string' },
        ],
        returnType: 'boolean',
        run: (connection, channel, ts, emoji) => {
          const done = orknux.slack.react(connection || this.settings.slack, channel, ts, emoji);
          if (done.error !== undefined) {
            throw new Error(`could not add the reaction: ${done.error}`);
          }
          return true;
        },
      }),

      new OrknuxFunction({
        name: 'search',
        description:
          'Searches Slack messages the way the search box does. Slack\'s search syntax works: in:#channel, ' +
          'from:@name, "an exact phrase". Answers the matches - channel, ts, user, text and a permalink ' +
          'back to each - and how many the whole search holds. Pass the connection the event came in on, ' +
          'or an empty string to use the configured one; limit caps the matches, 0 for the default. Note: ' +
          'Slack answers search only for a user token, so the connection needs one in its User Token field.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number' },
        ],
        returnType: 'map',
        run: (connection, query, limit) => {
          const found = orknux.slack.search(connection || this.settings.slack, query, limit || 20);
          if (found.error !== undefined) {
            throw new Error(`could not search Slack: ${found.error}`);
          }
          return found;
        },
      }),

      new OrknuxFunction({
        name: 'mention',
        description:
          'Turns a name into the notation Slack renders as a mention: <@U…> for a person, <!subteam^S…> ' +
          'for a user group. Use it to ping somebody in a message you are composing - put the answer in ' +
          'the message text as it is, and never write <@…> from a guessed id. Takes a display name, ' +
          'username, email, id or group handle. Pass the connection the event came in on, or an empty ' +
          'string to use the configured one.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'name', type: 'string' },
        ],
        returnType: 'string',
        run: (connection, name) => {
          const resolved = orknux.slack.mention(connection || this.settings.slack, name);
          if (resolved.error !== undefined) {
            throw new Error(`could not resolve the mention: ${resolved.error}`);
          }
          return resolved.mention;
        },
      }),

      new OrknuxFunction({
        name: 'upload',
        description:
          'Uploads text content to Slack as a file the workspace hosts - a CSV, a log, JSON, mermaid ' +
          'source - and shares it to a channel with a message. Pass the channel id (not a #name), a ' +
          'filename whose extension says what the content is (report.csv, diagram.mmd), the content ' +
          'itself, what the sharing message should say, and a threadTs to share inside a thread - ' +
          'empty for the channel itself. Pass an empty channel to only upload: the answered permalink ' +
          'then goes in a later post\'s attachments. Text only - a PDF or an image cannot travel this ' +
          'way; give remoteFile its url instead. Answers the file\'s id and permalink. Needs the ' +
          'botToken parameter.',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'filename', type: 'string' },
          { name: 'content', type: 'string' },
          { name: 'comment', type: 'string' },
          { name: 'threadTs', type: 'string' },
        ],
        returnType: 'map',
        run: (channel, filename, content, comment, threadTs) => {
          if (typeof filename !== 'string' || filename.length === 0) {
            throw new Error('an upload needs a filename');
          }
          if (typeof content !== 'string' || content.length === 0) {
            throw new Error('there is no content to upload');
          }

          /*
           * Slack's external upload flow, whose three steps are the reason
           * this is one function: ask for an upload url naming the byte
           * length, put the bytes there, then complete — which is also where
           * sharing to a channel and saying something about it happen.
           */
          const opened = slackApi(this.settings, 'files.getUploadURLExternal', {
            filename: filename,
            length: new TextEncoder().encode(content).length,
          });

          const put = orknux.http.request({
            url: at(opened, 'upload_url'),
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: content,
          });
          if (put.error !== undefined) {
            throw new Error(`could not reach Slack's upload url: ${put.error}`);
          }
          if (put.status >= 400) {
            throw new Error(`Slack's upload url answered ${put.status}`);
          }

          return completed(this.settings, at(opened, 'file_id'), filename, channel, comment, threadTs);
        },
      }),

      new OrknuxFunction({
        name: 'uploadBinary',
        description:
          'Uploads bytes to Slack as a file the workspace hosts - a PDF, an image - passed as base64, ' +
          'up to 10 MB decoded, and shares them to a channel with a message. Pass the channel id, a ' +
          'filename whose extension says what the bytes are (report.pdf, chart.png), the base64, what ' +
          'the sharing message should say, and a threadTs - or an empty channel to only upload. ' +
          'pdf_fromHtml answers base64 ready for this. Answers the file\'s id and permalink. Needs the ' +
          'botToken parameter.',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'filename', type: 'string' },
          { name: 'base64', type: 'string' },
          { name: 'comment', type: 'string' },
          { name: 'threadTs', type: 'string' },
        ],
        returnType: 'map',
        run: (channel, filename, base64, comment, threadTs) => {
          if (typeof filename !== 'string' || filename.length === 0) {
            throw new Error('an upload needs a filename');
          }
          const packed = typeof base64 === 'string' ? base64.replace(/\s+/g, '') : '';
          if (packed.length === 0) {
            throw new Error('there are no bytes to upload');
          }

          /*
           * Slack is told the length in decoded bytes, which base64 carries in
           * its own arithmetic: three bytes per four characters, less what the
           * padding says was never there.
           */
          const size = Math.floor((packed.replace(/=+$/, '').length * 3) / 4);
          const opened = slackApi(this.settings, 'files.getUploadURLExternal', {
            filename: filename,
            length: size,
          });

          const put = orknux.http.upload(at(opened, 'upload_url'), packed);
          if (put.error !== undefined) {
            throw new Error(`could not reach Slack's upload url: ${put.error}`);
          }
          if (put.status >= 400) {
            throw new Error(`Slack's upload url answered ${put.status}`);
          }

          return completed(this.settings, at(opened, 'file_id'), filename, channel, comment, threadTs);
        },
      }),

      new OrknuxFunction({
        name: 'uploadFromUrl',
        description:
          'Copies a file from a url onto Slack, so the channel holds the file itself rather than a ' +
          'link: a rendered mermaid diagram\'s image, a PDF a build published. Fetches up to 5 MB; a ' +
          'bigger file wants remoteFile, which points without copying. Pass the channel id, the url, ' +
          'a filename - or empty to name it from the url and its content type - what the sharing ' +
          'message should say, and a threadTs - or an empty channel to only upload. Answers the ' +
          'file\'s id and permalink. Needs the botToken parameter.',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'url', type: 'string' },
          { name: 'filename', type: 'string' },
          { name: 'comment', type: 'string' },
          { name: 'threadTs', type: 'string' },
        ],
        returnType: 'map',
        run: (channel, url, filename, comment, threadTs) => {
          if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
            throw new Error('a file is fetched by its http(s) url, and none was passed');
          }
          tokenOf(this.settings); // before the fetch, so a missing token costs nothing

          const got = orknux.http.download(url);
          if (got.error !== undefined) {
            throw new Error(`could not fetch the file: ${got.error}`);
          }
          if (got.status >= 400) {
            throw new Error(`${url} answered ${got.status}`);
          }

          const named =
            typeof filename === 'string' && filename.length > 0
              ? filename
              : namedFromUrl(url, got.contentType);
          const opened = slackApi(this.settings, 'files.getUploadURLExternal', {
            filename: named,
            length: got.size,
          });

          const put = orknux.http.upload(at(opened, 'upload_url'), got.base64, got.contentType ?? undefined);
          if (put.error !== undefined) {
            throw new Error(`could not reach Slack's upload url: ${put.error}`);
          }
          if (put.status >= 400) {
            throw new Error(`Slack's upload url answered ${put.status}`);
          }

          return completed(this.settings, at(opened, 'file_id'), named, channel, comment, threadTs);
        },
      }),

      new OrknuxFunction({
        name: 'remoteFile',
        description:
          'Attaches a file that already lives at a url - a PDF, a rendered diagram image, anything ' +
          'binary - to Slack as a remote file, and shares it to a channel. Slack keeps a pointer and ' +
          'shows a preview card; the bytes stay where they are, so the url must be reachable by ' +
          'whoever clicks. Pass the file\'s url, a title people will see, the channel id to share ' +
          'into - or empty to only register - and filetype as Slack\'s own kind string (pdf, png, ' +
          'csv), empty to let Slack guess. Answers the file\'s id and permalink. Needs the botToken ' +
          'parameter, with the remote_files scopes.',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'url', type: 'string' },
          { name: 'title', type: 'string' },
          { name: 'filetype', type: 'string' },
        ],
        returnType: 'map',
        run: (channel, url, title, filetype) => {
          if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
            throw new Error('a remote file needs the http(s) url it lives at');
          }

          /*
           * The url is its own external_id: registration is idempotent per id,
           * so registering the same document twice updates rather than
           * duplicates, and sharing needs no id kept anywhere.
           */
          const added = slackApi(this.settings, 'files.remote.add', {
            external_id: url,
            external_url: url,
            title: typeof title === 'string' && title.length > 0 ? title : url,
            filetype: filetype || undefined,
          });

          if (typeof channel === 'string' && channel.length > 0) {
            slackApi(this.settings, 'files.remote.share', { external_id: url, channels: channel });
          }

          const file = at(added, 'file');
          return { id: at(file, 'id'), permalink: at(file, 'permalink') };
        },
      }),

      new OrknuxFunction({
        name: 'listAttachments',
        description:
          'Lists the files attached to one Slack message: id, name, title, filetype, mimetype, size ' +
          'and permalink each - readAttachment takes the id, and post\'s attachments takes the ' +
          'permalink. Pass the channel id and the message\'s own ts (an event carries both). A message ' +
          'with no files answers an empty list. Needs the botToken parameter, with files:read and the ' +
          'conversation\'s history scope.',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'ts', type: 'string' },
        ],
        returnType: 'map',
        run: (channel, ts) => {
          if (typeof ts !== 'string' || ts.length === 0) {
            throw new Error('a message is named by its ts, and none was passed');
          }
          /*
           * One message, asked for by its own timestamp: latest=ts inclusive
           * with a limit of one is Slack's spelling of "exactly this one". A
           * reply is not in the channel's history, so when nothing comes back
           * the same question is asked of its thread.
           */
          let held = at(
            slackApi(this.settings, 'conversations.history', {
              channel: channel,
              latest: ts,
              inclusive: 'true',
              limit: '1',
            }),
            'messages',
          );
          if (!Array.isArray(held) || held.length === 0 || at(held[0], 'ts') !== ts) {
            const found = slackApi(this.settings, 'conversations.replies', {
              channel: channel,
              ts: ts,
              latest: ts,
              inclusive: 'true',
              limit: '1',
            });
            held = at(found, 'messages');
          }
          const message = (Array.isArray(held) ? held : []).find((one) => at(one, 'ts') === ts);
          if (message === undefined) {
            throw new Error(`no message at ${ts} in ${channel}`);
          }
          return {
            files: (at(message, 'files') ?? []).map((one) => ({
              id: at(one, 'id'),
              name: at(one, 'name'),
              title: at(one, 'title'),
              filetype: at(one, 'filetype'),
              mimetype: at(one, 'mimetype'),
              size: at(one, 'size'),
              permalink: at(one, 'permalink'),
            })),
          };
        },
      }),

      new OrknuxFunction({
        name: 'readAttachment',
        description:
          'Reads one attachment by the file id listAttachments answers. A text file - a CSV, a log, ' +
          'JSON, source - comes back as content; a binary one - a PDF, an image - as base64 bytes, up ' +
          'to 5 MB. Answers the file\'s name, mimetype, size, and exactly one of content or base64, ' +
          'the other null. Needs the botToken parameter, with files:read.',
        params: [{ name: 'file', type: 'string' }],
        returnType: 'map',
        run: (file) => {
          const token = tokenOf(this.settings);
          const described = at(slackApi(this.settings, 'files.info', { file: file }), 'file');
          const mimetype = at(described, 'mimetype');
          const source = at(described, 'url_private');
          const bearing = { authorization: `Bearer ${token}` };

          /*
           * Which door, decided by mimetype: text is read as the string it is,
           * and everything else as bytes wearing base64 — never text read as
           * bytes' worth of mojibake, and never a refusal now that bytes have
           * a shape that travels.
           */
          const named = typeof mimetype === 'string' ? mimetype : '';
          const readable =
            named.startsWith('text/') ||
            /(json|xml|csv|javascript|yaml|x-sh)\b/.test(named);

          if (readable) {
            const got = orknux.http.get(source, bearing);
            if (got.error !== undefined) {
              throw new Error(`could not fetch the file: ${got.error}`);
            }
            if (got.status >= 400) {
              throw new Error(`Slack answered ${got.status} for the file's content`);
            }
            return {
              name: at(described, 'name'),
              mimetype: mimetype,
              size: at(described, 'size'),
              content: got.body,
              base64: null,
            };
          }

          const got = orknux.http.download(source, bearing);
          if (got.error !== undefined) {
            throw new Error(`could not fetch the file: ${got.error}`);
          }
          if (got.status >= 400) {
            throw new Error(`Slack answered ${got.status} for the file's content`);
          }
          return {
            name: at(described, 'name'),
            mimetype: mimetype,
            size: got.size,
            content: null,
            base64: got.base64,
          };
        },
      }),
    ];
  }
}
