import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import { offlineBuildId } from "./offline-build";

const backendApiBaseUrl = (
  process.env.BACKEND_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000/api/v2"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  generateBuildId: async () => offlineBuildId,
  env: { NEXT_PUBLIC_OFFLINE_BUILD_ID: offlineBuildId },
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: process.env.UI_TEST_DIST_DIR ?? ".next",
  allowedDevOrigins: ["192.168.8.232"],
  async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "X-Shuttle-Build-Id", value: offlineBuildId }],
      },
      {
        source: "/rankings/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Permissions-Policy", value: "geolocation=(self)" },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: "/api/v2/:path*", destination: `${backendApiBaseUrl}/:path*` }];
  },
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withSerwist(nextConfig);
