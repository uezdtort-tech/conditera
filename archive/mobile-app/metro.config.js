const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Allow importing from outside the mobile-app directory (shared with web)
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
];

// react-native-maps is native-only and breaks web builds.
// Provide an empty mock for web platform.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-maps" && platform === "web") {
    return {
      filePath: path.resolve(__dirname, "src/mocks/MapsMock.js"),
      type: "sourceFile",
    };
  }
  // Default resolver for everything else
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
