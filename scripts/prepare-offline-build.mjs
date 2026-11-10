import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadataPath = path.join(frontendRoot, "public", "offline-build.json");
await mkdir(path.dirname(metadataPath), { recursive: true });
await writeFile(
  metadataPath,
  `${JSON.stringify({ buildId: randomUUID(), protocolVersion: 1 }, null, 2)}\n`,
  "utf8",
);
