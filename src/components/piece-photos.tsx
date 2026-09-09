"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Images, Loader2, ScanLine, Undo2 } from "lucide-react";
import { Button } from "./ui/button";
import { imageSource, prepareUploadedImage } from "@/lib/images";
import { removeBackground } from "@/lib/background-removal";
import { assignPhotoSlot, type PhotoSide } from "@/lib/photo-slots";
import { chosenImage, initialPhotos, savePhotoState, type PhotoChoice, type PieceImages } from "@/lib/photo-editor";

type BackgroundProgress = { stage: "download" | "processing"; progress?: number };
type Options = { item: PieceImages; images?: string[]; uploadedImages?: string[]; purchaseUrl: string; disabled?: boolean };

export function usePiecePhotos({ item, images = [], uploadedImages = [], purchaseUrl, disabled = false }: Options) {
  const [initial] = useState(() => initialPhotos(item, images, uploadedImages));
  const [imageSide, setImageSide] = useState<PhotoSide>("front");
  const [photos, setPhotos] = useState(initial);
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
  const working = !!backgroundProgress || !!photoWork;
  const busy = disabled || working;
  const imageControlsLocked = busy || !!review;
  const dirty = photos.frontId !== initial.frontId || photos.backId !== initial.backId || photos.sideId !== initial.sideId
    || photos.choices.length !== initial.choices.length
    || photos.choices.some((choice, index) => (Object.keys(choice) as Array<keyof PhotoChoice>).some((key) => choice[key] !== initial.choices[index]?.[key]))
    || !!review;
  const selectedId = photos[`${imageSide}Id`];
  const selectedPhoto = photos.choices.find((choice) => choice.id === selectedId);
  const previewSource = selectedPhoto ? review ? review.preview === "cutout" ? review.result : imageSource(selectedPhoto) : imageSource(chosenImage(selectedPhoto)) : undefined;
  let validPurchaseUrl = "";
  try { const url = new URL(purchaseUrl.trim()); if (["https:", "http:"].includes(url.protocol)) validPurchaseUrl = url.href; } catch { /* The optional field may be empty or incomplete while editing. */ }
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
      setPhotos((current) => ({ ...current, frontId: current.frontId || incoming[0]?.id || "", choices: [...current.choices, ...incoming.filter((choice) => !current.choices.some((existing) => existing.imageUrl === choice.imageUrl))] }));
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
      setPhotos((current) => ({ ...current, frontId: current.frontId || incoming[0]?.id || "", choices: [...current.choices, ...incoming.filter((choice) => !current.choices.some((existing) => existing.imageData === choice.imageData))] }));
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

  return {
    photos, setPhotos, imageSide, setImageSide, selectedId, selectedPhoto, previewSource,
    photoInput, photoWork, photoError, photoStatus, backgroundProgress, backgroundError,
    setBackgroundError, review, setReview, validPurchaseUrl, busy, imageControlsLocked,
    selectImage, addPhotos, fetchProductPhotos, createCutout, finishReview, cancelBackground, cancelPhotoWork,
    dirty, working, locked: imageControlsLocked,
    cancel: () => { cancelBackground(); cancelPhotoWork(); },
    save: () => savePhotoState(photos),
  };
}

export function PiecePhotos({ editor, name }: { editor: ReturnType<typeof usePiecePhotos>; name: string }) {
  const {
    photos, setPhotos, imageSide, setImageSide, selectedId, selectedPhoto, previewSource,
    photoInput, photoWork, photoError, photoStatus, backgroundProgress, backgroundError,
    setBackgroundError, review, setReview, validPurchaseUrl, busy, imageControlsLocked,
    selectImage, addPhotos, fetchProductPhotos, createCutout, finishReview, cancelBackground, cancelPhotoWork,
  } = editor;
  return <>
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
      {previewSource ? <img src={previewSource} alt={`${name || "Product image"}, ${imageSide}`} className="h-full w-full object-contain" /> : <p className="text-[12px] text-subtle">Choose a {imageSide} image{imageSide === "front" ? "." : " below. Optional."}</p>}
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
  </>;
}
