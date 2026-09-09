"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Camera, FolderOpen, Images, Loader2, Pencil, X } from "lucide-react";
import { Button } from "./ui/button";
import { IconAction } from "./ui/icon-action";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cameraErrorMessage, captureCameraPhoto, requestCameraStream } from "@/lib/camera";
import { cn } from "@/lib/utils";
import { ModelPhotoPlaceholder } from "./model-photo-placeholder";

type Props = {
  hasPhoto: boolean;
  busy: boolean;
  onSelect: (file: File) => void | Promise<void>;
  active?: boolean;
  className?: string;
};

// Hidden Outfits views stay mounted. Unmount this boundary when leaving so a
// camera prompt granted later cannot reopen the dialog or keep filming.
export function ModelPhotoPicker({ active = true, ...props }: Props) {
  return active ? <PhotoPicker {...props} /> : null;
}

function PhotoPicker({ hasPhoto, busy, onSelect, className }: Omit<Props, "active">) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraRequest = useRef<AbortController | null>(null);
  const captureSequence = useRef(0);
  const alive = useRef(true);
  const locked = busy || selecting;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cameraRequest.current?.abort(); cameraRequest.current = null; };
  }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => {
    const element = video.current;
    if (!element || !stream) return;
    let disposed = false;
    const ended = () => { if (!disposed) { setReady(false); setError("The camera stopped. Try again or choose another photo."); } };
    const tracks = stream.getVideoTracks();
    tracks.forEach((track) => track.addEventListener("ended", ended));
    element.srcObject = stream;
    void element.play().catch((cause) => { if (!disposed) { setError(cameraErrorMessage(cause)); setReady(false); cameraRequest.current?.abort(); } });
    return () => { disposed = true; tracks.forEach((track) => track.removeEventListener("ended", ended)); element.pause(); element.srcObject = null; };
  }, [stream]);

  function closeCamera() {
    if (locked) return;
    captureSequence.current++;
    cameraRequest.current?.abort(); cameraRequest.current = null;
    setStream(null); setPhoto(null); setCameraOpen(false);
    setStarting(false); setReady(false); setCapturing(false); setError("");
  }

  async function openCamera() {
    if (locked) return;
    captureSequence.current++;
    cameraRequest.current?.abort();
    const controller = new AbortController();
    cameraRequest.current = controller;
    setMenuOpen(false); setCameraOpen(true); setStream(null); setPhoto(null);
    setStarting(true); setReady(false); setCapturing(false); setError("");
    try {
      const next = await requestCameraStream(controller.signal);
      if (cameraRequest.current === controller && !controller.signal.aborted) setStream(next);
    } catch (cause) {
      if (cameraRequest.current === controller && !controller.signal.aborted) setError(cameraErrorMessage(cause));
    } finally {
      if (cameraRequest.current === controller && !controller.signal.aborted) setStarting(false);
    }
  }

  async function capture() {
    const element = video.current;
    const controller = cameraRequest.current;
    if (!element || !controller || !ready || capturing || locked) return;
    const token = ++captureSequence.current;
    setCapturing(true); setError("");
    try {
      const file = await captureCameraPhoto(element);
      if (cameraRequest.current !== controller || controller.signal.aborted || captureSequence.current !== token) return;
      setPhoto({ file, url: URL.createObjectURL(file) });
      controller.abort(); cameraRequest.current = null;
      setStream(null); setReady(false);
    } catch (cause) {
      if (cameraRequest.current === controller && !controller.signal.aborted) setError(cameraErrorMessage(cause));
    } finally { if (alive.current && captureSequence.current === token) setCapturing(false); }
  }

  async function select(file: File | undefined) {
    if (!file || locked) return;
    setMenuOpen(false); setSelecting(true); setError("");
    try {
      await onSelect(file);
      if (!alive.current) return;
      cameraRequest.current?.abort(); cameraRequest.current = null;
      setStream(null); setPhoto(null); setCameraOpen(false);
    } catch (cause) {
      // Keep a captured photo available for retry; Outfits also surfaces its
      // persistence error when a native library/file selection fails.
      if (alive.current) setError(cause instanceof Error ? cause.message : "This photo could not be saved. Try again.");
    } finally { if (alive.current) setSelecting(false); }
  }

  function chooseInput(input: HTMLInputElement | null) {
    if (locked) return;
    input?.click();
    setMenuOpen(false);
  }

  const optionClass = "flex w-full items-center gap-3 rounded-sm px-2 py-2.5 text-left text-[12px] text-foreground hover:bg-muted focus-visible:outline-foreground";
  return <>
    <Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild>{hasPhoto ? <IconAction ref={trigger} label="Change model photo" tooltip="Change photo" icon={Pencil} loading={selecting} disabled={locked} className={className} /> : <button ref={trigger} type="button" disabled={locked} aria-label="Add photo" className={cn("model-photo-trigger relative block w-full disabled:opacity-40", className)}><ModelPhotoPlaceholder /><span className="model-photo-prompt absolute inset-0 flex items-center justify-center gap-2 bg-background/50 text-[12px] text-foreground"><PopoverAnchor asChild><span className="inline-flex items-center gap-2">{selecting ? <><Loader2 size={13} className="animate-spin" />Saving photo…</> : "Add photo"}</span></PopoverAnchor></span></button>}</PopoverTrigger>
      <PopoverContent align={hasPhoto ? "end" : "center"} sideOffset={8} className="w-48 p-2" onCloseAutoFocus={(event) => { if (cameraOpen) event.preventDefault(); }}>
        <button type="button" className={optionClass} disabled={locked} onClick={() => void openCamera()}><Camera size={15} strokeWidth={1.5} />Take a photo</button>
        <button type="button" className={optionClass} disabled={locked} onClick={() => chooseInput(libraryInput.current)}><Images size={15} strokeWidth={1.5} />Photo library</button>
        <button type="button" className={optionClass} disabled={locked} onClick={() => chooseInput(fileInput.current)}><FolderOpen size={15} strokeWidth={1.5} />Choose file</button>
      </PopoverContent>
    </Popover>
    <input ref={libraryInput} type="file" accept="image/*" hidden aria-label="Choose a photo from your library" disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void select(file); }} />
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden aria-label="Choose a photo file" disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void select(file); }} />
    <Dialog.Root open={cameraOpen} onOpenChange={(open) => { if (!open) closeCamera(); }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/20 dark:bg-black/70" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] w-[calc(100%_-_32px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 border border-border bg-background p-6 text-foreground shadow-sm outline-none" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }} onEscapeKeyDown={(event) => { if (locked) event.preventDefault(); }} onInteractOutside={(event) => { if (locked) event.preventDefault(); }}>
        <Dialog.Title className="pr-8 text-[14px] font-normal">Take a photo</Dialog.Title>
        <Dialog.Description className="sr-only">Capture a photo, review it, then choose Use photo. Nothing is saved until you choose it.</Dialog.Description>
        <button type="button" className="absolute right-4 top-4 p-2 text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Close camera" disabled={locked} onClick={closeCamera}><X size={16} strokeWidth={1.5} /></button>
        <div className="relative mt-5 flex aspect-[4/5] max-h-[55dvh] w-full items-center justify-center overflow-hidden bg-black">
          {photo ? <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Captured photo" className="h-full w-full object-contain" />
          </> : <video ref={video} autoPlay muted playsInline aria-label="Live camera preview" className="h-full w-full object-contain" onCanPlay={() => setReady(true)} />}
          {!photo && (starting || !ready && !error) && <span className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-white" role="status"><Loader2 size={14} className="animate-spin" />Opening camera…</span>}
        </div>
        {error && <p role="alert" className="mt-4 text-[12px] leading-relaxed">{error}</p>}
        <div className="mt-5 flex items-center justify-between gap-4">
          {photo ? <><button type="button" className="py-2 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={locked} onClick={() => void openCamera()}>Retake</button><Button type="button" disabled={locked} onClick={() => void select(photo.file)}>{selecting ? <><Loader2 size={13} className="animate-spin" />Saving photo…</> : "Use photo"}</Button></> : error ? <><button type="button" className="py-2 text-[12px] text-muted-foreground hover:text-foreground" onClick={closeCamera}>Cancel</button><Button type="button" disabled={locked || starting} onClick={() => void openCamera()}>Try again</Button></> : <><button type="button" className="py-2 text-[12px] text-muted-foreground hover:text-foreground" onClick={closeCamera}>Cancel</button><Button type="button" disabled={!ready || capturing || locked} onClick={() => void capture()}>{capturing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} strokeWidth={1.5} />}Capture</Button></>}
        </div>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </>;
}
