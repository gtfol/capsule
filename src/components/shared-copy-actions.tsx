"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { authClient } from "@/lib/auth-client";
import { useSyncStore } from "@/lib/sync";
import { useWardrobe } from "@/lib/store";
import { copySharedPieces, selectedSharedPieces, sharedCopyReturnUrl, type SharedCopyDestination, type SharedCopySelection } from "@/lib/shared-copy";
import { previewSharedPieces, type SharedImportResult } from "@/lib/piece-identity";
import { collectionPieceUrl } from "@/lib/navigation";
import type { ShareSnapshot } from "@/lib/share-types";

type Props = { shareId: string; snapshot: ShareSnapshot; selection: SharedCopySelection; initialDestination?: SharedCopyDestination | null; onIntentClosed?: () => void };

export function SharedCopyActions({ shareId, snapshot, selection, initialDestination, onIntentClosed }: Props) {
  const { space, ready, items, wishlist, error: storageError } = useWardrobe();
  const user = useSyncStore((state) => state.user);
  const previews = useMemo(() => {
    if (!user || !ready || storageError || space !== `account:${user.id}`) return null;
    const pieces = selectedSharedPieces(snapshot, selection);
    return { wardrobe: previewSharedPieces(pieces, items), wishlist: previewSharedPieces(pieces, wishlist) };
  }, [user, ready, storageError, space, snapshot, selection, items, wishlist]);
  const [destination, setDestination] = useState<SharedCopyDestination>(initialDestination ?? "wardrobe");
  const [open, setOpen] = useState(Boolean(initialDestination));
  const [handledIntent, setHandledIntent] = useState(initialDestination);
  if (initialDestination !== handledIntent) {
    setHandledIntent(initialDestination);
    if (initialDestination) { setDestination(initialDestination); setOpen(true); }
  }
  const count = selection === "all" ? snapshot.pieces.length : snapshot.pieces[selection] ? 1 : 0;
  function close(value: boolean) {
    setOpen(value);
    if (!value) onIntentClosed?.();
  }
  if (!count) return null;
  return <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
    {(["wardrobe", "wishlist"] as const).map((target) => previews?.[target].added === 0 && !open
      ? <Link key={target} href={collectionPieceUrl(target, count === 1 ? previews[target].matches[0]?.id : undefined)} className="py-1 text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground">Already in your {target}</Link>
      : <Popover key={target} open={open && destination === target} onOpenChange={(value) => { if (value) setDestination(target); close(value); }}>
      <PopoverTrigger asChild><button type="button" className="py-1 text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground">Add to my {target}</button></PopoverTrigger>
      {open && destination === target && <CopyConfirmation key={`${space}:${target}`} shareId={shareId} snapshot={snapshot} selection={selection} destination={target} />}
    </Popover>)}
  </div>;
}

function CopyConfirmation({ shareId, snapshot, selection, destination }: Omit<Props, "initialDestination" | "onIntentClosed"> & { destination: SharedCopyDestination }) {
  const sync = useSyncStore();
  const { items, wishlist, ready, error: storageError } = useWardrobe();
  const preview = useMemo(() => previewSharedPieces(selectedSharedPieces(snapshot, selection), destination === "wardrobe" ? items : wishlist), [snapshot, selection, destination, items, wishlist]);
  const alive = useRef(false);
  const actionRunning = useRef(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<SharedImportResult | null>(null);
  const [reload, setReload] = useState(0);
  const count = selectedSharedPieces(snapshot, selection).length;
  const noun = preview.added === 1 ? "piece" : "pieces";
  const optionClass = "w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-40";

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    void useSyncStore.getState().initialize().catch(() => {
      if (!cancelled) setError("Sign-in could not be checked. Try again.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [reload]);

  async function google() {
    if (actionRunning.current) return;
    actionRunning.current = true; setWorking(true); setError("");
    try {
      const response = await authClient.signIn.social({ provider: "google", callbackURL: sharedCopyReturnUrl(window.location.href, { destination, selection }) });
      if (response.error) throw new Error(response.error.message || "Sign-in could not start.");
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Sign-in could not start."); }
    finally { actionRunning.current = false; if (alive.current) setWorking(false); }
  }

  async function emailAuth(event: React.FormEvent) {
    event.preventDefault();
    if (actionRunning.current) return;
    actionRunning.current = true; setWorking(true); setError("");
    try {
      const response = register ? await authClient.signUp.email({ email, password, name: name.trim() || email.split("@")[0] }) : await authClient.signIn.email({ email, password });
      if (response.error) throw new Error(response.error.message || "Sign-in failed.");
      if (alive.current) setPassword("");
      await useSyncStore.getState().refreshSession();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Sign-in failed."); }
    finally { actionRunning.current = false; if (alive.current) setWorking(false); }
  }

  async function add() {
    if (actionRunning.current || !sync.user) return;
    const userId = sync.user.id;
    const space = useWardrobe.getState().space;
    actionRunning.current = true; setWorking(true); setError("");
    try {
      const outcome = await copySharedPieces({ shareId, shownSnapshot: snapshot, selection, destination, expectedUserId: userId });
      if (!alive.current || useSyncStore.getState().user?.id !== userId || useWardrobe.getState().space !== space) return;
      setResult(outcome);
      void useWardrobe.getState().reload();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "These pieces could not be added. Try again."); }
    finally { actionRunning.current = false; if (alive.current) setWorking(false); }
  }

  return <PopoverContent side="bottom" align="start" sideOffset={8} className="w-72 p-3" aria-label={`Add to my ${destination}`}>
    {loading || (sync.user && !ready) ? <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground" role="status"><Loader2 size={13} className="animate-spin" aria-hidden="true" />Checking your {destination}…</p> : result ? <div className="space-y-3 px-1">
      <p className="text-[13px]" role="status">{result.alreadyAdded ? `${count === 1 ? "This piece is" : "These pieces are"} already in your ${destination}.` : `Added ${result.count} ${result.count === 1 ? "piece" : "pieces"} to your ${destination}.`}</p>
      {!result.alreadyAdded && result.skipped > 0 && <p className="text-xs text-muted-foreground">{result.skipped} already in your {destination}. Skipped.</p>}
      <Link href={collectionPieceUrl(destination, count === 1 ? result.itemIds[0] : undefined)} className="inline-block py-1 text-[12px] underline underline-offset-4">{count === 1 ? "View piece" : `Open my ${destination}`}</Link>
    </div> : sync.user ? <div className="space-y-3 px-1">
      <h2 className="text-[13px] font-normal">{preview.added ? `Add to my ${destination}` : `Already in your ${destination}`}</h2>
      {preview.added > 0 && <>
        <p className="text-xs leading-relaxed text-muted-foreground">{preview.added} shared {noun} will be saved to your {destination}.{snapshot.kind === "outfit" ? " The rendered outfit image stays in this shared view." : ""}</p>
      </>}
      {preview.skipped > 0 && preview.added > 0 && <p className="text-xs leading-relaxed text-muted-foreground">{preview.skipped} already in your {destination}. {preview.skipped === 1 ? "It will be skipped." : "These will be skipped."}</p>}
      <p className="truncate text-[11px] text-subtle" title={sync.user.email}>Signed in as {sync.user.email}</p>
      {storageError ? <p className="text-xs" role="alert">Your {destination} could not be checked. Reload the page and try again.</p> : preview.added === 0
        ? <Link href={collectionPieceUrl(destination, count === 1 ? preview.matches[0]?.id : undefined)} className="inline-block py-1 text-[12px] underline underline-offset-4">{count === 1 ? "View piece" : `Open my ${destination}`}</Link>
        : <Button type="button" disabled={working} className="w-full" onClick={() => void add()}>{working ? <><Loader2 size={13} className="animate-spin" aria-hidden="true" />Adding…</> : `Add ${preview.added} ${noun}`}</Button>}
    </div> : <div className="flex flex-col gap-1">
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">Sign in to add {count === 1 ? "this piece" : `these ${count} pieces`} to your {destination}.</p>
      {sync.enabled && sync.providers.google && <button type="button" className={optionClass} disabled={working || sync.status === "offline"} onClick={() => void google()}>{working ? "Connecting…" : "Continue with Google"}</button>}
      {sync.enabled && sync.providers.email && !showEmail && <button type="button" className={optionClass} disabled={working} onClick={() => setShowEmail(true)}>Continue with email</button>}
      {sync.enabled && sync.providers.email && showEmail && <form className="space-y-3 px-1 pt-2" onSubmit={emailAuth}>
        {register && <label className="field-label">Name<Input value={name} disabled={working} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
        <label className="field-label">Email<Input type="email" autoComplete="email" required disabled={working} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="field-label">Password<Input type="password" required minLength={8} autoComplete={register ? "new-password" : "current-password"} disabled={working} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className={optionClass} type="submit" disabled={working}>{working ? "Connecting…" : register ? "Create account" : "Sign in"}</button>
        <button type="button" disabled={working} className="text-xs text-muted-foreground" onClick={() => setRegister(!register)}>{register ? "Use an existing account" : "Create an account"}</button>
      </form>}
      {(!sync.enabled || (!sync.providers.google && !sync.providers.email)) && <p className="mt-2 px-1 text-xs text-muted-foreground">Sign-in is not available right now.</p>}
      {sync.status === "error" && <button type="button" className={optionClass} onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }}>Try again</button>}
    </div>}
    {(error || (!loading && sync.error && !sync.user)) && <p className="mt-3 px-1 text-xs leading-relaxed" role="alert">{error || sync.error}</p>}
    {error.includes("Refresh the page") && <button type="button" className="mt-3 px-1 text-xs underline underline-offset-4" onClick={() => window.location.reload()}>Refresh shared page</button>}
  </PopoverContent>;
}
