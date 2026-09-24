import { accountSpace, applyReferencePhoto, GUEST_SPACE, readReferencePhotoState, writeReferencePhoto } from "./db";
export type SyncedModelPhoto = { imageData: string | null; revision: number };
async function exchange(userId: string, photo?: { imageData: string | null; expectedRevision: number }): Promise<SyncedModelPhoto> {
  const response = await fetch("/api/model-photo", {
    method: photo ? "PUT" : "GET", cache: "no-store",
    headers: { "X-Capsule-User": userId, ...(photo ? { "Content-Type": "application/json" } : {}) },
    ...(photo ? { body: JSON.stringify(photo) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value?.error?.message || "Your model photo could not sync. Try again."), { status: response.status, code: value?.error?.code });
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !(value.imageData === null || typeof value.imageData === "string")) throw new Error("Your model photo could not be loaded.");
  return value;
}
async function pullReferencePhoto(userId: string): Promise<void> {
  const space = accountSpace(userId), local = await readReferencePhotoState(space);
  let remote = await exchange(userId);
  // Migrate legacy device-only photos once, only into an account that has never
  // stored a photo. A remote tombstone always wins over an old browser copy.
  if (remote.revision === 0 && local.revision === null && local.imageData) {
    try { remote = await exchange(userId, { imageData: local.imageData, expectedRevision: 0 }); }
    catch (error) {
      if ((error as { code?: string }).code !== "REVISION_CONFLICT") throw error;
      remote = await exchange(userId);
    }
  }
  await applyReferencePhoto(space, local, remote);
}
async function pushReferencePhoto(space: string, imageData: string | null): Promise<void> {
  if (space === GUEST_SPACE) return writeReferencePhoto(space, imageData);
  if (!space.startsWith("account:")) throw new Error("Sign in to sync your model photo.");
  const userId = space.slice("account:".length), local = await readReferencePhotoState(space);
  const revision = local.revision ?? (await exchange(userId)).revision;
  try {
    const remote = await exchange(userId, { imageData, expectedRevision: revision });
    await applyReferencePhoto(space, local, remote);
  } catch (error) {
    if ((error as { code?: string }).code === "REVISION_CONFLICT") await pullReferencePhoto(userId);
    throw error;
  }
}

async function photoLock<T>(space: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`capsule-model-photo:${space}`, action);
  return action();
}
export function syncReferencePhoto(userId: string): Promise<void> {
  return photoLock(accountSpace(userId), () => pullReferencePhoto(userId));
}
export function saveReferencePhoto(space: string, imageData: string | null): Promise<void> {
  return photoLock(space, () => pushReferencePhoto(space, imageData));
}
