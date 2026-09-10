"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ItemDetail, type ItemDraft } from "@/components/item-detail";
import { useWardrobe } from "@/lib/store";
import { prepareUploadedImage } from "@/lib/images";
import { WishlistDetail } from "./wishlist-detail";
import { createWishlistItem } from "@/lib/wishlist";
import type { WishlistPriceQuote } from "@/lib/wishlist-editor";
import { fetchProductImport } from "@/lib/product-import";
import { track } from "@/lib/analytics";
export function AddPiece({ onAdded, destination = "wardrobe", active = true, importUrl = null, onImportClosed }: { onAdded: () => void; destination?: "wardrobe" | "wishlist"; active?: boolean; importUrl?: string | null; onImportClosed?: () => void }) {
  const [mode, setMode] = useState<"link" | "photos">("link");
  const [url, setUrl] = useState(importUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<{ id: string; item: ItemDraft; images: string[]; uploadedImages?: string[]; priceQuote?: WishlistPriceQuote; fetchedAt: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const preparation = useRef(0);
  const { saveItem, saveWishlistItem, space } = useWardrobe();
  useEffect(() => () => { request.current?.abort(); preparation.current++; }, []);
  const extractUrl = useCallback(async (value: string, controller: AbortController) => {
    request.current?.abort();
    request.current = controller;
    setError("");
    setMode("link");
    setUrl(value);
    setBusy(true);
    try {
      const data = await fetchProductImport(value, { signal: controller.signal, online: navigator.onLine });
      if (controller.signal.aborted) return;
      const item = destination === "wishlist" ? { ...data.item, price: data.priceQuote?.price ?? "", currency: data.priceQuote?.currency ?? "" } : data.item;
      setDraft({ ...data, item, id: crypto.randomUUID(), fetchedAt: Date.now() });
      setUrl("");
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error && cause.name === "TimeoutError" ? "This page took too long to respond. Try again." : cause instanceof Error ? cause.message : "This page could not be imported. Try again."); }
    finally { if (request.current === controller) { setBusy(false); request.current = null; } }
  }, [destination]);
  useEffect(() => {
    if (!importUrl) return;
    const controller = new AbortController();
    // A handoff only opens a review draft. Saving still requires an explicit action.
    // Synchronize request/loading state when an external product URL arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void extractUrl(importUrl, controller);
    return () => { controller.abort(); request.current?.abort(); };
  }, [importUrl, extractUrl]);
  function extract(event: React.FormEvent) {
    event.preventDefault();
    if (!busy) void extractUrl(url, new AbortController());
  }
  function closeDraft() { setDraft(null); onImportClosed?.(); }
  // How a piece entered the wardrobe, without recording what the piece is.
  const addedSource = () => mode === "photos" ? "photo" as const : importUrl ? "extension" as const : "url_import" as const;
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
  return <section className="add-view" aria-labelledby="add-heading"><div className="flex items-center gap-1"><h1 id="add-heading" className="text-[14px] leading-5">{destination === "wishlist" ? "Add to wishlist" : "Add to wardrobe"}</h1><InfoTooltip key={mode} active={active} label={`About adding to your ${destination}`}>{mode === "link" ? "Fetch a product’s photos and details from its link, then review and edit them before saving." : "Photos are processed in this browser. Add the piece’s details and choose its front, back, or side views before saving."}</InfoTooltip></div>
    <div className="add-methods" role="group" aria-label="Add method"><button type="button" aria-pressed={mode === "link"} disabled={busy} onClick={() => { setMode("link"); setError(""); }}>Link</button><span aria-hidden="true">·</span><button type="button" aria-pressed={mode === "photos"} disabled={busy} onClick={() => { setMode("photos"); setError(""); }}>Photos</button></div>
    {mode === "link" ? <form onSubmit={extract} className="mt-6 flex items-center gap-5 border-b border-border focus-within:border-foreground"><label htmlFor="product-url" className="sr-only">Product URL</label><input id="product-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a product URL" autoComplete="url" required disabled={busy} className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle" /><Button type="submit" variant="ghost" disabled={busy || !url.trim()} className="h-12 shrink-0">{busy ? <><span>Fetching</span><Loader2 size={14} className="animate-spin" /></> : <><span>Continue</span><ArrowRight size={14} /></>}</Button></form> : <>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden aria-label="Choose piece photos" disabled={busy} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addPhotos(files); }} />
      <div className="photo-dropzone" data-dragging={dragging} aria-busy={busy} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void addPhotos(Array.from(event.dataTransfer.files)); }}>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? <><Loader2 size={14} className="animate-spin" />Opening photos</> : <>Upload photos<Upload size={14} strokeWidth={1.5} /></>}</Button>
        <p className="mt-2 text-[12px] text-subtle">or drop up to three photos of a piece here</p>
      </div><p className="mt-4 text-[12px] text-subtle">JPG, PNG, WebP or AVIF.</p>
    </>}
    {error && <p className="mt-6 text-[13px] leading-relaxed" role="alert">{error}</p>}
    {draft && (destination === "wishlist" ? <WishlistDetail key={draft.id} active={active} item={createWishlistItem({ ...draft.item, id: draft.id, createdAt: draft.fetchedAt, updatedAt: draft.fetchedAt }, draft.fetchedAt, draft.priceQuote ?? null)} images={draft.images} uploadedImages={draft.uploadedImages} isNew onClose={closeDraft} onSave={async (item) => { if (useWardrobe.getState().space !== space) throw new Error("The active wardrobe changed. Add this piece again to save."); await saveWishlistItem(item); track("piece_added", { collection: "wishlist", source: addedSource(), has_photo: Boolean(item.imageData || item.imageUrl) }); onAdded(); }} /> : <ItemDetail key={draft.id} active={active} item={draft.item} images={draft.images} uploadedImages={draft.uploadedImages} isNew onClose={closeDraft} onSave={async (item) => { if (useWardrobe.getState().space !== space) throw new Error("The active wardrobe changed. Add this piece again to save."); await saveItem(item); track("piece_added", { collection: "wardrobe", source: addedSource(), has_photo: Boolean(item.imageData || item.imageUrl) }); onAdded(); }} />)}
  </section>;
}
