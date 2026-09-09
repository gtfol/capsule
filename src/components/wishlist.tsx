"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, Link2Off, Loader2, Plus, X } from "lucide-react";
import { CATEGORIES } from "./item-detail";
import { ProductImages } from "./product-images";
import { StarRating } from "./star-rating";
import { WishlistDetail } from "./wishlist-detail";
import { Notice } from "./notice";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useWardrobe } from "@/lib/store";
import { applyPriceFetch, formatPrice, priceDropPercent } from "@/lib/wishlist";
import { mergeWishlistEdits } from "@/lib/wishlist-editor";
import type { Category, WishlistItem } from "@/lib/types";

type Sort = "recent" | "rating" | "drop";
const SORTS: { value: Sort; label: string }[] = [{ value: "recent", label: "Recently added" }, { value: "rating", label: "Highest rated" }, { value: "drop", label: "Biggest price drop" }];

export function Wishlist({ onAdd, onMoved, active = true }: { onAdd: () => void; onMoved: () => void; active?: boolean }) {
  const { wishlist, ready, space, updateWishlistItem, deleteWishlistItem, saveWishlistItem, moveWishlistToWardrobe } = useWardrobe();
  const [category, setCategory] = useState<Category | "all">("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<WishlistItem | null>(null);
  const [removed, setRemoved] = useState<WishlistItem | null>(null);
  const [error, setError] = useState("");
  const filtered = useMemo(() => wishlist.filter((item) => category === "all" || item.category === category).toSorted((a, b) => {
    if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0) || b.createdAt - a.createdAt;
    if (sort === "drop") return (priceDropPercent(b) ?? -Infinity) - (priceDropPercent(a) ?? -Infinity) || b.createdAt - a.createdAt;
    return b.createdAt - a.createdAt;
  }), [wishlist, category, sort]);
  return <>
    <aside className="catalog-sidebar" aria-label="Wishlist filters"><Popover open={active && filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><button className="filter-trigger"><span>Filter &amp; Sort</span><Plus size={12} strokeWidth={1.5} /></button></PopoverTrigger><PopoverContent align="start" side="bottom" className="w-48 p-4"><p className="mb-3 text-[11px] text-subtle">SORT BY</p>{SORTS.map((option) => <button className="flex w-full items-center justify-between py-2 text-left text-[12px]" key={option.value} aria-pressed={sort === option.value} onClick={() => setSort(option.value)}>{option.label}{sort === option.value && <Check size={12} />}</button>)}</PopoverContent></Popover>
      <div className="category-list" role="tablist" aria-label="Wishlist categories"><button role="tab" aria-selected={category === "all"} onClick={() => setCategory("all")} className={category === "all" ? "category active" : "category"}>ALL</button>{CATEGORIES.map((entry) => <button key={entry.value} role="tab" aria-selected={category === entry.value} onClick={() => setCategory(entry.value)} className={category === entry.value ? "category active" : "category"}>{entry.label.toUpperCase()}</button>)}</div>
    </aside>
    <section className="catalog-content" aria-label="Wishlist pieces"><div className="catalog-heading"><h1>Wishlist{category !== "all" ? ` / ${CATEGORIES.find((entry) => entry.value === category)?.label}` : ""}</h1><div className="flex items-center gap-6"><span className="text-[11px] text-subtle">{ready ? String(filtered.length).padStart(2, "0") : "—"}</span><button type="button" onClick={onAdd} className="text-muted-foreground hover:text-foreground" aria-label="Add to wishlist"><Plus size={15} strokeWidth={1.5} /></button></div></div>
      {!ready ? <div className="empty-state" role="status"><Loader2 size={16} className="animate-spin text-subtle" /><p className="mt-4 text-muted-foreground">Opening wishlist…</p></div> : filtered.length ? <div className="product-grid">{filtered.map((item) => <button type="button" className="product-card" key={item.id} onClick={() => setSelected(item)} aria-label={`View ${item.name}`}><ProductImages item={item} /><span className="product-name">{item.name}</span><span className="product-meta">{formatPrice(item.price, item.currency)}</span><span className="mt-2 flex w-full items-center justify-between gap-3"><StarRating value={item.rating} compact />{item.link_broken && <span title="A listing could not be fetched" aria-label="Link unavailable"><Link2Off size={13} strokeWidth={1.5} className="text-muted-foreground" /></span>}</span></button>)}</div> : <div className="empty-state"><p>{wishlist.length ? "No pieces in this category." : "Your wishlist is empty."}</p><p className="mt-2 text-[12px] text-subtle">Save a product link to keep its details and prices.</p><button className="mt-7 inline-flex items-center gap-3 border-b border-foreground pb-1 text-[12px]" onClick={onAdd}>Add to wishlist<ArrowRight size={13} /></button></div>}
    </section>
    {(removed || error) && <Notice role={error ? "alert" : "status"} autoDismiss={false} onDismiss={() => { setRemoved(null); setError(""); }}><span>{error || "Removed from wishlist."}</span>{removed && <button className="underline underline-offset-4" onClick={async () => { try { await saveWishlistItem({ ...removed, deletedAt: null, updatedAt: Date.now() }); setRemoved(null); setError(""); } catch { setError("This piece could not be restored. Try again."); } }}>Undo</button>}<button aria-label="Dismiss notification" onClick={() => { setRemoved(null); setError(""); }}><X size={13} /></button></Notice>}
    {selected && <WishlistDetail key={selected.id} active={active} item={selected} onClose={() => setSelected(null)} onSave={async (edited) => { const saved = await updateWishlistItem(edited.id, (current) => mergeWishlistEdits(current, edited), space); if (!saved) throw new Error("This wishlist piece was removed. Close the panel to continue."); }} onPriceChange={(url, result) => updateWishlistItem(selected.id, (current) => applyPriceFetch(current, url, result), space)} onDelete={async () => { const removedItem = await deleteWishlistItem(selected.id, space); if (removedItem) setRemoved(removedItem); }} onMove={async (edited) => { const moved = await moveWishlistToWardrobe(edited.id, space, (current) => mergeWishlistEdits(current, edited)); if (!moved) throw new Error("This piece is no longer in your wishlist."); setRemoved(null); onMoved(); }} />}
  </>;
}
