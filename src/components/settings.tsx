"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Download, Link2, Trash2, X } from "lucide-react";
import { useWardrobe } from "@/lib/store";
import { useSyncStore } from "@/lib/sync";
import { deleteLibrary, readLibrarySnapshot } from "@/lib/db";
import { libraryExport, supportUrl } from "@/lib/library-data";
import { getServerThemePreference, getThemePreference, setThemePreference, subscribeTheme, type ThemePreference } from "@/lib/theme";
import type { RenderCredential } from "@/lib/render-credential";
import { RenderKeySettings } from "./render-key-settings";
import { ShareLinkManager } from "./share-link-manager";
import { InfoTooltip } from "./ui/info-tooltip";
import { Button } from "./ui/button";

const actionClass = "flex min-h-10 items-center justify-between gap-4 text-left text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40";
const contributionLink = supportUrl(process.env.NEXT_PUBLIC_SUPPORT_URL);
export function Settings({ active, credential, onCredentialChange, rendering }: {
  active: boolean; credential: RenderCredential | null; onCredentialChange: (value: RenderCredential | null) => void;
  rendering: boolean;
}) {
  const { space } = useWardrobe();
  const account = space.startsWith("account:");
  const theme = useSyncExternalStore(subscribeTheme, getThemePreference, getServerThemePreference);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [confirmation, setConfirmation] = useState(false);
  const [links, setLinks] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const guard = () => { if (useWardrobe.getState().space !== space) throw new Error("Your active wardrobe changed. Reopen Settings to continue."); };
  async function exportData() {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const snapshot = await readLibrarySnapshot(space, guard);
      const blob = new Blob([JSON.stringify(libraryExport(snapshot), null, 2)], { type: "application/json" });
      guard();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `capsule-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus("Export downloaded.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your export could not be created."); }
    finally { working.current = false; setBusy(false); }
  }
  async function removeData() {
    if (working.current || rendering) return;
    working.current = true; setBusy(true); setError("");
    try {
      guard();
      if (account) {
        if (!navigator.onLine) throw new Error("Connect to the internet before deleting your synced library.");
        const sync = useSyncStore.getState();
        if (!sync.enabled || sync.user?.id !== space.slice(8)) throw new Error("Sign in again through Sync before deleting your library.");
        await sync.syncNow();
        guard();
        const latest = useSyncStore.getState();
        if (latest.user?.id !== space.slice(8) || latest.status !== "idle" || latest.error) throw new Error("Finish syncing before deleting your library. Check Sync and try again.");
      }
      await deleteLibrary(space, guard);
      await useWardrobe.getState().reload();
      guard();
      // Normal durable sync sends the deletion markers; offline retries remain queued.
      if (account) void useSyncStore.getState().syncNow();
      setConfirmation(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your library could not be deleted."); }
    finally { working.current = false; setBusy(false); }
  }
  const locked = busy || rendering;
  return <section className="mx-auto w-full max-w-[560px] pb-8 pt-[30px]" aria-labelledby="settings-heading">
    <h1 id="settings-heading" className="text-[14px]">Settings</h1>
    <div className="mt-10 space-y-10">
      <section><h2 className="text-[12px]">Appearance</h2><div className="mt-3 flex gap-6" role="group" aria-label="Theme">{([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={theme === value} className={`min-h-9 text-[12px] ${theme === value ? 'text-foreground underline underline-offset-4' : 'text-muted-foreground'}`} onClick={() => setThemePreference(value as ThemePreference)}>{label}</button>)}</div></section>
      <RenderKeySettings userId={account ? space.slice(8) : null} sessionKey={credential?.type === "session" ? credential.apiKey : ""} disabled={locked} active={active} onCredentialChange={onCredentialChange} />
      <section><div className="flex items-center gap-1"><h2 className="text-[12px]">Your data</h2><InfoTooltip active={active} label="About your data">Export includes the wardrobe, wishlist and price history, saved photos, outfits, and model photo available in this browser. Sync first to include changes from other devices. API keys and private share-management tokens are excluded. Linked photos that are not saved locally remain URLs.</InfoTooltip></div>
        <p className="mt-2 text-[11px] text-subtle">{account ? "Your account’s library on this device." : "Your library in this browser."}</p>
        <div className="mt-3 flex flex-col"><button className={actionClass} type="button" disabled={locked} onClick={() => void exportData()}>Export data <Download size={13} strokeWidth={1.5} /></button><button className={actionClass} type="button" disabled={locked} onClick={() => { setError(""); setConfirmation(true); }}>Delete library <Trash2 size={13} strokeWidth={1.5} /></button></div>
      </section>
      <section>{links && active ? <ShareLinkManager space={space} onBack={() => setLinks(false)} /> : <><h2 className="text-[12px]">Sharing</h2><button type="button" className={`${actionClass} mt-2 w-full`} onClick={() => setLinks(true)}>Manage share links <Link2 size={13} strokeWidth={1.5} /></button></>}</section>
      <section><h2 className="text-[12px]">Capsule</h2><a className={`${actionClass} mt-2`} href="https://github.com/gtfol/capsule" target="_blank" rel="noopener noreferrer">Source code <ArrowUpRight size={13} strokeWidth={1.5} /></a>{contributionLink && <><a className={actionClass} href={contributionLink} target="_blank" rel="noopener noreferrer">Support Capsule <ArrowUpRight size={13} strokeWidth={1.5} /></a><p className="mt-1 text-[11px] text-subtle">Optional, one-time support for development and hosting.</p></>}</section>
    </div>
    {status && <p className="mt-5 text-[12px] text-subtle" role="status">{status}</p>}{error && !confirmation && <p className="mt-5 text-[12px]" role="alert">{error}</p>}
    <Dialog.Root open={confirmation && active} onOpenChange={(open) => { if (!busy) setConfirmation(open); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/20 dark:bg-black/70" /><Dialog.Content role="alertdialog" className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%_-_40px)] max-w-[390px] -translate-x-1/2 -translate-y-1/2 border border-border bg-background p-7 text-foreground outline-none" onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus(); }}>
      <button ref={cancel} type="button" aria-label="Cancel deletion" disabled={busy} className="absolute right-4 top-4 p-2 text-muted-foreground" onClick={() => setConfirmation(false)}><X size={14} /></button>
      <Dialog.Title className="pr-8 text-[14px]">Delete your library?</Dialog.Title><Dialog.Description className="mt-3 text-[12px] leading-relaxed text-muted-foreground">This removes your wardrobe, wishlist, saved outfits, and this browser’s model photo. {account ? "Deletion syncs to your account and other devices. Conflicting edits on another device may be kept. Your account and saved API key stay." : "This cannot be undone."} Public share links stay available until you remove them in Manage share links. Export anything you want to keep first.</Dialog.Description>
      <Button type="button" className="mt-6 w-full" disabled={busy} onClick={() => void removeData()}>{busy ? "Deleting…" : "Delete library"}</Button>{error && <p role="alert" className="mt-4 text-[12px]">{error}</p>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
