"use client";

import type { ComponentProps } from "react";
import { Check, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = ComponentProps<"button"> & { label: string; icon: LucideIcon; loading?: boolean; complete?: boolean };

export function IconAction({ label, icon: Icon, loading, complete, className, ...props }: Props) {
  return <button type="button" {...props} aria-label={label} aria-busy={loading || undefined} className={cn("photo-tool shrink-0", className)}>
    {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : complete ? <Check size={16} strokeWidth={1.4} aria-hidden="true" /> : <Icon size={16} strokeWidth={1.4} aria-hidden="true" />}
    <span className="photo-tool-label" aria-hidden="true">{label}</span>
  </button>;
}
