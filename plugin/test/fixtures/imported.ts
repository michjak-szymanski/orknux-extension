import { definePlugin, fn, functionTool, param } from '@orknux/plugin';

export default definePlugin({
  id: 'imported',
  tools: [
    // The function below, fronted for agents, with words written for the model.
    functionTool({ function: 'shout', description: 'Say it louder. Use when asked to emphasise.' }),
  ],
  parameters: [
    param({
      name: 'shoutier',
      description: 'Whether to add emphasis.',
      type: 'boolean',
      required: false,
    }),
  ],
  permissions: ['INTL'],
  capabilities: ['NETWORK_REQUEST'],
  functions: [
    fn({
      name: 'shout',
      description: 'Louder.',
      params: [{ name: 'text', type: 'string' }],
      returnType: 'string',
      // A method rather than an arrow, so `this` is the plugin and the setting
      // is readable — which is how the sandbox calls it.
      run(text) {
        return this.settings.shoutier === true ? `${text.toUpperCase()}!` : text.toUpperCase();
      },
    }),
  ],
});
