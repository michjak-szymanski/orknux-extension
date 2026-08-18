// Reaches for something the sandbox does not have. The build is where that has
// to fail: an unresolved import in the bundle is a plugin that loads and then
// cannot run.
import { readFileSync } from 'node:fs';

export default class Reaching extends OrknuxPlugin {
  id() {
    return 'reaching';
  }

  apiVersion() {
    return 1;
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'read',
        returnType: 'string',
        run: () => readFileSync('/etc/passwd', 'utf8'),
      }),
    ];
  }
}
