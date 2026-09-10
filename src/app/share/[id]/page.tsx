import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SharedCapsule } from "@/components/shared-capsule";
import { hashShareViewer, shareStore } from "@/lib/server/shares";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared capsule",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await shareStore.get(id).then((record) => ({ record, failed: false })).catch(() => ({ record: null, failed: true }));
  // Count the open server-side so the owner's total survives blocked analytics.
  // Only a live link counts, and only once per viewer per day.
  if (result.record) await countShareView(id);
  return result.record ? <SharedCapsule shareId={id} snapshot={result.record.snapshot} updatedAt={result.record.updatedAt} expiresAt={result.record.expiresAt} /> : <ShareUnavailable temporary={result.failed} />;
}
// Prefetches and crawlers should not read as visits. Next sends a purpose
// header for the former; the latter are excluded by a coarse agent check,
// which is enough for a counter meant to show a person their link's reach.
const CRAWLER = /bot|crawler|spider|crawling|preview|facebookexternalhit|slackbot|bingpreview|headlesschrome|monitor|curl|wget|python-requests/i;
async function countShareView(id: string) {
  try {
    const header = await headers();
    if (header.get("next-router-prefetch") || header.get("purpose") === "prefetch" || header.get("x-purpose") === "preview") return;
    if (CRAWLER.test(header.get("user-agent") ?? "")) return;
    if (!process.env.DATABASE_URL) return;
    await shareStore.recordView(id, hashShareViewer(new Request("https://capsule.invalid", { headers: header }), process.env.DATABASE_URL));
  } catch { /* A view that cannot be counted must never fail the page. */ }
}
function ShareUnavailable({ temporary = false }: { temporary?: boolean }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
    <h1 className="text-[14px]">{temporary ? "This link could not be opened." : "This link is no longer available."}</h1>
    <p className="text-[12px] text-muted-foreground">{temporary ? "Try again in a moment." : "It may have expired or been removed."}</p>
    <Link className="mt-4 text-[12px] underline underline-offset-4" href="/">Open capsule</Link>
  </main>;
}
