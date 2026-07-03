module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource: 'nativewind' rewrites JSX so className is honored.
      // babel-preset-expo also runs the React Compiler (enabled via the
      // experiments.reactCompiler flag in app.json) ahead of this transform.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
