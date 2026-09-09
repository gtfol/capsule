import type { ShareSnapshot } from "./share-types";

export const MAX_SHARE_OWNER_NAME = 100;

export function shareOwnerName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_SHARE_OWNER_NAME) || undefined;
}

export function sharedHeading(snapshot: Pick<ShareSnapshot, "kind" | "title" | "ownerName">): string {
  if (snapshot.ownerName && (snapshot.kind === "wardrobe" || snapshot.kind === "wishlist")) {
    return `${snapshot.ownerName}’s ${snapshot.kind}`;
  }
  return snapshot.title;
}
