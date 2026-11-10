"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { OFFLINE_WORKER_PROTOCOL_VERSION } from "@/lib/offline/readiness-protocol";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: 1, networkMode: "always" },
          mutations: { networkMode: "always" },
        },
      }),
  );
  useEffect(() => {
    const onWorkerMessage = (event: MessageEvent) => {
      if (
        event.data?.type !== "OFFLINE_BUILD_QUERY" ||
        event.data.protocolVersion !== OFFLINE_WORKER_PROTOCOL_VERSION
      )
        return;
      event.ports[0]?.postMessage({
        protocolVersion: OFFLINE_WORKER_PROTOCOL_VERSION,
        buildId: process.env.NEXT_PUBLIC_OFFLINE_BUILD_ID,
      });
    };
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
