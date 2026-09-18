import { definePlugin, fn, param } from '@orknux/plugin';

/**
 * The plugin from the server's own template, written against this package.
 *
 * It answers the questions an upload asks — what it calls itself, which plugin
 * API it was written against, what it offers, and what it has to be told — and
 * it is built with `npm run example`, which bundles it and then asks it those
 * same questions before anything is uploaded.
 *
 * The parameter types are declared once. `run` is typed from them, so `email` is
 * a `string` here without being annotated, and changing the declaration to
 * `number` stops this file compiling rather than producing a plugin that lies
 * about itself.
 */
export default definePlugin({
  id: 'teammates',

  /*
   * What each workspace answers once, arriving as `this.settings` — which is
   * why `isTeammate` below is written as a method rather than an arrow: the
   * sandbox calls `run` with the plugin as `this`, and an arrow written here
   * would close over nothing.
   */
  parameters: [
    param({
      name: 'teamDomain',
      description: 'The mail domain this workspace treats as its own.',
      type: 'string',
    }),
  ],

  functions: [
    fn({
      name: 'isTeammate',
      description: 'Whether an email address belongs to a member of this workspace.',
      params: [{ name: 'email', type: 'string' }],
      returnType: 'boolean',

      /*
       * Nothing in here can reach out. The sandbox denies host access, IO,
       * threads and the network, so a function works with what it was passed
       * and what the workspace answered — anything further is a capability the
       * plugin would have to declare and somebody would have to accept.
       */
      run(email) {
        const domain = this.settings.teamDomain;
        if (typeof domain !== 'string' || domain.length === 0) {
          // Required, so a workspace that has not set it is already marked as
          // needing to. Answering no is the safe reading of not knowing.
          return false;
        }
        return email.length > 0 && email.endsWith(`@${domain}`);
      },
    }),

    fn({
      name: 'domainOf',
      description: 'The domain part of an email address, or an empty string.',
      params: [{ name: 'email', type: 'string' }],
      returnType: 'string',
      run: (email) => {
        const at = email.lastIndexOf('@');
        return at === -1 ? '' : email.slice(at + 1).toLowerCase();
      },
    }),

    fn({
      name: 'summarise',
      description: 'How many of a list of addresses are teammates.',
      params: [
        { name: 'addresses', type: 'array' },
        { name: 'domain', type: 'string' },
      ],
      returnType: 'map',
      /*
       * An array crossed the boundary as JSON, so what is in it is `unknown`
       * until this code looks — which is the reason to declare `array` rather
       * than pretend to know.
       */
      run: (addresses, domain) => {
        const suffix = `@${domain.toLowerCase()}`;
        const inside = addresses.filter(
          (address) => typeof address === 'string' && address.toLowerCase().endsWith(suffix),
        );
        return { total: addresses.length, teammates: inside.length };
      },
    }),
  ],
});
