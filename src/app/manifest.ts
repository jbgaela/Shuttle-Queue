import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shuttle Queue",
    short_name: "Shuttle Queue",
    description: "Offline-first badminton queue operations.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f8f5",
    theme_color: "#0d7468",
    icons: [
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
