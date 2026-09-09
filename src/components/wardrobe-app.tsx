"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, Loader2, Plus, X } from "lucide-react";
import { AddPiece } from "@/components/add-piece";
import { CATEGORIES, ItemDetail } from "@/components/item-detail";
import { Outfits } from "@/components/outfits";
import { SyncPopover } from "@/components/sync-popover";
import { ThemeControl } from "@/components/theme-control";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWardrobe } from "@/lib/store";
import { useSyncStore } from "@/lib/sync";
import { imageSource } from "@/lib/images";
import type { Category, Item } from "@/lib/types";
type View = "wardrobe" | "add" | "outfits";
type Sort = "newest" | "oldest" | "name" | "brand";
const SORTS: { value: Sort; label: string }[] = [{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "name", label: "Name A–Z" }, { value: "brand", label: "Brand A–Z" }];
export function WardrobeApp() {
  const space = useWardrobe((state) => state.space);
  return <WardrobeSurface key={space} />;
}
function WardrobeSurface() {
  const [view, setView] = useState<View>("wardrobe");
  const [category, setCategory] = useState<Category | "all">("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [selected, setSelected] = useState<Item | null>(null);
  const [removed, setRemoved] = useState<Item | null>(null);
  const [notice, setNotice] = useState<{ id: string; message: string } | null>(null);
  const [online, setOnline] = useState(true);
  const { items, ready, error, initialize, saveItem, deleteItem, space } = useWardrobe();
  useEffect(() => { void initialize(); void useSyncStore.getState().initialize(); const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); useSyncStore.getState().stop(); }; }, [initialize]);
  const filtered = useMemo(() => items.filter((item) => category === "all" || item.category === category).toSorted((a, b) => sort === "newest" ? b.createdAt - a.createdAt : sort === "oldest" ? a.createdAt - b.createdAt : sort === "name" ? a.name.localeCompare(b.name) : a.brand.localeCompare(b.brand)), [items, category, sort]);
  const categoryName = category === "all" ? "All" : CATEGORIES.find((entry) => entry.value === category)?.label;
  const showNotice = (message: string) => setNotice({ id: crypto.randomUUID(), message });
  async function remove(item: Item) { await deleteItem(item.id); setRemoved(item); setNotice(null); }
  function dismissNotice() {
    setNotice((current) => current === notice ? null : current);
    setRemoved((current) => current === removed ? null : current);
  }
  return <div className="min-h-dvh bg-background text-foreground"><a className="skip-link" href="#main">Skip to wardrobe</a>
    <header className="top-bar"><button onClick={() => setView("wardrobe")} className="wordmark" aria-label="Capsule wardrobe">capsule</button><div className="flex items-center gap-5 text-[12px]"><span className="text-subtle">{online ? "" : "Offline"}</span><span aria-live="polite">{ready ? `${items.length} ${items.length === 1 ? "piece" : "pieces"}` : "— pieces"}</span></div></header>
    <main id="main" className={view === "wardrobe" ? "catalog-layout" : "main-view"}>
      {view === "wardrobe" && <><aside className="catalog-sidebar" aria-label="Wardrobe filters"><Popover><PopoverTrigger asChild><button className="filter-trigger"><span>Filter &amp; Sort</span><Plus size={12} strokeWidth={1.5} /></button></PopoverTrigger><PopoverContent align="start" side="bottom" className="w-48 p-4"><p className="mb-3 text-[11px] text-subtle">SORT BY</p>{SORTS.map((option) => <button className="flex w-full items-center justify-between py-2 text-left text-[12px]" key={option.value} aria-pressed={sort === option.value} onClick={() => setSort(option.value)}>{option.label}{sort === option.value && <Check size={12} />}</button>)}</PopoverContent></Popover>
        <div className="category-list" role="tablist" aria-label="Categories"><button role="tab" aria-selected={category === "all"} onClick={() => setCategory("all")} className={category === "all" ? "category active" : "category"}>ALL</button>{CATEGORIES.map((entry) => <button key={entry.value} role="tab" aria-selected={category === entry.value} onClick={() => setCategory(entry.value)} className={category === entry.value ? "category active" : "category"}>{entry.label.toUpperCase()}</button>)}</div>
      </aside><section className="catalog-content" aria-label={`${categoryName} pieces`}><div className="catalog-heading"><h1>{categoryName}</h1><span className="text-[11px] text-subtle">{ready ? String(filtered.length).padStart(2, "0") : "—"}</span></div>
        {!ready ? <div className="empty-state" role="status"><Loader2 size={16} className="animate-spin text-subtle" /><p className="mt-4 text-muted-foreground">Opening wardrobe…</p></div> : filtered.length ? <div className="product-grid">{filtered.map((item) => <button className="product-card" key={item.id} onClick={() => setSelected(item)} aria-label={`View ${item.name}`}><ProductImages item={item} /><span className="product-name">{item.name}</span><span className="product-meta">{[item.brand, item.size].filter(Boolean).join(" / ") || item.color || "\u00a0"}</span></button>)}</div> : <div className="empty-state"><p className="font-normal">{items.length ? `No ${categoryName?.toLowerCase()} yet.` : "Your wardrobe is empty."}</p><p className="mt-2 text-[12px] text-subtle">{items.length ? "Pieces in this category will appear here." : "Add your first piece with a link or photos."}</p><button className="mt-7 inline-flex items-center gap-3 border-b border-foreground pb-1 text-[12px]" onClick={() => setView("add")}>Add a piece<ArrowRight size={13} /></button></div>}
      </section></>}
      <div hidden={view !== "add"}><AddPiece onAdded={() => { setCategory("all"); setView("wardrobe"); setRemoved(null); showNotice("Piece saved."); }} /></div>
      <div hidden={view !== "outfits"}><Outfits onAdd={() => setView("add")} /></div>
    </main>
    {(error || notice || removed) && <Notice key={error ? `error:${error}` : removed ? `removed:${removed.id}` : notice?.id} role={error ? "alert" : "status"} autoDismiss={!error && !removed && notice?.message === "Piece saved."} onDismiss={dismissNotice}><span>{error || (removed ? "Piece removed." : notice?.message)}</span>{removed && !error && <button className="underline underline-offset-4" onClick={async () => { try { await saveItem({ ...removed, updatedAt: Date.now(), deletedAt: null }); setRemoved(null); } catch { showNotice("Could not restore the piece. Try again."); } }}>Undo</button>}{!error && <button aria-label="Dismiss notification" onClick={dismissNotice}><X size={13} /></button>}</Notice>}
    <nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav-inner"><button className={`nav-button ${view === "wardrobe" ? "current" : ""}`} aria-current={view === "wardrobe" ? "page" : undefined} onClick={() => setView("wardrobe")}>Wardrobe</button><span className="nav-dot" aria-hidden="true">•</span><button className={`nav-button ${view === "add" ? "current" : ""}`} aria-current={view === "add" ? "page" : undefined} onClick={() => setView("add")}>Add</button><span className="nav-dot" aria-hidden="true">•</span><button className={`nav-button ${view === "outfits" ? "current" : ""}`} aria-current={view === "outfits" ? "page" : undefined} onClick={() => setView("outfits")}>Outfits</button><span className="nav-dot" aria-hidden="true">•</span><ThemeControl /><SyncPopover /></div></nav>
    {selected && <ItemDetail key={selected.id} item={selected} onClose={() => setSelected(null)} onSave={async (item) => { if (useWardrobe.getState().space !== space) throw new Error("The active wardrobe changed. Open this piece again to save."); await saveItem(item); }} onDelete={remove} />}
  </div>;
}

function ProductImages({ item }: { item: Item }) {
  const frontSource = imageSource(item);
  const candidateBackSource = item.backImageData || item.backImageUrl ? imageSource({ imageUrl: item.backImageUrl ?? "", imageData: item.backImageData }) : null;
  const backSource = candidateBackSource !== frontSource ? candidateBackSource : null;
  const [loadedBack, setLoadedBack] = useState<string | null>(null);
  const [failedFront, setFailedFront] = useState<string | null>(null);
  const backReady = !!backSource && loadedBack === backSource;
  const frontUnavailable = failedFront === frontSource;
  return <div className="product-image" data-back-ready={backReady} data-front-unavailable={frontUnavailable} data-unavailable={frontUnavailable && !backReady ? "Image unavailable" : undefined}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img key={`front:${frontSource}`} className="product-image-front" src={frontSource} alt={item.name} loading="lazy" decoding="async" onLoad={() => setFailedFront(null)} onError={() => setFailedFront(frontSource)} />
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {backSource && <img key={`back:${backSource}`} className="product-image-back" src={backSource} alt="" aria-hidden="true" loading="lazy" decoding="async" onLoad={(event) => { if (event.currentTarget.naturalWidth > 0) setLoadedBack(backSource); }} onError={() => setLoadedBack((current) => current === backSource ? null : current)} />}
  </div>;
}

function Notice({ autoDismiss, onDismiss, role, children }: { autoDismiss: boolean; onDismiss: () => void; role: "alert" | "status"; children: ReactNode }) {
  const [dismissing, setDismissing] = useState(false);
  useEffect(() => {
    if (!autoDismiss) return;
    const timer = window.setTimeout(() => setDismissing(true), 3000);
    return () => window.clearTimeout(timer);
  }, [autoDismiss]);
  return <div className="notice" role={role} data-dismissing={dismissing} onAnimationEnd={(event) => {
    if (dismissing && event.target === event.currentTarget && event.animationName === "notice-out") onDismiss();
  }}>{children}</div>;
}
