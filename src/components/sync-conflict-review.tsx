"use client";

import { useState } from "react";
import type { SyncChoices, SyncConflict } from "@/lib/offline/domain-compat";
import { resolveSyncConflicts } from "@/lib/offline/repository";
import { Button, Input, Select } from "./ui";

export function SyncConflictReview({
  accountId,
  conflicts,
  onComplete,
}: {
  accountId: string;
  conflicts: SyncConflict[];
  onComplete: () => Promise<void>;
}) {
  const [choices, setChoices] = useState<SyncChoices>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = conflicts.every(
    (item) =>
      choices[item.key] &&
      (choices[item.key]?.choice !== "rename" || choices[item.key]?.name?.trim()),
  );
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await resolveSyncConflicts(accountId, choices);
      await onComplete();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The reviewed changes could not be synced.",
      );
      await onComplete();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Review sync conflicts"
      className="mt-5 space-y-4 rounded-2xl border border-[var(--line)] p-4"
    >
      <h4 className="font-semibold">Review changes before syncing</h4>
      <p className="text-sm text-[var(--muted)]">
        Your pending work is saved. Choose how to resolve each difference. Other pending changes
        will be kept.
      </p>
      {conflicts.map((item, index) => (
        <fieldset key={item.key} disabled={busy} className="space-y-2 rounded-xl bg-[#f7faf8] p-3">
          <legend className="text-sm font-semibold">
            {item.collection} · {item.field === "$record" ? "record changed" : item.field}
          </legend>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <details>
              <summary>This device</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(item.local, null, 2)}
              </pre>
            </details>
            <details>
              <summary>Cloud</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(item.cloud, null, 2)}
              </pre>
            </details>
          </div>
          <label className="block text-sm">
            Resolution {index + 1}
            <Select
              value={choices[item.key]?.choice ?? ""}
              onChange={(event) =>
                setChoices({
                  ...choices,
                  [item.key]: { choice: event.target.value as "local" | "cloud" | "rename" },
                })
              }
            >
              <option value="" disabled>
                Choose a resolution
              </option>
              {item.kind === "identity" ? (
                <>
                  <option value="cloud">Use the existing cloud identity</option>
                  {["players", "courts"].includes(item.collection) && (
                    <option value="rename">Keep both and rename this device’s record</option>
                  )}
                </>
              ) : (
                <>
                  <option value="local">Keep this device’s change</option>
                  <option value="cloud">Keep the cloud change</option>
                </>
              )}
            </Select>
          </label>
          {choices[item.key]?.choice === "rename" && (
            <label className="block text-sm">
              New name
              <Input
                maxLength={item.collection === "players" ? 80 : 60}
                value={choices[item.key]?.name ?? ""}
                onChange={(event) =>
                  setChoices({
                    ...choices,
                    [item.key]: { choice: "rename", name: event.target.value },
                  })
                }
              />
            </label>
          )}
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="text-sm text-[#8d4824]">
          {error}
        </p>
      )}
      <Button disabled={busy || !ready} onClick={() => void apply()}>
        {busy ? "Applying choices…" : "Apply choices and sync"}
      </Button>
    </section>
  );
}
