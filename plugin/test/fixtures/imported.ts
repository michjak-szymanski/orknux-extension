import { definePlugin, fn } from '@orknux/plugin';

export default definePlugin({
  id: 'imported',
  functions: [
    fn({
      name: 'shout',
      description: 'Louder.',
      params: [{ name: 'text', type: 'string' }],
      returnType: 'string',
      run: (text) => text.toUpperCase(),
    }),
  ],
});
