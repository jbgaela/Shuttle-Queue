import { cn } from "@/lib/utils";
import { Children, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { LoaderCircle, Zap } from "lucide-react";

type SpinnerSize = "sm" | "md" | "lg";

const spinnerSizeClasses: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

export function Spinner({ size = "md", className }: { size?: SpinnerSize; className?: string }) {
  return <LoaderCircle aria-hidden="true" className={cn(spinnerSizeClasses[size], "shrink-0 animate-spin motion-reduce:animate-none", className)} />;
}

export function LoadingState({ label = "Loading", variant = "section", className }: { label?: string; variant?: "fullPage" | "section"; className?: string }) {
  if (variant === "fullPage") return <div role="status" aria-live="polite" aria-label={label} className={cn("grid min-h-screen place-items-center px-5", className)}><div className="flex flex-col items-center gap-4 text-center"><div className="grid size-14 place-items-center rounded-3xl bg-[var(--teal)] text-white shadow-lg"><Zap size={26} /></div><div className="flex items-center gap-3 text-sm text-[var(--muted)]"><Spinner size="lg" className="text-[var(--teal)]" /><span>{label}</span></div></div></div>;
  return <div role="status" aria-live="polite" aria-label={label} className={cn("flex min-h-32 items-center justify-center gap-3 px-5 py-8 text-sm text-[var(--muted)]", className)}><Spinner size="md" className="text-[var(--teal)]" /><span>{label}</span></div>;
}

export function Button({ className, variant = "primary", loading = false, disabled, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger"; loading?: boolean }) {
  const childText = Children.toArray(children).filter((child): child is string => typeof child === "string").join(" ").trim();
  const pendingText = /(?:…|\.\.\.)$/.test(childText);
  const isLoading = loading || pendingText;
  const accessibleLabel = isLoading && childText ? childText.replace(/\s*(?:…|\.\.\.)$/, "") : undefined;
  return <button className={cn("focus-ring relative inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-100", variant === "primary" && "bg-[var(--teal)] text-white hover:bg-[var(--teal-dark)]", variant === "quiet" && "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--teal)]", variant === "danger" && "bg-[#a74646] text-white hover:bg-[#853838]", className)} disabled={disabled || isLoading} aria-busy={isLoading || undefined} aria-label={props["aria-label"] ?? accessibleLabel} {...props}>{isLoading && <Spinner size="sm" className="absolute text-current" />}<span className={cn("inline-flex items-center justify-center gap-2 [&>svg]:shrink-0", isLoading && "invisible")}>{children}</span></button>;
}
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <section className={cn("min-w-0 rounded-3xl border border-[var(--line)] bg-white p-5 shadow-[0_10px_30px_rgba(16,42,45,0.05)]", className)} {...props} />; }
export function Badge({ children, tone = "teal" }: { children: React.ReactNode; tone?: "teal" | "orange" | "gray" }) { return <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", tone === "teal" && "bg-[#d8f1eb] text-[var(--teal-dark)]", tone === "orange" && "bg-[#fff0e4] text-[#a85b2b]", tone === "gray" && "bg-[#edf2f0] text-[var(--muted)]")}>{children}</span>; }
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input className="focus-ring w-full rounded-2xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--teal)] focus:ring-2 focus:ring-[#d8f1eb]" {...props} />; }
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="focus-ring w-full rounded-2xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--teal)] focus:ring-2 focus:ring-[#d8f1eb]" {...props}>{children}</select>;
}
