import { definePlugin, fn } from '@orknux/plugin';

/**
 * The plugin from the server's own template, written against this package.
 *
 * It answers the three questions an upload asks — what it calls itself, which
 * plugin API it was written against, and what it offers — and it is built with
 * `npm run example`, which bundles it and then asks it those same three questions
 * before anything is uploaded.
 *
 * The parameter types are declared once. `run` is typed from them, so `email` is
 * a `string` here without being annotated, and changing the declaration to
 * `number` stops this file compiling rather than producing a plugin that lies
 * about itself.
 */
export default definePlugin({
  id: 'teammates',

  functions: [
    fn({
      name: 'isTeammate',
      description: 'Whether an email address belongs to a member of this workspace.',
      params: [{ name: 'email', type: 'string' }],
      returnType: 'boolean',

      /*
       * Nothing in here can reach out. The sandbox denies host access, IO,
       * threads and the network, so a function works with what it was passed —
       * looking a user up in the directory is a capability the server has still
       * to hand over.
       */
      run: (email) => email.length > 0 && email.endsWith('@example.com'),
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
