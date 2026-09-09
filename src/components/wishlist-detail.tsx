"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Link2Off, Loader2, Plus, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { CATEGORIES } from "./item-detail";
import { StarRating } from "./star-rating";
import { PriceHistoryChart } from "./price-history-chart";
import { PiecePhotos, usePiecePhotos } from "./piece-photos";
import { applyPriceFetch, formatPrice, MAX_PRICE_HISTORY, MAX_WISHLIST_SOURCES, normalizeListingUrl, recomputeWishlistPrice, wishlistPriceNumber } from "@/lib/wishlist";
import { fetchWishlistPrice } from "@/lib/wishlist-client";
import type { WishlistItem } from "@/lib/types";
import type { WishlistPriceQuote } from "@/lib/wishlist-editor";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog";
import { SharePopover } from "./share-popover";
import { useWardrobe } from "@/lib/store";

type Props = {
  item: WishlistItem;
  images?: string[];
  uploadedImages?: string[];
  isNew?: boolean;
  active?: boolean;
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

export function WishlistDetail({ item, images = [], uploadedImages = [], isNew = false, active = true, onClose, onSave, onDelete, onMove, onPriceChange }: Props) {
  const savedItem = useWardrobe((state) => state.wishlist.find((piece) => piece.id === item.id));
  const [form, setForm] = useState(item);
  const [error, setError] = useState("");
  const [priceError, setPriceError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const [alternative, setAlternative] = useState("");
  const [showAlternative, setShowAlternative] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const photoEditor = usePiecePhotos({ item, images, uploadedImages, purchaseUrl: form.purchaseUrl, disabled: saving || !!fetching });
  const busy = photoEditor.locked;
  const dirty = isNew || hasEdits(form, item) || photoEditor.dirty;
  const set = <K extends keyof WishlistItem>(key: K, value: WishlistItem[K]) => setForm((current) => ({ ...current, [key]: value }));
  const discard = () => { request.current?.abort(); photoEditor.cancel(); onClose(); };
  const close = () => { if (saving) return; if (dirty || busy || alternative.trim()) setConfirmClose(true); else discard(); };

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
      const purchaseUrl = form.purchaseUrl.trim() ? normalizeListingUrl(form.purchaseUrl) : "";
      if (!form.name.trim()) throw new Error("Enter a name for this piece.");
      if (form.price && wishlistPriceNumber(form.price) === null) throw new Error("Enter a valid price using digits and a decimal point.");
      if (form.currency && !/^[A-Z]{3}$/.test(form.currency)) throw new Error("Use a three-letter currency code.");
      const cached = await photoEditor.save();
      let edited: WishlistItem = { ...form, ...cached, name: form.name.trim(), purchaseUrl, updatedAt: Date.now() };
      if (isNew) {
        // Confirmation can correct the visible quote without rewriting the
        // price actually observed by the initial fetch.
        const source = edited.sources.find((entry) => entry.url === purchaseUrl);
        if (source) edited = { ...edited, sources: edited.sources.map((entry) => entry === source ? { ...entry, price: form.price, currency: form.currency } : entry) };
        else if (purchaseUrl) edited = { ...edited, sources: [...edited.sources, { url: purchaseUrl, price: "", currency: "", fetched_at: null, link_broken: false }] };
        edited = recomputeWishlistPrice(edited);
      }
      await onSave(edited);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This piece could not be saved. Try again."); }
    finally { setSaving(false); }
  }

  return <><Sheet open={active} onOpenChange={(open) => { if (!open) close(); }}><SheetContent data-busy={saving} onEscapeKeyDown={(event) => { if (saving || confirmClose) event.preventDefault(); }} onInteractOutside={(event) => { if (saving || confirmClose) event.preventDefault(); }}>
    <div className="flex items-center justify-between gap-4 pr-9"><SheetTitle className="text-[14px] leading-5">{isNew ? "Add to wishlist" : "Wishlist details"}</SheetTitle>{!isNew && savedItem && <SharePopover target={{ kind: "piece", piece: savedItem }} active={active} disabled={dirty || busy || !!alternative.trim()} disabledReason="Save changes before sharing." />}</div>
    <SheetDescription className="sr-only">Review this piece, your rating, listing links and recorded prices.</SheetDescription>
    <PiecePhotos editor={photoEditor} name={form.name} />

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
      <label className="field-label">Product link (optional)<Input type="url" value={form.purchaseUrl} onChange={(event) => set("purchaseUrl", event.target.value)} maxLength={8000} /></label>
      <label className="field-label">Description<textarea className="field-input min-h-20 resize-y py-2" value={form.description} onChange={(event) => set("description", event.target.value)} maxLength={6000} placeholder="—" /></label>
    </fieldset>

    <section className="mt-9 border-t border-border pt-6" aria-label="Price tracking">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-[12px] text-muted-foreground">{form.currentSourceUrl ? "Current price" : "Last known price"}</h2><p className="mt-1 text-[17px]">{formatPrice(form.price, form.currency)}</p></div>{!isNew && <Button type="button" variant="ghost" disabled={busy || !form.purchaseUrl.trim()} onClick={() => void checkPrice(form.purchaseUrl)} className="px-0 text-[12px]">{fetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} strokeWidth={1.5} />}Refetch price</Button>}</div>
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
        const purchaseUrl = form.purchaseUrl.trim() ? normalizeListingUrl(form.purchaseUrl) : "";
        const cached = await photoEditor.save();
        await onMove({ ...form, ...cached, purchaseUrl });
        onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "This piece could not be moved. Try again."); setSaving(false); }
    }}>Move to wardrobe<ArrowRight size={13} /></button>}
    </form>
  </SheetContent></Sheet><UnsavedChangesDialog open={active && confirmClose} onOpenChange={setConfirmClose} onDiscard={discard} canSave={!busy && !alternative.trim()} isNew={isNew} onSave={() => { setConfirmClose(false); void save(); }} /></>;
}
