"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { IconAction } from "@/components/ui/icon-action";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ModelPhotoPicker } from "@/components/model-photo-picker";
import { RenderKeySettings } from "@/components/render-key-settings";
import { SharePopover } from "@/components/share-popover";
import { useWardrobe } from "@/lib/store";
import { compressImage, imageSource } from "@/lib/images";
import type { Outfit } from "@/lib/types";
import { writeRecord, writeReferencePhoto } from "@/lib/db";
import { renderCredentialPayload, type RenderCredential } from "@/lib/render-credential";
type RenderConfig = { enabled: boolean; requiresApiKey: boolean; provider: string; model: string };
export function Outfits({ onAdd, active = true }: { onAdd: () => void; active?: boolean }) {
  const { items, outfits, referencePhoto, setReferencePhoto, saveOutfit, deleteOutfit, space } = useWardrobe();
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [config, setConfig] = useState<RenderConfig | null>(null);
  const [credential, setCredential] = useState<RenderCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Outfit | null>(null);
  const [unsaved, setUnsaved] = useState<Outfit | null>(null);
  const [removed, setRemoved] = useState<Outfit | null>(null);
  useEffect(() => { const load = () => { void fetch("/api/render/status").then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then(setConfig).catch(() => setConfig(null)); }; load(); window.addEventListener("online", load); return () => window.removeEventListener("online", load); }, []);
  const selectedItems = items.filter((item) => selection.includes(item.id));
  function toggle(id: string) { setError(""); setSelection((value) => value.includes(id) ? value.filter((entry) => entry !== id) : value.length < 6 ? [...value, id] : value); }
  async function selectPhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true); setError("");
    try {
      if (!file.size) throw new Error("This photo is empty. Choose another file.");
      if (file.size > 20_000_000) throw new Error("Choose a model photo smaller than 20 MB.");
      const data = await compressImage(file, 1200, 0.82);
      if (useWardrobe.getState().space !== space) throw new Error("Your account changed. Choose the photo again.");
      await writeReferencePhoto(space, data);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Your model photo could not be saved."); throw cause; }
    finally { setPhotoBusy(false); }
  }
  async function render() {
    if (busy || photoBusy || !config?.enabled || !referencePhoto || !selectedItems.length || unsaved) return;
    if (!navigator.onLine) { setError("Connect to the internet to render an outfit."); return; }
    setBusy(true); setError("");
    try {
      const credentialBody = renderCredentialPayload(credential, space);
      const pieces = await Promise.all(selectedItems.map(async (item) => ({ id: item.id, name: item.name, imageData: await compressImage(imageSource(item), 900, 0.78) })));
      const body = JSON.stringify({ ...credentialBody, referencePhoto: await compressImage(referencePhoto, 1200, 0.8), items: pieces });
      if (new TextEncoder().encode(body).length > 3_900_000) throw new Error("These images are too large to render together. Select fewer pieces.");
      if (useWardrobe.getState().space !== space) throw new Error("Your account changed. Select your pieces again.");
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
  const modelPhotoPanel = <aside aria-label="Your model photo" className="self-start">
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1"><h2 className="text-[12px]">Your model photo</h2>{active && <InfoTooltip label="About your model photo">Saved in this browser and reused for future outfits. Sent with your selected pieces to OpenAI only when you select Render outfit.</InfoTooltip>}</div>{referencePhoto && <div role="group" aria-label="Model photo actions" className="-my-2 -mr-2 flex shrink-0 items-center gap-1"><ModelPhotoPicker key={space} active={active} hasPhoto busy={busy || photoBusy} onSelect={selectPhoto} /><IconAction label="Remove model photo" tooltip="Remove photo" icon={Trash2} disabled={busy || photoBusy} onClick={() => { void setReferencePhoto(null).catch(() => setError("Your model photo could not be removed.")); }} /></div>}</div>
    <p className="mt-2 text-[11px] leading-relaxed text-subtle">A full-body photo or mirror selfie, facing the camera and visible from head to toe.</p>
    {referencePhoto ? <div className="mt-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={referencePhoto} alt="Your saved model photo" className="reference-image" />
      <p className="mt-3 text-[11px] text-subtle" role="status">Saved for future outfits</p>
    </div> : null}
    {!referencePhoto && <ModelPhotoPicker key={space} active={active} hasPhoto={false} busy={busy || photoBusy} onSelect={selectPhoto} className="mt-4" />}
  </aside>;
  return <section className="outfits-view" aria-labelledby="outfits-heading"><div className="outfits-head"><h1 id="outfits-heading" className="text-[14px] leading-5">Outfits <span className="ml-3 text-[11px] font-normal text-subtle">{String(outfits.length).padStart(2, "0")}</span></h1>{items.length > 0 && outfits.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => setCreating(!creating)} className="text-[12px]">{creating ? "Back to outfits" : <><Plus size={13} />Create outfit</>}</Button>}</div>
    {!items.length && !outfits.length ? <div className="outfit-workspace"><div className="empty-state"><p className="font-normal">No pieces yet.</p><p className="mt-2 text-[12px] text-subtle">Add pieces to your wardrobe to create an outfit.</p><button className="mt-7 inline-flex items-center gap-3 border-b border-foreground pb-1 text-[12px]" onClick={onAdd}>Add to wardrobe<ArrowRight size={13} /></button></div>{modelPhotoPanel}</div> : builder ? <div className="outfit-workspace">
      <div><div className="flex items-center justify-between"><h2 className="text-[12px]">Choose pieces</h2><span className="text-[11px] text-subtle">{selectedItems.length} / 6</span></div><div className="outfit-picker">{items.map((item) => <button key={item.id} type="button" className="outfit-piece" aria-label={`Select ${item.name}`} aria-pressed={selection.includes(item.id)} disabled={busy || (!selection.includes(item.id) && selection.length >= 6)} onClick={() => toggle(item.id)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageSource(item)} alt={item.name} loading="lazy" />{selection.includes(item.id) && <span className="selected-mark p-1"><Check size={13} /></span>}<span className="mt-3 block truncate text-[11px]">{item.name}</span><span className="mt-1 block truncate text-[10px] text-subtle">{item.brand || "\u00a0"}</span>
      </button>)}</div></div>
      <div className="space-y-6">{modelPhotoPanel}
      {config?.requiresApiKey && <RenderKeySettings key={space} active={active} userId={space.startsWith("account:") ? space.slice(8) : null} sessionKey={credential?.type === "session" ? credential.apiKey : ""} disabled={busy} onCredentialChange={setCredential} />}
      <div>{config?.model && <p className="mb-3 text-[11px] text-subtle">Model: {config.model}</p>}<Button type="button" onClick={() => { void render(); }} className="w-full" disabled={busy || photoBusy || Boolean(unsaved) || !referencePhoto || selectedItems.length === 0 || !config?.enabled || (config.requiresApiKey && !credential)}>{busy ? <><Loader2 size={14} className="animate-spin" />Rendering…</> : "Render outfit"}</Button><p className="mt-3 text-[11px] leading-relaxed text-subtle">{!config ? "Connect to the internet to render outfits." : !config.enabled ? "Rendering is not available right now." : config.requiresApiKey ? "Rendering is billed to your OpenAI account." : "Sends your photo and selected pieces to OpenAI to create an image."}</p></div>
      {error && <p className="text-[12px] leading-relaxed" role="alert">{error}</p>}{unsaved && <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={unsaved.imageData} alt="Rendered outfit awaiting save" className="w-full" /><Button type="button" variant="outline" className="mt-3 w-full" onClick={async () => { try { await saveOutfit(unsaved); setDetail(unsaved); setUnsaved(null); setCreating(false); setError(""); } catch { setError("The image could not be saved. Free some browser storage and retry."); } }}>Retry saving image</Button><div className="mt-3 flex justify-between text-[11px]"><a href={unsaved.imageData} download={`capsule-${unsaved.id}.jpg`} className="underline underline-offset-4">Download image</a><button type="button" className="text-muted-foreground" onClick={() => setUnsaved(null)}>Discard</button></div></div>}
      </div>
    </div> : <div className="outfit-workspace"><div className="outfit-grid !mt-0">{outfits.toSorted((a, b) => b.createdAt - a.createdAt).map((outfit) => <button key={outfit.id} onClick={() => setDetail(outfit)} className="text-left" aria-label={`View ${outfit.name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={outfit.imageData} alt={outfit.name} loading="lazy" /><span className="mt-4 block text-[12px]">{outfit.name}</span><span className="mt-1 block text-[11px] text-subtle">{new Date(outfit.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span></button>)}</div>{modelPhotoPanel}</div>}
    {(!builder || (!items.length && !outfits.length)) && error && <p role="alert" className="mt-6 text-[12px]">{error}</p>}
    {removed && <div className="mt-8 flex items-center gap-5 text-[12px]" role="status"><span>Outfit removed.</span><button className="underline underline-offset-4" onClick={async () => { try { await saveOutfit({ ...removed, updatedAt: Date.now(), deletedAt: null }); setRemoved(null); } catch { setError("Could not restore this outfit."); } }}>Undo</button><button aria-label="Dismiss" onClick={() => setRemoved(null)}><X size={12} /></button></div>}
    {detail && <Sheet open={active} onOpenChange={(open) => { if (!open) setDetail(null); }}><SheetContent><div className="flex items-center justify-between gap-4 pr-9"><SheetTitle className="text-[14px] leading-5">{detail.name}</SheetTitle><SharePopover target={{ kind: "outfit", outfit: detail, pieces: items.filter((piece) => detail.itemIds.includes(piece.id)) }} active={active} /></div><SheetDescription className="sr-only">Rendered outfit and its wardrobe pieces.</SheetDescription>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={detail.imageData} alt={detail.name} className="mt-8 w-full" /><div className="mt-6 flex flex-wrap gap-3">{detail.itemIds.map((id) => { const item = items.find((piece) => piece.id === id); return item ? <div className="w-14" key={id} title={item.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageSource(item)} alt={item.name} className="aspect-[4/5] w-full object-contain" /></div> : null; })}</div><div className="mt-8 flex items-center justify-between"><a href={detail.imageData} download={`capsule-${detail.id}.jpg`} className="text-[12px] underline underline-offset-4">Download image</a><button className="text-[12px] text-muted-foreground" onClick={async () => { try { await deleteOutfit(detail.id); setRemoved(detail); setDetail(null); } catch { setError("Could not remove this outfit."); } }}>Remove outfit</button></div></SheetContent></Sheet>}
  </section>;
}
