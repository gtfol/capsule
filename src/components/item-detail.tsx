"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ImagePlus, Images, Loader2, ScanLine, Undo2 } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { cacheProductImages, imageSource, prepareUploadedImage } from "@/lib/images";
import { removeBackground } from "@/lib/background-removal";
import { assignPhotoSlot, type PhotoSide, type PhotoSlots } from "@/lib/photo-slots";
import type { Category, Item } from "@/lib/types";
export const CATEGORIES: { value: Category; label: string }[] = [{ value: "tops", label: "Tops" }, { value: "jackets", label: "Jackets" }, { value: "bottoms", label: "Bottoms" }, { value: "accessories", label: "Accessories" }, { value: "shoes", label: "Shoes" }];
export type ItemDraft = Omit<Item, "id" | "createdAt" | "updatedAt">;
type Props = { item: ItemDraft | Item; images?: string[]; uploadedImages?: string[]; isNew?: boolean; onClose: () => void; onSave: (item: Item) => Promise<void>; onDelete?: (item: Item) => Promise<void> };
type PhotoChoice = { id: string; imageUrl: string; imageData?: string; cutout?: string; useCutout?: boolean };
type PhotoState = PhotoSlots & { choices: PhotoChoice[] };
type BackgroundProgress = { stage: "download" | "processing"; progress?: number };
function initialPhotos(item: ItemDraft | Item, images: string[], uploadedImages: string[]): PhotoState {
  if (uploadedImages.length) {
    const choices = [...new Set(uploadedImages)].map((imageData, index) => ({ id: `upload-${index}`, imageUrl: "", imageData }));
    return { choices, frontId: choices[0].id, backId: choices[1]?.id ?? null, sideId: choices[2]?.id ?? null };
  }
  const choices: PhotoChoice[] = [];
  if (item.imageData || item.imageUrl) choices.push({ id: "front", imageUrl: item.imageUrl, imageData: item.imageData });
  const back = { id: "back", imageUrl: item.backImageUrl ?? "", imageData: item.backImageData };
  const hasBack = !!(back.imageData || back.imageUrl) && (!choices[0] || imageSource(back) !== imageSource(choices[0]));
  if (hasBack) choices.push(back);
  const side = { id: "side", imageUrl: item.sideImageUrl ?? "", imageData: item.sideImageData };
  const hasSide = !!(side.imageData || side.imageUrl) && !choices.some((choice) => imageSource(choice) === imageSource(side));
  if (hasSide) choices.push(side);
  for (const imageUrl of images) {
    if (imageUrl && !choices.some((choice) => choice.imageUrl === imageUrl)) choices.push({ id: `gallery-${choices.length}`, imageUrl });
  }
  return { choices: choices.slice(0, 24), frontId: choices[0]?.id ?? "", backId: hasBack ? "back" : null, sideId: hasSide ? "side" : null };
}
const chosenImage = (choice: PhotoChoice) => ({ imageUrl: choice.imageUrl, imageData: choice.useCutout ? choice.cutout : choice.imageData });

export function ItemDetail({ item, images = [], uploadedImages = [], isNew = false, onClose, onSave, onDelete }: Props) {
  const [initialState] = useState(() => ({ form: item, photos: initialPhotos(item, images, uploadedImages) }));
  const [form, setForm] = useState<ItemDraft | Item>(initialState.form);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState("");
  const [imageSide, setImageSide] = useState<PhotoSide>("front");
  const [photos, setPhotos] = useState(initialState.photos);
  const [backgroundProgress, setBackgroundProgress] = useState<BackgroundProgress | null>(null);
  const [backgroundError, setBackgroundError] = useState("");
  const [review, setReview] = useState<{ choiceId: string; result: string; preview: "original" | "cutout" } | null>(null);
  const [photoWork, setPhotoWork] = useState<"fetching" | "uploading" | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoStatus, setPhotoStatus] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const photoRequest = useRef<AbortController | null>(null);
  const photoSequence = useRef(0);
  const backgroundRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { backgroundRequest.current?.abort(); backgroundRequest.current = null; photoRequest.current?.abort(); photoRequest.current = null; photoSequence.current++; }, []);
  const busy = saving || !!backgroundProgress || !!photoWork;
  const imageControlsLocked = busy || !!review;
  const formChanged = (Object.keys(form) as Array<keyof ItemDraft>).some((key) => form[key] !== initialState.form[key]);
  const photosChanged = photos.frontId !== initialState.photos.frontId || photos.backId !== initialState.photos.backId || photos.sideId !== initialState.photos.sideId
    || photos.choices.length !== initialState.photos.choices.length
    || photos.choices.some((choice, index) => (Object.keys(choice) as Array<keyof PhotoChoice>).some((key) => choice[key] !== initialState.photos.choices[index]?.[key]));
  const dirty = isNew || formChanged || photosChanged || !!review;
  const update = (key: keyof ItemDraft, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const selectedId = photos[`${imageSide}Id`];
  const selectedPhoto = photos.choices.find((choice) => choice.id === selectedId);
  const previewSource = selectedPhoto ? review ? review.preview === "cutout" ? review.result : imageSource(selectedPhoto) : imageSource(chosenImage(selectedPhoto)) : undefined;
  let validPurchaseUrl = "";
  try { const url = new URL(form.purchaseUrl.trim()); if (["https:", "http:"].includes(url.protocol)) validPurchaseUrl = url.href; } catch { /* The optional field may be empty or incomplete while editing. */ }
  function selectImage(id: string) {
    if (imageControlsLocked) return;
    setBackgroundError("");
    setPhotos((current) => assignPhotoSlot(current, imageSide, id));
  }
  function cancelBackground() {
    backgroundRequest.current?.abort();
    backgroundRequest.current = null;
    setBackgroundProgress(null);
  }
  function cancelPhotoWork() {
    photoSequence.current++;
    photoRequest.current?.abort();
    photoRequest.current = null;
    setPhotoWork(null);
  }
  function discard() { cancelBackground(); cancelPhotoWork(); setConfirmClose(false); onClose(); }
  function close() {
    if (saving) return;
    if (dirty || backgroundProgress || photoWork) setConfirmClose(true);
    else onClose();
  }
  async function fetchProductPhotos() {
    if (imageControlsLocked || !validPurchaseUrl) return;
    setPhotoError(""); setPhotoStatus("");
    if (!navigator.onLine) { setPhotoError("Connect to the internet to fetch product photos. Your saved photos are available offline."); return; }
    const controller = new AbortController();
    const token = ++photoSequence.current;
    photoRequest.current = controller;
    setPhotoWork("fetching");
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: validPurchaseUrl }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      const data = await response.json();
      if (controller.signal.aborted || token !== photoSequence.current) return;
      if (!response.ok) throw new Error(data.error || "Product photos could not be fetched. Try another purchase link.");
      const urls = [...new Set([data.item?.imageUrl, ...(Array.isArray(data.images) ? data.images : [])])].filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url));
      if (!urls.length) throw new Error("No product photos were found. Try another purchase link.");
      const incoming = urls.map((imageUrl) => ({ id: crypto.randomUUID(), imageUrl }));
      setPhotos((current) => ({ ...current, choices: [...current.choices, ...incoming.filter((choice) => !current.choices.some((existing) => existing.imageUrl === choice.imageUrl))] }));
      setPhotoStatus("Product photos loaded.");
    } catch (cause) {
      if (!controller.signal.aborted && token === photoSequence.current) setPhotoError(cause instanceof Error && cause.name === "TimeoutError" ? "This page took too long to respond. Try again." : cause instanceof Error ? cause.message : "Product photos could not be fetched. Try again.");
    } finally {
      if (token === photoSequence.current) { photoRequest.current = null; setPhotoWork(null); }
    }
  }
  async function addPhotos(files: File[]) {
    if (imageControlsLocked || !files.length) return;
    setPhotoError(""); setPhotoStatus("");
    if (files.length > 3) { setPhotoError("Choose up to three photos at a time."); return; }
    const token = ++photoSequence.current;
    setPhotoWork("uploading");
    try {
      const data = await Promise.all(files.map(prepareUploadedImage));
      if (token !== photoSequence.current) return;
      const incoming = [...new Set(data)].map((imageData) => ({ id: crypto.randomUUID(), imageUrl: "", imageData }));
      setPhotos((current) => ({ ...current, choices: [...current.choices, ...incoming.filter((choice) => !current.choices.some((existing) => existing.imageData === choice.imageData))] }));
      setPhotoStatus("Photos added. Choose a front, back, or side image.");
    } catch (cause) {
      if (token === photoSequence.current) setPhotoError(cause instanceof Error ? cause.message : "These photos could not be opened. Try another image.");
    } finally { if (token === photoSequence.current) setPhotoWork(null); }
  }
  async function createCutout() {
    if (!selectedPhoto || imageControlsLocked) return;
    const controller = new AbortController();
    backgroundRequest.current = controller;
    setBackgroundError("");
    setBackgroundProgress({ stage: "download" });
    try {
      const result = await removeBackground(imageSource(selectedPhoto), (progress) => {
        if (backgroundRequest.current === controller && !controller.signal.aborted) setBackgroundProgress(progress);
      }, controller.signal);
      if (backgroundRequest.current === controller && !controller.signal.aborted) setReview({ choiceId: selectedPhoto.id, result, preview: "cutout" });
    } catch (cause) {
      if (backgroundRequest.current === controller && !controller.signal.aborted) setBackgroundError(cause instanceof Error ? cause.message : "The background could not be removed. Your original photo is unchanged.");
    } finally {
      if (backgroundRequest.current === controller) { backgroundRequest.current = null; setBackgroundProgress(null); }
    }
  }
  function finishReview(useCutout: boolean) {
    if (!review) return;
    setPhotos((current) => ({ ...current, choices: current.choices.map((choice) => choice.id === review.choiceId ? { ...choice, cutout: review.result, useCutout } : choice) }));
    setReview(null);
  }
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || review) return;
    setSaving(true); setError("");
    try {
      const purchaseUrl = form.purchaseUrl.trim();
      if (purchaseUrl && !["https:", "http:"].includes(new URL(purchaseUrl).protocol)) throw new Error("Enter a valid purchase link.");
      if (!form.name.trim()) throw new Error("Enter a name for this piece.");
      if (form.price && (!Number.isFinite(Number(form.price)) || Number(form.price) < 0)) throw new Error("Enter a valid price.");
      if (form.currency && !/^[A-Z]{3}$/.test(form.currency)) throw new Error("Use a three-letter currency code.");
      const front = photos.choices.find((choice) => choice.id === photos.frontId);
      const back = photos.backId !== photos.frontId ? photos.choices.find((choice) => choice.id === photos.backId) : undefined;
      const side = photos.sideId !== photos.frontId && photos.sideId !== photos.backId ? photos.choices.find((choice) => choice.id === photos.sideId) : undefined;
      if (!front) throw new Error("Choose a front photo for this piece.");
      const { imageData, backImageData, sideImageData } = await cacheProductImages(chosenImage(front), back ? chosenImage(back) : undefined, side ? chosenImage(side) : undefined);
      const now = Date.now();
      await onSave({ ...form, name: form.name.trim(), purchaseUrl, imageUrl: front.imageUrl, imageData, backImageUrl: back?.imageUrl, backImageData, sideImageUrl: side?.imageUrl, sideImageData, id: "id" in item ? item.id : crypto.randomUUID(), createdAt: "createdAt" in item ? item.createdAt : now, updatedAt: now, deletedAt: null } as Item);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This piece could not be saved. Try again."); }
    finally { setSaving(false); }
  }
  return <><Sheet open onOpenChange={(open) => { if (!open) close(); }}><SheetContent data-busy={saving} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }}>
    <SheetTitle className="text-[14px] leading-5">{isNew ? "Add to wardrobe" : "Piece details"}</SheetTitle>
    <SheetDescription className="sr-only">Review the product image and edit this piece’s details.</SheetDescription>
    {photos.choices.length > 1 && <div className="mt-7 flex items-center justify-between gap-4">
      <div className="image-side-controls" role="group" aria-label="Image side">
        <button type="button" aria-pressed={imageSide === "front"} disabled={imageControlsLocked} onClick={() => { setImageSide("front"); setBackgroundError(""); }}>Front</button>
        <button type="button" aria-pressed={imageSide === "back"} disabled={imageControlsLocked} onClick={() => { setImageSide("back"); setBackgroundError(""); }}>Back</button>
        <button type="button" aria-pressed={imageSide === "side"} disabled={imageControlsLocked} onClick={() => { setImageSide("side"); setBackgroundError(""); }}>Side</button>
      </div>
      {imageSide !== "front" && selectedId && <button type="button" disabled={imageControlsLocked} className="text-[11px] text-muted-foreground underline underline-offset-4" onClick={() => { setPhotos((current) => ({ ...current, [`${imageSide}Id`]: null })); setImageSide("front"); setBackgroundError(""); }}>Remove {imageSide}</button>}
    </div>}
    <div className="detail-image mt-6 flex aspect-[5/4] items-center justify-center bg-background" data-cutout={review ? review.preview === "cutout" : !!selectedPhoto?.useCutout}>
      {/* Product images are stored in IndexedDB as data URLs for offline use. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {previewSource ? <img src={previewSource} alt={`${form.name || "Product image"}, ${imageSide}`} className="h-full w-full object-contain" /> : <p className="text-[12px] text-subtle">Choose a {imageSide} image below. Optional.</p>}
    </div>
    {photos.choices.length > 1 && <div className="mt-4 flex gap-3 overflow-x-auto pb-2" aria-label="Product images">{photos.choices.map((choice, i) => <button type="button" key={choice.id} aria-label={`Use image ${i + 1} as ${imageSide}`} aria-pressed={selectedId === choice.id} disabled={imageControlsLocked || (imageSide !== "front" && choice.id === photos.frontId && !selectedId)} className={`relative h-14 w-12 shrink-0 border-b disabled:opacity-40 ${selectedId === choice.id ? "border-foreground" : "border-transparent"}`} onClick={() => selectImage(choice.id)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSource(chosenImage(choice))} alt="" className="h-full w-full object-contain" loading="lazy" />
      {selectedId === choice.id && <Check size={10} className="absolute bottom-0 right-0 bg-background" />}
    </button>)}</div>}
    <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden aria-label="Add piece photos" disabled={imageControlsLocked} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addPhotos(files); }} />
    {!photoWork && !backgroundProgress && !review && <div className="photo-toolbar" role="group" aria-label="Photo tools">
      <button type="button" className="photo-tool" aria-label="Add photos" disabled={imageControlsLocked} onClick={() => photoInput.current?.click()}><ImagePlus size={16} strokeWidth={1.4} aria-hidden="true" /><span className="photo-tool-label" aria-hidden="true">Add photos</span></button>
      {validPurchaseUrl && <button type="button" className="photo-tool" aria-label="Fetch product photos" disabled={imageControlsLocked} onClick={() => void fetchProductPhotos()}><Images size={16} strokeWidth={1.4} aria-hidden="true" /><span className="photo-tool-label" aria-hidden="true">Fetch product photos</span></button>}
      {selectedPhoto && <button type="button" className="photo-tool" aria-label={selectedPhoto.cutout ? selectedPhoto.useCutout ? "Revert to original" : "Use cutout" : "Remove background"} disabled={busy} onClick={() => { if (selectedPhoto.cutout) setPhotos((current) => ({ ...current, choices: current.choices.map((choice) => choice.id === selectedPhoto.id ? { ...choice, useCutout: !choice.useCutout } : choice) })); else void createCutout(); }}>{selectedPhoto.useCutout ? <Undo2 size={16} strokeWidth={1.4} aria-hidden="true" /> : <ScanLine size={16} strokeWidth={1.4} aria-hidden="true" />}<span className="photo-tool-label" aria-hidden="true">{selectedPhoto.cutout ? selectedPhoto.useCutout ? "Revert to original" : "Use cutout" : "Remove background"}</span></button>}
    </div>}
    {photoWork && <div className="background-tools" aria-live="polite"><span className="flex items-center gap-2 text-[12px]"><Loader2 size={13} className="animate-spin" />{photoWork === "fetching" ? "Fetching product photos…" : "Opening photos…"}</span><button type="button" className="text-[12px] text-muted-foreground" onClick={cancelPhotoWork}>Cancel</button></div>}
    {photoError && <p className="mt-3 text-[12px] leading-relaxed" role="alert">{photoError}</p>}
    {photoStatus && !photoWork && <p className="mt-3 text-[11px] text-subtle" role="status">{photoStatus}</p>}
    {backgroundProgress ? <div className="background-tools" aria-live="polite"><div className="flex items-center gap-2 text-[12px]"><Loader2 size={13} className="animate-spin" /><span>{backgroundProgress.stage === "download" ? "Preparing background removal…" : "Removing background…"}{backgroundProgress.progress === undefined ? "" : ` ${Math.round(Math.max(0, Math.min(100, backgroundProgress.progress)))}%`}</span></div><button type="button" className="text-[12px] underline underline-offset-4" onClick={cancelBackground}>Cancel</button></div> : review ? <div className="background-review">
      <div className="image-side-controls" role="group" aria-label="Background comparison"><button type="button" aria-pressed={review.preview === "original"} onClick={() => setReview((current) => current && { ...current, preview: "original" })}>Original</button><button type="button" aria-pressed={review.preview === "cutout"} onClick={() => setReview((current) => current && { ...current, preview: "cutout" })}>Cutout</button></div>
      <div className="mt-4 flex items-center gap-4"><Button type="button" variant="ghost" onClick={() => finishReview(false)}>Keep original</Button><Button type="button" onClick={() => finishReview(true)}>Use cutout</Button></div>
    </div> : null}
    {backgroundError && <p className="mt-3 text-[12px] leading-relaxed" role="alert">{backgroundError}</p>}
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
      <div className="flex items-center justify-between gap-5 pt-2"><Button type="submit" disabled={busy || !!review} className="min-w-40">{saving ? <><Loader2 size={14} className="animate-spin" />Saving</> : isNew ? "Save piece" : "Save changes"}</Button>{!isNew && onDelete && "id" in item && <Button type="button" variant="ghost" className="text-[12px] text-muted-foreground" disabled={busy || !!review} onClick={async () => { setSaving(true); try { await onDelete(item as Item); onClose(); } catch { setError("This piece could not be removed. Try again."); setSaving(false); } }}>Remove piece</Button>}</div>
    </fieldset></form>
  </SheetContent></Sheet><UnsavedChangesDialog open={confirmClose} onOpenChange={setConfirmClose} onDiscard={discard} onSave={() => { setConfirmClose(false); void save(); }} canSave={!busy && !review} isNew={isNew} /></>;
}
