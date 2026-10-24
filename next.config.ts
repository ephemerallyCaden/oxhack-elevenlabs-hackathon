import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // We browse dev via 127.0.0.1 (ElevenLabs allowlist); Next 16 blocks non-localhost dev origins by default.
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
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
