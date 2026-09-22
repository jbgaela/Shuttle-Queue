"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned } from "lucide-react";
import { api, ApiError, type RankingLocationInput } from "@/lib/api";
import { Button, Card, LoadingState } from "@/components/ui";

export function newRankingVisitKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

const locationMessages = {
  DENIED:
    "Location permission was denied. Enable location for this site in your browser settings, then retry.",
  TIMEOUT:
    "Your location request timed out. Check that location services are enabled, then retry.",
  UNAVAILABLE:
    "Your browser could not provide a location. Enable device location services or try a supported browser, then retry.",
};

export function RankingLocationGate({
  token,
  children,
}: {
  token: string;
  children: (visitKey: string, onAccessLost: () => void) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [visitKey, setVisitKey] = useState(newRankingVisitKey);
  const [accessUntil, setAccessUntil] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const locationInFlight = useRef(false);
  const opening = useQuery({
    queryKey: ["rankingVisit", token, visitKey],
    queryFn: () => api.openRankingVisit(token, visitKey),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const loseAccess = useCallback(() => {
    setAccessUntil(null);
  }, []);

  useEffect(() => {
    const hide = () => {
      generation.current += 1;
      locationInFlight.current = false;
      setAccessUntil(null);
      setBusy(false);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hide();
        setVisitKey(newRankingVisitKey());
        setMessage("");
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      generation.current += 1;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey.includes(visitKey),
      });
    };
  }, [queryClient, visitKey]);

  useEffect(() => {
    if (!accessUntil) return;
    const timer = window.setTimeout(
      loseAccess,
      Math.max(0, accessUntil - Date.now()),
    );
    const checkExpiry = () => {
      if (Date.now() >= accessUntil) loseAccess();
    };
    window.addEventListener("focus", checkExpiry);
    document.addEventListener("visibilitychange", checkExpiry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkExpiry);
      document.removeEventListener("visibilitychange", checkExpiry);
    };
  }, [accessUntil, loseAccess]);

  const shareLocation = useCallback(async () => {
    if (locationInFlight.current || !opening.isSuccess) return;
    locationInFlight.current = true;
    const attempt = generation.current;
    setBusy(true);
    setMessage("");
    let location: RankingLocationInput;
    if (!navigator.geolocation || !window.isSecureContext)
      location = { status: "UNAVAILABLE" };
    else
      location = await new Promise<RankingLocationInput>((resolve) =>
        navigator.geolocation.getCurrentPosition(
          ({ coords }) =>
            resolve({
              status: "GRANTED",
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracy: coords.accuracy,
            }),
          (error) =>
            resolve({
              status:
                error.code === 1
                  ? "DENIED"
                  : error.code === 3
                    ? "TIMEOUT"
                    : "UNAVAILABLE",
            }),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        ),
      );
    if (generation.current !== attempt) return;
    try {
      const result = await api.rankingVisitLocation(token, visitKey, location);
      if (generation.current !== attempt) return;
      if (
        result.status === "GRANTED" &&
        result.accessExpiresAt &&
        Date.parse(result.accessExpiresAt) > Date.now()
      )
        setAccessUntil(Date.parse(result.accessExpiresAt));
      else
        setMessage(
          location.status === "GRANTED"
            ? "Location was not accepted. Please retry."
            : locationMessages[location.status],
        );
    } catch (error) {
      if (generation.current === attempt)
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to save location. Please retry.",
        );
    } finally {
      if (generation.current === attempt) {
        locationInFlight.current = false;
        setBusy(false);
      }
    }
  }, [opening.isSuccess, token, visitKey]);

  useEffect(() => {
    if (!opening.isSuccess || accessUntil || !navigator.permissions?.query)
      return;
    let cancelled = false;
    const attempt = generation.current;
    // An existing site grant needs no new button click. Prompt/denied states
    // still require the visitor to use the explicit location control.
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (
          !cancelled &&
          generation.current === attempt &&
          permission.state === "granted"
        )
          void shareLocation();
      })
      .catch(() => {
        // Some browsers do not support querying geolocation permission.
        // The manual location control remains available.
      });
    return () => {
      cancelled = true;
    };
  }, [accessUntil, opening.isSuccess, shareLocation]);

  if (accessUntil)
    return (
      <>
        {children(visitKey, loseAccess)}
        <aside
          aria-label="Visit privacy"
          className="bg-[var(--paper)] px-4 py-4 text-center text-xs leading-5 text-[var(--muted)]"
        >
        </aside>
      </>
    );
  if (opening.isPending && opening.fetchStatus !== "paused")
    return (
      <LoadingState variant="fullPage" label="Preparing shared rankings" />
    );
  const unavailable =
    opening.error instanceof ApiError && opening.error.status === 404;
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <MapPinned
          aria-hidden="true"
          className="text-[var(--teal)]"
          size={32}
        />
        <h1 className="display mt-4 text-3xl">
          {unavailable
            ? "Rankings unavailable"
            : busy
              ? "Opening rankings"
              : "Location required"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          {unavailable
            ? "This shared link is invalid or has been revoked."
            : "Location is required to view these rankings."}
        </p>
        {!unavailable && (
          <>
            <p role="status" className="mt-3 text-sm text-[var(--muted)]">
              {busy
                ? "Getting your location and confirming access…"
                : "Rankings stay hidden until your browser provides a location. Approximate IP location does not unlock this page."}
            </p>
            {(message || opening.error || opening.fetchStatus === "paused") && (
              <p role="alert" className="mt-4 text-sm text-[#8d4824]">
                {message ||
                  (opening.fetchStatus === "paused"
                    ? "Connect to the internet to continue."
                    : opening.error?.message)}
              </p>
            )}
            <Button
              className="mt-5"
              loading={busy || opening.isFetching}
              disabled={
                busy || opening.isFetching || opening.fetchStatus === "paused"
              }
              onClick={() => {
                if (opening.isError) void opening.refetch();
                else void shareLocation();
              }}
            >
              {opening.isError
                ? "Retry connection"
                : busy
                  ? "Getting location"
                  : message
                    ? "Retry location"
                    : "Share location and continue"}
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
