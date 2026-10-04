// @ts-check
import { defineConfig } from 'astro/config';
import { envField } from 'astro/config';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  adapter: netlify({
    devFeatures: {
      edgeFunctions: false,
    },
  }),
  env: {
    schema: {
      OPENAI_API_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
    },
  },
});
