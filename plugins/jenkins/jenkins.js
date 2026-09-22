/*
 * Jenkins, as a plugin.
 *
 * What this exists for is the question asked in the minute after something
 * goes red: which job, which build, what broke, and can it be run again. That
 * question is answered today by somebody opening a browser tab, and the answer
 * is nearly always one of four things — the job's state, a build's result, the
 * failing tests, the last hundred lines of the log.
 *
 * A plugin has no network, deliberately and permanently, so every call here is
 * made by the *server* on the plugin's behalf, under the NETWORK_REQUEST
 * capability a person accepted, against the Jenkins the workspace named.
 *
 * ## Setting one up
 *
 * 1. Load this plugin and accept NETWORK_REQUEST, which is all it asks for.
 * 2. Set `url` to the controller's root — `https://ci.example.com`, or
 *    `https://example.com/jenkins` where it is served under a path.
 * 3. For anything but an instance read anonymously, set `user` to whose token
 *    it is and put an API token in a workspace variable that `token` points
 *    at. Jenkins authenticates a token *as somebody*, so the two go together
 *    or neither does.
 *
 * ## Three things about Jenkins' API worth knowing before reading this file
 *
 * **A job's `color` is its status**, and it is a colour: `blue` is passing,
 * `red` is failing, `yellow` is unstable, and an `_anime` suffix means it is
 * building right now. Nobody should have to know that, so it is translated
 * here into a word and a boolean.
 *
 * **`tree` is how an answer is kept small.** Jenkins will hand over every
 * field of every build of a job if asked plainly, which is megabytes nobody
 * wanted; every call below names the fields it needs, and the listing asks for
 * one more job than it will show so that it can say whether there were more.
 *
 * **The links Jenkins writes are its own idea of where it lives** — whatever
 * root URL an administrator typed into its configuration, which on a great
 * many instances is still `http://localhost:8080`. So every url answered here
 * is built from the `url` this plugin was given instead, which is the one
 * address known to work: it is the one the answer just came back from.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** What a job's colour means, once the `_anime` suffix is off it. */
const STATUS = {
  blue: 'passing',
  green: 'passing',
  red: 'failing',
  yellow: 'unstable',
  grey: 'never built',
  notbuilt: 'never built',
  aborted: 'aborted',
  disabled: 'disabled',
};

/** The permalinks Jenkins answers in place of a build number, in its own spelling. */
const PERMALINKS = [
  'lastBuild',
  'lastCompletedBuild',
  'lastStableBuild',
  'lastSuccessfulBuild',
  'lastFailedBuild',
  'lastUnsuccessfulBuild',
];

/** A nested field, or null rather than a thrown error on the way down. */
function at(holder, name) {
  if (holder === null || typeof holder !== 'object') {
    return null;
  }
  const held = holder[name];
  return held === undefined ? null : held;
}

/**
 * One of an answer's headers, whatever case it came back in.
 *
 * Header names are case-insensitive and nothing in this plugin decides which
 * case they arrive in, so reading `answered.headers.location` would work right
 * up until something in front of Jenkins spelled it `Location`.
 */
function header(answered, name) {
  const held = answered.headers;
  if (held === null || typeof held !== 'object') {
    return null;
  }
  const wanted = name.toLowerCase();
  for (const key of Object.keys(held)) {
    if (key.toLowerCase() === wanted) {
      return held[key];
    }
  }
  return null;
}

/** The controller's root, without its trailing slash. */
function root(settings) {
  const configured = settings.url;
  if (typeof configured !== 'string' || configured.length === 0) {
    throw new Error("the plugin's url parameter is not set, and every Jenkins call needs it");
  }
  return configured.endsWith('/') ? configured.slice(0, -1) : configured;
}

/**
 * The authorization header, or null where this instance is read anonymously.
 *
 * Jenkins has one scheme: Basic, with an API token where a password would go.
 * A token identifies somebody, so a token with no user is refused here rather
 * than sent as a Bearer token Jenkins has no idea what to do with.
 */
function authorization(settings) {
  const user = settings.user;
  const token = settings.token;
  const named = typeof user === 'string' && user.length > 0;
  const held = typeof token === 'string' && token.length > 0;
  if (!named && !held) {
    /* An open instance, read as whoever anonymous is allowed to be. */
    return null;
  }
  if (!named) {
    throw new Error('a token is set but no user to send it as, and Jenkins authenticates a token as somebody');
  }
  if (!held) {
    throw new Error('a user is set but no token to go with it');
  }
  /*
   * `orknux.encoding` rather than a hand-rolled alphabet and a TextEncoder:
   * the server does the UTF-8 and the base64, so this plugin needs no
   * permission to turn a string into its own bytes.
   */
  const pair = orknux.encoding.encodeBase64(`${user}:${token}`);
  if (pair.error !== undefined) {
    throw new Error(`could not encode the credential: ${pair.error}`);
  }
  return 'Basic ' + pair.base64;
}

/** The headers a call goes out with: json asked for, the credential, and whatever else was given. */
function headers(settings, more) {
  const built = { accept: 'application/json' };
  const credential = authorization(settings);
  if (credential !== null) {
    built.authorization = credential;
  }
  if (more !== null && typeof more === 'object') {
    for (const key of Object.keys(more)) {
      built[key] = more[key];
    }
  }
  return built;
}

/**
 * What a refusal says.
 *
 * Jenkins answers an error with an HTML page, so there is no message to read
 * out of a body — the status is the whole of what it said. These three are
 * worth naming because each has a cause somebody can act on, and a bare "403"
 * sends people to the wrong one of them.
 */
function refusal(status, path, said) {
  const where = path.split('?')[0];
  const aside = typeof said === 'string' && said.length > 0 ? `: ${said}` : '';
  if (status === 401) {
    return `Jenkins refused the credential (401) for ${where}${aside} - check the user, and that the token is that user's`;
  }
  if (status === 403) {
    return `Jenkins refused the request (403) for ${where}${aside} - either this user may not do it, or the instance wants a CSRF crumb it would not issue`;
  }
  if (status === 404) {
    return `Jenkins has nothing at ${where} (404)${aside}`;
  }
  return `Jenkins answered ${status}${aside} for ${where}`;
}

/** One call to Jenkins, authenticated, answered whole or thrown. */
function call(settings, asked) {
  const answered = orknux.http.request({
    url: root(settings) + asked.path,
    method: asked.method === undefined ? 'GET' : asked.method,
    headers: headers(settings, asked.headers),
    body: asked.body,
  });
  if (answered.error !== undefined) {
    throw new Error(`could not reach Jenkins: ${answered.error}`);
  }
  /* A 404 that means something in particular says that, rather than the path. */
  if (answered.status === 404 && typeof asked.notFound === 'string') {
    throw new Error(asked.notFound);
  }
  if (answered.status >= 400) {
    throw new Error(refusal(answered.status, asked.path, header(answered, 'x-error')));
  }
  return answered;
}

/** The same, for the calls that want the parsed body and nothing else. */
function read(settings, path, notFound) {
  return call(settings, { path: path, notFound: notFound }).json;
}

/**
 * Jenkins' CSRF crumb, where the instance wants one.
 *
 * A request authenticated with an API token has been exempt from CSRF
 * protection since Jenkins 2.96, so most of the time this costs one cheap GET
 * and answers an empty map. It is here for the instances where the exemption
 * does not apply — a password used in place of a token, an older controller, a
 * proxy in front that loses the distinction — because the failure without it
 * is a 403 with an HTML page behind it, which is the least debuggable answer
 * Jenkins has.
 *
 * A crumb issuer that refuses, or is not there, is not an error: it means CSRF
 * protection is off, or that this credential may not ask. The POST that
 * follows says so itself, and says it about the thing actually being done.
 */
function crumb(settings) {
  const answered = orknux.http.get(root(settings) + '/crumbIssuer/api/json', headers(settings));
  if (answered.error !== undefined || answered.status >= 400) {
    return {};
  }
  const field = at(answered.json, 'crumbRequestField');
  const value = at(answered.json, 'crumb');
  if (typeof field !== 'string' || typeof value !== 'string') {
    return {};
  }
  const built = {};
  built[field] = value;
  return built;
}

/** The path a list of job names spells: `a/b` is `/job/a/job/b`. */
function pathOf(names) {
  return names.map((name) => '/job/' + encodeURIComponent(name)).join('');
}

/** Whether a url segment names a build: a number, or one of Jenkins' permalinks. */
function isBuild(segment) {
  if (/^\d+$/.test(segment)) {
    return true;
  }
  const wanted = segment.toLowerCase();
  return PERMALINKS.some((one) => one.toLowerCase() === wanted);
}

/**
 * What a caller means by a job, which is usually whatever somebody pasted.
 *
 * `build` is filled in where the reference named one — a link to build 42 of a
 * job is a link to *that build*, and taking the job out of it and then reading
 * `lastBuild` would answer confidently about something else.
 *
 * Only the path is read out of a url; the host is not. The request goes to the
 * `url` this plugin was configured with, so a link to a *different* Jenkins
 * names a job on this one, or nothing at all.
 */
function reference(job) {
  const asked = typeof job === 'string' ? job.trim() : String(job === null || job === undefined ? '' : job);
  if (asked.length === 0) {
    throw new Error('there is no job named');
  }

  const site = asked.match(/^https?:\/\/[^/]+(\/.*)?$/);
  const segments = (site === null ? asked : site[1] ?? '').split('/').filter((one) => one.length > 0);

  const names = [];
  let build = null;
  if (segments.includes('job')) {
    /*
     * Jenkins' own spelling, `job/a/job/b`, possibly under a path prefix and
     * possibly with a build on the end. The segments are decoded because a
     * pasted url carries `%20` where a name has a space in it, and encoding
     * that again would ask for a job called `my%20job`.
     */
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index] === 'job' && index + 1 < segments.length) {
        names.push(decodeURIComponent(segments[index + 1]));
        index += 1;
      } else if (names.length > 0 && isBuild(segments[index])) {
        build = segments[index];
        break;
      }
    }
  } else {
    /* A plain name, or a path through folders: `platform/services/deploy`. */
    for (const segment of segments) {
      names.push(decodeURIComponent(segment));
    }
  }

  if (names.length === 0) {
    throw new Error(`not a job name or a job url: ${asked}`);
  }
  return { name: names.join('/'), path: pathOf(names), build: build };
}

/**
 * Which build a call means, in Jenkins' own spelling.
 *
 * A number or a permalink and nothing else, because whatever comes back from
 * here goes into a url path — and a permalink is matched whatever the capitals,
 * so that `lastbuild` is not a 404 nobody can explain.
 */
function buildOf(which) {
  const asked = typeof which === 'string' ? which.trim() : String(which === null || which === undefined ? '' : which);
  if (/^\d+$/.test(asked)) {
    return asked;
  }
  const found = PERMALINKS.find((one) => one.toLowerCase() === asked.toLowerCase());
  if (found !== undefined) {
    return found;
  }
  throw new Error(`not a build number or a permalink: ${asked} - it takes 412, or ${PERMALINKS.join(', ')}`);
}

/** A colour, as a word and a boolean. */
function statusOf(colour) {
  if (typeof colour !== 'string' || colour.length === 0) {
    return { status: null, building: false };
  }
  const building = colour.endsWith('_anime');
  const settled = building ? colour.slice(0, -'_anime'.length) : colour;
  return { status: STATUS[settled] ?? settled, building: building };
}

/** Jenkins counts time in milliseconds since the epoch; everybody else reads ISO 8601. */
function whenOf(stamp) {
  return typeof stamp === 'number' && stamp > 0 ? new Date(stamp).toISOString() : null;
}

/** Whether an item holds other jobs rather than being one — a folder, or a multibranch project. */
function holdsJobs(entry) {
  const kind = at(entry, '_class');
  return typeof kind === 'string' && /Folder|MultiBranch/i.test(kind);
}

/** One job as the declared `Job` shape — see objects(). */
function jobOf(entry, site) {
  const colour = statusOf(at(entry, 'color'));
  const named = at(entry, 'fullName') ?? at(entry, 'name');
  const last = at(entry, 'lastBuild');
  const health = (at(entry, 'healthReport') ?? [])[0];

  /*
   * The parameters a build takes, dug out of `property` — which is a list of
   * every configured property of the job, with the interesting one somewhere
   * in it. Empty from a listing, which does not ask for them.
   */
  const parameters = [];
  for (const property of at(entry, 'property') ?? []) {
    for (const definition of at(property, 'parameterDefinitions') ?? []) {
      const kind = at(definition, 'type');
      parameters.push({
        name: at(definition, 'name'),
        /* `StringParameterDefinition` is the class name; `String` is the answer. */
        type: typeof kind === 'string' ? kind.replace(/ParameterDefinition$/, '') : null,
        default: at(at(definition, 'defaultParameterValue'), 'value'),
        description: at(definition, 'description'),
      });
    }
  }

  return {
    name: named,
    folder: holdsJobs(entry),
    status: colour.status,
    building: colour.building,
    description: at(entry, 'description'),
    buildable: at(entry, 'buildable'),
    inQueue: at(entry, 'inQueue'),
    health: at(health, 'score'),
    lastBuild: at(last, 'number'),
    lastResult: at(last, 'result'),
    lastStarted: whenOf(at(last, 'timestamp')),
    lastSuccess: at(at(entry, 'lastSuccessfulBuild'), 'number'),
    lastFailure: at(at(entry, 'lastFailedBuild'), 'number'),
    parameters: parameters,
    url: typeof named === 'string' ? site + pathOf(named.split('/')) + '/' : null,
  };
}

/** One build as the declared `Build` shape — see objects(). */
function builtOf(json, name, site, path) {
  /* What started it is in `actions`, which is a list of mostly empty objects. */
  let cause = null;
  for (const action of at(json, 'actions') ?? []) {
    const causes = at(action, 'causes');
    if (Array.isArray(causes) && causes.length > 0) {
      cause = at(causes[0], 'shortDescription');
      break;
    }
  }

  /*
   * `changeSet` on a freestyle build and `changeSets` on a pipeline one: the
   * same list, spelled twice by two parts of Jenkins. Both are asked for and
   * whichever answered is read — a tree naming a field a build does not have
   * is ignored rather than refused, which is what makes that safe.
   */
  const one = at(json, 'changeSet');
  const sets = at(json, 'changeSets') ?? (one === null ? [] : [one]);
  const changes = [];
  for (const set of sets) {
    for (const item of at(set, 'items') ?? []) {
      changes.push({
        commit: at(item, 'commitId'),
        message: at(item, 'msg'),
        author: at(at(item, 'author'), 'fullName'),
      });
    }
  }

  const number = at(json, 'number');
  return {
    job: name,
    number: number,
    result: at(json, 'result'),
    building: at(json, 'building') === true,
    started: whenOf(at(json, 'timestamp')),
    duration: at(json, 'duration'),
    estimated: at(json, 'estimatedDuration'),
    cause: cause,
    changes: changes,
    url: number === null ? null : `${site}${path}/${number}/`,
  };
}

export default class Jenkins extends OrknuxPlugin {

  id() {
    return 'jenkins';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [
      new OrknuxParameter({
        name: 'url',
        description:
          "The controller's root: https://ci.example.com, or https://example.com/jenkins " +
          'where it is served under a path.',
        type: 'string',
        required: true,
      }),
      new OrknuxParameter({
        name: 'user',
        description:
          'Whose API token this is — Jenkins authenticates a token as somebody. ' +
          'Left empty, with token empty too, on an instance read anonymously.',
        type: 'string',
        required: false,
      }),
      new OrknuxParameter({
        name: 'token',
        description:
          "An API token, made on the user's own configuration page. A password works on " +
          'most instances and should not be used.',
        type: 'string',
        required: false,
        secret: true,
      }),
    ];
  }

  permissions() {
    // None. Turning `user:token` into base64 is `orknux.encoding`'s job, and
    // that is ungranted — it reaches nothing, the way a digest does not.
    return [];
  }

  capabilities() {
    // The widest capability there is, asked for because this plugin is about
    // exactly one outside service: every request goes to the url above.
    return ['NETWORK_REQUEST'];
  }

  /*
   * The shapes this plugin answers.
   *
   * `Job` is one shape for both calls that answer a job, the way jira's
   * `Issue` is one for both of its: a listing leaves `buildable`, `health` and
   * `parameters` empty rather than absent, so a caller reading `parameters`
   * gets a list either way instead of finding out which call it came from.
   */
  objects() {
    return [
      new OrknuxObject({
        name: 'Parameter',
        description: 'One parameter a job takes when it is built.',
        properties: [
          { name: 'name', kind: 'string', description: 'The name to pass it under, exactly.' },
          { name: 'type', kind: 'string', description: 'String, Boolean, Choice, Password.' },
          { name: 'default', kind: 'string', description: 'What it is when nobody says.' },
          { name: 'description', kind: 'string', description: 'What the job says it is for.' },
        ],
      }),

      new OrknuxObject({
        name: 'Job',
        description: 'One job, as this plugin answers it.',
        properties: [
          { name: 'name', kind: 'string', description: 'The full name: folder/child for a job in a folder.' },
          { name: 'folder', kind: 'boolean', description: 'It holds other jobs rather than building anything.' },
          { name: 'status', kind: 'string', description: 'passing, failing, unstable, aborted, never built, disabled.' },
          { name: 'building', kind: 'boolean', description: 'A build is running right now.' },
          { name: 'description', kind: 'string', description: 'What the job says it is for.' },
          { name: 'buildable', kind: 'boolean', description: 'False where it is disabled. Null from a listing.' },
          { name: 'inQueue', kind: 'boolean', description: 'Waiting for an executor. Null from a listing.' },
          { name: 'health', kind: 'number', description: "Jenkins' own score out of 100. Null from a listing." },
          { name: 'lastBuild', kind: 'number', description: 'The most recent build number, or null if never built.' },
          { name: 'lastResult', kind: 'string', description: 'SUCCESS, FAILURE, UNSTABLE, ABORTED. Null while building.' },
          { name: 'lastStarted', kind: 'string', description: 'ISO 8601, when that build began.' },
          { name: 'lastSuccess', kind: 'number', description: 'The last build that passed — what to compare against.' },
          { name: 'lastFailure', kind: 'number', description: 'The last build that failed.' },
          { name: 'parameters', kind: 'array', of: 'Parameter', description: 'Empty from a listing.' },
          { name: 'url', kind: 'string', description: 'The link for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Jobs',
        description: 'What a listing came to.',
        properties: [
          { name: 'jobs', kind: 'array', of: 'Job', description: 'Capped by limit.' },
          {
            name: 'more',
            kind: 'boolean',
            description: 'There were others. Jenkins does not count what it was not asked to send.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'Change',
        description: 'One commit that went into a build.',
        properties: [
          { name: 'commit', kind: 'string', description: 'The revision.' },
          { name: 'message', kind: 'string', description: 'What its author wrote.' },
          { name: 'author', kind: 'string', description: 'Who wrote it.' },
        ],
      }),

      new OrknuxObject({
        name: 'Build',
        description: 'One build of one job.',
        properties: [
          { name: 'job', kind: 'string', description: 'The job it belongs to.' },
          { name: 'number', kind: 'number', description: 'Which build — what a permalink resolved to.' },
          { name: 'result', kind: 'string', description: 'SUCCESS, FAILURE, UNSTABLE, ABORTED. Null while it runs.' },
          { name: 'building', kind: 'boolean', description: 'It has not finished.' },
          { name: 'started', kind: 'string', description: 'ISO 8601.' },
          { name: 'duration', kind: 'number', description: 'Milliseconds, and 0 while it is still running.' },
          { name: 'estimated', kind: 'number', description: 'Milliseconds Jenkins expects, from the builds before it.' },
          { name: 'cause', kind: 'string', description: 'Why it ran — "Started by user Ada", "Started by GitHub push".' },
          { name: 'changes', kind: 'array', of: 'Change', description: 'The commits in it. Empty where Jenkins tracked none.' },
          { name: 'url', kind: 'string', description: 'The link for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Log',
        description: "The end of a build's console output.",
        properties: [
          { name: 'job', kind: 'string', description: 'The job it belongs to.' },
          { name: 'build', kind: 'number', description: 'Which build — what a permalink resolved to.' },
          { name: 'building', kind: 'boolean', description: 'The log is still being written.' },
          { name: 'result', kind: 'string', description: 'Null while it is still running.' },
          { name: 'lines', kind: 'number', description: 'How many lines came back.' },
          { name: 'truncated', kind: 'boolean', description: 'There is more log above these; ask for more lines.' },
          { name: 'text', kind: 'string', description: 'The last lines of the console, oldest first.' },
          { name: 'url', kind: 'string', description: 'The console, for a person to read the whole of.' },
        ],
      }),

      new OrknuxObject({
        name: 'Failure',
        description: 'One test that did not pass.',
        properties: [
          { name: 'test', kind: 'string', description: 'The class and the case: com.acme.CartTest.emptyCart.' },
          { name: 'status', kind: 'string', description: 'FAILED, or REGRESSION where it passed last time.' },
          { name: 'message', kind: 'string', description: 'What the assertion said. Null where it said nothing.' },
        ],
      }),

      new OrknuxObject({
        name: 'Tests',
        description: "What a build's test report came to.",
        properties: [
          { name: 'job', kind: 'string', description: 'The job it belongs to.' },
          { name: 'build', kind: 'number', description: 'Which build. Null where a permalink named it.' },
          { name: 'total', kind: 'number', description: 'How many ran.' },
          { name: 'passed', kind: 'number', description: 'How many passed.' },
          { name: 'failed', kind: 'number', description: 'How many failed.' },
          { name: 'skipped', kind: 'number', description: 'How many were skipped.' },
          { name: 'failures', kind: 'array', of: 'Failure', description: 'Capped by limit.' },
          { name: 'more', kind: 'boolean', description: 'There were more failures than came back.' },
          { name: 'url', kind: 'string', description: 'The test report, for a person to open.' },
        ],
      }),

      new OrknuxObject({
        name: 'Queued',
        description: 'A build asked for, and where it has got to.',
        properties: [
          { name: 'id', kind: 'string', description: 'The queue item, which queueItem takes.' },
          { name: 'job', kind: 'string', description: 'What was asked to build.' },
          { name: 'waiting', kind: 'boolean', description: 'Still in the queue; no build number yet.' },
          { name: 'why', kind: 'string', description: "What it is waiting for, in Jenkins' own words." },
          { name: 'cancelled', kind: 'boolean', description: 'Somebody took it out of the queue.' },
          { name: 'build', kind: 'number', description: 'The build number, once it has one.' },
          { name: 'url', kind: 'string', description: 'The build, once there is one to link to.' },
        ],
      }),
    ];
  }

  /*
   * Two pages, because there are two jobs here and a model picks one before it
   * has read either. Triage is where an agent wastes the most context — the
   * whole console log is the wrong first move and the obvious one — and
   * triggering is where it does the most damage, because a job that was
   * already building gets built twice by somebody who did not look first.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Finding out why a Jenkins build failed',
        description: 'Where to look when a build goes red, without dragging a megabyte of log into the answer.',
        content: `# Finding out why a Jenkins build failed

Four calls, and the order matters. Three of them are cheap; the console log is
not.

## 1. The build, not the log

\`jenkins_build(job)\` answers the last build by default: its \`result\`, whether
it is still \`building\`, what \`cause\` started it, and which \`changes\` went into
it. Read this first. A build that is still running has \`result: null\`, and "it
failed" about a build that has not finished is the most common wrong answer
there is.

The \`changes\` are the best single clue in a failure: three commits went in, the
build went red, and the messages usually say which one was the risk.

## 2. The tests, if there are any

\`jenkins_testResults(job)\` answers the counts and the failing cases by name,
with the assertion message each. **This is the answer** for most red builds,
and it costs a fraction of the log — a hundred failing tests is a few
kilobytes, where their console output is megabytes.

A build that published no test report says so, plainly. That is not an error:
it means this job runs no tests, or it died before it got to them.

## 3. The end of the log

\`jenkins_buildLog(job, which, lines)\` answers the **last** lines, because that
is where a build says why it stopped. Start with the default. Ask for more only
when the tail does not say — and if \`truncated\` is true there is more above, so
500 is a reasonable second move and 5000 almost never is.

Compilation errors, missing credentials and out-of-space are all at the end. A
test failure is in the middle, which is what step 2 is for.

## 4. Compare against what worked

\`jenkins_build(job, "lastSuccessfulBuild")\` beside the failing one says whether
the job has ever passed, when it last did, and what has gone in since. "It has
never passed" and "it broke this morning" are different problems, and they look
identical from a single red build.

## What not to do

- **Do not fetch the whole console log.** There is no call here that does, on
  purpose. If the answer really needs more, say which lines you read and give
  the \`url\` so a person can read the rest.
- **Do not retrigger to see whether it passes.** That is a flaky test dressed
  as debugging: it costs an agent nothing and an executor ten minutes, and a
  second red build says nothing the first one did not.
- **Do not quote a colour as a status.** Jenkins says \`blue\` for passing and
  \`red_anime\` for failing-and-building-now; this plugin answers a word and a
  boolean instead, and those are the ones to repeat to a person.`,
      }),

      new OrknuxSkill({
        name: 'Running a Jenkins job',
        description: 'What triggering actually does, and why a queue item is not a build yet.',
        content: `# Running a Jenkins job

\`jenkins_trigger(job, parameters)\` asks Jenkins to build something. Two things
about it are worth knowing before the first call.

## Look before you trigger

\`jenkins_job(job)\` answers \`building\`, \`inQueue\`, \`buildable\` and the
\`parameters\` the job takes. Read it first, every time:

- **\`building\` or \`inQueue\` means it is already going.** Triggering again
  queues a second build of the same thing, and on a job that deploys, two
  builds of one commit is an incident rather than a duplicate.
- **\`buildable: false\` means the job is disabled.** The trigger will be
  refused; say that, rather than trying it again.
- **The parameters are named exactly.** \`BRANCH\` is not \`branch\`, and Jenkins
  does not correct it — a name it does not know is ignored and the build runs
  with the default, which looks from outside like the build ignoring you.

## A queue item is not a build

\`trigger\` answers a \`Queued\`, not a \`Build\`, and that is Jenkins being honest:
the build has not started. It has been put in a queue, behind whatever else is
in it, waiting for an executor with the right label to be free.

\`jenkins_queueItem(id)\` says where it got to. While \`waiting\` is true, \`why\`
says what it is waiting for in Jenkins' own words — "Waiting for next available
executor", "Build #41 is already in progress". Once it starts, \`build\` carries
the number that every other call here takes.

**Nothing here polls, because nothing in a plugin can wait.** A workflow that
must act on the result checks back on its own schedule, or lets the job say so
— a post-build step calling a webhook beats anything that sits and asks.

**And queue items expire.** Jenkins forgets one about five minutes after the
build starts. Past that, \`queueItem\` answers that it is gone, and the job's
\`lastBuild\` is where to look — which is the better place anyway once there is a
build number.

## Say what you did

A triggered build carries its cause — "Started by user …" — and whoever finds
it later reads that. Quote the queue id, or the build number and the job's url,
in whatever you report, so the next person does not have to search a list of
builds for the one that was yours.`,
      }),
    ];
  }

  /* The agents' surface: all of it. Reading a build and running one are the same job. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'jobs' }),
      new OrknuxFunctionTool({ function: 'job' }),
      new OrknuxFunctionTool({ function: 'build' }),
      new OrknuxFunctionTool({ function: 'buildLog' }),
      new OrknuxFunctionTool({ function: 'testResults' }),
      new OrknuxFunctionTool({ function: 'trigger' }),
      new OrknuxFunctionTool({ function: 'queueItem' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'jobs',
        description:
          'Lists the jobs on the Jenkins, or the jobs inside one folder - pass the folder as a name ' +
          '("platform"), a path ("platform/services") or a url. Each answers its full name, whether ' +
          'it is a folder holding other jobs, its status as a word (passing, failing, unstable, ' +
          'aborted, never built, disabled), whether it is building now, its last build number, ' +
          'result and start time, and a url. A folder is not listed into: pass it back here to see ' +
          'inside it. limit caps the list, and more says whether there were others.',
        params: [
          { name: 'folder', type: 'string', required: false, default: '' },
          { name: 'limit', type: 'number', required: false, default: 50 },
        ],
        returnType: 'Jobs',
        run: (folder, limit) => {
          const inside = typeof folder === 'string' && folder.trim().length > 0 ? reference(folder) : null;
          const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
          const site = root(this.settings);

          /*
           * One more than will be shown, so that `more` is answered rather
           * than guessed: a tree with a range on it does not say how many it
           * left behind, and a listing that silently stops at the limit reads
           * as "that is all of them".
           */
          const listed = read(
            this.settings,
            `${inside === null ? '' : inside.path}/api/json?tree=jobs[name,fullName,url,color,` +
              `description,lastBuild[number,result,timestamp]]{0,${capped + 1}}`,
            inside === null ? undefined : `there is no folder called ${inside.name}`,
          );

          const found = at(listed, 'jobs') ?? [];
          return {
            jobs: found.slice(0, capped).map((one) => jobOf(one, site)),
            more: found.length > capped,
          };
        },
      }),

      new OrknuxFunction({
        name: 'job',
        description:
          'Opens one job: its status, whether it is building or queued, whether it can be built at ' +
          'all, its health score, its last build and its last successful and failed ones, and the ' +
          'parameters a build takes - name, type, default and description each. Pass the job as a ' +
          'name ("deploy"), a path through folders ("platform/services/deploy") or any url that ' +
          'names it. Read this before triggering anything: it says whether a build is already ' +
          'running, and what the parameters are actually called.',
        params: [{ name: 'job', type: 'string' }],
        returnType: 'Job',
        run: (job) => {
          const ref = reference(job);
          const opened = read(
            this.settings,
            `${ref.path}/api/json?tree=name,fullName,url,description,buildable,color,inQueue,` +
              'healthReport[score,description],lastBuild[number,result,timestamp],' +
              'lastSuccessfulBuild[number],lastFailedBuild[number],' +
              'property[parameterDefinitions[name,type,description,defaultParameterValue[value]]]',
            `there is no job called ${ref.name}`,
          );
          return jobOf(opened, root(this.settings));
        },
      }),

      new OrknuxFunction({
        name: 'build',
        description:
          'One build of a job: its result (SUCCESS, FAILURE, UNSTABLE, ABORTED, and null while it ' +
          'is still running), whether it is still building, when it started, how long it took in ' +
          'milliseconds, what caused it, and the commits that went into it. which takes a build ' +
          'number as a string ("412") or one of Jenkins\' permalinks - lastBuild, ' +
          'lastSuccessfulBuild, lastFailedBuild, lastCompletedBuild, lastStableBuild - and is ' +
          'lastBuild if not given. A url that names a build answers that build, whatever which ' +
          'says. Read this before any log: a build that has not finished has not failed.',
        params: [
          { name: 'job', type: 'string' },
          { name: 'which', type: 'string', required: false, default: 'lastBuild' },
        ],
        returnType: 'Build',
        run: (job, which) => {
          const ref = reference(job);
          const wanted = ref.build === null ? buildOf(which) : ref.build;
          const opened = read(
            this.settings,
            `${ref.path}/${wanted}/api/json?tree=number,result,building,timestamp,duration,` +
              'estimatedDuration,actions[causes[shortDescription]],' +
              'changeSet[items[commitId,msg,author[fullName]]],' +
              'changeSets[items[commitId,msg,author[fullName]]]',
            `${ref.name} has no build ${wanted}`,
          );
          return builtOf(opened, ref.name, root(this.settings), ref.path);
        },
      }),

      new OrknuxFunction({
        name: 'buildLog',
        description:
          "The end of a build's console output, which is where a build says why it stopped. " +
          'Answers the last lines oldest first, how many came back, whether there is more above ' +
          "them, and the build's own number and result - so a permalink like lastBuild resolves to " +
          'a number you can quote. which takes a build number or a permalink and is lastBuild if ' +
          'not given; lines caps how many lines come back, 200 if not given. Only the tail is ' +
          'fetched, so asking for thousands of lines of a large log is slow and rarely the answer: ' +
          'try the test results first.',
        params: [
          { name: 'job', type: 'string' },
          { name: 'which', type: 'string', required: false, default: 'lastBuild' },
          { name: 'lines', type: 'number', required: false, default: 200 },
        ],
        returnType: 'Log',
        run: (job, which, lines) => {
          const ref = reference(job);
          const wanted = ref.build === null ? buildOf(which) : ref.build;
          const capped = Math.min(Math.max(Math.trunc(lines), 1), 5000);
          const site = root(this.settings);
          const where = `${ref.path}/${wanted}`;

          /*
           * What the build is, before what it said. This resolves a permalink
           * to a number — an answer about "lastBuild" is an answer about a
           * build nobody can name afterwards — and says whether the log is
           * still being written, which changes what its last line means.
           */
          const about = read(
            this.settings,
            `${where}/api/json?tree=number,result,building`,
            `${ref.name} has no build ${wanted}`,
          );

          /*
           * Only the tail crosses the wire, where Jenkins will say how long
           * the log is. `progressiveText` answers its length in a header and
           * takes a byte offset, so a 40 MB log costs a window rather than
           * 40 MB — which matters here, where everything handed to a plugin
           * has to fit in a sandbox. Where that header is missing — an old
           * controller, a proxy that drops it, a HEAD nobody answers — the
           * whole console is fetched and cut here instead, which is correct
           * and merely dearer.
           */
          const window = Math.min(Math.max(capped * 240, 8 * 1024), 512 * 1024);
          const probe = orknux.http.request({
            url: `${site}${where}/logText/progressiveText?start=0`,
            method: 'HEAD',
            headers: headers(this.settings),
          });
          const length =
            probe.error === undefined && probe.status < 400 ? Number(header(probe, 'x-text-size')) : NaN;

          const cut = Number.isFinite(length) && length > window;
          const text = cut
            ? call(this.settings, { path: `${where}/logText/progressiveText?start=${length - window}` }).body
            : call(this.settings, { path: `${where}/consoleText` }).body;

          const all = (typeof text === 'string' ? text : '').split('\n');
          /* The byte window landed mid-line, and half a line is not a line. */
          if (cut && all.length > 1) {
            all.shift();
          }
          const tail = all.slice(-capped);

          return {
            job: ref.name,
            build: at(about, 'number'),
            building: at(about, 'building') === true,
            result: at(about, 'result'),
            lines: tail.length,
            truncated: cut || tail.length < all.length,
            text: tail.join('\n'),
            url: `${site}${where}/console`,
          };
        },
      }),

      new OrknuxFunction({
        name: 'testResults',
        description:
          "A build's test report: how many ran, passed, failed and were skipped, and the failing " +
          'cases by name with the assertion message each. This is the answer for most red builds ' +
          'and costs a fraction of the console log, so try it before reading any log. which takes ' +
          'a build number or a permalink and is lastBuild if not given; limit caps the failures ' +
          'listed. A build that published no test report says so rather than answering nothing.',
        params: [
          { name: 'job', type: 'string' },
          { name: 'which', type: 'string', required: false, default: 'lastBuild' },
          { name: 'limit', type: 'number', required: false, default: 20 },
        ],
        returnType: 'Tests',
        run: (job, which, limit) => {
          const ref = reference(job);
          const wanted = ref.build === null ? buildOf(which) : ref.build;
          const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
          const site = root(this.settings);
          const where = `${ref.path}/${wanted}`;

          /*
           * Everything but the stack traces and the captured output, which are
           * the two fields that make a test report enormous and the two a
           * caller has least use for: the class, the case and the message say
           * which test and why.
           */
          const report = read(
            this.settings,
            `${where}/testReport/api/json?tree=failCount,skipCount,passCount,totalCount,` +
              'suites[cases[className,name,status,errorDetails]]',
            `${ref.name} build ${wanted} published no test results - either it runs no tests, ` +
              'or it stopped before them',
          );

          const failures = [];
          for (const suite of at(report, 'suites') ?? []) {
            for (const one of at(suite, 'cases') ?? []) {
              const status = at(one, 'status');
              if (status !== 'FAILED' && status !== 'REGRESSION') {
                continue;
              }
              const held = at(one, 'className');
              const named = at(one, 'name');
              failures.push({
                test: typeof held === 'string' && held.length > 0 ? `${held}.${named}` : named,
                status: status,
                message: at(one, 'errorDetails'),
              });
            }
          }

          /*
           * Jenkins answers some of these and not others depending on which
           * publisher wrote the report, so each is worked out from whichever
           * of the four did come back rather than being shown as a null.
           */
          const failed = at(report, 'failCount') ?? failures.length;
          const skipped = at(report, 'skipCount') ?? 0;
          const passed = at(report, 'passCount');
          const total = at(report, 'totalCount');
          return {
            job: ref.name,
            build: /^\d+$/.test(wanted) ? Number(wanted) : null,
            total: total ?? (passed === null ? null : passed + failed + skipped),
            passed: passed ?? (total === null ? null : total - failed - skipped),
            failed: failed,
            skipped: skipped,
            failures: failures.slice(0, capped),
            more: failures.length > capped,
            url: `${site}${where}/testReport/`,
          };
        },
      }),

      new OrknuxFunction({
        name: 'trigger',
        description:
          "Asks Jenkins to build a job. parameters is a map of the job's own parameters by name - " +
          '{"BRANCH": "main"} - and the names have to match exactly, because Jenkins ignores one it ' +
          'does not know and builds with the default instead. Leave it empty for a job that takes ' +
          'none. Answers a queue item, not a build: the build has not started, and queueItem says ' +
          'when it has and what number it got. Read the job first - triggering one that is already ' +
          'building queues a second build of the same thing.',
        params: [
          { name: 'job', type: 'string' },
          { name: 'parameters', type: 'map', required: false, default: {} },
        ],
        returnType: 'Queued',
        run: (job, parameters) => {
          const ref = reference(job);
          const given = parameters !== null && typeof parameters === 'object' ? parameters : {};
          const passed = Object.keys(given)
            .filter((name) => given[name] !== null && given[name] !== undefined)
            .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(String(given[name]))}`);

          /*
           * `buildWithParameters` is refused on a job that takes none, and
           * `build` ignores the parameters of a job that does — so which of
           * them is used is decided by what was actually passed.
           */
          const where =
            passed.length === 0 ? `${ref.path}/build` : `${ref.path}/buildWithParameters?${passed.join('&')}`;

          const asked = call(this.settings, {
            method: 'POST',
            path: where,
            headers: crumb(this.settings),
            notFound: `there is no job called ${ref.name}, or it takes no parameters to build with`,
          });

          /*
           * The queue item is only in the Location header; the body is empty.
           * Something in front of Jenkins may have eaten that header, in which
           * case the build was still accepted and there is simply nothing to
           * follow it by — which is worth answering as a null rather than as a
           * failure that did not happen.
           */
          const location = header(asked, 'location');
          const found = typeof location === 'string' ? location.match(/\/queue\/item\/(\d+)/) : null;
          return {
            id: found === null ? null : found[1],
            job: ref.name,
            waiting: true,
            why: null,
            cancelled: false,
            build: null,
            url: null,
          };
        },
      }),

      new OrknuxFunction({
        name: 'queueItem',
        description:
          'Where a triggered build got to. Pass the id trigger answered, or the queue url. While ' +
          'waiting is true the build has not started, and why says what it is waiting for in ' +
          'Jenkins\' own words - "Waiting for next available executor". Once it starts, build ' +
          'carries the number every other call here takes. Jenkins forgets a queue item about five ' +
          "minutes after the build starts, and says so: past that, the job's lastBuild is where to " +
          'look.',
        params: [{ name: 'item', type: 'string' }],
        returnType: 'Queued',
        run: (item) => {
          const asked =
            typeof item === 'string' ? item.trim() : String(item === null || item === undefined ? '' : item);
          const found = asked.match(/^(?:.*\/queue\/item\/)?(\d+)\/?$/);
          if (found === null) {
            throw new Error(`not a queue item id or a queue url: ${asked}`);
          }
          const id = found[1];

          const held = read(
            this.settings,
            `/queue/item/${id}/api/json?tree=id,why,blocked,buildable,stuck,cancelled,` +
              'task[name,fullName],executable[number]',
            `queue item ${id} is not in the queue any more - Jenkins forgets one about five ` +
              "minutes after the build starts, so look at the job's lastBuild instead",
          );

          const running = at(held, 'executable');
          const number = at(running, 'number');
          const named = at(at(held, 'task'), 'fullName') ?? at(at(held, 'task'), 'name');
          return {
            id: String(at(held, 'id') ?? id),
            job: named,
            waiting: number === null,
            why: at(held, 'why'),
            cancelled: at(held, 'cancelled') === true,
            build: number,
            url:
              number === null || typeof named !== 'string'
                ? null
                : `${root(this.settings)}${pathOf(named.split('/'))}/${number}/`,
          };
        },
      }),
    ];
  }
}
