function pretty(value: string) {
  return value.toLowerCase().split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

export type PlayerGenderKind = "MALE" | "FEMALE" | "NEUTRAL";

export function playerGenderKind(gender?: string): PlayerGenderKind {
  if (gender === "MALE" || gender === "FEMALE") return gender;
  return "NEUTRAL";
}

export function playerGenderLabel(gender?: string) {
  const kind = playerGenderKind(gender);
  return kind === "MALE" ? "Male player" : kind === "FEMALE" ? "Female player" : "Player";
}

export function participantSkillLabel(skillLevel?: string) {
  return skillLevel ? pretty(skillLevel) : "Skill unavailable";
}

export function liveCourtStatusLabel(status: string) {
  return status === "OCCUPIED" ? "Playing" : pretty(status);
}
