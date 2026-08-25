import { UserRound } from "lucide-react";
import type { SVGProps } from "react";
import { playerGenderKind, type PlayerGenderKind } from "@/lib/live-court";

type PlayerGenderIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  gender?: string | undefined;
  size?: number | string;
};

type SilhouetteProps = Omit<PlayerGenderIconProps, "gender">;

function MaleSilhouette({ className, size, ...props }: SilhouetteProps) {
  return <svg {...props} className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="3.1" /><path d="M5.5 20c.4-4.1 2.7-6.5 6.5-6.5s6.1 2.4 6.5 6.5H5.5Z" /></svg>;
}

function FemaleSilhouette({ className, size, ...props }: SilhouetteProps) {
  return <svg {...props} className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.1 8.4c0-3.1 2-5.5 4.9-5.5s4.9 2.4 4.9 5.5v2.1h-1.5l-.7-2.1c-1.6.7-3.5.7-5.3 0l-.7 2.1H7.1V8.4Z" /><path d="M5.1 20c.4-3.9 2.8-6.5 6.9-6.5s6.5 2.6 6.9 6.5H5.1Z" /></svg>;
}

export function PlayerGenderIcon({ gender, size = 20, ...props }: PlayerGenderIconProps) {
  const kind = playerGenderKind(gender);
  if (kind === "MALE") return <MaleSilhouette {...props} size={size} />;
  if (kind === "FEMALE") return <FemaleSilhouette {...props} size={size} />;
  return <UserRound {...props} size={size} />;
}
