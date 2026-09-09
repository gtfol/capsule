"use client";
import { useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cacheProductImage, imageSource } from "@/lib/images";
import type { Category, Item } from "@/lib/types";
export const CATEGORIES: { value: Category; label: string }[] = [{ value: "tops", label: "Tops" }, { value: "jackets", label: "Jackets" }, { value: "bottoms", label: "Bottoms" }, { value: "accessories", label: "Accessories" }, { value: "shoes", label: "Shoes" }];
export type ItemDraft = Omit<Item, "id" | "createdAt" | "updatedAt">;
type Props = { item: ItemDraft | Item; images?: string[]; isNew?: boolean; onClose: () => void; onSave: (item: Item) => Promise<void>; onDelete?: (item: Item) => Promise<void> };
export function ItemDetail({ item, images = [], isNew = false, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<ItemDraft | Item>(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof ItemDraft, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const candidates = [...new Set([item.imageUrl, ...images])].filter(Boolean).slice(0, 24);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const purchase = new URL(form.purchaseUrl);
      if (!["https:", "http:"].includes(purchase.protocol)) throw new Error("Enter a valid purchase link.");
      if (!form.name.trim()) throw new Error("Enter a name for this piece.");
      if (form.price && (!Number.isFinite(Number(form.price)) || Number(form.price) < 0)) throw new Error("Enter a valid price.");
      const imageData = form.imageData && form.imageUrl === item.imageUrl ? form.imageData : await cacheProductImage(form.imageUrl);
      const now = Date.now();
      await onSave({ ...form, name: form.name.trim(), imageData, id: "id" in item ? item.id : crypto.randomUUID(), createdAt: "createdAt" in item ? item.createdAt : now, updatedAt: now, deletedAt: null } as Item);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This piece could not be saved. Try again."); }
    finally { setBusy(false); }
  }
  return <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><SheetContent onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
    <SheetTitle className="text-[14px] leading-5">{isNew ? "Add to wardrobe" : "Piece details"}</SheetTitle>
    <SheetDescription className="sr-only">Review the product image and edit this piece’s details.</SheetDescription>
    <div className="detail-image mt-8 flex aspect-[5/4] items-center justify-center bg-white">
      {/* Product images are stored in IndexedDB as data URLs for offline use. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={form.imageUrl === item.imageUrl && item.imageData ? item.imageData : imageSource({ imageUrl: form.imageUrl })} alt={form.name || "Product image"} className="h-full w-full object-contain" />
    </div>
    {candidates.length > 1 && <div className="mt-4 flex gap-3 overflow-x-auto pb-2" aria-label="Product images">{candidates.map((url, i) => <button type="button" key={url} aria-label={`Use image ${i + 1}`} aria-pressed={form.imageUrl === url} className={`relative h-14 w-12 shrink-0 border-b ${form.imageUrl === url ? "border-black" : "border-transparent"}`} onClick={() => update("imageUrl", url)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSource({ imageUrl: url })} alt="" className="h-full w-full object-contain" loading="lazy" />
      {form.imageUrl === url && <Check size={10} className="absolute bottom-0 right-0 bg-white" />}
    </button>)}</div>}
    <form onSubmit={save} className="mt-7 space-y-5">
      <label className="field-label">Name<Input value={form.name} onChange={(event) => update("name", event.target.value)} required maxLength={300} placeholder="Item name" /></label>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <label className="field-label">Brand<Input value={form.brand} onChange={(event) => update("brand", event.target.value)} maxLength={120} placeholder="—" /></label>
        <label className="field-label">Category<select className="field-input" value={form.category} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
        <label className="field-label">Size<Input value={form.size} onChange={(event) => update("size", event.target.value)} maxLength={80} placeholder="—" /></label>
        <label className="field-label">Color<Input value={form.color} onChange={(event) => update("color", event.target.value)} maxLength={100} placeholder="—" /></label>
        <label className="field-label">Price<Input type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={(event) => update("price", event.target.value)} placeholder="—" /></label>
        <label className="field-label">Currency<Input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} placeholder="USD" minLength={3} maxLength={3} pattern="[A-Z]{3}" /></label>
      </div>
      <label className="field-label">Purchase link<div className="flex items-center gap-3"><Input type="url" value={form.purchaseUrl} onChange={(event) => update("purchaseUrl", event.target.value)} required maxLength={2048} /><a href={/^https?:\/\//.test(form.purchaseUrl) ? form.purchaseUrl : undefined} target="_blank" rel="noopener noreferrer" aria-label="Open purchase link" className="pt-2 text-neutral-500"><ArrowUpRight size={16} /></a></div></label>
      <label className="field-label">Description<textarea className="field-input min-h-20 resize-y py-2" value={form.description} onChange={(event) => update("description", event.target.value)} maxLength={6000} placeholder="—" /></label>
      {error && <p role="alert" className="text-[12px] leading-relaxed">{error}</p>}
      <div className="flex items-center justify-between gap-5 pt-2"><Button type="submit" disabled={busy} className="min-w-40">{busy ? <><Loader2 size={14} className="animate-spin" />Saving</> : isNew ? "Save piece" : "Save changes"}</Button>{!isNew && onDelete && "id" in item && <Button type="button" variant="ghost" className="text-[12px] text-neutral-500" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(item as Item); onClose(); } catch { setError("This piece could not be removed. Try again."); setBusy(false); } }}>Remove piece</Button>}</div>
    </form>
  </SheetContent></Sheet>;
}
