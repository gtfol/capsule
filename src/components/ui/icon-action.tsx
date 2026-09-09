"use client";

import type { ComponentProps } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = ComponentProps<"button"> & { label: string; tooltip?: string; icon: LucideIcon; loading?: boolean; complete?: boolean };

export function IconAction({ label, tooltip, icon: Icon, loading, complete, className, ...props }: Props) {
  return <Tooltip.Provider delayDuration={200} disableHoverableContent><Tooltip.Root>
    <Tooltip.Trigger asChild><button type="button" {...props} aria-label={label} aria-busy={loading || undefined} className={cn("photo-tool shrink-0", className)}>
    {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : complete ? <Check size={16} strokeWidth={1.4} aria-hidden="true" /> : <Icon size={16} strokeWidth={1.4} aria-hidden="true" />}
    </button></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content side="top" align="end" sideOffset={5} collisionPadding={12} className="pointer-events-none z-[100] max-w-[calc(100vw-24px)] bg-popover px-[7px] py-[5px] text-[11px] leading-snug text-muted-foreground">{tooltip ?? label}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}
