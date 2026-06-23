
module.exports = {
  env: { node: true, es2022: true, browser: false },
  parserOptions: { ecmaVersion: 2022 },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-var': 'error',
    'prefer-const': 'warn',
    'eqeqeq': ['error', 'always'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['public/**/*.js'],
      env: { browser: true, node: false },
      rules: { 'no-unused-vars': 'off' },
    },
  ],
};
