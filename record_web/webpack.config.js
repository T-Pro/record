const path = require('path');

module.exports = {
  mode: 'production',
  entry: {
    'record.bridge': './js/record.bridge.js',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'web/assets/packages/record_web/assets/js'),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  }
};