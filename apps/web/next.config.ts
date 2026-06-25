import { join } from "node:path";
import type { NextConfig } from "next";

// On GitHub Pages the site is a static export served from /trove (the deploy
// workflow sets PAGES=true). Everywhere else (Vercel, local dev) it runs as a
// full Next.js app at the root — enabling SSR/ISR for live + user-created pages.
const onPages = process.env.PAGES === "true";
const repo = "/trove";

const nextConfig: NextConfig = {
  // Static export ONLY for GitHub Pages; Vercel/dev run the full server.
  output: onPages ? "export" : undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: onPages ? repo : undefined,
  assetPrefix: onPages ? `${repo}/` : undefined,
  // Exposed to the client so we can prefix static assets (broadcast audio).
  env: { NEXT_PUBLIC_BASE_PATH: onPages ? repo : "" },
  // Compile the workspace TS packages (shipped as source, no build step).
  transpilePackages: ["@trove/engine", "@trove/data"],
  // Pin the monorepo root (avoids picking up stray lockfiles elsewhere on disk).
  turbopack: {
    root: join(import.meta.dirname, "..", ".."),
  },
};

export default nextConfig;
