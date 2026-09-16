"use client";

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Download, Trash2, X } from "lucide-react";
import { useWardrobe } from "@/lib/store";
import { useSyncStore } from "@/lib/sync";
import { deleteLibrary, forgetDeletedAccount, readLibrarySnapshot } from "@/lib/db";
import { libraryExport } from "@/lib/library-data";
import { listShareRecords } from "@/lib/share-client";
import type { RenderCredential } from "@/lib/render-credential";
import { SupportLink } from "./support-link";
import { IntegrationSettings } from "./integration-settings";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { RenderKeySettings, useRenderKeyController } from "./render-key-settings";
import { InfoTooltip } from "./ui/info-tooltip";
import { Button } from "./ui/button";

const actionClass = "flex min-h-10 items-center justify-between gap-4 text-left text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-40";
export function Settings({ active, onClose, credential, onCredentialChange, rendering }: {
  active: boolean; onClose: () => void; credential: RenderCredential | null; onCredentialChange: (value: RenderCredential | null) => void;
  rendering: boolean;
}) {
  const { space } = useWardrobe();
  const account = space.startsWith("account:");
  const [confirmationText, setConfirmationText] = useState("");
  const confirmedDeletion = useRef(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
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
        if (confirmationText !== "DELETE") return;
        if (!confirmedDeletion.current) {
          if (!navigator.onLine) throw new Error("Connect to the internet before deleting your account.");
          const sync = useSyncStore.getState();
          if (sync.user?.id !== space.slice(8)) throw new Error("Sign in again through Sync before deleting your account.");
          const links = await listShareRecords(space);
          guard();
          const response = await fetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUserId: space.slice(8), confirmation: "DELETE", links: links.map(({ record }) => ({ id: record.id, token: record.token })) }), signal: AbortSignal.timeout(30_000) });
          const result = await response.json();
          if (!response.ok || result.deleted !== true || result.userId !== space.slice(8)) throw new Error(result.error || "Your account deletion could not be confirmed.");
          confirmedDeletion.current = true;
        }
        await forgetDeletedAccount(space);
      } else {
        await deleteLibrary(space, guard);
        await useWardrobe.getState().reload();
      }
      setConfirmation(false);
    } catch (cause) { setError(confirmedDeletion.current ? "Your account was deleted, but this browser’s copy could not be cleared. Retry to finish clearing it." : cause instanceof Error ? cause.message : "Your data could not be deleted."); }
    finally { working.current = false; setBusy(false); }
  }
  const locked = busy || rendering;
  // Keep key state and requests alive while the dialog content is unmounted.
  const keyController = useRenderKeyController({ userId: account ? space.slice(8) : null, disabled: locked, onCredentialChange });
  return <Sheet open={active} onOpenChange={(open) => { if (!open && !busy) onClose(); }}><SheetContent aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); opener.current = document.activeElement as HTMLElement; heading.current?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); (opener.current?.isConnected && opener.current !== document.body ? opener.current : document.querySelector<HTMLButtonElement>('[data-settings-trigger]'))?.focus(); }}>
    <SheetTitle ref={heading} tabIndex={-1} className="pr-10 text-[14px] outline-none">Settings</SheetTitle>
    <div className="mt-8 space-y-8">
      <RenderKeySettings controller={keyController} userId={account ? space.slice(8) : null} sessionKey={credential?.type === "session" ? credential.apiKey : ""} disabled={locked} active={active} onCredentialChange={onCredentialChange} />
      <IntegrationSettings userId={account ? space.slice(8) : null} active={active} disabled={locked} />
      <section><div className="flex items-center gap-1"><h2 className="text-[13px]">Your data</h2><InfoTooltip active={active} label="About your data">Export includes the wardrobe, wishlist and price history, saved photos, outfits, and model photo available in this browser. Sync first to include changes from other devices. API keys and private share-management tokens are excluded. Linked photos that are not saved locally remain URLs.</InfoTooltip></div>
        <p className="mt-2 text-[11px] text-subtle">{account ? "Your account’s data on this device." : "Saved in this browser."}</p>
        <div className="mt-3 flex flex-col"><button className={actionClass} type="button" disabled={locked} onClick={() => void exportData()}>Export data <Download size={13} strokeWidth={1.5} /></button><button className={actionClass} type="button" disabled={locked} onClick={() => { setError(""); setConfirmationText(""); setConfirmation(true); }}>{account ? "Delete account" : "Clear browser data"} <Trash2 size={13} strokeWidth={1.5} /></button></div>
      </section>
      <section><a className={`${actionClass} mt-2`} href="https://github.com/gtfol/capsule" target="_blank" rel="noopener noreferrer">Source code <ArrowUpRight size={13} strokeWidth={1.5} /></a><SupportLink className={actionClass} /></section>
    </div>
    {status && <p className="mt-5 text-[13px] text-subtle" role="status">{status}</p>}{error && !confirmation && <p className="mt-5 text-[13px]" role="alert">{error}</p>}
    <Dialog.Root open={confirmation && active} onOpenChange={(open) => { if (!busy) setConfirmation(open); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/20 dark:bg-black/70" /><Dialog.Content role="alertdialog" className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%_-_40px)] max-w-[390px] -translate-x-1/2 -translate-y-1/2 border border-border bg-background p-7 text-foreground outline-none" onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus(); }}>
      <button ref={cancel} type="button" aria-label="Cancel deletion" disabled={busy} className="absolute right-4 top-4 p-2 text-muted-foreground" onClick={() => setConfirmation(false)}><X size={14} /></button>
      <Dialog.Title className="pr-8 text-[14px]">{account ? "Delete your account?" : "Clear browser data?"}</Dialog.Title><Dialog.Description className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{account ? "Permanently deletes your account, synced wardrobe, wishlist, outfits, saved API key, integration tokens, and this browser’s account data. Share links managed by this browser are revoked. Offline copies and links created on other browsers remain there. Guest data is separate." : "Permanently removes this browser’s guest wardrobe, wishlist, saved outfits, and model photo. Public share links remain available; manage them through Share."} Export anything you want to keep first.</Dialog.Description>
      {account && <label className="mt-5 block text-[12px] text-muted-foreground">Type DELETE to confirm<input className="field-input mt-2" value={confirmationText} disabled={busy} autoComplete="off" onChange={(event) => setConfirmationText(event.target.value)} /></label>}
      <Button type="button" className="mt-6 w-full" disabled={busy || (account && confirmationText !== "DELETE")} onClick={() => void removeData()}>{busy ? "Deleting…" : account ? "Delete account" : "Clear browser data"}</Button>{error && <p role="alert" className="mt-4 text-[13px]">{error}</p>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </SheetContent></Sheet>;
}
