export type PhotoSide = "front" | "back" | "side";
export type PhotoSlots = { frontId: string; backId: string | null; sideId: string | null };

/** Keep photo assignments exclusive while preserving the required front view. */
export function assignPhotoSlot<T extends PhotoSlots>(current: T, side: PhotoSide, id: string): T {
  const target = `${side}Id` as keyof PhotoSlots;
  const previous = current[target];
  if (previous === id || !id) return current;
  if (side !== "front" && !previous && current.frontId === id) return current;
  const other = (["frontId", "backId", "sideId"] as const).find((key) => key !== target && current[key] === id);
  return { ...current, [target]: id, ...(other ? { [other]: previous } : {}) };
}
