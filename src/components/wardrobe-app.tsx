"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, Plus, X } from "lucide-react";
import { AddPiece } from "@/components/add-piece";
import { CATEGORIES, ItemDetail } from "@/components/item-detail";
import { Outfits } from "@/components/outfits";
import { SyncPopover } from "@/components/sync-popover";
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
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const { items, ready, error, initialize, saveItem, deleteItem, space } = useWardrobe();
  useEffect(() => { void initialize(); void useSyncStore.getState().initialize(); const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); useSyncStore.getState().stop(); }; }, [initialize]);
  const filtered = useMemo(() => items.filter((item) => category === "all" || item.category === category).toSorted((a, b) => sort === "newest" ? b.createdAt - a.createdAt : sort === "oldest" ? a.createdAt - b.createdAt : sort === "name" ? a.name.localeCompare(b.name) : a.brand.localeCompare(b.brand)), [items, category, sort]);
  const categoryName = category === "all" ? "All" : CATEGORIES.find((entry) => entry.value === category)?.label;
  async function remove(item: Item) { await deleteItem(item.id); setRemoved(item); setNotice(""); }
  return <div className="min-h-dvh bg-white text-black"><a className="skip-link" href="#main">Skip to wardrobe</a>
    <header className="top-bar"><button onClick={() => setView("wardrobe")} className="wordmark" aria-label="Capsule wardrobe">capsule</button><div className="flex items-center gap-5 text-[12px]"><span className="text-neutral-400">{online ? "" : "Offline"}</span><span aria-live="polite">{ready ? `${items.length} ${items.length === 1 ? "piece" : "pieces"}` : "— pieces"}</span></div></header>
    <main id="main" className={view === "wardrobe" ? "catalog-layout" : "main-view"}>
      {view === "wardrobe" && <><aside className="catalog-sidebar" aria-label="Wardrobe filters"><Popover><PopoverTrigger asChild><button className="filter-trigger"><span>Filter &amp; Sort</span><Plus size={12} strokeWidth={1.5} /></button></PopoverTrigger><PopoverContent align="start" side="bottom" className="w-48 p-4"><p className="mb-3 text-[11px] font-semibold text-neutral-400">SORT BY</p>{SORTS.map((option) => <button className="flex w-full items-center justify-between py-2 text-left text-[12px]" key={option.value} aria-pressed={sort === option.value} onClick={() => setSort(option.value)}>{option.label}{sort === option.value && <Check size={12} />}</button>)}</PopoverContent></Popover>
        <div className="category-list" role="tablist" aria-label="Categories"><button role="tab" aria-selected={category === "all"} onClick={() => setCategory("all")} className={category === "all" ? "category active" : "category"}>ALL</button>{CATEGORIES.map((entry) => <button key={entry.value} role="tab" aria-selected={category === entry.value} onClick={() => setCategory(entry.value)} className={category === entry.value ? "category active" : "category"}>{entry.label.toUpperCase()}</button>)}</div>
      </aside><section className="catalog-content" aria-label={`${categoryName} pieces`}><div className="catalog-heading"><h1>{categoryName}</h1><span className="text-[11px] text-neutral-400">{ready ? String(filtered.length).padStart(2, "0") : "—"}</span></div>
        {!ready ? <div className="empty-state" role="status"><Loader2 size={16} className="animate-spin text-neutral-400" /><p className="mt-4 text-neutral-500">Opening wardrobe…</p></div> : filtered.length ? <div className="product-grid">{filtered.map((item) => <button className="product-card" key={item.id} onClick={() => setSelected(item)} aria-label={`View ${item.name}`}><div className="product-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSource(item)} alt={item.name} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.opacity = "0"; event.currentTarget.parentElement?.setAttribute("data-unavailable", "Image unavailable"); }} />
        </div><span className="product-name">{item.name}</span><span className="product-meta">{[item.brand, item.size].filter(Boolean).join(" / ") || item.color || "\u00a0"}</span></button>)}</div> : <div className="empty-state"><p className="font-medium">{items.length ? `No ${categoryName?.toLowerCase()} yet.` : "Your wardrobe is empty."}</p><p className="mt-2 text-[12px] text-neutral-400">{items.length ? "Pieces in this category will appear here." : "Paste a product link to add your first piece."}</p><button className="mt-7 inline-flex items-center gap-3 border-b border-black pb-1 text-[12px]" onClick={() => setView("add")}>Add a piece<ArrowRight size={13} /></button></div>}
      </section></>}
      <div hidden={view !== "add"}><AddPiece onAdded={() => { setCategory("all"); setView("wardrobe"); setNotice("Piece saved."); }} /></div>
      <div hidden={view !== "outfits"}><Outfits onAdd={() => setView("add")} /></div>
    </main>
    {(error || notice || removed) && <div className="notice" role={error ? "alert" : "status"}><span>{error || (removed ? "Piece removed." : notice)}</span>{removed && !error && <button className="underline underline-offset-4" onClick={async () => { try { await saveItem({ ...removed, updatedAt: Date.now(), deletedAt: null }); setRemoved(null); } catch { setNotice("Could not restore the piece. Try again."); } }}>Undo</button>}{!error && <button aria-label="Dismiss notification" onClick={() => { setNotice(""); setRemoved(null); }}><X size={13} /></button>}</div>}
    <nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav-inner"><button className={`nav-button ${view === "wardrobe" ? "current" : ""}`} aria-current={view === "wardrobe" ? "page" : undefined} onClick={() => setView("wardrobe")}>Wardrobe</button><span className="nav-dot" aria-hidden="true">·</span><button className={`nav-button ${view === "add" ? "current" : ""}`} aria-current={view === "add" ? "page" : undefined} onClick={() => setView("add")}>Add</button><span className="nav-dot" aria-hidden="true">·</span><button className={`nav-button ${view === "outfits" ? "current" : ""}`} aria-current={view === "outfits" ? "page" : undefined} onClick={() => setView("outfits")}>Outfits</button><span className="nav-dot" aria-hidden="true">·</span><SyncPopover /></div></nav>
    {selected && <ItemDetail key={selected.id} item={selected} onClose={() => setSelected(null)} onSave={async (item) => { if (useWardrobe.getState().space !== space) throw new Error("The active wardrobe changed. Open this piece again to save."); await saveItem(item); }} onDelete={remove} />}
  </div>;
}
