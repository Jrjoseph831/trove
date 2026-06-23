import { join } from "node:path";
import type { NextConfig } from "next";

// On GitHub Pages the site is served from /trove (project page). The deploy
// workflow sets PAGES=true; local dev stays at the root.
const onPages = process.env.PAGES === "true";
const repo = "/trove";

const nextConfig: NextConfig = {
  // Static export → deployable to GitHub Pages.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: onPages ? repo : undefined,
  assetPrefix: onPages ? `${repo}/` : undefined,
  // Compile the workspace TS packages (shipped as source, no build step).
  transpilePackages: ["@trove/engine", "@trove/data"],
  // Pin the monorepo root (avoids picking up stray lockfiles elsewhere on disk).
  turbopack: {
    root: join(import.meta.dirname, "..", ".."),
  },
};

export default nextConfig;
