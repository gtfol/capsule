"use client";
import { useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { SharePopover } from "@/components/share-popover";
import { useWardrobe } from "@/lib/store";
import { PiecePhotos, usePiecePhotos } from "./piece-photos";
import type { Category, Item } from "@/lib/types";
export const CATEGORIES: { value: Category; label: string }[] = [{ value: "tops", label: "Tops" }, { value: "jackets", label: "Jackets" }, { value: "bottoms", label: "Bottoms" }, { value: "accessories", label: "Accessories" }, { value: "shoes", label: "Shoes" }];
export type ItemDraft = Omit<Item, "id" | "createdAt" | "updatedAt">;
type Props = { item: ItemDraft | Item; images?: string[]; uploadedImages?: string[]; isNew?: boolean; active?: boolean; onClose: () => void; onSave: (item: Item) => Promise<void>; onDelete?: (item: Item) => Promise<void> };

export function ItemDetail({ item, images = [], uploadedImages = [], isNew = false, active = true, onClose, onSave, onDelete }: Props) {
  const savedItem = useWardrobe((state) => "id" in item ? state.items.find((piece) => piece.id === item.id) : undefined);
  const [initialForm] = useState(item);
  const [form, setForm] = useState<ItemDraft | Item>(initialForm);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState("");
  const photoEditor = usePiecePhotos({ item, images, uploadedImages, purchaseUrl: form.purchaseUrl, disabled: saving });
  const busy = photoEditor.locked;
  const formChanged = (Object.keys(form) as Array<keyof ItemDraft>).some((key) => form[key] !== initialForm[key]);
  const dirty = isNew || formChanged || photoEditor.dirty;
  const update = (key: keyof ItemDraft, value: string) => setForm((current) => ({ ...current, [key]: value }));
  function discard() { photoEditor.cancel(); setConfirmClose(false); onClose(); }
  function close() {
    if (saving) return;
    if (dirty || photoEditor.working) setConfirmClose(true);
    else onClose();
  }
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setSaving(true); setError("");
    try {
      const purchaseUrl = form.purchaseUrl.trim();
      if (purchaseUrl && !["https:", "http:"].includes(new URL(purchaseUrl).protocol)) throw new Error("Enter a valid purchase link.");
      if (!form.name.trim()) throw new Error("Enter a name for this piece.");
      if (form.price && (!Number.isFinite(Number(form.price)) || Number(form.price) < 0)) throw new Error("Enter a valid price.");
      if (form.currency && !/^[A-Z]{3}$/.test(form.currency)) throw new Error("Use a three-letter currency code.");
      const photos = await photoEditor.save();
      const now = Date.now();
      await onSave({ ...form, name: form.name.trim(), purchaseUrl, ...photos, id: "id" in item ? item.id : crypto.randomUUID(), createdAt: "createdAt" in item ? item.createdAt : now, updatedAt: now, deletedAt: null } as Item);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This piece could not be saved. Try again."); }
    finally { setSaving(false); }
  }
  return <><Sheet open={active} onOpenChange={(open) => { if (!open) close(); }}><SheetContent data-busy={saving} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }}>
    <div className="flex items-center justify-between gap-4 pr-9"><SheetTitle className="text-[14px] leading-5">{isNew ? "Add to wardrobe" : "Piece details"}</SheetTitle>{!isNew && savedItem && <SharePopover target={{ kind: "piece", piece: savedItem }} active={active} disabled={dirty || busy} disabledReason="Save changes before sharing." />}</div>
    <SheetDescription className="sr-only">Review the product image and edit this piece’s details.</SheetDescription>
    <PiecePhotos editor={photoEditor} name={form.name} />
    <form onSubmit={save} className="mt-7"><fieldset disabled={busy} className="space-y-5">
      <label className="field-label">Name<Input value={form.name} onChange={(event) => update("name", event.target.value)} required maxLength={300} placeholder="Item name" /></label>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <label className="field-label">Brand<Input value={form.brand} onChange={(event) => update("brand", event.target.value)} maxLength={120} placeholder="—" /></label>
        <label className="field-label">Category<select className="field-input" value={form.category} onChange={(event) => update("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
        <label className="field-label">Size<Input value={form.size} onChange={(event) => update("size", event.target.value)} maxLength={80} placeholder="—" /></label>
        <label className="field-label">Color<Input value={form.color} onChange={(event) => update("color", event.target.value)} maxLength={100} placeholder="—" /></label>
        <label className="field-label">Price<Input type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={(event) => update("price", event.target.value)} placeholder="—" /></label>
        <label className="field-label">Currency<Input value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} placeholder="USD" minLength={3} maxLength={3} pattern="[A-Z]{3}" /></label>
      </div>
      <label className="field-label">Purchase link <span className="text-subtle">(optional)</span><div className="flex items-center gap-3"><Input type="url" value={form.purchaseUrl} onChange={(event) => update("purchaseUrl", event.target.value)} maxLength={2048} />{/^https?:\/\//.test(form.purchaseUrl) && <a href={form.purchaseUrl} target="_blank" rel="noopener noreferrer" aria-label="Open purchase link" className="pt-2 text-muted-foreground"><ArrowUpRight size={16} /></a>}</div></label>
      <label className="field-label">Description<textarea className="field-input min-h-20 resize-y py-2" value={form.description} onChange={(event) => update("description", event.target.value)} maxLength={6000} placeholder="—" /></label>
      {error && <p role="alert" className="text-[12px] leading-relaxed">{error}</p>}
      <div className="flex items-center justify-between gap-5 pt-2"><Button type="submit" disabled={busy} className="min-w-40">{saving ? <><Loader2 size={14} className="animate-spin" />Saving</> : isNew ? "Save piece" : "Save changes"}</Button>{!isNew && onDelete && "id" in item && <Button type="button" variant="ghost" className="text-[12px] text-muted-foreground" disabled={busy} onClick={async () => { setSaving(true); try { await onDelete(item as Item); onClose(); } catch { setError("This piece could not be removed. Try again."); setSaving(false); } }}>Remove piece</Button>}</div>
    </fieldset></form>
  </SheetContent></Sheet><UnsavedChangesDialog open={active && confirmClose} onOpenChange={setConfirmClose} onDiscard={discard} onSave={() => { setConfirmClose(false); void save(); }} canSave={!busy} isNew={isNew} /></>;
}
