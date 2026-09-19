/**
 * The contract as the sandbox presents it: the globals, no imports.
 *
 * This is the other way to write a plugin, and the one the server's own template
 * uses. Nothing is imported, so nothing has to be bundled — the file compiles to
 * itself, and what the editor checks it against is declared here rather than
 * pulled in. The declarations mirror the template the server serves from
 * `/api/plugins/template`, which is filled in from what that build actually
 * enforces; these are the same names and fields, pinned to the server this
 * package tracks.
 *
 *     /// <reference types="@orknux/plugin/globals" />
 *
 * or, once, in tsconfig.json:
 *
 *     { "compilerOptions": { "types": ["@orknux/plugin/globals"] } }
 *
 * Use it when a plugin is a single file with no dependencies and you would
 * rather not run a bundler at all — `tsc` alone produces something the server
 * takes. Everything else wants `import { definePlugin, fn } from '@orknux/plugin'`,
 * which is the same contract with the parameter types carried into `run`.
 *
 * Do not load both in one file. They describe the same classes, and an import
 * shadows the global of the same name, which reads as a puzzle rather than as
 * the choice it is.
 */

/** The shape of a value crossing between a workflow and a plugin. */
type OrknuxValueType = 'string' | 'number' | 'boolean' | 'map' | 'array';

/** What a plugin may ask for. Exactly this list, and nothing else. */
type OrknuxPermission = 'CONSOLE' | 'INTL' | 'TEXT_ENCODING' | 'PERFORMANCE' | 'TEMPORAL';

/** What a plugin may ask the server to do for it. Exactly this list, and nothing else. */
type OrknuxCapability =
  | 'SLACK_READ_THREAD'
  | 'SLACK_POST_MESSAGE'
  | 'SLACK_ADD_REACTION'
  | 'SLACK_READ_MESSAGE'
  | 'SLACK_READ_USER'
  | 'SLACK_MENTION'
  | 'SLACK_SEARCH'
  | 'NETWORK_REQUEST';

/** The kinds of connection a workspace can hold. */
type ConnectionType = 'SLACK' | 'SMTP' | 'HTTP';

/**
 * A connection the workspace configured, handed to a plugin as a handle.
 *
 * An id and a type and nothing else. A plugin cannot open a socket — the
 * sandbox has no network and no permission can ask for one — so what crosses is
 * a name for a connection the server will use on the plugin's behalf, never the
 * connection itself and never its credential.
 *
 * The type parameter is what makes `SlackConnection` mean something: it appears
 * as a member, so a Jira connection is not assignable where a Slack one is
 * wanted and the mistake is caught where it is written rather than at the first
 * call.
 */
declare class OrknuxConnection<T extends ConnectionType> {
  readonly id: number;
  readonly type: T;
}

/** A Slack connection, which is what the Slack helpers take. */
type SlackConnection = OrknuxConnection<'SLACK'>;

/** One message in a Slack thread, as much of it as anything here needs. */
interface SlackThreadMessage {
  /** Slack's timestamp, which is also the message's id. */
  ts: string;
  /** Who wrote it, or the bot that did. Null where Slack said neither. */
  user: string | null;
  text: string;
  /** Whether this is the message the thread hangs under rather than a reply. */
  parent: boolean;
}

/** A thread that was read, or why it could not be. */
type SlackThread =
  | {
      messages: SlackThreadMessage[];
      /**
       * Slack's own count of the replies under the parent.
       *
       * Not `messages.length - 1`: a page holds what was asked for and the
       * count is of the whole thread. It is the number a filter wants —
       * `replies === 1` is the first reply.
       */
      replies: number;
      error?: undefined;
    }
  | {
      /**
       * Why not, in Slack's own words where they were Slack's:
       * `not_in_channel`, `thread_not_found`, and the rest.
       *
       * A refusal rather than a thrown error, so a plugin can say something
       * useful about it. Check for it before reading `messages`.
       */
      error: string;
      messages?: undefined;
      replies?: undefined;
    };

/** A message that was posted — its channel and its own `ts` — or why not. */
type SlackPost =
  | { channel: string; ts: string | null; error?: undefined }
  | { error: string; channel?: undefined; ts?: undefined };

/** Whether a reaction went on. Already-reacted counts as ok. */
type SlackReaction = { ok: true; error?: undefined } | { error: string; ok?: undefined };

/** The one message a permalink points at, or why it could not be read. */
type SlackLinkedMessage =
  | {
      channel: string;
      ts: string;
      user: string | null;
      text: string;
      threadTs: string | null;
      error?: undefined;
    }
  | { error: string; text?: undefined };

/** Who a user id belongs to, or why that could not be said. */
type SlackUserInfo =
  | {
      id: string;
      name: string;
      realName: string | null;
      displayName: string | null;
      bot: boolean;
      error?: undefined;
    }
  | { error: string; id?: undefined };

/** The notation Slack renders as a mention, ready to put in a message. */
type SlackMention =
  | { mention: string; id: string; label: string; error?: undefined }
  | { error: string; mention?: undefined };

/** What a search of Slack's messages came to, or why it could not be run. */
type SlackSearchResult =
  | {
      matches: {
        channel: string | null;
        channelName: string | null;
        ts: string | null;
        user: string | null;
        text: string;
        /** The way back to the message, for the thread around it. */
        permalink: string | null;
      }[];
      /** How many the whole search holds, not how many came back. */
      total: number;
      error?: undefined;
    }
  | { error: string; matches?: undefined; total?: undefined };

/**
 * What came back, or why nothing did.
 *
 * A refusal is data rather than a thrown error, so a plugin can say something
 * useful about it — and so a condition that could not be decided does not
 * quietly decide. `json` sits beside `body` where the reply parsed as JSON;
 * `body` is always the text that arrived.
 */
type OrknuxResponse =
  | {
      status: number;
      headers: Record<string, string>;
      body: string;
      json?: unknown;
      error?: undefined;
    }
  | {
      error: string;
      status?: undefined;
      headers?: undefined;
      body?: undefined;
      json?: undefined;
    };

/**
 * A binary answer: the bytes as base64, and what they claim to be. Base64 is
 * the one shape bytes have in a sandbox where everything crosses as text.
 */
type OrknuxBinaryResponse =
  | {
      status: number;
      headers: Record<string, string>;
      /** The answer's bytes, base64-encoded. */
      base64: string;
      /** How many bytes that decodes to. */
      size: number;
      /** The answer's own content-type header, or null where it sent none. */
      contentType: string | null;
      error?: undefined;
    }
  | {
      error: string;
      status?: undefined;
      headers?: undefined;
      base64?: undefined;
      size?: undefined;
      contentType?: undefined;
    };

/** What `orknux.session.store.put` answered: stored, or refused in a sentence. */
type OrknuxStorePut = { ok: true; error?: undefined } | { error: string; ok?: undefined };

/**
 * What the server will do on a plugin's behalf.
 *
 * A plugin has no network and no way to ask for one, so the calls that have to
 * reach outside are made by the server, under a capability the plugin declares
 * and a person accepts, and what crosses is data.
 *
 * Every call but `log` needs its capability. Without it the call answers
 * `{ error }` saying so, rather than reaching anything.
 */
declare const orknux: {
  slack: {
    /**
     * The messages in one Slack thread, oldest first.
     *
     * Needs the `SLACK_READ_THREAD` capability.
     *
     * @param connection which Slack to read through. A workspace with two Slack
     *   connections has two Slacks, and a reply that arrived on one has to be
     *   read through that one — so pass the connection the trigger says its
     *   event came in on rather than assuming.
     * @param channel the channel's id, as the trigger gives it.
     * @param threadTs the parent's timestamp — Slack's `thread_ts`, which every
     *   reply in the thread carries.
     * @param limit how many to fetch; the count comes back whatever this is.
     *   Capped by the server.
     */
    thread(
      connection: SlackConnection,
      channel: string,
      threadTs: string,
      limit?: number,
    ): SlackThread;

    /**
     * Post a message through a connection the plugin was given.
     *
     * Needs the `SLACK_POST_MESSAGE` capability.
     *
     * @param connection which Slack to post through.
     * @param channel the channel id, or a `#name`/`@handle` it resolves.
     * @param text what to say.
     * @param threadTs when set, the message joins that thread. The answer's
     *   `ts` is the new message's own timestamp, which `react` hangs on and a
     *   reply threads onto.
     */
    post(
      connection: SlackConnection,
      channel: string,
      text: string,
      threadTs?: string,
    ): SlackPost;

    /**
     * Add an emoji reaction to a message.
     *
     * Needs the `SLACK_ADD_REACTION` capability.
     *
     * @param ts the message's own `ts` — `post` returns one, and every thread
     *   message carries one.
     * @param emoji the short name, with or without the colons.
     */
    react(connection: SlackConnection, channel: string, ts: string, emoji: string): SlackReaction;

    /**
     * The one message a Slack permalink points at.
     *
     * Needs the `SLACK_READ_MESSAGE` capability.
     *
     * @param link the message's permalink — what a message pasted into another
     *   message travels as.
     */
    message(connection: SlackConnection, link: string): SlackLinkedMessage;

    /**
     * Who a Slack user id is.
     *
     * Needs the `SLACK_READ_USER` capability.
     *
     * @param userId the id, bare or as the `<@U…>` notation a message carries
     *   it in.
     */
    user(connection: SlackConnection, userId: string): SlackUserInfo;

    /**
     * The notation that pings somebody, from their name.
     *
     * Needs the `SLACK_MENTION` capability.
     *
     * @param name a display name, username, email, id, or a user group's
     *   handle — with or without the `@`. The answer's `mention` goes into
     *   `post`'s text as it is.
     */
    mention(connection: SlackConnection, name: string): SlackMention;

    /**
     * Search Slack's messages, the way the search box does.
     *
     * Needs the `SLACK_SEARCH` capability — and, from Slack's own side, a
     * **user** token: `search.messages` refuses the usual bot token with
     * `not_allowed_token_type`, and that refusal comes back as the error.
     *
     * @param query in Slack's search syntax — `in:#channel`, `from:@name`
     *   and the rest work as they do in the box.
     * @param limit how many matches to bring back; capped to one page.
     */
    search(connection: SlackConnection, query: string, limit?: number): SlackSearchResult;
  };

  http: {
    /**
     * One HTTP request, made by the server on this plugin's behalf.
     *
     * Needs the `NETWORK_REQUEST` capability, which is the widest thing a
     * plugin can ask for and the one an administrator will think hardest
     * about: it reaches anything the server can. Ask for it only if the plugin
     * is about an outside service, and say in the plugin's description which
     * one.
     *
     * Where a request may get to is the installation's proxy rules, which this
     * cannot see and cannot argue with. The body comes back as text; there are
     * no bytes here, because there is nowhere in the sandbox to put them. An
     * object body goes out as JSON with the content-type set — the header is
     * the half people forget — and a string body is passed through untouched.
     *
     * @param what the url on its own, or the whole request.
     */
    request(
      what:
        | string
        | {
            url: string;
            method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
            headers?: Record<string, string>;
            body?: string | Record<string, unknown> | readonly unknown[];
          },
    ): OrknuxResponse;

    /** The same, for the request nearly everybody wants. */
    get(url: string, headers?: Record<string, string>): OrknuxResponse;

    /** And the other one. An object body goes as JSON, with the header set. */
    post(
      url: string,
      body?: string | Record<string, unknown> | readonly unknown[],
      headers?: Record<string, string>,
    ): OrknuxResponse;

    /**
     * Sends bytes — a file — given as base64, which is the one shape binary
     * has here. Sent as an octet stream unless `contentType` or a header says
     * what it is; POST, capped at 10 MB of decoded bytes. Needs
     * `NETWORK_REQUEST` like every other request.
     */
    upload(
      url: string,
      base64: string,
      contentType?: string,
      headers?: Record<string, string>,
    ): OrknuxResponse;

    /**
     * Fetches binary content — an image, a PDF — and answers `base64`,
     * `contentType` and `size` instead of `body`, because a PNG does not
     * survive being read as a string. Capped at 5 MB of bytes.
     */
    download(url: string, headers?: Record<string, string>): OrknuxBinaryResponse;
  };

  /**
   * The AI session's own store, for a plugin that has to keep its place
   * between the calls of one conversation.
   *
   * What one tool call puts, a later one gets, for as long as the session
   * lives — and no other session ever sees it. Not a capability: nothing
   * outside the session is reached by it. The doors only exist where the call
   * was made inside an AI session; anywhere else `put` answers `{ error }`
   * saying so and `get` answers null.
   */
  session: {
    store: {
      /**
       * Stores one value under a key, replacing what was there. The value
       * makes the trip as JSON, so what comes back out is a copy — and
       * anything JSON cannot say (a function, undefined) does not survive.
       */
      put(key: string, value: unknown): OrknuxStorePut;

      /** What the key holds, parsed, or null where nothing does. */
      get(key: string): unknown;
    };
  };

  /**
   * Not a capability, and never needed granting — nothing is reached by it.
   * The line crosses as text and the server decides where it goes; a level
   * below the installation's threshold is dropped where it was written, so
   * tracing can stay in.
   */
  log: {
    debug(...parts: unknown[]): void;
    info(...parts: unknown[]): void;
    warn(...parts: unknown[]): void;
    error(...parts: unknown[]): void;
  };
};

/** A function's declaration, checked as it is constructed. */
interface OrknuxFunctionDeclared {
  /** An identifier: letters, digits and underscores. */
  name: string;
  /** Optional; shown beside it in the interface. */
  description?: string;
  /** In the order `run` receives them. */
  params?: { name: string; type: OrknuxValueType }[];
  /** What it answers with. A function has to answer something. */
  returnType: OrknuxValueType;
  /** What it does. Stays here; the server calls back into it. */
  run: (...args: never[]) => unknown;
}

/** A tool's declaration — a run of its own, offered to agents. */
interface OrknuxToolDeclared {
  /** An identifier: letters, digits and underscores. */
  name: string;
  /** Written for the model that reads it: when to call this, and with what. */
  description?: string;
  /** In the order `run` receives them. */
  params?: { name: string; type: OrknuxValueType }[];
  /** What it answers with. A tool answers a model, so it has to answer something. */
  returnType: OrknuxValueType;
  /** What it does. Stays here; the server calls back into it. */
  run: (...args: never[]) => unknown;
}

/** A proxy's declaration — one of this plugin's own functions, fronted for agents. */
interface OrknuxFunctionToolDeclared {
  /** The name of one of this plugin's functions, as `functions()` declares it. */
  function: string;
  /** What agents call it. Defaults to the function's own name. */
  name?: string;
  /** Written for the model. Defaults to the function's description. */
  description?: string;
}

/** What a parameter may be: exactly what a workspace variable can hold. */
type OrknuxParameterType = 'string' | 'number' | 'boolean' | 'connection';

/** A parameter's declaration — one thing the plugin has to be told, per workspace. */
interface OrknuxParameterDeclared {
  /** An identifier: letters, digits and underscores. */
  name: string;
  /** Optional; shown under it on the form somebody fills in. */
  description?: string;
  type: OrknuxParameterType;
  /**
   * Whether the plugin can work without it. Defaults to true, because a
   * parameter nobody needs is one nobody should be asked for.
   *
   * A workspace that has not answered a required one is marked as such in its
   * plugin list and against the parameter itself.
   */
  required?: boolean;
  /**
   * Whether this is asking for something that should not be typed into a form.
   * Defaults to false.
   *
   * Saying true refuses a typed-in value: the only way to answer it is to
   * point at one of the workspace's variables, which is where this
   * installation keeps things it encrypts.
   */
  secret?: boolean;
  /**
   * Which kind of connection, and required when `type` is `'connection'`.
   *
   * It narrows the picker to the connections the plugin can actually use: a
   * Slack plugin handed a Jira connection has been handed a credential it
   * cannot read and fails at the first call, which is a worse answer than a
   * list that never offered it.
   *
   * What arrives in `settings` is then an `OrknuxConnection<T>` — an id and a
   * type, never the connection's credential. The sandbox has no network; the
   * server makes the call.
   */
  connectionType?: ConnectionType;
}

/**
 * What a plugin extends. Defined by the sandbox before this file is evaluated,
 * which is why it is declared rather than imported.
 */
declare abstract class OrknuxPlugin {
  /** What this plugin calls itself, and the prefix on everything it declares. */
  abstract id(): string;

  /** Which plugin API this was written against. */
  abstract apiVersion(): number;

  /** What this plugin offers to workflows. Defaults to none. */
  functions(): OrknuxFunction[];

  /**
   * What this plugin offers to agents, as tools a model calls. Defaults to
   * none.
   *
   * A surface of its own because it has a reader of its own: a tool's
   * description is read by a model deciding whether to call it, where a
   * function's is read by a person building a workflow. A tool that is really
   * one of the functions is declared as an `OrknuxFunctionTool`, which proxies
   * it rather than describing it twice — params, return type and
   * implementation stay the function's, and only the name and description may
   * be its own.
   */
  tools(): (OrknuxTool | OrknuxFunctionTool)[];

  /** What this plugin has to be told before it can work. Defaults to none. */
  parameters(): OrknuxParameter[];

  /**
   * Which JavaScript this plugin needs. Defaults to none.
   *
   * A plugin embeds its libraries rather than importing them, and a bundle
   * written for a browser or for Node often expects language features this
   * sandbox does not switch on. Say which, and whoever loads the plugin is
   * shown the list and has to accept it. Nothing is relaxed that was not
   * accepted, and nothing is relaxed for any other plugin.
   *
   * Loading is done with none of them granted, because that is the run that
   * finds out which you want — so the top level of your bundle has to evaluate
   * without them. Ask for what `run` needs, not for what loading needs.
   */
  permissions(): OrknuxPermission[];

  /**
   * What this plugin asks the server to do on its behalf. Defaults to none.
   *
   * Separate from `permissions()`, which only ever turns on a language
   * builtin. These reach outside — so they are declared apart, granted apart,
   * and shown apart to whoever accepts the plugin.
   */
  capabilities(): OrknuxCapability[];

  /**
   * The library files this plugin ships with, as paths relative to its own
   * file: `lib/util.js` or `./lib/util.js`. Defaults to none.
   *
   * The complete list — every file that arrives beside the plugin is declared
   * here, and every relative `import` in the plugin or in a library resolves
   * to a declared path. No absolute paths, no URLs, no `..`, no bare
   * specifiers — an npm dependency is still bundled in, not declared.
   *
   * Whoever loads the plugin is shown this list and has to allow it. A zip's
   * contents are checked against it; a load from a URL fetches these files,
   * resolved against the plugin's URL, and only these.
   */
  libraries(): string[];

  /**
   * What a workspace set those parameters to, keyed by name.
   *
   * Frozen, and put there by the server for the length of one call. A
   * parameter nothing usable is set for is absent rather than null, so
   * `this.settings.token === undefined` is the question to ask.
   *
   * This is the whole of what a plugin knows about the workspace it is running
   * for. Nothing reaches a plugin that a workspace did not point at, which is
   * what makes the parameter list a readable answer to "what can this thing
   * get at?".
   */
  readonly settings: Readonly<
    Record<string, string | number | boolean | OrknuxConnection<ConnectionType> | undefined>
  >;
}

/** What each declared function is wrapped in. */
declare class OrknuxFunction {
  constructor(declaration: OrknuxFunctionDeclared);

  readonly name: string;
  readonly description: string | null;
  readonly params: { name: string; type: OrknuxValueType }[];
  readonly returnType: OrknuxValueType;
  readonly run: (...args: never[]) => unknown;
}

/** A tool of the plugin's own: a declaration with a run, offered to agents. */
declare class OrknuxTool {
  constructor(declaration: OrknuxToolDeclared);

  readonly name: string;
  readonly description: string | null;
  readonly params: { name: string; type: OrknuxValueType }[];
  readonly returnType: OrknuxValueType;
  readonly run: (...args: never[]) => unknown;
  /** Null: this tool has a run of its own rather than fronting a function. */
  readonly proxyOf: null;
}

/**
 * A tool that is one of this plugin's own functions, exposed to agents.
 *
 * The utility that says so rather than a copy: params, return type and
 * implementation are the function's — including any edit somebody makes to it
 * on the server later — and only the name and the model-facing description may
 * be this tool's own. A `function` that `functions()` does not declare is
 * refused at load.
 */
declare class OrknuxFunctionTool {
  constructor(declaration: OrknuxFunctionToolDeclared);

  /** The plugin's own function this tool stands in front of. */
  readonly proxyOf: string;
  readonly name: string;
  readonly description: string | null;
}

/** What each declared parameter is wrapped in. */
declare class OrknuxParameter {
  constructor(declaration: OrknuxParameterDeclared);

  readonly name: string;
  readonly description: string | null;
  readonly type: OrknuxParameterType;
  readonly required: boolean;
  readonly secret: boolean;
  readonly connectionType: ConnectionType | null;
}
