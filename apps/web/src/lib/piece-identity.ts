import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Item } from "./types";

export const SOURCE_KEY_PATTERN = /^[a-f0-9]{64}$/;

/** A public matching hint, never an ownership credential or a raw local ID. */
export function pieceSourceKey(piece: Pick<Item, "id" | "sourceKey">): string {
  return piece.sourceKey && SOURCE_KEY_PATTERN.test(piece.sourceKey)
    ? piece.sourceKey
    : bytesToHex(sha256(new TextEncoder().encode(`capsule-piece-v1:${piece.id}`)));
}

type MatchablePiece = Pick<Item, "sourceKey" | "purchaseUrl" | "category" | "size" | "color"> & {
  sources?: { url: string }[];
};
const variant = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const tracking = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|srsltid|_ga|_gl)$/i;

/** Keep product/variant parameters and fragments; discard only known tracking. */
export function productLinkKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    for (const name of [...url.searchParams.keys()]) if (tracking.test(name)) url.searchParams.delete(name);
    url.searchParams.sort();
    return `${url.host}${url.pathname.replace(/\/$/, "")}${url.search}${url.hash}`;
  } catch { return null; }
}

function links(piece: MatchablePiece): string[] {
  return [piece.purchaseUrl, ...(piece.sources?.map((source) => source.url) ?? [])]
    .map(productLinkKey).filter((key): key is string => key !== null);
}

export function findDuplicatePiece<T extends Item>(piece: MatchablePiece, existing: T[]): T | undefined {
  const live = existing.filter((item) => !item.deletedAt);
  if (piece.sourceKey && SOURCE_KEY_PATTERN.test(piece.sourceKey)) {
    const identity = live.find((item) => pieceSourceKey(item) === piece.sourceKey);
    if (identity) return identity;
  }
  const productLinks = new Set(links(piece));
  if (!productLinks.size) return undefined;
  // Missing size/color only match another missing value; unknown variants
  // must not hide a potentially different piece. Names are never compared.
  return live.find((item) => item.category === piece.category
    && variant(item.size) === variant(piece.size) && variant(item.color) === variant(piece.color)
    && links(item).some((key) => productLinks.has(key)));
}

/** Include earlier new pieces, so an overlapping bulk selection is also unique. */
export function previewSharedPieces(pieces: MatchablePiece[], existing: Item[]) {
  const candidates = [...existing];
  const matches = pieces.map((piece, index) => {
    const match = findDuplicatePiece(piece, candidates);
    if (!match) candidates.push({ ...piece, id: `selection:${index}`, name: "", brand: "", price: "", currency: "", description: "", imageUrl: "", createdAt: 0, updatedAt: 0 });
    return match ?? null;
  });
  return { matches, added: matches.filter((match) => !match).length, skipped: matches.filter(Boolean).length };
}

export interface SharedImportResult {
  count: number;
  skipped: number;
  alreadyAdded: boolean;
  itemIds: string[];
}
