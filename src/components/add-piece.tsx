"use client";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemDetail, type ItemDraft } from "@/components/item-detail";
import { useWardrobe } from "@/lib/store";
export function AddPiece({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ item: ItemDraft; images: string[] } | null>(null);
  const { saveItem, space } = useWardrobe();
  async function extract(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!navigator.onLine) { setError("Connect to the internet to fetch a product link."); return; }
    let normalized: URL;
    try { normalized = new URL(url.trim()); if (!["https:", "http:"].includes(normalized.protocol)) throw new Error(); }
    catch { setError("Paste a full product URL, starting with https://."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: normalized.href }), signal: AbortSignal.timeout(35_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This page could not be imported. Try another product link.");
      setDraft(data);
      setUrl("");
    } catch (cause) { setError(cause instanceof Error && cause.name === "TimeoutError" ? "This page took too long to respond. Try again." : cause instanceof Error ? cause.message : "This page could not be imported. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="add-view" aria-labelledby="add-heading"><h1 id="add-heading" className="text-[14px] leading-5">Add a piece</h1><form onSubmit={extract} className="mt-8 flex items-center gap-5 border-b border-neutral-300 focus-within:border-black"><label htmlFor="product-url" className="sr-only">Product URL</label><input id="product-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a product URL" autoComplete="url" required disabled={busy} className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-neutral-400" /><Button type="submit" variant="ghost" disabled={busy || !url.trim()} className="h-12 shrink-0">{busy ? <><span>Fetching</span><Loader2 size={14} className="animate-spin" /></> : <><span>Continue</span><ArrowRight size={14} /></>}</Button></form><p className="mt-4 text-[12px] text-neutral-400">Review the image and details before saving.</p>{error && <p className="mt-6 text-[13px] leading-relaxed" role="alert">{error}</p>}
    {draft && <ItemDetail key={draft.item.purchaseUrl} item={draft.item} images={draft.images} isNew onClose={() => setDraft(null)} onSave={async (item) => { if (useWardrobe.getState().space !== space) throw new Error("The active wardrobe changed. Import this piece again to save."); await saveItem(item); onAdded(); }} />}
  </section>;
}
