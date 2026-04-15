module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  rules: {
    // Security: disallow use of a `shell` property in source to prevent
    // accidental `shell: true` usage that leads to command injection.
    'no-restricted-syntax': [
      'error',
      {
        selector: "Property[key.name='shell']",
        message: "Avoid using a 'shell' property (e.g. { shell: true }). Use execFile/spawn with arg arrays or explicit APIs instead.",
      },
    ],
  },
};
