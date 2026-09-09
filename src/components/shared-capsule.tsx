"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { ThemeControl } from "./theme-control";
import { StarRating } from "./star-rating";
import { SharedCopyActions } from "./shared-copy-actions";
import { formatPrice } from "@/lib/wishlist";
import { CATEGORIES } from "@/lib/types";
import type { Category } from "@/lib/types";
import type { SharedPiece, ShareSnapshot } from "@/lib/share-types";
import { readSharedCopyIntent } from "@/lib/shared-copy";
import { useSyncStore } from "@/lib/sync";

function PieceDetails({ piece }: { piece: SharedPiece }) {
  const photos = [
    { label: "Front", data: piece.imageData },
    { label: "Back", data: piece.backImageData },
    { label: "Side", data: piece.sideImageData },
  ].filter((photo): photo is { label: string; data: string } => !!photo.data);
  const [photo, setPhoto] = useState(0);
  return <>
    <div className="detail-image mt-6 aspect-[5/4]"><img src={photos[photo]?.data ?? piece.imageData} alt={`${piece.name}, ${photos[photo]?.label.toLowerCase() ?? "front"}`} className="h-full w-full object-contain" /></div>
    {photos.length > 1 && <div className="image-side-controls mt-4" role="group" aria-label="Image view">{photos.map((entry, index) => <button key={entry.label} type="button" aria-pressed={index === photo} onClick={() => setPhoto(index)}>{entry.label}</button>)}</div>}
    <div className="mt-8 space-y-5">
      {piece.brand && <p className="text-[12px] text-muted-foreground">{piece.brand}</p>}
      {piece.price && <p className="text-[14px]">{formatPrice(piece.price, piece.currency)}</p>}
      {piece.rating !== undefined && piece.rating !== null && <StarRating value={piece.rating} label="Owner’s rating" />}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-[12px]">{[["Category", piece.category], ["Size", piece.size], ["Color", piece.color]].filter(([, value]) => !!value).map(([label, value]) => <div key={label}><dt className="mb-2 text-[11px] text-subtle">{label}</dt><dd className={label === "Category" ? "capitalize" : undefined}>{value}</dd></div>)}</dl>
      {piece.description && <p className="whitespace-pre-line text-[12px] leading-relaxed">{piece.description}</p>}
      {piece.purchaseUrl && <a href={piece.purchaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[12px] underline underline-offset-4">Product link<ArrowUpRight size={13} /></a>}
    </div>
  </>;
}
export function SharedCapsule({ shareId, snapshot, updatedAt, expiresAt }: { shareId: string; snapshot: ShareSnapshot; updatedAt: number; expiresAt: number | null }) {
  const [category, setCategory] = useState<Category | "all">("all");
  const [selected, setSelected] = useState<SharedPiece | null>(null);
  const [{ addTo, piece }, setCopyQuery] = useQueryStates({ addTo: parseAsStringLiteral(["wardrobe", "wishlist"] as const), piece: parseAsString }, { history: "replace", shallow: true, scroll: false });
  const intentKey = `${addTo ?? ""}:${piece ?? ""}`;
  const [handledIntent, setHandledIntent] = useState("");
  const intent = readSharedCopyIntent(`https://capsule.invalid/?${new URLSearchParams({ addTo: addTo ?? "", piece: piece ?? "" })}`, snapshot.pieces.length);
  if (intentKey !== handledIntent) {
    setHandledIntent(intentKey);
    if (intent && typeof intent.selection === "number" && snapshot.kind !== "piece") setSelected(snapshot.pieces[intent.selection]);
  }
  const clearIntent = () => { void setCopyQuery({ addTo: null, piece: null }); };
  useEffect(() => () => useSyncStore.getState().stop(), []);
  const wholeSelection = snapshot.kind === "piece" ? 0 : "all";
  const collection = snapshot.kind === "wardrobe" || snapshot.kind === "wishlist";
  const pieces = snapshot.pieces.filter((piece) => category === "all" || piece.category === category);
  const date = (value: number) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(value);
  const note = <p className="mt-8 text-[11px] leading-relaxed text-subtle">Shared snapshot · Updated {date(updatedAt)}{expiresAt !== null ? ` · Available until ${date(expiresAt)}` : ""}</p>;
  return <div className="min-h-dvh bg-background text-foreground">
    <a className="skip-link" href="#shared-main">Skip to shared pieces</a>
    <main id="shared-main" className={collection ? "catalog-layout" : "mx-auto max-w-5xl px-[30px] pb-28 pt-[30px] max-sm:px-5"}>
      {collection && <aside className="catalog-sidebar" aria-label="Shared collection filters"><p className="mb-6 text-[12px]">{snapshot.kind === "wishlist" ? "Wishlist" : "Wardrobe"}</p><div className="category-list" role="tablist" aria-label="Categories"><button role="tab" aria-selected={category === "all"} onClick={() => setCategory("all")} className={category === "all" ? "category active" : "category"}>ALL</button>{CATEGORIES.map((value) => <button key={value} role="tab" aria-selected={category === value} onClick={() => setCategory(value)} className={category === value ? "category active" : "category"}>{value.toUpperCase()}</button>)}</div></aside>}
      <section className={collection ? "catalog-content" : ""} aria-label={snapshot.title}>
        <div className="catalog-heading"><h1>{snapshot.title}</h1>{collection && <span className="text-[11px] text-subtle">{String(pieces.length).padStart(2, "0")}</span>}</div>
        <div className="mb-8"><SharedCopyActions shareId={shareId} snapshot={snapshot} selection={wholeSelection} initialDestination={intent?.selection === wholeSelection ? intent.destination : null} onIntentClosed={clearIntent} /></div>
        {snapshot.kind === "piece" ? <div className="mx-auto max-w-xl"><PieceDetails piece={snapshot.pieces[0]} /></div> : <>
          {snapshot.kind === "outfit" && <img src={snapshot.outfitImageData} alt={snapshot.title} className="mx-auto mb-10 max-h-[80vh] w-full object-contain" />}
          {pieces.length ? <div className="product-grid">{pieces.map((piece, index) => <button type="button" className="product-card" key={index} aria-label={`View ${piece.name}`} onClick={() => setSelected(piece)}><div className="product-image"><img className="product-image-front" src={piece.imageData} alt={piece.name} loading="lazy" decoding="async" /></div><span className="product-name">{piece.name}</span><span className="product-meta">{piece.brand || "\u00a0"}</span>{piece.price && <span className="mt-1 text-[11px] text-subtle">{formatPrice(piece.price, piece.currency)}</span>}{piece.rating !== undefined && piece.rating !== null && <span className="mt-2"><StarRating value={piece.rating} compact label="Owner’s rating" /></span>}</button>)}</div> : collection ? <p className="py-20 text-[12px] text-muted-foreground">No pieces in this category.</p> : null}
        </>}
        {note}
      </section>
    </main>
    <nav className="bottom-nav" aria-label="Shared capsule"><div className="bottom-nav-inner"><Link href="/" className="nav-button">capsule</Link><span className="nav-dot" aria-hidden="true">•</span><span className="text-muted-foreground">Shared view</span><span className="nav-dot" aria-hidden="true">•</span><ThemeControl /></div></nav>
    {selected && <Sheet open onOpenChange={(open) => { if (!open) { setSelected(null); clearIntent(); } }}><SheetContent><SheetTitle className="pr-9 text-[14px] leading-5">{selected.name}</SheetTitle><SheetDescription className="sr-only">Shared piece details. Add your own copy to your wardrobe or wishlist.</SheetDescription><div className="mt-5"><SharedCopyActions shareId={shareId} snapshot={snapshot} selection={snapshot.pieces.indexOf(selected)} initialDestination={intent?.selection === snapshot.pieces.indexOf(selected) ? intent.destination : null} onIntentClosed={clearIntent} /></div><PieceDetails key={snapshot.pieces.indexOf(selected)} piece={selected} /></SheetContent></Sheet>}
  </div>;
}
