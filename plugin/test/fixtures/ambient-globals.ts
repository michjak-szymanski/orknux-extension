/*
 * Never built and never run: this file exists to be *typechecked*, by
 * `tsconfig.ambient.json`, against `types/globals.d.ts` alone. It leans on
 * every part of the ambient contract — parameters, permissions, capabilities,
 * `this.settings`, the `orknux` helpers and their refusal arms — so a globals
 * file that stops describing what the server's template describes stops the
 * typecheck rather than shipping quietly.
 */
export default class Probe extends OrknuxPlugin {
  id(): string {
    return 'probe';
  }

  apiVersion(): number {
    return 1;
  }

  parameters(): OrknuxParameter[] {
    return [
      new OrknuxParameter({
        name: 'slack',
        description: 'The Slack to read through when a function is not handed one.',
        type: 'connection',
        connectionType: 'SLACK',
        required: false,
      }),
      new OrknuxParameter({
        name: 'token',
        type: 'string',
        secret: true,
      }),
    ];
  }

  permissions(): OrknuxPermission[] {
    return ['TEXT_ENCODING'];
  }

  capabilities(): OrknuxCapability[] {
    return ['SLACK_READ_THREAD', 'NETWORK_REQUEST'];
  }

  functions(): OrknuxFunction[] {
    return [
      new OrknuxFunction({
        name: 'isFirstReply',
        params: [
          { name: 'channel', type: 'string' },
          { name: 'threadTs', type: 'string' },
        ],
        returnType: 'boolean',
        run: (channel: string, threadTs: string): boolean => {
          const handle = this.settings.slack;
          if (typeof handle !== 'object') {
            // Absent, or answered with something a connection is not.
            return false;
          }
          const read = orknux.slack.thread(handle as SlackConnection, channel, threadTs, 2);
          if (read.error !== undefined) {
            orknux.log.warn('could not read the thread', read.error);
            return false;
          }
          return read.replies === 1;
        },
      }),

      new OrknuxFunction({
        name: 'status',
        params: [{ name: 'url', type: 'string' }],
        returnType: 'number',
        run: (url: string): number => {
          const answered = orknux.http.get(url);
          // Narrowing on the refusal arm is the shape every helper answers in.
          return answered.error === undefined ? answered.status : -1;
        },
      }),
    ];
  }
}
