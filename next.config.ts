import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // flash-sdk → @coral-xyz/anchor → nodewallet.js requires 'fs'
      // which doesn't exist in the browser. Provide empty fallback.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
      };
    }
    return config;
  },
  // Turbopack equivalent
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/empty-module.ts" },
      path: { browser: "./src/lib/empty-module.ts" },
      os: { browser: "./src/lib/empty-module.ts" },
    },
  },
};

export default nextConfig;
