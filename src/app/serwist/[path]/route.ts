import { createSerwistRoute } from "@serwist/turbopack";
import { offlineBuildId } from "../../../../offline-build";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
    esbuildOptions: {
      sourcemap: false,
      define: { __OFFLINE_BUILD_ID__: JSON.stringify(offlineBuildId) },
    },
    rebuildOnChange: process.env.NODE_ENV !== "production",
  },
);
