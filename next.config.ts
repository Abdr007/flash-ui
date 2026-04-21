import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ---- Version Skew Protection ----
  // On Vercel, VERCEL_DEPLOYMENT_ID is set per-build automatically. Telling
  // Next about it makes static asset URLs deployment-scoped (?dpl=<id>) and
  // forces a hard reload when the client's deployment != the server's. This
  // is the fix for "I came back after a few days and the page is broken /
  // chunks won't load / Connect Wallet does nothing" — the stale prerendered
  // HTML at the edge no longer points at chunks the new deploy purged.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.NEXT_DEPLOYMENT_ID,

  // ---- Security Headers ----
  async headers() {
    return [
      {
        // The root page HTML must never be cached at the edge. Without this,
        // Vercel's prerender cache held a ~5 minute stale copy (observed
        // x-vercel-cache: HIT, age 344s) — new deploys went live in chunks
        // but users still loaded HTML that referenced pre-fix chunks until
        // the stale-time ran out. Forcing no-store on just the HTML means
        // every page load hits the current deployment, while hashed JS/CSS
        // chunks continue to cache normally (they're content-addressed).
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
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
              // 'unsafe-inline' + 'unsafe-eval' are required by the Solana
              // wallet adapter (eval is used in @solana/web3.js bigint codepaths
              // and inline scripts come from Next's RSC payload). Tighten via
              // hashes/nonces in a future pass.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' https: data: blob:",
              "font-src 'self' https: data:",
              // connect-src is intentionally broad: token logos and price feeds
              // come from a long tail of CDNs (Helius, Jupiter, Pyth, Solscan,
              // Kamino, IPFS gateways, Arweave, Wikipedia, etc). Locking this
              // to a fixed list breaks token icon resolution in production.
              // Defense lives at the route level (rate limits, allowlists) and
              // at the wallet level (signature verification).
              "connect-src 'self' https: wss:",
              // Privy and WalletConnect both mount iframes — without
              // frame-src, the default-src 'self' blocks them silently and
              // the wallet modal just hangs. auth.privy.io hosts Privy's
              // auth iframe; verify.walletconnect.org / verify.walletconnect.com
              // host WalletConnect's wallet discovery and deep-link iframes.
              "frame-src 'self' https://auth.privy.io https://*.privy.io https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://solflare.com https://*.solflare.com",
              "child-src 'self' https://auth.privy.io https://*.privy.io https://*.walletconnect.com https://*.walletconnect.org",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              "object-src 'none'",
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
      // Next's remotePatterns require a real wildcard (** or *). The previous
      // entry "bafkrei*" was a literal hostname and never matched anything.
      // Token metadata for SPL tokens is commonly hosted at
      // <CID>.ipfs.nftstorage.link, so authorize the whole subdomain space.
      { protocol: "https", hostname: "**.ipfs.nftstorage.link" },
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
