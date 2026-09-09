"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useWardrobe } from "@/lib/store";
import { compressImage, imageSource } from "@/lib/images";
import type { Outfit } from "@/lib/types";
import { writeRecord, writeReferencePhoto } from "@/lib/db";
type RenderConfig = { enabled: boolean; requiresApiKey: boolean; provider: string; model: string };
export function Outfits({ onAdd }: { onAdd: () => void }) {
  const { items, outfits, referencePhoto, setReferencePhoto, saveOutfit, deleteOutfit, space } = useWardrobe();
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [config, setConfig] = useState<RenderConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Outfit | null>(null);
  const [unsaved, setUnsaved] = useState<Outfit | null>(null);
  const [removed, setRemoved] = useState<Outfit | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  useEffect(() => { const load = () => { void fetch("/api/render/status").then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then(setConfig).catch(() => setConfig(null)); }; load(); window.addEventListener("online", load); return () => window.removeEventListener("online", load); }, []);
  const selectedItems = items.filter((item) => selection.includes(item.id));
  function toggle(id: string) { setError(""); setSelection((value) => value.includes(id) ? value.filter((entry) => entry !== id) : value.length < 6 ? [...value, id] : value); }
  async function selectPhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true); setError("");
    try { if (file.size > 20_000_000) throw new Error("Choose a reference photo smaller than 20 MB."); const data = await compressImage(file, 1200, 0.82); await writeReferencePhoto(space, data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The reference photo could not be saved."); }
    finally { setPhotoBusy(false); if (photoInput.current) photoInput.current.value = ""; }
  }
  async function render(event: React.FormEvent) {
    event.preventDefault();
    if (!referencePhoto || !selectedItems.length || unsaved) return;
    if (!navigator.onLine) { setError("Connect to the internet to render an outfit."); return; }
    setBusy(true); setError("");
    try {
      const pieces = await Promise.all(selectedItems.map(async (item) => ({ id: item.id, name: item.name, imageData: await compressImage(imageSource(item), 900, 0.78) })));
      const body = JSON.stringify({ apiKey: apiKey.trim(), referencePhoto: await compressImage(referencePhoto, 1200, 0.8), items: pieces });
      if (new TextEncoder().encode(body).length > 3_900_000) throw new Error("These images are too large to render together. Select fewer pieces.");
      const response = await fetch("/api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(125_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This outfit could not be rendered. Try again.");
      const imageData = await compressImage(data.imageData, 1500, 0.86);
      const now = Date.now();
      const outfit: Outfit = { id: crypto.randomUUID(), name: `Outfit ${String(outfits.length + 1).padStart(2, "0")}`, itemIds: selectedItems.map((item) => item.id), imageData, createdAt: now, updatedAt: now, deletedAt: null };
      setUnsaved(outfit);
      await writeRecord(space, "outfits", outfit);
      setUnsaved(null); setCreating(false); setSelection([]); setDetail(outfit);
    } catch (cause) { setError(cause instanceof Error && cause.name === "TimeoutError" ? "Rendering took too long. Try again." : cause instanceof Error ? cause.message : "This outfit could not be rendered."); }
    finally { setBusy(false); }
  }
  const builder = creating || outfits.length === 0;
  return <section className="outfits-view" aria-labelledby="outfits-heading"><div className="outfits-head"><h1 id="outfits-heading" className="text-[14px] leading-5">Outfits <span className="ml-3 text-[11px] font-normal text-neutral-400">{String(outfits.length).padStart(2, "0")}</span></h1>{items.length > 0 && outfits.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => setCreating(!creating)} className="text-[12px]">{creating ? "Back to outfits" : <><Plus size={13} />Create outfit</>}</Button>}</div>
    {!items.length && !outfits.length ? <div className="empty-state"><p className="font-normal">No pieces yet.</p><p className="mt-2 text-[12px] text-neutral-400">Add pieces to your wardrobe to create an outfit.</p><button className="mt-7 inline-flex items-center gap-3 border-b border-black pb-1 text-[12px]" onClick={onAdd}>Add a piece<ArrowRight size={13} /></button></div> : builder ? <form onSubmit={render} className="outfit-workspace">
      <div><div className="flex items-center justify-between"><h2 className="text-[12px]">Choose pieces</h2><span className="text-[11px] text-neutral-400">{selectedItems.length} / 6</span></div><div className="outfit-picker">{items.map((item) => <button key={item.id} type="button" className="outfit-piece" aria-label={`Select ${item.name}`} aria-pressed={selection.includes(item.id)} disabled={busy || (!selection.includes(item.id) && selection.length >= 6)} onClick={() => toggle(item.id)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageSource(item)} alt={item.name} loading="lazy" />{selection.includes(item.id) && <span className="selected-mark p-1"><Check size={13} /></span>}<span className="mt-3 block truncate text-[11px]">{item.name}</span><span className="mt-1 block truncate text-[10px] text-neutral-400">{item.brand || "\u00a0"}</span>
      </button>)}</div></div>
      <div className="space-y-6"><div><div className="mb-4 flex items-center justify-between"><h2 className="text-[12px]">Your reference photo</h2>{referencePhoto && <button type="button" className="text-[11px] text-neutral-400" disabled={busy} onClick={() => { void setReferencePhoto(null).catch(() => setError("The reference photo could not be removed.")); }}>Remove</button>}</div>{referencePhoto ? <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={referencePhoto} alt="Your reference photo" className="reference-image" /><button type="button" className="mt-3 text-[11px] text-neutral-500 underline underline-offset-4" disabled={busy || photoBusy} onClick={() => photoInput.current?.click()}>Change photo</button></div> : <button type="button" className="flex h-44 w-full flex-col items-center justify-center gap-3 border border-dashed border-neutral-200 text-[12px] text-neutral-500 hover:border-neutral-400" onClick={() => photoInput.current?.click()} disabled={busy || photoBusy}>{photoBusy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} strokeWidth={1.3} />}<span>{photoBusy ? "Saving photo…" : "Choose your photo"}</span></button>}<input type="file" ref={photoInput} accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" aria-label="Choose your reference photo" onChange={(event) => void selectPhoto(event.target.files?.[0])} /><p className="mt-3 text-[11px] leading-relaxed text-neutral-400">Stored in this browser. Sent for rendering only when you select Render outfit.</p></div>
      {config?.requiresApiKey && <label className="field-label">OpenAI API key<Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="sk-…" disabled={busy} /><span className="mt-2 block text-[11px] leading-relaxed text-neutral-400">Used for this session only. Rendering is billed to your OpenAI account.</span></label>}
      <div><Button type="submit" className="w-full" disabled={busy || photoBusy || Boolean(unsaved) || !referencePhoto || selectedItems.length === 0 || !config?.enabled || (config.requiresApiKey && !apiKey.trim())}>{busy ? <><Loader2 size={14} className="animate-spin" />Rendering…</> : "Render outfit"}</Button><p className="mt-3 text-[11px] leading-relaxed text-neutral-400">{!config ? "Connect to the internet to render outfits." : !config.enabled ? "Rendering is not available right now." : "Sends your photo and selected pieces to OpenAI to create an image."}</p></div>
      {error && <p className="text-[12px] leading-relaxed" role="alert">{error}</p>}{unsaved && <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={unsaved.imageData} alt="Rendered outfit awaiting save" className="w-full" /><Button type="button" variant="outline" className="mt-3 w-full" onClick={async () => { try { await saveOutfit(unsaved); setDetail(unsaved); setUnsaved(null); setCreating(false); setError(""); } catch { setError("The image could not be saved. Free some browser storage and retry."); } }}>Retry saving image</Button><div className="mt-3 flex justify-between text-[11px]"><a href={unsaved.imageData} download={`capsule-${unsaved.id}.jpg`} className="underline underline-offset-4">Download image</a><button type="button" className="text-neutral-500" onClick={() => setUnsaved(null)}>Discard</button></div></div>}
      </div>
    </form> : <div className="outfit-grid">{outfits.toSorted((a, b) => b.createdAt - a.createdAt).map((outfit) => <button key={outfit.id} onClick={() => setDetail(outfit)} className="text-left" aria-label={`View ${outfit.name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={outfit.imageData} alt={outfit.name} loading="lazy" /><span className="mt-4 block text-[12px]">{outfit.name}</span><span className="mt-1 block text-[11px] text-neutral-400">{new Date(outfit.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span></button>)}</div>}
    {!builder && error && <p role="alert" className="mt-6 text-[12px]">{error}</p>}
    {removed && <div className="mt-8 flex items-center gap-5 text-[12px]" role="status"><span>Outfit removed.</span><button className="underline underline-offset-4" onClick={async () => { try { await saveOutfit({ ...removed, updatedAt: Date.now(), deletedAt: null }); setRemoved(null); } catch { setError("Could not restore this outfit."); } }}>Undo</button><button aria-label="Dismiss" onClick={() => setRemoved(null)}><X size={12} /></button></div>}
    {detail && <Sheet open onOpenChange={(open) => { if (!open) setDetail(null); }}><SheetContent><SheetTitle className="text-[14px] leading-5">{detail.name}</SheetTitle><SheetDescription className="sr-only">Rendered outfit and its wardrobe pieces.</SheetDescription>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={detail.imageData} alt={detail.name} className="mt-8 w-full" /><div className="mt-6 flex flex-wrap gap-3">{detail.itemIds.map((id) => { const item = items.find((piece) => piece.id === id); return item ? <div className="w-14" key={id} title={item.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageSource(item)} alt={item.name} className="aspect-[4/5] w-full object-contain" /></div> : null; })}</div><div className="mt-8 flex items-center justify-between"><a href={detail.imageData} download={`capsule-${detail.id}.jpg`} className="text-[12px] underline underline-offset-4">Download image</a><button className="text-[12px] text-neutral-500" onClick={async () => { try { await deleteOutfit(detail.id); setRemoved(detail); setDetail(null); } catch { setError("Could not remove this outfit."); } }}>Remove outfit</button></div></SheetContent></Sheet>}
  </section>;
}
