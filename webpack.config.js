// webpack.config.js
const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: './app.js', // Your main UI entry
  output: {
    filename: 'bundle.js',           // Android will load this ONE file
    path: path.resolve(__dirname, 'dist'),
  },
  resolve: {
    fallback: {
      "path": require.resolve("path-browserify"),
      "events": require.resolve("events/"),
      "buffer": require.resolve("buffer/"),
      "fs": false // Disable file system for Android
    },
    alias: {
      // THE MAGIC: Swap the file!
      './uart': path.resolve(__dirname, 'uart-android.js'),
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer'],
    }),
    new CopyPlugin({
      patterns: [
        { 
          from: "index.html", 
          to: "index.html",
          transform(content) {
            // Replace WHATEVER script tag you have with bundle.js
            return content.toString()
              .replace('src="renderer.js"', 'src="bundle.js"')
              .replace('src="app.js"', 'src="bundle.js"');
          }
        },
        { from: "styles.css", to: "styles.css" },
        // Add other folders like images/fonts here
      ],
    }),
  ],
  externals: {
    'serialport': '{}', // Ignore Node SerialPort
    'electron': '{}'    // Ignore Electron IPC
  }
};
