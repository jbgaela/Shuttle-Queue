import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  return <button className={cn("focus-ring inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", variant === "primary" && "bg-[var(--teal)] text-white hover:bg-[var(--teal-dark)]", variant === "quiet" && "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--teal)]", variant === "danger" && "bg-[#a74646] text-white hover:bg-[#853838]", className)} {...props} />;
}
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <section className={cn("rounded-3xl border border-[var(--line)] bg-white p-5 shadow-[0_10px_30px_rgba(16,42,45,0.05)]", className)} {...props} />; }
export function Badge({ children, tone = "teal" }: { children: React.ReactNode; tone?: "teal" | "orange" | "gray" }) { return <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", tone === "teal" && "bg-[#d8f1eb] text-[var(--teal-dark)]", tone === "orange" && "bg-[#fff0e4] text-[#a85b2b]", tone === "gray" && "bg-[#edf2f0] text-[var(--muted)]")}>{children}</span>; }
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input className="focus-ring w-full rounded-2xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--teal)] focus:ring-2 focus:ring-[#d8f1eb]" {...props} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select className="focus-ring w-full rounded-2xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--teal)] focus:ring-2 focus:ring-[#d8f1eb]" {...props} />; }
