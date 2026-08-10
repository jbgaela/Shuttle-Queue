import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: process.env.UI_TEST_DIST_DIR ?? ".next",
  allowedDevOrigins: ['192.168.8.232'],
};

export default withSerwist(nextConfig);
