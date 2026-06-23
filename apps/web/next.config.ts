import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the workspace TS packages (shipped as source, no build step).
  transpilePackages: ["@trove/engine", "@trove/data"],
  // Pin the monorepo root (avoids picking up stray lockfiles elsewhere on disk).
  turbopack: {
    root: join(import.meta.dirname, "..", ".."),
  },
};

export default nextConfig;
