"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemDetail, type ItemDraft } from "@/components/item-detail";
import { useWardrobe } from "@/lib/store";
import { prepareUploadedImage } from "@/lib/images";
import { WishlistDetail } from "./wishlist-detail";
import { createWishlistItem } from "@/lib/wishlist";
import type { WishlistPriceQuote } from "@/lib/wishlist-editor";
export function AddPiece({ onAdded, destination = "wardrobe" }: { onAdded: () => void; destination?: "wardrobe" | "wishlist" }) {
  const [mode, setMode] = useState<"link" | "photos">("link");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<{ id: string; item: ItemDraft; images: string[]; uploadedImages?: string[]; priceQuote?: WishlistPriceQuote; fetchedAt: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const preparation = useRef(0);
  const { saveItem, saveWishlistItem, space } = useWardrobe();
  useEffect(() => () => { request.current?.abort(); preparation.current++; }, []);
  async function extract(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!navigator.onLine) { setError("Connect to the internet to fetch a product link."); return; }
    let normalized: URL;
    try { normalized = new URL(url.trim()); if (!["https:", "http:"].includes(normalized.protocol)) throw new Error(); }
    catch { setError("Paste a full product URL, starting with https://."); return; }
    if (busy) return;
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: normalized.href }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || "This page could not be imported. Try another product link.");
      const item = destination === "wishlist" ? { ...data.item, price: data.priceQuote?.price ?? "", currency: data.priceQuote?.currency ?? "" } : data.item;
      setDraft({ ...data, item, id: crypto.randomUUID(), fetchedAt: Date.now() });
      setUrl("");
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error && cause.name === "TimeoutError" ? "This page took too long to respond. Try again." : cause instanceof Error ? cause.message : "This page could not be imported. Try again."); }
    finally { if (!controller.signal.aborted) setBusy(false); if (request.current === controller) request.current = null; }
  }
  async function addPhotos(files: File[]) {
    if (busy || !files.length) return;
    setError("");
    if (files.length > 3) { setError("Choose up to three photos of the same piece."); return; }
    const token = ++preparation.current;
    setBusy(true);
    try {
      const uploadedImages = await Promise.all(files.map(prepareUploadedImage));
      if (token !== preparation.current) return;
      setDraft({ id: crypto.randomUUID(), fetchedAt: Date.now(), images: [], uploadedImages, item: { name: "", brand: "", category: "tops", size: "", color: "", price: "", currency: "", description: "", purchaseUrl: "", imageUrl: "" } });
    } catch (cause) { if (token === preparation.current) setError(cause instanceof Error ? cause.message : "These photos could not be opened. Try another image."); }
    finally { if (token === preparation.current) setBusy(false); }
  }
  return <section className="add-view" aria-labelledby="add-heading"><h1 id="add-heading" className="text-[14px] leading-5">{destination === "wishlist" ? "Add to wishlist" : "Add a piece"}</h1>
    {destination === "wardrobe" && <div className="add-methods" role="group" aria-label="Add method"><button type="button" aria-pressed={mode === "link"} disabled={busy} onClick={() => { setMode("link"); setError(""); }}>Link</button><span aria-hidden="true">·</span><button type="button" aria-pressed={mode === "photos"} disabled={busy} onClick={() => { setMode("photos"); setError(""); }}>Photos</button></div>}
    {mode === "link" ? <><form onSubmit={extract} className="mt-6 flex items-center gap-5 border-b border-border focus-within:border-foreground"><label htmlFor="product-url" className="sr-only">Product URL</label><input id="product-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a product URL" autoComplete="url" required disabled={busy} className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle" /><Button type="submit" variant="ghost" disabled={busy || !url.trim()} className="h-12 shrink-0">{busy ? <><span>Fetching</span><Loader2 size={14} className="animate-spin" /></> : <><span>Continue</span><ArrowRight size={14} /></>}</Button></form><p className="mt-4 text-[12px] text-subtle">Review the image and details before saving.</p></> : <>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden aria-label="Choose piece photos" disabled={busy} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addPhotos(files); }} />
      <div className="photo-dropzone" data-dragging={dragging} aria-busy={busy} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void addPhotos(Array.from(event.dataTransfer.files)); }}>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? <><Loader2 size={14} className="animate-spin" />Opening photos</> : <>Choose photos<ArrowRight size={14} /></>}</Button>
        <p className="mt-2 text-[12px] text-subtle">or drop up to three photos of a piece here</p>
      </div><p className="mt-4 text-[12px] text-subtle">JPG, PNG, WebP or AVIF. Photos are processed in this browser.</p>
    </>}
    {error && <p className="mt-6 text-[13px] leading-relaxed" role="alert">{error}</p>}
    {draft && (destination === "wishlist" ? <WishlistDetail key={draft.id} item={createWishlistItem({ ...draft.item, id: draft.id, createdAt: draft.fetchedAt, updatedAt: draft.fetchedAt }, draft.fetchedAt, draft.priceQuote ?? null)} images={draft.images} isNew onClose={() => setDraft(null)} onSave={async (item) => { if (useWardrobe.getState().space !== space) throw new Error("The active wardrobe changed. Add this piece again to save."); await saveWishlistItem(item); onAdded(); }} /> : <ItemDetail key={draft.id} item={draft.item} images={draft.images} uploadedImages={draft.uploadedImages} isNew onClose={() => setDraft(null)} onSave={async (item) => { if (useWardrobe.getState().space !== space) throw new Error("The active wardrobe changed. Add this piece again to save."); await saveItem(item); onAdded(); }} />)}
  </section>;
}
