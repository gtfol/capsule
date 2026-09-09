import type { Metadata } from "next";
import Link from "next/link";
import { SharedCapsule } from "@/components/shared-capsule";
import { shareStore } from "@/lib/server/shares";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared capsule",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await shareStore.get(id).then((record) => ({ record, failed: false })).catch(() => ({ record: null, failed: true }));
  return result.record ? <SharedCapsule shareId={id} snapshot={result.record.snapshot} updatedAt={result.record.updatedAt} expiresAt={result.record.expiresAt} /> : <ShareUnavailable temporary={result.failed} />;
}
function ShareUnavailable({ temporary = false }: { temporary?: boolean }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
    <h1 className="text-[14px]">{temporary ? "This link could not be opened." : "This link is no longer available."}</h1>
    <p className="text-[12px] text-muted-foreground">{temporary ? "Try again in a moment." : "It may have expired or been removed."}</p>
    <Link className="mt-4 text-[12px] underline underline-offset-4" href="/">Open capsule</Link>
  </main>;
}
