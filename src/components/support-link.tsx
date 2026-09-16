"use client";

import { ArrowUpRight } from "lucide-react";
import { supportUrl } from "@/lib/library-data";

const url = supportUrl(process.env.NEXT_PUBLIC_SUPPORT_URL);
export function SupportLink({ className }: { className?: string }) {
  if (!url) return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Support Capsule (opens in a new tab)" className={className}>Support Capsule <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" /></a>;
}
