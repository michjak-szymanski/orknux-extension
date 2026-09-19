/*
 * Microsoft Teams, as a plugin.
 *
 * Teams has no Socket Mode. Slack's websocket is what lets an installation
 * behind a firewall hear about a message without publishing a port, and there
 * is nothing on the Teams side that does the same job: the two ways Microsoft
 * delivers a message are an Azure Bot messaging endpoint and a Graph change
 * notification, and both of them are Microsoft calling a URL of ours. So the
 * receiving half here is a Teams **outgoing webhook** - the one delivery Teams
 * offers that needs no Azure application, no Graph consent and no subscription
 * to renew - pointed at one of this installation's webhook triggers.
 *
 * What makes that safe to point at the open internet is the header Teams sends
 * with it. Every request carries `Authorization: HMAC <signature>`, where the
 * signature is HMAC-SHA256 of the exact bytes of the body, keyed by the security
 * token Teams handed out when the webhook was created. Checking that is pure
 * arithmetic over the request, which is precisely what a plugin can do and what
 * a webhook trigger's `FUNCTION` authentication was built to ask - so `verify`
 * below is the gatekeeper, and the token reaches it as a secret parameter,
 * which means a workspace variable, which means the encrypted column.
 *
 * The sending half is not here at all, and that is deliberate. A plugin has no
 * network - no files, no sockets, no host - so it could not call Graph even if
 * it wanted to, and it should not want to: an outgoing call made from inside a
 * sandbox would go round the installation's proxy rules, which every other call
 * this product makes obeys. So a message is sent by an HTTP request action
 * against a connection, the way any other API is called here, and what this
 * plugin contributes is the shape of the request: `message` builds the body
 * Graph expects and `channelUrl` and `replyUrl` build the addresses, so nobody
 * has to keep Graph's spelling in their head or in a workflow's fields.
 *
 * Nothing on this file asks for a permission. Everything it does is arithmetic
 * and string handling — and the arithmetic is `orknux.crypto`'s now, which is
 * not a grant either: a digest reaches nothing, sends nothing and learns
 * nothing, so it needs no capability and no dialog. The SHA-256 that used to
 * be written out here by hand is gone, along with the statement budget it ate
 * and the constant-time comparison that a JIT was free to stop making
 * constant-time.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The Graph host every address below is built on. */
const GRAPH = 'https://graph.microsoft.com/v1.0';
/** A field off something that may not be an object at all, since this is reading a request. */
function field(holder, name) {
  return holder !== null && typeof holder === 'object' ? holder[name] : undefined;
}

function textOf(holder, name) {
  const value = field(holder, name);
  return typeof value === 'string' ? value : '';
}

export default class Teams extends OrknuxPlugin {

  id() {
    return 'teams';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'webhookSecret',
        description: 'The security token Teams showed when the outgoing webhook was created.',
        type: 'string',
        required: true,
        // Refuses a typed-in value, so the only way to answer it is to point at
        // one of the workspace's variables - which is the encrypted column.
        secret: true,
      }),
      new OrknuxParameter({
        name: 'webhookName',
        description: 'What the outgoing webhook is called in Teams, so its mention can be taken off the text.',
        type: 'string',
        required: false,
      }),
    ];
  }

  /* The one shape this plugin answers; everything else here is a string. */
  objects() {
    return [
      new OrknuxObject({
        name: 'Sender',
        description: 'Who said it and where — the fields a reply has to be addressed with.',
        properties: [
          { name: 'user', kind: 'string', description: 'Their display name.' },
          {
            name: 'userId',
            kind: 'string',
            description: 'The id Teams knows them by, which a mention in a reply must name.',
          },
          { name: 'aadObjectId', kind: 'string', description: 'Their directory object id, where Teams sent one.' },
          { name: 'conversationId', kind: 'string', description: 'The conversation the activity arrived in.' },
          { name: 'teamId', kind: 'string', description: 'What channelUrl and replyUrl take.' },
          { name: 'channelId', kind: 'string', description: 'What channelUrl and replyUrl take.' },
          { name: 'tenantId', kind: 'string', description: 'Which tenant it came from.' },
          { name: 'messageId', kind: 'string', description: 'What replyUrl threads a reply onto.' },
        ],
      }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'verify',
        description: 'Whether this request really came from the Teams outgoing webhook it claims to.',
        // Named to match what a webhook trigger hands its gatekeeper. The
        // signature is over the bytes that arrived, so it is `rawBody` and not
        // the parsed body that is hashed: re-serialising the JSON would reorder
        // a key or drop a space and every request would be refused.
        params: [{ name: 'headers', type: 'map' }, { name: 'rawBody', type: 'string' }],
        returnType: 'boolean',
        run: (headers, rawBody) => {
          const secret = this.settings.webhookSecret;
          if (typeof secret !== 'string' || secret.length === 0) {
            // Required, so a workspace that has not answered it is already
            // marked as needing to. Refusing everybody is the safe reading.
            return false;
          }
          // Teams sends "HMAC <signature>". The headers arrive lower-cased,
          // which is the one thing about them that can be relied on.
          const authorization = textOf(headers, 'authorization');
          const marker = authorization.indexOf(' ');
          if (marker < 0 || authorization.slice(0, marker).toUpperCase() !== 'HMAC') {
            return false;
          }

          /*
           * The secret arrives base64 and the signature goes back as base64,
           * which is exactly the shape `orknux.crypto` speaks — so the key
           * crosses as it was given and nothing here decodes anything.
           */
          const body = typeof rawBody === 'string' ? rawBody : '';
          const mine = orknux.crypto.hmac('sha256', { base64: secret }, { text: body });
          if (mine.error !== undefined) {
            // A refusal is data, and "could not compute the signature" reads
            // as a request this will not vouch for.
            return false;
          }

          const sent = authorization.slice(marker + 1).trim();
          const same = orknux.crypto.timingSafeEqual({ base64: mine.base64 }, { base64: sent });
          return same.equal === true;
        },
      }),

      new OrknuxFunction({
        name: 'text',
        description: 'What was said, with the mention of the webhook and any markup taken off.',
        params: [{ name: 'activity', type: 'map' }],
        returnType: 'string',
        run: (activity) => {
          let said = textOf(activity, 'text');
          if (said.length === 0) {
            return '';
          }

          // Teams writes a mention as `<at>Name</at>`, and the name is the
          // webhook's own - so what is left is the instruction somebody typed
          // rather than the address they typed it to.
          const name = this.settings.webhookName;
          if (typeof name === 'string' && name.length > 0) {
            said = said.split('<at>' + name + '</at>').join(' ');
          }

          return said.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        },
      }),

      new OrknuxFunction({
        name: 'sender',
        description: 'Who said it and where, as the fields a reply has to be addressed with.',
        params: [{ name: 'activity', type: 'map' }],
        returnType: 'Sender',
        run: (activity) => {
          const channelData = field(activity, 'channelData');
          return {
            user: textOf(field(activity, 'from'), 'name'),
            // Teams' own id for the person, which is what a mention in a reply
            // has to name; the display name is not addressable.
            userId: textOf(field(activity, 'from'), 'id'),
            aadObjectId: textOf(field(activity, 'from'), 'aadObjectId'),
            conversationId: textOf(field(activity, 'conversation'), 'id'),
            teamId: textOf(channelData, 'teamsTeamId'),
            channelId: textOf(channelData, 'teamsChannelId'),
            tenantId: textOf(field(channelData, 'tenant'), 'id'),
            messageId: textOf(activity, 'id'),
          };
        },
      }),

      new OrknuxFunction({
        name: 'message',
        description: 'The body of a Graph request that posts this text to a channel.',
        params: [{ name: 'text', type: 'string' }, { name: 'html', type: 'boolean' }],
        // A string and not a map, because this is the body of a request and a
        // request body is bytes. Handing back a map would leave whoever wired
        // the node guessing how it was going to be serialised.
        returnType: 'string',
        run: (text, html) => JSON.stringify({
          body: {
            contentType: html === true ? 'html' : 'text',
            content: typeof text === 'string' ? text : String(text ?? ''),
          },
        }),
      }),

      new OrknuxFunction({
        name: 'channelUrl',
        description: 'Where a new message in a channel is posted.',
        params: [{ name: 'teamId', type: 'string' }, { name: 'channelId', type: 'string' }],
        returnType: 'string',
        run: (teamId, channelId) =>
          GRAPH + '/teams/' + encodeURIComponent(teamId) + '/channels/' + encodeURIComponent(channelId) + '/messages',
      }),

      new OrknuxFunction({
        name: 'replyUrl',
        description: 'Where a reply under an existing message is posted.',
        params: [
          { name: 'teamId', type: 'string' },
          { name: 'channelId', type: 'string' },
          { name: 'messageId', type: 'string' },
        ],
        returnType: 'string',
        run: (teamId, channelId, messageId) =>
          GRAPH + '/teams/' + encodeURIComponent(teamId) + '/channels/' + encodeURIComponent(channelId) +
          '/messages/' + encodeURIComponent(messageId) + '/replies',
      }),
    ];
  }
}
