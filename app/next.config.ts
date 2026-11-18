import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Anchor 0.32's ESM build has CommonJS inside (`exports.workspace = require(...)` when not in a
  // browser), which crashes `next dev` server rendering with "exports is not defined". Let Node
  // load its CommonJS build on the server instead. The browser bundle uses dist/browser, unaffected.
  serverExternalPackages: ["@coral-xyz/anchor"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
