import path from "node:path";
import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: ".next-build",
  allowedDevOrigins: ['192.168.8.232'],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default withSerwist(nextConfig);
