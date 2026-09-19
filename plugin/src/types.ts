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
 * A tool of the plugin's own, as it is written: a declaration with a run,
 * offered to agents.
 *
 * The same shape as a function's declaration, and typed the same way — the
 * parameters are a tuple and `run` is read off them. What differs is the
 * reader: a tool's description is read by a model deciding whether to call it,
 * so it says when to call this and with what, where a function's is read by a
 * person building a workflow.
 */
export interface OrknuxToolDeclaration<
  Params extends readonly OrknuxParam[] = readonly OrknuxParam[],
  Returns extends OrknuxValueType = OrknuxValueType,
> {
  /** An identifier. Granted to an agent prefixed with the plugin's id. */
  name: string;

  /** Written for the model that reads it: when to call this, and with what. */
  description?: string;

  /** In the order `run` receives them. */
  params?: Params;

  /** What it answers with. A tool answers a model, so it has to answer something. */
  returnType: Returns;

  /** What it does. Synchronous, for the reasons a function's `run` is. */
  run: (this: OrknuxRunContext, ...args: OrknuxArgs<Params>) => OrknuxValues[Returns];
}

/**
 * A tool after `OrknuxTool` has checked it.
 *
 * As the sandbox stores it, defaults filled in the way a function's are —
 * plus `proxyOf`, null here because this tool has a run of its own rather
 * than fronting one of the plugin's functions.
 */
export interface OrknuxToolInstance {
  readonly name: string;
  readonly description: string | null;
  readonly params: readonly OrknuxParam[];
  readonly returnType: string;
  readonly run: (...args: never[]) => unknown;
  readonly proxyOf: null;
}

/**
 * A tool that is one of the plugin's own functions, exposed to agents, as it
 * is written.
 *
 * The utility that says so rather than a copy: the params, return type and
 * implementation are the function's — including any edit somebody makes to it
 * on the server later — and only the name and the model-facing description may
 * be this tool's own. A `function` that `functions()` does not declare is
 * refused at load.
 */
export interface OrknuxFunctionToolDeclaration {
  /** The name of one of this plugin's functions, as `functions()` declares it. */
  function: string;

  /** What agents call it. Defaults to the function's own name. */
  name?: string;

  /** Written for the model. Defaults to the function's description. */
  description?: string;
}

/**
 * A proxy after `OrknuxFunctionTool` has checked it.
 *
 * `proxyOf` is what marks it: the loader reads it, resolves the params and
 * return type from the named function, and refuses a name `functions()` does
 * not declare.
 */
export interface OrknuxFunctionToolInstance {
  readonly proxyOf: string;
  readonly name: string;
  readonly description: string | null;
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

/**
 * One instruction set a plugin brings.
 *
 * Neither called nor run: `content` is markdown an agent reads before doing
 * something, so the knowledge of how this plugin's work is meant to be done
 * travels with the code that does it.
 */
export interface OrknuxSkillDeclaration {
  /**
   * What the skill is called, and what an agent asks for by name.
   *
   * Prose rather than an identifier — nothing calls a skill, an agent reads
   * it — so `Rolling back a deploy` is a better name than `rolling_back`.
   * At most `MAX_SKILL_NAME_LENGTH` characters.
   */
  name: string;

  /**
   * One line on what it is for. This is what an agent chooses from before
   * loading anything, so it earns its place: "What to do when a release is
   * bad" tells a model when to reach for the page; "Deploy skill" does not.
   */
  description?: string | null;

  /**
   * The markdown itself, at most `MAX_SKILL_CHARS` characters.
   *
   * A skill opens with a `---` frontmatter block naming and describing it.
   * Leave the block out and the server writes one from the `name` and
   * `description` above — they are the same two facts, and stating them twice
   * is a trap. A block that opens and never closes is your mistake, and is
   * refused as one.
   */
  content: string;
}

/** What a skill is once the sandbox has checked it. */
export interface OrknuxSkillInstance {
  readonly name: string;
  readonly description: string | null;
  readonly content: string;
}

/** What one field of an exported object may be. */
export type OrknuxPropertyKind = 'string' | 'number' | 'boolean' | 'object' | 'array';

/**
 * One field of an object a plugin exports.
 *
 * `of` is where a shape stops being flat: required for an `object` (it names
 * another of this plugin's objects) and for an `array` (a scalar kind, or
 * another object's name). Left off anything else, because there would be
 * nothing for it to say.
 */
export interface OrknuxProperty {
  name: string;
  kind: OrknuxPropertyKind;
  /** The object this points at, or what the array holds. */
  of?: string | null;
  /**
   * What this field means, for whoever — or whatever — reads it. A name says
   * what a field is called and nothing about what belongs in it.
   */
  description?: string | null;
}

/**
 * A named shape a plugin exports, for its functions to pass around.
 *
 * A plugin's functions belong to every workspace at once, which is why they
 * may not name a workspace's own objects — there is no single workspace whose
 * definitions they could mean. An object declared here is the answer: it
 * belongs to the plugin, travels with it, and is available wherever the
 * plugin is, under the plugin's key — `Issue` declared by `jira` arrives as
 * `jira_Issue`.
 *
 * Within the plugin, refer to them by the plugin's own spelling: a property
 * whose `of` is `User` means the `User` this plugin declares, and the server
 * rewrites the reference when it stores it.
 */
export interface OrknuxObjectDeclaration {
  /**
   * What the shape is called, unprefixed. An identifier, conventionally
   * PascalCase — it reads as a type, because that is what it is.
   */
  name: string;
  description?: string | null;
  properties: readonly OrknuxProperty[];
}

/** What an object is once the sandbox has checked it. */
export interface OrknuxObjectInstance {
  readonly name: string;
  readonly description: string | null;
  readonly properties: readonly OrknuxProperty[];
}

/** What a plugin answers when the server asks it what it is. */
export interface OrknuxPluginInstance {
  /** What this plugin calls itself, and the prefix on everything it declares. */
  id(): string;

  /** Which plugin API it was written against. */
  apiVersion(): number;

  /** What it offers to workflows. */
  functions(): OrknuxFunctionInstance[];

  /** What it offers to agents. */
  tools(): (OrknuxToolInstance | OrknuxFunctionToolInstance)[];

  /** What it has to be told before it can work. */
  parameters(): OrknuxParameterInstance[];

  /** Which JavaScript it needs beyond what every plugin gets. */
  permissions(): OrknuxPermission[];

  /** What it asks the server to do on its behalf. */
  capabilities(): OrknuxCapability[];

  /**
   * The library files it ships with, as paths relative to its own file:
   * `lib/util.js` or `./lib/util.js`. The complete list — every shipped file
   * is declared, every relative import resolves within it, and whoever loads
   * the plugin is shown it and has to allow it. No absolute paths, no URLs,
   * no `..`, no bare specifiers.
   */
  libraries(): string[];

  /**
   * The instruction sets it brings: markdown an agent reads, never code it
   * runs. They arrive as a skill catalog named after the plugin's key and are
   * granted like any other — nothing is automatic.
   */
  skills(): OrknuxSkillInstance[];

  /**
   * The shapes it exports, for its own functions and tools to pass around.
   *
   * Available wherever the plugin is, under the plugin's key: `Issue`
   * declared by `jira` is `jira_Issue`. A function returning or taking one
   * names it by the plugin's own spelling.
   */
  objects(): OrknuxObjectInstance[];

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

/** What a search of Slack's messages came to, or why it could not be run. */
export type SlackSearchResult =
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
 * A binary answer: the bytes as base64, and what they claim to be. Base64 is
 * the one shape bytes have in a sandbox where everything crosses as text.
 */
export type OrknuxBinaryResponse =
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
export type OrknuxStorePut = { ok: true; error?: undefined } | { error: string; ok?: undefined };

/**
 * A connection argument as the Slack helpers take it: the handle out of
 * `settings`, or a bare id where that is what a trigger handed over. The helper
 * reads the id off an object and passes anything else through, so
 * `trigger.connection` and a number both work.
 */
export type SlackConnectionArgument = OrknuxConnectionHandle | number | string;

/**
 * What a crypto call is handed: bytes as base64, or text the server encodes as
 * UTF-8 for you.
 *
 * The second form is there so a plugin that only wants to hash a string need
 * not ask for `TEXT_ENCODING` to turn it into bytes first.
 */
export type OrknuxCryptoInput = { base64: string; text?: undefined } | { text: string; base64?: undefined };

/** What a digest, a derivation or a handful of random bytes came to. */
export type OrknuxDigest =
  | { base64: string; error?: undefined }
  | { error: string; base64?: undefined };

/** Whether two byte strings are the same, compared in constant time. */
export type OrknuxComparison =
  | { equal: boolean; error?: undefined }
  | { error: string; equal?: undefined };

/** The digests `orknux.crypto` will compute. */
export type OrknuxDigestAlgorithm = 'sha256' | 'sha384' | 'sha512' | 'sha1' | 'md5';

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

    /**
     * Search Slack's messages, the way the search box does. Needs
     * `SLACK_SEARCH` — and, from Slack's own side, a user token: the
     * connection's User Token field is what a search runs on, and one
     * without it falls back to the bot token, whose `not_allowed_token_type`
     * comes back as the error.
     */
    search(connection: SlackConnectionArgument, query: string, limit?: number): SlackSearchResult;
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
            /** Base64 whose decoded bytes are the body; wins over `body`. */
            bodyBase64?: string;
            /** Bring the answer's bytes back as `base64` instead of `body`. */
            binary?: boolean;
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
     * has on this side of the sandbox. Sent as an octet stream unless
     * `contentType` or a header says what it is; POST, and capped at 10 MB of
     * decoded bytes. Needs `NETWORK_REQUEST` like every other request.
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
   * Arithmetic the sandbox has no instruction for.
   *
   * GraalJS has no crypto at all — not a digest, not an HMAC, not a random
   * number — so a plugin verifying a webhook signature or speaking an
   * authentication handshake could not begin. These are the smallest surface
   * that removes that wall.
   *
   * **Not granted, and deliberately so.** No permission, no capability, no
   * acceptance dialog: a digest reaches nothing, sends nothing and learns
   * nothing. It is in the same class as `JSON.parse`, and the server computes
   * it only because the sandbox has no way to. Making every plugin declare a
   * capability to compute a SHA-256 would be a dialog with no decision behind
   * it, and a dialog nobody can answer meaningfully is one they learn to click
   * through.
   *
   * Every call answers an object: `base64` on success, `error` and nothing
   * else on refusal — a refusal is data a plugin can act on, never a throw.
   */
  crypto: {
    /** The digest of some bytes. */
    hash(algorithm: OrknuxDigestAlgorithm, input: OrknuxCryptoInput): OrknuxDigest;

    /** HMAC, keyed. What a webhook signature is checked with. */
    hmac(
      algorithm: OrknuxDigestAlgorithm,
      key: OrknuxCryptoInput,
      input: OrknuxCryptoInput,
    ): OrknuxDigest;

    /**
     * A key derived from a password, the slow way on purpose.
     *
     * `length` is how many bytes are wanted. `iterations` is capped — see
     * [MAX_PBKDF2_ITERATIONS], and note that over the cap is a refusal rather
     * than a clamp.
     */
    pbkdf2(
      algorithm: OrknuxDigestAlgorithm,
      password: OrknuxCryptoInput,
      salt: OrknuxCryptoInput,
      iterations: number,
      length: number,
    ): OrknuxDigest;

    /** Bytes from the platform's secure source — a nonce, a state, an idempotency key. */
    random(bytes: number): OrknuxDigest;

    /**
     * Whether two byte strings match, in time that does not depend on where
     * they first differ.
     *
     * Comparing a signature with `===` leaks its prefix through how long the
     * comparison took, one byte at a time, which is enough to forge one. This
     * is here rather than left to the plugin because a constant-time
     * comparison written in JavaScript stops being constant-time as soon as a
     * JIT has looked at it.
     */
    timingSafeEqual(a: OrknuxCryptoInput, b: OrknuxCryptoInput): OrknuxComparison;
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
