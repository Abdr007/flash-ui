import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ---- Security Headers ----
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "0" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' https: data: blob:",
              "font-src 'self' https: data:",
              "connect-src 'self' https: wss:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
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
    // Pin workspace root explicitly. Without this, Next walks up and finds
    // an orphan package-lock.json in ~/ and treats home as the workspace
    // root, breaking tailwindcss/postcss resolution. `process.cwd()` is
    // the reliable way — `__dirname` is undefined in ESM TS config files.
    root: process.cwd(),
    resolveAlias: {
      fs: { browser: "./src/lib/empty-module.ts" },
      path: { browser: "./src/lib/empty-module.ts" },
      os: { browser: "./src/lib/empty-module.ts" },
    },
  },
};

export default nextConfig;
