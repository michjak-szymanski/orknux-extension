// The other way to write one: no imports at all, against the sandbox's globals.
export default class Ambient extends OrknuxPlugin {
  id() {
    return 'ambient';
  }

  apiVersion() {
    return 1;
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'answer',
        returnType: 'number',
        run: () => 42,
      }),
    ];
  }
}
