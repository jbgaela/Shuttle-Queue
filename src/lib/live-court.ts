function pretty(value: string) {
  return value.toLowerCase().split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

export function playerInitials(displayName?: string) {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "P";
  if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function participantMetadata(gender?: string, skillLevel?: string) {
  return `${gender ? pretty(gender) : "Gender unavailable"} · ${skillLevel ? pretty(skillLevel) : "Skill unavailable"}`;
}

export function liveCourtStatusLabel(status: string) {
  return status === "OCCUPIED" ? "Playing" : pretty(status);
}
