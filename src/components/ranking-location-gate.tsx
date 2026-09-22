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

type PermissionStateValue = "granted" | "denied" | "prompt" | "unsupported";
type EnvironmentIssue = "INSECURE_CONTEXT" | "POLICY_BLOCKED" | "UNAVAILABLE";
type LocationPhase = "idle" | "locating" | "saving";

const environmentMessages: Record<EnvironmentIssue, string> = {
  INSECURE_CONTEXT:
    "Location access requires a secure HTTPS connection. Open the shared link in the deployed site and retry.",
  POLICY_BLOCKED:
    "This browser context does not allow location access. Open the shared link directly in your browser and retry.",
  UNAVAILABLE:
    "This browser does not provide location access. Enable location services or try a supported browser, then retry.",
};

function geolocationPolicyAllowsAccess() {
  if (typeof document === "undefined") return true;
  const policy = (
    document as Document & {
      permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
    }
  ).permissionsPolicy;
  return policy?.allowsFeature ? policy.allowsFeature("geolocation") : true;
}

function environmentIssue(): EnvironmentIssue | null {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return null;
  if (!window.isSecureContext) return "INSECURE_CONTEXT";
  if (!navigator.geolocation) return "UNAVAILABLE";
  if (!geolocationPolicyAllowsAccess()) return "POLICY_BLOCKED";
  return null;
}

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
  const [locationPhase, setLocationPhase] =
    useState<LocationPhase>("idle");
  const [online, setOnline] = useState(true);
  const [permissionState, setPermissionState] =
    useState<PermissionStateValue>("unsupported");
  const generation = useRef(0);
  const locationInFlight = useRef(false);
  const permissionStatus = useRef<PermissionStatus | null>(null);
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
      setLocationPhase("idle");
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
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

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
    setLocationPhase("locating");
    setMessage("");
    try {
      const issue = environmentIssue();
      let location: RankingLocationInput;
      if (issue) {
        location = { status: "UNAVAILABLE" };
      } else {
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
      }
      if (generation.current !== attempt) return;
      setLocationPhase("saving");
      const result = await api.rankingVisitLocation(token, visitKey, location);
      if (generation.current !== attempt) return;
      if (
        result.status === "GRANTED" &&
        result.accessExpiresAt &&
        Date.parse(result.accessExpiresAt) > Date.now()
      ) {
        setAccessUntil(Date.parse(result.accessExpiresAt));
      } else {
        setMessage(
          issue
            ? environmentMessages[issue]
            : location.status === "GRANTED"
              ? "Location was not accepted. Please retry."
              : locationMessages[location.status],
        );
      }
    } catch (error) {
      if (generation.current === attempt) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to save location. Please retry.",
        );
      }
    } finally {
      if (generation.current === attempt) {
        locationInFlight.current = false;
        setLocationPhase("idle");
      }
    }
  }, [opening.isSuccess, token, visitKey]);

  useEffect(() => {
    if (!opening.isSuccess || accessUntil) return;
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    const attempt = generation.current;
    let removePermissionListener = () => {};
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled || generation.current !== attempt) return;
        permissionStatus.current = status;
        const update = () => {
          if (cancelled || generation.current !== attempt) return;
          setPermissionState(status.state);
          if (status.state === "granted") void shareLocation();
        };
        if (typeof status.addEventListener === "function") {
          status.addEventListener("change", update);
          removePermissionListener = () => {
            if (typeof status.removeEventListener === "function")
              status.removeEventListener("change", update);
          };
        }
        update();
      })
      .catch(() => {
        if (!cancelled && generation.current === attempt)
          setPermissionState("unsupported");
      });
    return () => {
      cancelled = true;
      removePermissionListener();
      permissionStatus.current = null;
    };
  }, [accessUntil, opening.isSuccess, shareLocation]);

  if (accessUntil) return children(visitKey, loseAccess);
  if (opening.isPending && opening.fetchStatus !== "paused") {
    return (
      <LoadingState variant="fullPage" label="Preparing shared rankings" />
    );
  }

  const unavailable =
    opening.error instanceof ApiError && opening.error.status === 404;
  const offline = !online || opening.fetchStatus === "paused";
  if (offline) {
    return (
      <GateScreen
        heading="Connection required"
        description="Connect to the internet to open these shared rankings."
        actionLabel="Retry connection when online"
        actionDisabled
      />
    );
  }
  if (unavailable) {
    return (
      <GateScreen
        heading="Rankings unavailable"
        description="This shared link is invalid or has been revoked."
      />
    );
  }
  if (opening.isError) {
    const requestId =
      opening.error instanceof ApiError ? opening.error.requestId : undefined;
    return (
      <GateScreen
        heading="Unable to open rankings"
        description="The shared rankings service could not be reached."
        alert={opening.error.message}
        {...(requestId ? { requestId } : {})}
        actionLabel="Retry connection"
        actionLoading={opening.isFetching}
        onAction={() => void opening.refetch()}
      />
    );
  }

  const environment = opening.isSuccess ? environmentIssue() : null;
  const busy = locationPhase !== "idle";
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <MapPinned
          aria-hidden="true"
          className="text-[var(--teal)]"
          size={32}
        />
        <h1 className="display mt-4 text-3xl">
          {locationPhase === "locating"
            ? "Getting your location"
            : locationPhase === "saving"
              ? "Confirming access"
              : "Location required"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          Location is required to view these rankings.
        </p>
        <p role="status" className="mt-3 text-sm text-[var(--muted)]">
          {locationPhase === "locating"
            ? "Waiting for your browser to provide a location."
            : locationPhase === "saving"
              ? "Saving your location and confirming access."
              : environment
                ? environmentMessages[environment]
                : permissionState === "denied"
                  ? "Location is blocked for this site. Update the browser permission, then check again."
                  : permissionState === "prompt"
                    ? "Select Share location and continue, then choose Allow when your browser asks."
                    : "We need your location to confirm access to these rankings."}
        </p>
        {message && (
          <p role="alert" className="mt-4 text-sm text-[#8d4824]">
            {message}
          </p>
        )}
        <details className="mt-4 text-sm text-[var(--muted)]">
          <summary className="cursor-pointer rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)]">
            About this access check
          </summary>
          <p className="mt-2 leading-6">
            Your IP address, device details, visit time, and location are
            recorded and can be viewed by the link owner and Super Admins for
            90 days.
          </p>
        </details>
        <Button
          className="mt-5"
          loading={busy}
          disabled={busy}
          onClick={() => void shareLocation()}
        >
          {busy
            ? locationPhase === "saving"
              ? "Confirming access"
              : "Getting location"
            : permissionState === "denied" || environment
              ? "Check location access"
              : message
                ? "Retry location"
                : "Share location and continue"}
        </Button>
      </Card>
    </main>
  );
}

function GateScreen({
  heading,
  description,
  alert,
  requestId,
  actionLabel,
  actionDisabled = false,
  actionLoading = false,
  onAction,
}: {
  heading: string;
  description: string;
  alert?: string;
  requestId?: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onAction?: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <MapPinned
          aria-hidden="true"
          className="text-[var(--teal)]"
          size={32}
        />
        <h1 className="display mt-4 text-3xl">{heading}</h1>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          {description}
        </p>
        {alert && (
          <p role="alert" className="mt-4 text-sm text-[#8d4824]">
            {alert}
          </p>
        )}
        {requestId && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Reference: {requestId}
          </p>
        )}
        {actionLabel && (
          <Button
            className="mt-5"
            loading={actionLoading}
            disabled={actionDisabled || actionLoading}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}
      </Card>
    </main>
  );
}
