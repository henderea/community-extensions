import henderea from 'eslint-config-henderea';

export default [
  ...henderea,
  {
    ignores: ['bundles', 'node_modules']
  }
];
