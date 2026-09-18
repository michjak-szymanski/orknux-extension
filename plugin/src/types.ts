import type {
  CAPABILITIES,
  CONNECTION,
  CONNECTION_TYPES,
  PARAMETER_TYPES,
  PERMISSIONS,
  VALUE_TYPES,
} from './limits.js';

/**
 * The shape of a value crossing between a workflow and a plugin.
 *
 * Derived from the list the server accepts rather than written out again, so the
 * two cannot disagree about what a plugin may declare.
 */
export type OrknuxValueType = (typeof VALUE_TYPES)[number];

/** A permission a plugin may ask for. The server's own list; nothing else exists. */
export type OrknuxPermission = (typeof PERMISSIONS)[number];

/** Something a plugin may ask the server to do on its behalf. */
export type OrknuxCapability = (typeof CAPABILITIES)[number];

/** The kinds of connection a workspace can hold. */
export type OrknuxConnectionType = (typeof CONNECTION_TYPES)[number];

/**
 * What a plugin's parameter may be: exactly what a workspace variable can hold,
 * plus a reference to one of the workspace's connections.
 */
export type OrknuxParameterType = (typeof PARAMETER_TYPES)[number] | typeof CONNECTION;

/**
 * A connection the workspace configured, as it arrives in `settings`.
 *
 * An id and a type and nothing else. A plugin cannot open a socket — the sandbox
 * has no network and no permission can ask for one — so what crosses is a name
 * for a connection the server will use on the plugin's behalf, never the
 * connection itself and never its credential.
 *
 * The type parameter is what makes "a Slack connection" mean something: it
 * appears as a member, so a mismatched kind is caught where it is written rather
 * than at the first call.
 */
export interface OrknuxConnectionHandle<
  Type extends OrknuxConnectionType = OrknuxConnectionType,
> {
  readonly id: number;
  readonly type: Type;
}

/**
 * What a workspace set the plugin's parameters to, keyed by name.
 *
 * Frozen, and put there by the server for the length of one call. A parameter
 * nothing usable is set for is absent rather than null — `undefined` is in the
 * type so that `settings.token === undefined` is a question the compiler lets
 * you ask, because it is the question to ask.
 */
export type OrknuxSettings = Readonly<
  Record<string, string | number | boolean | OrknuxConnectionHandle | undefined>
>;

/**
 * What `run` reaches through `this`.
 *
 * The sandbox calls `run` with the plugin as `this`, so a `run` written as a
 * method — or as a `function` inside `fn` — sees the settings. An arrow function
 * does not, and that is JavaScript rather than this package: an arrow closes
 * over the `this` of wherever it was written, which inside a `functions()` body
 * is the plugin and inside a `definePlugin` spec is nothing.
 */
export interface OrknuxRunContext {
  readonly settings: OrknuxSettings;
}

/**
 * What each of those is in TypeScript.
 *
 * A map is `Record<string, unknown>` and an array `unknown[]`, not `object` and
 * `any[]`: everything crossing into the sandbox arrived as JSON, so what is
 * inside is genuinely unknown until the code looks. `unknown` makes it look.
 */
export interface OrknuxValues {
  string: string;
  number: number;
  boolean: boolean;
  map: Record<string, unknown>;
  array: unknown[];
}

/** One of a function's parameters, as it is declared. */
export interface OrknuxParam<
  Name extends string = string,
  Type extends OrknuxValueType = OrknuxValueType,
> {
  readonly name: Name;
  readonly type: Type;
}

/**
 * The arguments `run` is handed, read off the parameters it declared.
 *
 * This is the whole reason for declaring parameters as a tuple: `params` and the
 * signature of `run` are one statement rather than two that can drift, so
 * renaming a type in the declaration is a compile error in the body.
 */
export type OrknuxArgs<Params extends readonly OrknuxParam[]> = {
  -readonly [Index in keyof Params]: OrknuxValues[Params[Index]['type']];
};

/** A function, as it is written. */
export interface OrknuxFunctionDeclaration<
  Params extends readonly OrknuxParam[] = readonly OrknuxParam[],
  Returns extends OrknuxValueType = OrknuxValueType,
> {
  /** An identifier. Offered to a workflow prefixed with the plugin's id. */
  name: string;

  /** Optional; shown beside it in the interface. */
  description?: string;

  /** In the order `run` receives them. */
  params?: Params;

  /** What it answers with. A function has to answer something. */
  returnType: Returns;

  /**
   * What it does.
   *
   * Synchronous, and not by omission: the sandbox has no host access, no IO and
   * no way to hand a promise back across the boundary, so there is nothing a
   * plugin could usefully await. Everything it works with was passed to it — or
   * sits in `this.settings`, which the sandbox puts on the plugin `run` is
   * called on.
   */
  run: (this: OrknuxRunContext, ...args: OrknuxArgs<Params>) => OrknuxValues[Returns];
}

/**
 * A function after `OrknuxFunction` has checked it.
 *
 * The declaration as the sandbox stores it, which is not quite what was written:
 * an absent description became null and absent parameters became an empty array.
 */
export interface OrknuxFunctionInstance {
  readonly name: string;
  readonly description: string | null;
  readonly params: readonly OrknuxParam[];
  readonly returnType: string;
  readonly run: (...args: never[]) => unknown;
}

/**
 * One thing a plugin has to be told before it can work, as it is written.
 *
 * Not a function's parameter: a function's is filled in by whoever calls it,
 * node by node, while this is answered once by each workspace and arrives as
 * `this.settings`. Declaring them is also how a workspace can see what a plugin
 * is able to reach — nothing gets in that is not on the list.
 */
export interface OrknuxParameterDeclaration {
  /** An identifier: letters, digits and underscores. */
  name: string;

  /** Optional; shown under it on the form somebody fills in. */
  description?: string;

  type: OrknuxParameterType;

  /**
   * Whether the plugin can work without it. Defaults to true, because a
   * parameter nobody needs is one nobody should be asked for.
   */
  required?: boolean;

  /**
   * Whether this is asking for something that should not be typed into a form.
   * Defaults to false. Saying true refuses a typed-in value: the only way to
   * answer it is to point at one of the workspace's variables, which is where
   * an installation keeps things it encrypts.
   */
  secret?: boolean;

  /**
   * Which kind of connection, and required when `type` is `'connection'`.
   *
   * It narrows the picker to the connections the plugin can actually use, and
   * what then arrives in `settings` is a handle — an id and a type, never the
   * connection's credential.
   */
  connectionType?: OrknuxConnectionType;
}

/**
 * A parameter after `OrknuxParameter` has checked it.
 *
 * As the sandbox stores it: an absent description became null, an absent
 * `required` became true, an absent `secret` false, and an absent
 * `connectionType` null.
 */
export interface OrknuxParameterInstance {
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly connectionType: string | null;
}

/** What a plugin answers when the server asks it what it is. */
export interface OrknuxPluginInstance {
  /** What this plugin calls itself, and the prefix on everything it declares. */
  id(): string;

  /** Which plugin API it was written against. */
  apiVersion(): number;

  /** What it offers. */
  functions(): OrknuxFunctionInstance[];

  /** What it has to be told before it can work. */
  parameters(): OrknuxParameterInstance[];

  /** Which JavaScript it needs beyond what every plugin gets. */
  permissions(): OrknuxPermission[];

  /** What it asks the server to do on its behalf. */
  capabilities(): OrknuxCapability[];

  /** What the workspace answered its parameters with, for the length of a call. */
  readonly settings: OrknuxSettings;
}

/**
 * A plugin as it leaves the file: a class, exported as the default.
 *
 * The server checks the prototype rather than probing for methods, so a plain
 * object with the right keys is refused however right the keys are.
 */
export type OrknuxPluginConstructor = new () => OrknuxPluginInstance;

/** One message in a Slack thread, as much of it as anything here needs. */
export interface SlackThreadMessage {
  /** Slack's timestamp, which is also the message's id. */
  ts: string;
  /** Who wrote it, or the bot that did. Null where Slack said neither. */
  user: string | null;
  text: string;
  /** Whether this is the message the thread hangs under rather than a reply. */
  parent: boolean;
}

/** A thread that was read, or why it could not be. */
export type SlackThread =
  | {
      messages: SlackThreadMessage[];
      /**
       * Slack's own count of the replies under the parent — not
       * `messages.length - 1`: a page holds what was asked for and the count is
       * of the whole thread. `replies === 1` is the first reply.
       */
      replies: number;
      error?: undefined;
    }
  | {
      /**
       * Why not, in Slack's own words where they were Slack's. A refusal rather
       * than a thrown error, so a plugin can say something useful about it.
       */
      error: string;
      messages?: undefined;
      replies?: undefined;
    };

/** A message that was posted — its channel and its own `ts` — or why not. */
export type SlackPost =
  | { channel: string; ts: string | null; error?: undefined }
  | { error: string; channel?: undefined; ts?: undefined };

/** Whether a reaction went on. Already-reacted counts as ok. */
export type SlackReaction = { ok: true; error?: undefined } | { error: string; ok?: undefined };

/** The one message a permalink points at, or why it could not be read. */
export type SlackLinkedMessage =
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
export type SlackUserInfo =
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
export type SlackMention =
  | { mention: string; id: string; label: string; error?: undefined }
  | { error: string; mention?: undefined };

/**
 * What came back from an HTTP request, or why nothing did.
 *
 * A refusal is data rather than a thrown error, so a plugin can say something
 * useful about it — and so a condition that could not be decided does not
 * quietly decide. `json` sits beside `body` where the reply parsed as JSON, and
 * simply is not there where it did not; `body` is always the text that arrived.
 */
export type OrknuxResponse =
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
 * A connection argument as the Slack helpers take it: the handle out of
 * `settings`, or a bare id where that is what a trigger handed over. The helper
 * reads the id off an object and passes anything else through, so
 * `trigger.connection` and a number both work.
 */
export type SlackConnectionArgument = OrknuxConnectionHandle | number | string;

/**
 * What the server will do on a plugin's behalf — the `orknux` object the sandbox
 * defines before a plugin is evaluated.
 *
 * Every call but `log` needs its capability. Without it the call answers
 * `{ error }` saying so, rather than reaching anything: the helpers are part of
 * the contract and always there, so an ungranted call is a sentence and not
 * whatever a call on undefined throws.
 */
export interface OrknuxHelpers {
  slack: {
    /**
     * The messages in one Slack thread, oldest first. Needs `SLACK_READ_THREAD`.
     *
     * Pass the connection the trigger says its event came in on rather than
     * assuming — a workspace with two Slack connections has two Slacks.
     */
    thread(
      connection: SlackConnectionArgument,
      channel: string,
      threadTs: string,
      limit?: number,
    ): SlackThread;

    /** Post a message through a connection it was given. Needs `SLACK_POST_MESSAGE`. */
    post(
      connection: SlackConnectionArgument,
      channel: string,
      text: string,
      threadTs?: string,
    ): SlackPost;

    /** Add an emoji reaction to a message. Needs `SLACK_ADD_REACTION`. */
    react(
      connection: SlackConnectionArgument,
      channel: string,
      ts: string,
      emoji: string,
    ): SlackReaction;

    /** The one message a Slack permalink points at. Needs `SLACK_READ_MESSAGE`. */
    message(connection: SlackConnectionArgument, link: string): SlackLinkedMessage;

    /** Who a Slack user id is, bare or as `<@U…>`. Needs `SLACK_READ_USER`. */
    user(connection: SlackConnectionArgument, userId: string): SlackUserInfo;

    /** The notation that pings somebody, from their name. Needs `SLACK_MENTION`. */
    mention(connection: SlackConnectionArgument, name: string): SlackMention;
  };

  http: {
    /**
     * One HTTP request, made by the server on this plugin's behalf. Needs
     * `NETWORK_REQUEST` — the widest thing a plugin can ask for, and the one an
     * administrator will think hardest about.
     *
     * An object body is sent as JSON with the content-type set, because the
     * header is the half people forget; a string body is passed through
     * untouched. Where a request may get to is the installation's proxy rules,
     * which this cannot see and cannot argue with.
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
  };

  /**
   * Not a capability, and never needed granting — nothing is reached by it. The
   * line crosses as text and the server decides where it goes; a level below
   * the installation's threshold costs one comparison and is dropped where it
   * was written, so tracing can stay in.
   */
  log: {
    debug(...parts: unknown[]): void;
    info(...parts: unknown[]): void;
    warn(...parts: unknown[]): void;
    error(...parts: unknown[]): void;
  };
}
