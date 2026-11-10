import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export const offlineBuildId = (() => {
  try {
    const buildMetadata = JSON.parse(readFileSync("public/offline-build.json", "utf8")) as {
      buildId?: unknown;
    };
    if (typeof buildMetadata.buildId === "string") return buildMetadata.buildId;
  } catch {
    /* Development and direct config checks may run before a production build. */
  }
  return `local-${randomUUID()}`;
})();
