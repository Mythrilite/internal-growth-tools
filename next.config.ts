import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Ignore better-sqlite3 and other server-only modules
    if (isServer) {
      config.externals = [...(config.externals || []), "better-sqlite3"];
    }
    return config;
  },
  experimental: {
    turbopack: {
      resolveAlias: {
        "better-sqlite3": false,
      },
    },
  },
};

export default nextConfig;
