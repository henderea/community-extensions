import henderea from 'eslint-config-henderea';

export default [
  ...henderea,
  {
    files: ['**/*.ts'],
    rules: {
      '@stylistic/block-spacing': ['error', 'always'],
      '@stylistic/object-curly-spacing': ['error', 'always']
    }
  },
  {
    ignores: ['bundles', 'node_modules']
  }
];
