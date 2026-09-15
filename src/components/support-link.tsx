"use client";

import { Heart } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { supportUrl } from "@/lib/library-data";

const url = supportUrl(process.env.NEXT_PUBLIC_SUPPORT_URL);
export function SupportLink() {
  if (!url) return null;
  return <Tooltip.Provider delayDuration={200}><Tooltip.Root>
    <Tooltip.Trigger asChild><a href={url} target="_blank" rel="noopener noreferrer" aria-label="Support Capsule (opens in a new tab)" className="nav-button flex items-center justify-center"><Heart size={14} strokeWidth={1.5} aria-hidden="true" /></a></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content side="top" sideOffset={8} collisionPadding={12} className="z-[100] bg-popover px-2 py-1 text-[11px] text-muted-foreground">Support Capsule</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}
