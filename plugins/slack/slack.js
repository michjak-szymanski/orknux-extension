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
/**
 * The bot token, or the sentence that says which parameter is missing.
 *
 * A user token is accepted and noted rather than refused. Slack takes either
 * for these calls and attributes the result to whoever the token belongs to -
 * so a `xoxp-` here means every file this plugin uploads is posted by that
 * person, under their name and their picture, and the bot's own message
 * afterwards says "I have attached the file" beside somebody else's upload.
 *
 * That is occasionally what somebody wants, which is why this is a line in the
 * log rather than an error. What it usually is, is a `botToken` pointed at
 * the user token `search` needs - the one Slack call here that will not
 * answer to a bot. That token has its own parameter now, `userToken`, so
 * the two no longer have to share a field and uploads can stay the bot's.
 */
function tokenOf(settings) {
  const token = settings.botToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error("the plugin's botToken parameter is not set, and uploading needs it");
  }
  if (token.startsWith('xoxp-')) {
    orknux.log.warn(
      'botToken holds a user token (xoxp-), so Slack will show this upload as posted by that ' +
        'person rather than by the bot. A bot token (xoxb-) uploads as the bot; if this was ' +
        'meant for search, it belongs in the userToken parameter.',
    );
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

/** The middle step's two failures, which every upload here answers the same way. */
function putOrThrow(put) {
  if (put.error !== undefined) {
    throw new Error(`could not reach Slack's upload url: ${put.error}`);
  }
  if (put.status >= 400) {
    throw new Error(`Slack's upload url answered ${put.status}`);
  }
}

/**
 * Text put on Slack as a file it hosts.
 *
 * Slack's external upload flow, whose three steps are the reason this is one
 * function: ask for an upload url naming the byte length, put the bytes
 * there, then complete - which is also where sharing to a channel and saying
 * something about it happen.
 */
function uploadedText(settings, filename, content, channel, comment, threadTs) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('an upload needs a filename');
  }
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('there is no content to upload');
  }

  const opened = slackApi(settings, 'files.getUploadURLExternal', {
    filename: filename,
    length: new TextEncoder().encode(content).length,
  });

  putOrThrow(
    orknux.http.request({
      url: at(opened, 'upload_url'),
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: content,
    }),
  );

  return completed(settings, at(opened, 'file_id'), filename, channel, comment, threadTs);
}

/** Bytes, passed as base64, put on Slack the same way. */
function uploadedBytes(settings, filename, base64, channel, comment, threadTs) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('an upload needs a filename');
  }
  const packed = typeof base64 === 'string' ? base64.replace(/\s+/g, '') : '';
  if (packed.length === 0) {
    throw new Error('there are no bytes to upload');
  }

  /*
   * Slack is told the length in decoded bytes, which base64 carries in its
   * own arithmetic: three bytes per four characters, less what the padding
   * says was never there.
   */
  const size = Math.floor((packed.replace(/=+$/, '').length * 3) / 4);
  const opened = slackApi(settings, 'files.getUploadURLExternal', {
    filename: filename,
    length: size,
  });

  putOrThrow(orknux.http.upload(at(opened, 'upload_url'), packed));

  return completed(settings, at(opened, 'file_id'), filename, channel, comment, threadTs);
}

/** A file fetched from a url and put on Slack, so the workspace holds it. */
function uploadedFromUrl(settings, url, filename, channel, comment, threadTs) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new Error('a file is fetched by its http(s) url, and none was passed');
  }
  tokenOf(settings); // before the fetch, so a missing token costs nothing

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
  const opened = slackApi(settings, 'files.getUploadURLExternal', {
    filename: named,
    length: got.size,
  });

  putOrThrow(
    orknux.http.upload(at(opened, 'upload_url'), got.base64, got.contentType ?? undefined),
  );

  return completed(settings, at(opened, 'file_id'), named, channel, comment, threadTs);
}

/**
 * The permalinks `post` attaches, from whatever a caller passed as attachments.
 *
 * A string is a file already on Slack and is used as it is - the cheap path,
 * and the one that needs no token at all. A map is a file that does not exist
 * yet: it is uploaded here, with `botToken`, and what comes back is its
 * permalink, so both kinds end up in the same list.
 *
 * Uploaded *without* a channel, deliberately. Sharing at upload time makes
 * Slack post the file as its own message, which is a second message nobody
 * asked for and which arrives before the text explaining it. A permalink in
 * the message that follows is Slack's own way of hanging a file on a message
 * somebody wrote.
 */
function attaching(settings, attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  const links = [];
  for (const one of attachments) {
    if (typeof one === 'string') {
      if (one.length > 0) links.push(one);
      continue;
    }
    if (one === null || typeof one !== 'object') {
      continue;
    }

    const filename = at(one, 'filename');
    const named = typeof filename === 'string' ? filename : '';
    const content = at(one, 'content');
    const base64 = at(one, 'base64');
    const url = at(one, 'url');

    let hosted;
    if (typeof content === 'string') {
      hosted = uploadedText(settings, named, content, '', '', '');
    } else if (typeof base64 === 'string') {
      hosted = uploadedBytes(settings, named, base64, '', '', '');
    } else if (typeof url === 'string') {
      hosted = uploadedFromUrl(settings, url, named, '', '', '');
    } else {
      throw new Error(
        'an attachment map says which file by content, base64 or url, and none of the three was set',
      );
    }
    if (typeof hosted.permalink === 'string' && hosted.permalink.length > 0) {
      links.push(hosted.permalink);
    }
  }
  return links;
}

/**
 * A search run against Slack's own API with the `userToken` parameter.
 *
 * Search is the one call here Slack will not answer for a bot: `search.messages`
 * refuses a `xoxb-` with `not_allowed_token_type`, whoever asks. The capability
 * path reads the User Token field of the connection, which is the right answer
 * when a workspace has filled it in - and this is the answer when it has not,
 * or when the searching identity should not be whoever the connection belongs
 * to. Shaped to match the capability's answer exactly, so the function's
 * callers cannot tell which path ran.
 */
function searchAs(token, query, limit) {
  const answered = orknux.http.request({
    url: 'https://slack.com/api/search.messages',
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body:
      `query=${encodeURIComponent(query)}&count=${encodeURIComponent(limit)}`,
  });
  if (answered.error !== undefined) {
    return { error: answered.error };
  }
  if (at(answered.json, 'ok') !== true) {
    const said = at(answered.json, 'error');
    return { error: typeof said === 'string' ? said : `status ${answered.status}` };
  }

  const messages = at(answered.json, 'messages');
  const matches = (at(messages, 'matches') ?? []).map((one) => ({
    channel: at(at(one, 'channel'), 'id'),
    channelName: at(at(one, 'channel'), 'name'),
    ts: at(one, 'ts'),
    /* Slack answers a search match by name where a thread answers by id. */
    user: at(one, 'user') ?? at(one, 'username'),
    text: at(one, 'text'),
    permalink: at(one, 'permalink'),
  }));
  return { matches: matches, total: at(messages, 'total') ?? matches.length };
}

/**
 * Whether a failure was the connection being gone rather than Slack saying no.
 *
 * The event a workflow carries holds the connection it came in on, and every
 * function here tells the caller to pass it - so when that connection has
 * since been deleted, what fails is the caller doing exactly as it was told.
 */
function connectionGone(error) {
  return typeof error === 'string' && error.includes('has been deleted');
}

/**
 * One call, through the connection asked for, or through the configured one.
 *
 * A connection id travels inside the event payload and outlives the connection
 * itself: delete the connection and every event already in flight still names
 * it. An agent handed one of those did as it was told, was told the connection
 * is gone, and had to work out on its own that an empty string means "the
 * configured one" - a wasted turn on the way to the only other option there is.
 *
 * So the fallback happens here. It cannot reach another workspace's Slack: the
 * server checks that the caller may use the connection it names, and the
 * configured one is this workspace's own, chosen in the plugin's settings. What
 * it can do is send through a different connection of this workspace than the
 * one named, which is worth a line in the log and is better than not sending.
 *
 * @param call takes a connection id and answers what the door answered.
 */
function through(call, asked, configured) {
  const first = call(asked || configured);
  if (first.error === undefined || !asked || asked === configured) return first;
  if (!connectionGone(first.error)) return first;

  orknux.log.warn(
    `the connection this event came in on (${asked}) has been deleted; using the configured one instead`,
  );
  return call(configured);
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
          'A bot token (xoxb-) for the two upload functions, with files:write - and ' +
          'remote_files:write and remote_files:share for remoteFile. Everything else here runs ' +
          'without it, and post needs it only when an attachment is a file to upload rather ' +
          'than a permalink. It must be the bot\'s own: a user token (xoxp-) works, but Slack ' +
          'then shows every uploaded file as posted by that person rather than by the bot - a ' +
          'user token for search goes in userToken instead.',
        type: 'string',
        required: false,
        secret: true,
      }),
      new OrknuxParameter({
        name: 'userToken',
        description:
          'A user token (xoxp-) for search, which is the one call Slack will not answer for a bot: ' +
          'search.messages refuses a bot token with not_allowed_token_type. Set this and search runs ' +
          'as that person; leave it empty and search uses the connection\'s own User Token field, ' +
          'which is where a workspace usually keeps one. Nothing else here uses it.',
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
   * The shapes these answers have.
   *
   * Most of them are the server's, not this plugin's: `readThread` hands back
   * what the SLACK_READ_THREAD capability answered, and declaring it here is
   * writing down a shape the server already guarantees rather than inventing
   * one. That is worth doing anyway — a caller should not have to read this
   * file to learn that `replies` counts the whole thread and `messages` only
   * the page that came back.
   */
  objects() {
    return [
      new OrknuxObject({
        name: 'Message',
        description: 'One message in a thread.',
        properties: [
          { name: 'ts', kind: 'string', description: "Slack's timestamp, which is also the message's id." },
          { name: 'user', kind: 'string', description: 'Who wrote it, or null where Slack said neither.' },
          { name: 'text', kind: 'string', description: 'What it says, in mrkdwn.' },
          {
            name: 'parent',
            kind: 'boolean',
            description: 'Whether this is the message the thread hangs under, rather than a reply.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'Thread',
        description: 'The messages under one parent, oldest first.',
        properties: [
          { name: 'messages', kind: 'array', of: 'Message', description: 'The page that came back, capped by limit.' },
          {
            name: 'replies',
            kind: 'number',
            description: "Slack's own count of the whole thread, not of this page. replies === 1 is the first reply.",
          },
        ],
      }),

      new OrknuxObject({
        name: 'LinkedMessage',
        description: 'The one message a permalink points at.',
        properties: [
          { name: 'channel', kind: 'string', description: 'The channel id it lives in.' },
          { name: 'ts', kind: 'string', description: 'Its own timestamp.' },
          { name: 'user', kind: 'string', description: 'Who wrote it, or null.' },
          { name: 'text', kind: 'string', description: 'What it says.' },
          { name: 'threadTs', kind: 'string', description: "The thread's parent ts, or null outside a thread." },
        ],
      }),

      new OrknuxObject({
        name: 'User',
        description: 'Who a Slack user id belongs to.',
        properties: [
          { name: 'id', kind: 'string', description: 'The U… id itself.' },
          { name: 'name', kind: 'string', description: 'The username.' },
          { name: 'realName', kind: 'string', description: 'Their actual name, where they set one.' },
          { name: 'displayName', kind: 'string', description: 'What Slack shows in a channel.' },
          { name: 'bot', kind: 'boolean', description: 'Whether this is an app rather than a person.' },
        ],
      }),

      new OrknuxObject({
        name: 'SearchMatch',
        description: 'One message a search matched.',
        properties: [
          { name: 'channel', kind: 'string', description: 'The channel id.' },
          { name: 'channelName', kind: 'string', description: 'Its name, without the hash.' },
          { name: 'ts', kind: 'string', description: 'The message timestamp.' },
          { name: 'user', kind: 'string', description: 'Who wrote it.' },
          { name: 'text', kind: 'string', description: 'What it says.' },
          { name: 'permalink', kind: 'string', description: 'The way back to it — readMessage takes this.' },
        ],
      }),

      new OrknuxObject({
        name: 'SearchResult',
        description: 'What a search of Slack came to.',
        properties: [
          { name: 'matches', kind: 'array', of: 'SearchMatch', description: 'Capped by limit.' },
          { name: 'total', kind: 'number', description: 'How many the whole search holds, not how many came back.' },
        ],
      }),

      new OrknuxObject({
        name: 'Posted',
        description: 'A message that was posted.',
        properties: [
          { name: 'channel', kind: 'string', description: 'Where it landed — resolved, if a #name was passed.' },
          {
            name: 'ts',
            kind: 'string',
            description: 'Its own timestamp: what react hangs on, and what a reply threads onto.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'HostedFile',
        description: 'A file now on Slack, however it got there.',
        properties: [
          { name: 'id', kind: 'string', description: 'The F… id; readAttachment takes it.' },
          {
            name: 'permalink',
            kind: 'string',
            description: "The link to it. Put this in a later post's attachments to show it again.",
          },
        ],
      }),

      new OrknuxObject({
        name: 'Attachment',
        description: 'A file hanging on a message, as a listing describes it.',
        properties: [
          { name: 'id', kind: 'string', description: 'What readAttachment takes.' },
          { name: 'name', kind: 'string', description: 'The filename.' },
          { name: 'title', kind: 'string', description: 'What Slack shows above it.' },
          { name: 'filetype', kind: 'string', description: "Slack's own short kind: pdf, png, csv." },
          { name: 'mimetype', kind: 'string', description: 'What decides whether readAttachment answers text or bytes.' },
          { name: 'size', kind: 'number', description: 'In bytes.' },
          { name: 'permalink', kind: 'string', description: 'The link for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Attachments',
        description: 'The files hanging on one message.',
        properties: [
          {
            name: 'files',
            kind: 'array',
            of: 'Attachment',
            description: 'Empty where the message carried none.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'AttachmentContent',
        description: 'One attachment read back — text as text, binary as bytes.',
        properties: [
          { name: 'name', kind: 'string', description: 'The filename.' },
          { name: 'mimetype', kind: 'string', description: 'What it claims to be.' },
          { name: 'size', kind: 'number', description: 'In bytes.' },
          {
            name: 'content',
            kind: 'string',
            description: 'The text, where it is a text file. Null for anything binary.',
          },
          {
            name: 'base64',
            kind: 'string',
            description: 'The bytes, where it is binary. Null for a text file. Exactly one of these two is set.',
          },
        ],
      }),
    ];
  }

  /*
   * What the tool descriptions cannot carry: the half-dozen small habits that
   * separate a message people read from one they scroll past. Each is cheap,
   * none is discoverable from a function signature, and getting them wrong is
   * visible to everybody in the channel rather than only in a log.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Posting to Slack so people read it',
        description: 'What to check before posting a message, and where replies belong.',
        content: `# Posting to Slack so people read it

A channel is somebody else's interface. Everything below is about not making
it worse.

## Markdown is not what Slack reads

Slack reads *mrkdwn*, which looks like markdown and is not. Post markdown
straight and the reader sees your punctuation: \`**bold**\` arrives with the
asterisks showing, and \`[text](url)\` arrives as literal brackets.

Run anything you composed through **\`markdown_toSlack\`** before
\`slack_post\`. That is the whole fix, and it is one call.

If that plugin is not available: one asterisk is bold, one underscore is
italic, one tilde is strikethrough, a link is \`<url|text>\`, and there are no
headings.

## Never write a mention by hand

\`<@U0123ABCD>\` looks guessable and is not. An id you invented either pings
nobody or pings a stranger. Call **\`slack_mention(connection, name)\`** with
the person's name and put its answer in the text exactly as it comes back.

The same applies in reverse: a message that arrives containing \`<@U…>\` is not
a name. \`slack_whoIs\` turns it into one before you quote it back at somebody.

## Reply in the thread

If you are answering a message, pass its \`threadTs\` to \`slack_post\`. A reply
posted to the channel instead of the thread is a new conversation in front of
everybody, and the person who asked has to work out which answer is theirs.

Post to the channel itself only when starting something genuinely new.

## Length, and the alternative to it

If your answer is longer than a screen, do not paste it. Post two or three
lines saying what it is and what it concludes, and attach the rest:

- text — a log, a CSV, a query, a config — goes through **\`slack_upload\`**
  with a filename whose extension says what it is
- a PDF or an image goes through **\`slack_uploadBinary\`** as base64, which is
  what \`pdf_fromHtml\` already answers
- a diagram goes through **\`mermaid_render\`** or **\`nomnoml_render\`** and
  then \`slack_uploadBinary\` with a \`.png\` filename — see below

A wall of text costs everybody in the channel a scroll. A summary and a file
costs the two people who care a click.

## Diagrams: always the picture, never the markup

**Slack draws no SVG.** It hosts one as a file and shows a card with a filename
on it, so an SVG posted to a channel is a thing people have to download and open
before they can see it — which is to say, a thing most of them will never see.

So take the default and do not think about it. \`mermaid_render\` and
\`nomnoml_render\` both answer a **png** unless you ask otherwise, and that png
goes to \`slack_uploadBinary\` with a \`.png\` filename. Ask for
\`format: 'svg'\` only when the reader is not a person: something that embeds
the markup, or a file somebody is going to edit. Posting one to a channel is
never that.

Pass the **\`key\`** the render answered, not the bytes:

    mermaid_render(source)  ->  { png: '…', key: 'mermaid.1k3af9' }
    slack_uploadBinary(channel, 'flow.png', '', comment, threadTs, 'mermaid.1k3af9')

The answer reaches the next call by going through you, and a few kilobytes of
base64 does not survive being written out again — one arrived with a stray
character in the middle of it and the whole call was rejected as malformed.
The key is a dozen characters and what it names never leaves the server.

## Before you post at all

\`slack_readThread\` first when you are joining something already in progress.
Somebody has usually answered already, and the most annoying possible message
is a confident restatement of what the previous reply said.

React rather than reply when acknowledgement is all that is needed.
\`slack_react\` with a checkmark says "done, nothing to read here" without
adding a message to anybody's unread count.`,
      }),
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

          const read = through((use) => orknux.slack.thread(use, channel, threadTs, 2), connection, this.settings.slack);
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
          'event came in on, or an empty string to use the configured one. An empty string is always safe: a connection named by an older event may since have been deleted. ' +
          'Answers channel, ts, user and text.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'link', type: 'string' },
        ],
        returnType: 'LinkedMessage',
        run: (connection, link) => {
          const read = through((use) => orknux.slack.message(use, link), connection, this.settings.slack);
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
          'connection the event came in on, or an empty string to use the configured one. An empty string is always safe: a connection named by an older event may since have been deleted. ' +
          'Answers id, ' +
          'name, realName, displayName and whether it is a bot.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'userId', type: 'string' },
        ],
        returnType: 'User',
        run: (connection, userId) => {
          const found = through((use) => orknux.slack.user(use, userId), connection, this.settings.slack);
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
          'use the configured one. An empty string is always safe: a connection named by an older event may since have been deleted. limit caps how many messages come back.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'channel', type: 'string' },
          { name: 'threadTs', type: 'string' },
          { name: 'limit', type: 'number', required: false, default: 20 },
        ],
        returnType: 'Thread',
        run: (connection, channel, threadTs, limit) => {
          const read = through((use) => orknux.slack.thread(use, channel, threadTs, limit), connection, this.settings.slack);
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
          'attachments hangs files on the message, and takes either kind: a permalink string for a ' +
          'file already on Slack (as an event or readThread carries it), or a map for one that is ' +
          'not there yet - {filename, content} for text like a CSV, {filename, base64} for bytes ' +
          'like a PDF (pdf_fromHtml answers base64 ready for this), or {url} to copy a file from a ' +
          'url. The maps upload first and need the botToken parameter; permalinks need nothing. ' +
          'Pass an empty array for ' +
          'none. Pass the connection the event came in on, or an empty string to use the configured ' +
          'one. An empty string is always safe: a connection named by an older event may since have been deleted. Answers the channel and the new message\'s ts.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'channel', type: 'string' },
          { name: 'text', type: 'string' },
          { name: 'threadTs', type: 'string' },
          { name: 'attachments', type: 'array' },
        ],
        returnType: 'Posted',
        run: (connection, channel, text, threadTs, attachments) => {
          /*
           * Slack attaches a hosted file to a message when the message carries
           * the file's permalink - that is Slack's own mechanism, so linking a
           * file that is already there needs nothing beyond SLACK_POST_MESSAGE.
           * A file that is *not* there yet is put there first, which is the
           * part that needs `botToken`. The `| ` label keeps the raw
           * url out of the text people read; the preview still unfurls.
           */
          let said = text;
          const linked = attaching(this.settings, attachments);
          if (linked.length > 0) {
            said = `${said}${linked.map((one) => ` <${one}| >`).join('')}`;
          }

          const posted = through(
            (use) => orknux.slack.post(use, channel, said, threadTs || undefined),
            connection,
            this.settings.slack,
          );
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
          'connection the event came in on, or an empty string to use the configured one. An empty string is always safe: a connection named by an older event may since have been deleted.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'channel', type: 'string' },
          { name: 'ts', type: 'string' },
          { name: 'emoji', type: 'string' },
        ],
        returnType: 'boolean',
        run: (connection, channel, ts, emoji) => {
          const done = through((use) => orknux.slack.react(use, channel, ts, emoji), connection, this.settings.slack);
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
          'or an empty string to use the configured one. An empty string is always safe: a connection named by an older event may since have been deleted. limit caps the matches. Note: ' +
          'Slack answers search only for a user token, so either the userToken parameter is set or the ' +
          'connection carries one in its User Token field.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'query', type: 'string' },
          { name: 'limit', type: 'number', required: false, default: 20 },
        ],
        returnType: 'SearchResult',
        run: (connection, query, limit) => {
          /*
           * The plugin's own user token first, where a workspace set one, and
           * the connection's User Token field otherwise. Both end at the same
           * Slack endpoint with the same kind of credential; what differs is
           * who holds it, and a workspace that has filled in neither gets the
           * capability's own error rather than a second one invented here.
           */
          const mine = this.settings.userToken;
          const found =
            typeof mine === 'string' && mine.length > 0
              ? searchAs(mine, query, limit)
              : through((use) => orknux.slack.search(use, query, limit), connection, this.settings.slack);
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
          'string to use the configured one. An empty string is always safe: a connection named by an older event may since have been deleted.',
        params: [
          { name: 'connection', type: 'string' },
          { name: 'name', type: 'string' },
        ],
        returnType: 'string',
        run: (connection, name) => {
          const resolved = through((use) => orknux.slack.mention(use, name), connection, this.settings.slack);
          if (resolved.error !== undefined) {
            throw new Error(`could not resolve the mention: ${resolved.error}`);
          }
          return resolved.mention;
        },
      }),

      new OrknuxFunction({
        name: 'upload',
        description:
          'Uploads text content to Slack as a file the workspace hosts - an SVG, a CSV, a log, JSON, ' +
          'markdown, source - and shares it to a channel with a message. Anything you can read is ' +
          'text and belongs here, including an SVG a renderer answered with: send it as it stands, ' +
          'never base64. Slack hosts what it is given but draws none of it - every one of these ' +
          'arrives as a file card, an SVG included - so where somebody should see a picture in ' +
          'the message, upload a PNG with uploadFromUrl instead. Pass the channel id (not a #name), a ' +
          'filename whose extension says what the content is (report.csv, diagram.mmd), the content ' +
          'itself, what the sharing message should say, and a threadTs to share inside a thread - ' +
          'empty for the channel itself. Pass an empty channel to only upload: the answered permalink ' +
          'then goes in a later post\'s attachments. Text only - a PDF or an image cannot travel this ' +
          'way; give remoteFile its url instead. Where a tool answered a key for what it made, ' +
          'PASS THAT as contentKey and leave content empty: the bytes are taken off the server ' +
          'instead of out of what you type back, which is the one thing that stops a long file ' +
          'arriving truncated. Answers the file\'s id and permalink. Needs the botToken ' +
          'parameter.',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'filename', type: 'string' },
          { name: 'content', type: 'string' },
          { name: 'comment', type: 'string' },
          { name: 'threadTs', type: 'string' },
          { name: 'contentKey', type: 'string', required: false, default: '' },
        ],
        returnType: 'HostedFile',
        run: (channel, filename, content, comment, threadTs, contentKey) => {
          /*
           * The key is preferred over the content, and that is the point of it.
           *
           * Anything a tool answered with has to be written back out by the
           * model to reach the next call, and a few kilobytes of it does not
           * survive the trip - a rendered diagram went to Slack with a stray
           * character in the middle and the whole call was rejected as
           * malformed JSON. A key is a dozen characters, and what it names
           * never leaves the server.
           *
           * Preferred rather than exclusive: a caller with the text in hand
           * passes content as before, and a workflow node has no session to
           * keep anything in, so content stays the way that always works.
           */
          let said = content;
          if (typeof contentKey === 'string' && contentKey.length > 0) {
            const held = orknux.session.store.get(contentKey);
            if (typeof held !== 'string' || held.length === 0) {
              throw new Error(
                `nothing is kept under ${contentKey} in this session: pass the content itself, ` +
                  'or render it again to get a fresh key',
              );
            }
            said = held;
          }

          return uploadedText(this.settings, filename, said, channel, comment, threadTs);
        },
      }),

      new OrknuxFunction({
        name: 'uploadBinary',
        description:
          'Uploads bytes to Slack as a file the workspace hosts - a PDF, a PNG, a JPEG - and ' +
          'shares them to a channel with a message. PASS contentKey, NOT base64: mermaid_render, ' +
          'nomnoml_render and pdf_fromHtml each answer a short key beside the bytes, and giving ' +
          'that key here takes them off the server instead of out of what you type back. A few ' +
          'kilobytes of base64 does not survive being written into a tool call - it arrives with a ' +
          'character wrong and the whole call is rejected as malformed - so copying the bytes out ' +
          'of one answer and into the next argument is the one thing that reliably fails. Only ' +
          'pass base64 directly when the bytes came from somewhere that answered no key. Either ' +
          'way you must pass a filename whose extension says what the bytes are (report.pdf, ' +
          'chart.png), the channel id, what the sharing message should say, and a threadTs - or an ' +
          'empty channel to only upload. For bytes only: an SVG, a CSV, JSON, markdown or any ' +
          'source you could read goes to upload instead, as it stands. Answers the file\'s id and ' +
          'permalink. Needs the botToken parameter.',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'filename', type: 'string' },
          { name: 'base64', type: 'string' },
          { name: 'comment', type: 'string' },
          { name: 'threadTs', type: 'string' },
          { name: 'contentKey', type: 'string', required: false, default: '' },
        ],
        returnType: 'HostedFile',
        run: (channel, filename, base64, comment, threadTs, contentKey) => {
          /*
           * The key wins over the base64, for the reason upload{Q}s does: bytes
           * that reach here by being written out by a model do not survive the
           * trip. A rendered diagram is tens of kilobytes of base64, and one
           * stray character makes the whole call unparseable - which is how
           * this failed before there was a key to pass instead.
           */
          let bytes = base64;
          if (typeof contentKey === 'string' && contentKey.length > 0) {
            const held = orknux.session.store.get(contentKey);
            if (typeof held !== 'string' || held.length === 0) {
              throw new Error(
                `nothing is kept under ${contentKey} in this session: pass the base64 itself, ` +
                  'or render it again to get a fresh key',
              );
            }
            bytes = held;
          }

          return uploadedBytes(this.settings, filename, bytes, channel, comment, threadTs);
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
        returnType: 'HostedFile',
        run: (channel, url, filename, comment, threadTs) =>
          uploadedFromUrl(this.settings, url, filename, channel, comment, threadTs),
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
        returnType: 'HostedFile',
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
        returnType: 'Attachments',
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
        returnType: 'AttachmentContent',
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
