import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "assets.coingecko.com" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
      { protocol: "https", hostname: "arweave.net" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
      { protocol: "https", hostname: "gateway.irys.xyz" },
      { protocol: "https", hostname: "bafkrei*" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "nftstorage.link" },
      { protocol: "https", hostname: "shdw-drive.genesysgo.net" },
      { protocol: "https", hostname: "*.arweave.net" },
      { protocol: "https", hostname: "statics.solscan.io" },
      { protocol: "https", hostname: "img.fotofolio.xyz" },
      { protocol: "https", hostname: "static.jup.ag" },
      { protocol: "https", hostname: "metadata.degods.com" },
      { protocol: "https", hostname: "i.imgur.com" },
      { protocol: "https", hostname: "cf-ipfs.com" },
    ],
  },
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
