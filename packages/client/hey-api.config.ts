import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../openapi.yaml',
  output: {
    path: 'src/generated',
    format: 'prettier',
    lint: 'eslint',
  },
  plugins: [
    {
      name: '@hey-api/client-fetch',
      type: 'client',
    },
    {
      name: '@hey-api/sdk',
    },
    {
      name: '@hey-api/types',
    },
  ],
});
