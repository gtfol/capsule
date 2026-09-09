"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Images, Link2Off, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { CATEGORIES } from "./item-detail";
import { StarRating } from "./star-rating";
import { PriceHistoryChart } from "./price-history-chart";
import { cacheProductImages, imageSource } from "@/lib/images";
import { applyPriceFetch, formatPrice, MAX_PRICE_HISTORY, MAX_WISHLIST_SOURCES, normalizeListingUrl, recomputeWishlistPrice, wishlistPriceNumber } from "@/lib/wishlist";
import { fetchWishlistPrice } from "@/lib/wishlist-client";
import type { WishlistItem } from "@/lib/types";
import type { WishlistPriceQuote } from "@/lib/wishlist-editor";
import { assignPhotoSlot } from "@/lib/photo-slots";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog";

type Props = {
  item: WishlistItem;
  images?: string[];
  isNew?: boolean;
  onClose: () => void;
  onSave: (item: WishlistItem) => Promise<void>;
  onDelete?: () => Promise<void>;
  onMove?: (item: WishlistItem) => Promise<void>;
  onPriceChange?: (url: string, result: WishlistPriceQuote | null) => Promise<WishlistItem | null>;
};

function trackingFields(item: WishlistItem) {
  return { sources: item.sources, priceHistory: item.priceHistory, price: item.price, currency: item.currency, currentSourceUrl: item.currentSourceUrl, link_broken: item.link_broken };
}
function hasEdits(item: WishlistItem, initial: WishlistItem) {
  const fields = ["name", "brand", "category", "size", "color", "description", "purchaseUrl", "rating", "imageUrl", "imageData", "backImageUrl", "backImageData", "sideImageUrl", "sideImageData"] as const;
  return fields.some((field) => item[field] !== initial[field]);
}

export function WishlistDetail({ item, images = [], isNew = false, onClose, onSave, onDelete, onMove, onPriceChange }: Props) {
  const [form, setForm] = useState(item);
  const [error, setError] = useState("");
  const [priceError, setPriceError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const [alternative, setAlternative] = useState("");
  const [showAlternative, setShowAlternative] = useState(false);
  const [imageSide, setImageSide] = useState<"front" | "back" | "side">("front");
  const [gallery, setGallery] = useState(() => [...new Set([item.imageUrl, item.backImageUrl, item.sideImageUrl, ...images].filter((url): url is string => !!url))]);
  const [fetchingPhotos, setFetchingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const busy = saving || !!fetching || fetchingPhotos;
  const selectedImage = imageSide === "front" ? { imageUrl: form.imageUrl, imageData: form.imageData } : imageSide === "back" ? { imageUrl: form.backImageUrl ?? "", imageData: form.backImageData } : { imageUrl: form.sideImageUrl ?? "", imageData: form.sideImageData };
  const set = <K extends keyof WishlistItem>(key: K, value: WishlistItem[K]) => setForm((current) => ({ ...current, [key]: value }));
  const discard = () => { request.current?.abort(); onClose(); };
  const close = () => { if (saving) return; if (isNew || hasEdits(form, item) || fetching || fetchingPhotos || alternative.trim()) setConfirmClose(true); else discard(); };
  function selectImage(imageUrl: string) {
    setForm((current) => {
      const data = new Map([[current.imageUrl, current.imageData], [current.backImageUrl, current.backImageData], [current.sideImageUrl, current.sideImageData], [item.imageUrl, item.imageData], [item.backImageUrl, item.backImageData], [item.sideImageUrl, item.sideImageData]]);
      const slots = assignPhotoSlot({ frontId: current.imageUrl, backId: current.backImageUrl || null, sideId: current.sideImageUrl || null }, imageSide, imageUrl);
      return { ...current, imageUrl: slots.frontId, imageData: data.get(slots.frontId), backImageUrl: slots.backId ?? undefined, backImageData: slots.backId ? data.get(slots.backId) : undefined, sideImageUrl: slots.sideId ?? undefined, sideImageData: slots.sideId ? data.get(slots.sideId) : undefined };
    });
  }

  async function fetchPhotos() {
    if (busy || request.current) return;
    setPhotoError("");
    if (!navigator.onLine) { setPhotoError("Connect to the internet to fetch product photos."); return; }
    const controller = new AbortController();
    request.current = controller;
    setFetchingPhotos(true);
    try {
      const url = normalizeListingUrl(form.purchaseUrl);
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || "Product photos could not be fetched.");
      const incoming = [data.item?.imageUrl, ...(Array.isArray(data.images) ? data.images : [])].filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url)).slice(0, 24);
      if (!incoming.length) throw new Error("No product photos were found on this page.");
      setGallery((current) => [...new Set([...current, ...incoming])]);
    } catch (cause) { if (!controller.signal.aborted) setPhotoError(cause instanceof Error ? cause.message : "Product photos could not be fetched."); }
    finally { if (request.current === controller) { request.current = null; setFetchingPhotos(false); } }
  }

  async function checkPrice(rawUrl: string, isAlternative = false) {
    if (busy || request.current) return;
    setPriceError(""); setStatus("");
    let url: string;
    try { url = normalizeListingUrl(rawUrl); }
    catch { setPriceError("Enter a full listing URL, starting with https://."); return; }
    if (!navigator.onLine) { setPriceError("Connect to the internet to check a listing. Your saved prices are available offline."); return; }
    if (!form.sources.some((source) => source.url === url) && form.sources.length >= MAX_WISHLIST_SOURCES) { setPriceError(`A piece can have up to ${MAX_WISHLIST_SOURCES} listing links.`); return; }
    if (form.priceHistory.length >= MAX_PRICE_HISTORY) { setPriceError(`This piece has reached ${MAX_PRICE_HISTORY} price observations.`); return; }
    const controller = new AbortController();
    request.current = controller;
    setFetching(url);
    let quote: WishlistPriceQuote | null = null;
    let fetchError = "";
    try { quote = await fetchWishlistPrice(url, controller.signal); }
    catch (cause) {
      if (controller.signal.aborted) return;
      fetchError = cause instanceof Error && cause.name === "TimeoutError" ? "This listing took too long to respond." : cause instanceof Error ? cause.message : "This listing could not be checked.";
    }
    try {
      if (controller.signal.aborted) return;
      const updated = onPriceChange ? await onPriceChange(url, quote) : applyPriceFetch(form, url, quote);
      if (controller.signal.aborted) return;
      if (!updated) throw new Error("This wishlist piece was removed. Close the panel to continue.");
      setForm((current) => ({ ...current, ...trackingFields(updated) }));
      if (isAlternative) { setAlternative(""); setShowAlternative(false); }
      if (fetchError) setPriceError(fetchError);
      else setStatus("Price checked.");
    } catch (cause) {
      if (!controller.signal.aborted) setPriceError(cause instanceof Error ? cause.message : "The price check could not be saved. Try again.");
    } finally {
      if (request.current === controller) { request.current = null; setFetching(null); }
    }
  }

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setSaving(true); setError("");
    try {
      const purchaseUrl = normalizeListingUrl(form.purchaseUrl);
      if (!form.name.trim()) throw new Error("Enter a name for this piece.");
      if (form.price && wishlistPriceNumber(form.price) === null) throw new Error("Enter a valid price using digits and a decimal point.");
      if (form.currency && !/^[A-Z]{3}$/.test(form.currency)) throw new Error("Use a three-letter currency code.");
      if (form.price && !form.currency) throw new Error("Enter a currency for this price.");
      const cached = await cacheProductImages(form, form.backImageUrl || form.backImageData ? { imageUrl: form.backImageUrl ?? "", imageData: form.backImageData } : undefined, form.sideImageUrl || form.sideImageData ? { imageUrl: form.sideImageUrl ?? "", imageData: form.sideImageData } : undefined);
      let edited: WishlistItem = { ...form, ...cached, name: form.name.trim(), purchaseUrl, updatedAt: Date.now() };
      if (isNew) {
        // Confirmation can correct the visible quote without rewriting the
        // price actually observed by the initial fetch.
        const source = edited.sources.find((entry) => entry.url === purchaseUrl);
        if (source) edited = { ...edited, sources: edited.sources.map((entry) => entry === source ? { ...entry, price: form.price, currency: form.currency } : entry) };
        else edited = { ...edited, sources: [...edited.sources, { url: purchaseUrl, price: "", currency: "", fetched_at: null, link_broken: false }] };
        edited = recomputeWishlistPrice(edited);
      }
      await onSave(edited);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This piece could not be saved. Try again."); }
    finally { setSaving(false); }
  }

  return <><Sheet open onOpenChange={(open) => { if (!open) close(); }}><SheetContent data-busy={saving} onEscapeKeyDown={(event) => { if (saving || confirmClose) event.preventDefault(); }} onInteractOutside={(event) => { if (saving || confirmClose) event.preventDefault(); }}>
    <SheetTitle className="text-[14px] leading-5">{isNew ? "Add to wishlist" : "Wishlist details"}</SheetTitle>
    <SheetDescription className="sr-only">Review this piece, your rating, listing links and recorded prices.</SheetDescription>
    {gallery.length > 1 && <div className="mt-7 flex items-center justify-between gap-4"><div className="image-side-controls" role="group" aria-label="Image view">{(["front", "back", "side"] as const).map((side) => <button type="button" key={side} aria-pressed={imageSide === side} disabled={busy} onClick={() => setImageSide(side)}>{side === "front" ? "Front" : side === "back" ? "Back" : "Side"}</button>)}</div>{imageSide !== "front" && (selectedImage.imageUrl || selectedImage.imageData) && <button className="photo-tool" type="button" aria-label={`Remove ${imageSide} image`} disabled={busy} onClick={() => setForm((current) => imageSide === "back" ? { ...current, backImageUrl: undefined, backImageData: undefined } : { ...current, sideImageUrl: undefined, sideImageData: undefined })}><X size={13} /></button>}</div>}
    <div className="detail-image mt-6 flex aspect-[5/4] items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {selectedImage.imageUrl || selectedImage.imageData ? <img src={imageSource(selectedImage)} alt={`${form.name || "Product image"}, ${imageSide}`} className="h-full w-full object-contain" /> : <p className="text-[12px] text-subtle">Choose a {imageSide} image below. Optional.</p>}
    </div>
    {gallery.length > 1 && <div className="mt-4 flex gap-3 overflow-x-auto pb-2" aria-label="Product images">{gallery.map((imageUrl, index) => <button key={imageUrl} type="button" aria-label={`Use image ${index + 1} as ${imageSide}`} aria-pressed={selectedImage.imageUrl === imageUrl} disabled={busy || (imageSide !== "front" && imageUrl === form.imageUrl && !selectedImage.imageUrl)} className={`relative h-14 w-12 shrink-0 border-b ${selectedImage.imageUrl === imageUrl ? "border-foreground" : "border-transparent"}`} onClick={() => selectImage(imageUrl)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSource({ imageUrl, imageData: imageUrl === form.imageUrl ? form.imageData : imageUrl === form.backImageUrl ? form.backImageData : imageUrl === form.sideImageUrl ? form.sideImageData : undefined })} alt="" className="h-full w-full object-contain" loading="lazy" />
      {selectedImage.imageUrl === imageUrl && <Check size={10} className="absolute bottom-0 right-0 bg-background" />}
    </button>)}</div>}
    {!isNew && <div className="photo-toolbar" role="group" aria-label="Photo tools"><button type="button" className="photo-tool" aria-label="Fetch product photos" disabled={busy} onClick={() => void fetchPhotos()}>{fetchingPhotos ? <Loader2 size={16} className="animate-spin" /> : <Images size={16} strokeWidth={1.4} />}<span className="photo-tool-label" aria-hidden="true">Fetch product photos</span></button></div>}
    {photoError && <p className="mt-3 text-[12px]" role="alert">{photoError}</p>}

    <form onSubmit={save} className="mt-7"><fieldset disabled={busy} className="space-y-5">
      <label className="field-label">Name<Input value={form.name} onChange={(event) => set("name", event.target.value)} required maxLength={300} placeholder="Item name" /></label>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <label className="field-label">Brand<Input value={form.brand} onChange={(event) => set("brand", event.target.value)} maxLength={120} placeholder="—" /></label>
        <label className="field-label">Category<select className="field-input" value={form.category} onChange={(event) => set("category", event.target.value as WishlistItem["category"])}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
        <label className="field-label">Size<Input value={form.size} onChange={(event) => set("size", event.target.value)} maxLength={80} placeholder="—" /></label>
        <label className="field-label">Color<Input value={form.color} onChange={(event) => set("color", event.target.value)} maxLength={100} placeholder="—" /></label>
        {isNew && <><label className="field-label">Price<Input type="number" min="0" step="0.01" value={form.price} onChange={(event) => set("price", event.target.value)} placeholder="—" /></label><label className="field-label">Currency<Input value={form.currency} onChange={(event) => set("currency", event.target.value.toUpperCase())} maxLength={3} pattern="[A-Z]{3}" placeholder="USD" /></label></>}
      </div>
      <div><p className="field-label mb-2" id="wishlist-rating-label">Your rating</p><StarRating value={form.rating} onChange={(value) => set("rating", value)} disabled={busy} label="Your rating" /></div>
      <label className="field-label">Product link<Input type="url" value={form.purchaseUrl} onChange={(event) => set("purchaseUrl", event.target.value)} required maxLength={2048} /></label>
      <label className="field-label">Description<textarea className="field-input min-h-20 resize-y py-2" value={form.description} onChange={(event) => set("description", event.target.value)} maxLength={6000} placeholder="—" /></label>
    </fieldset>

    <section className="mt-9 border-t border-border pt-6" aria-label="Price tracking">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-[12px] text-muted-foreground">{form.currentSourceUrl ? "Current price" : "Last known price"}</h2><p className="mt-1 text-[17px]">{formatPrice(form.price, form.currency)}</p></div>{!isNew && <Button type="button" variant="ghost" disabled={busy} onClick={() => void checkPrice(form.purchaseUrl)} className="px-0 text-[12px]">{fetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} strokeWidth={1.5} />}Refetch price</Button>}</div>
      {!isNew && <div className="mt-6 space-y-4" aria-label="Listing sources">{form.sources.map((source, index) => <div key={source.url} className={`wishlist-source ${source.url === form.currentSourceUrl ? "is-current" : ""}`}>
        <div className="min-w-0"><a className="inline-flex max-w-full items-center gap-1.5 text-[12px]" href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}><span className="truncate">{new URL(source.url).hostname.replace(/^www\./, "")}</span><ArrowUpRight size={12} className="shrink-0" /></a><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle"><span>{formatPrice(source.price, source.currency)}</span>{source.link_broken && <span className="inline-flex items-center gap-1"><Link2Off size={11} />Link unavailable</span>}</div></div>
        <button type="button" className="photo-tool shrink-0" disabled={busy} onClick={() => void checkPrice(source.url)} aria-label={`Refetch listing ${index + 1}`} title="Refetch price">{fetching === source.url ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} strokeWidth={1.4} />}</button>
      </div>)}</div>}
      {!isNew && (showAlternative ? <div className="mt-5 flex items-center gap-3 border-b border-border"><Input type="url" aria-label="Alternative listing URL" placeholder="Paste another listing URL" value={alternative} disabled={busy} onChange={(event) => setAlternative(event.target.value)} maxLength={2048} className="border-0" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void checkPrice(alternative, true); } }} /><button type="button" className="photo-tool shrink-0" disabled={busy || !alternative.trim()} onClick={() => void checkPrice(alternative, true)} aria-label="Fetch alternative link"><ArrowRight size={15} /></button></div> : <button type="button" className="mt-5 inline-flex items-center gap-2 py-1 text-[12px] text-muted-foreground hover:text-foreground" disabled={busy || form.sources.length >= MAX_WISHLIST_SOURCES} onClick={() => setShowAlternative(true)}><Plus size={13} strokeWidth={1.5} />Add alternative link</button>)}
      {priceError && <p className="mt-4 text-[12px] leading-relaxed" role="alert">{priceError}</p>}
      {status && <p className="mt-4 text-[11px] text-subtle" role="status">{status}</p>}
      <h2 className="mb-4 mt-8 text-[12px] text-muted-foreground">Price history</h2>
      <PriceHistoryChart entries={form.priceHistory} currency={form.currency} />
    </section>
    {error && <p role="alert" className="mt-5 text-[12px] leading-relaxed">{error}</p>}
    <div className="mt-8 flex items-center justify-between gap-4"><Button type="submit" disabled={busy} className="min-w-40">{saving ? <><Loader2 size={14} className="animate-spin" />Saving</> : isNew ? "Save to wishlist" : "Save changes"}</Button>{!isNew && onDelete && <Button type="button" variant="ghost" className="text-[12px] text-muted-foreground" disabled={busy} onClick={async () => { setSaving(true); try { await onDelete(); onClose(); } catch { setError("This piece could not be removed. Try again."); setSaving(false); } }}>Remove piece</Button>}</div>
    {!isNew && onMove && <button type="button" className="mt-6 inline-flex items-center gap-3 py-2 text-[12px] text-muted-foreground hover:text-foreground" disabled={busy} onClick={async () => {
      setSaving(true); setError("");
      try {
        if (!form.name.trim()) throw new Error("Enter a name for this piece.");
        const purchaseUrl = normalizeListingUrl(form.purchaseUrl);
        const cached = await cacheProductImages(form, form.backImageUrl || form.backImageData ? { imageUrl: form.backImageUrl ?? "", imageData: form.backImageData } : undefined, form.sideImageUrl || form.sideImageData ? { imageUrl: form.sideImageUrl ?? "", imageData: form.sideImageData } : undefined);
        await onMove({ ...form, ...cached, purchaseUrl });
        onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "This piece could not be moved. Try again."); setSaving(false); }
    }}>Move to wardrobe<ArrowRight size={13} /></button>}
    </form>
  </SheetContent></Sheet><UnsavedChangesDialog open={confirmClose} onOpenChange={setConfirmClose} onDiscard={discard} canSave={!busy && !alternative.trim()} isNew={isNew} onSave={() => { setConfirmClose(false); void save(); }} /></>;
}
