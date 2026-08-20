import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: process.env.UI_TEST_DIST_DIR ?? ".next",
  allowedDevOrigins: ['192.168.8.232'],
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default withSerwist(nextConfig);
