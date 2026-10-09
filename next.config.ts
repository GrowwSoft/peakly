import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // End-to-end runs use their own build folder so they never collide with a running dev server.
  ...(process.env.GI_NEXT_DIST_DIR ? { distDir: process.env.GI_NEXT_DIST_DIR } : {}),
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
