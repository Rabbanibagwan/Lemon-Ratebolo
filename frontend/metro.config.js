// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, ".metro-cache");
config.cacheStores = [
  new FileStore({ root: path.join(root, "cache") }),
];

// jsPDF ESM source uses private class fields Hermes cannot compile.
// Always resolve bare "jspdf" to the minified build.
const jspdfMin = path.resolve(__dirname, "node_modules/jspdf/dist/jspdf.es.min.js");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "jspdf" || moduleName === "jspdf/dist/jspdf.es.min.js") {
    return { type: "sourceFile", filePath: jspdfMin };
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.maxWorkers = 2;

module.exports = config;
