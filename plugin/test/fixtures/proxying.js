// A tool fronting a function the plugin does not declare, which the loader
// refuses at load rather than leaving to the first agent to call it.
export default class Proxying extends OrknuxPlugin {
  id() {
    return 'proxying';
  }

  apiVersion() {
    return 1;
  }

  tools() {
    return [new OrknuxFunctionTool({ function: 'missing' })];
  }
}
