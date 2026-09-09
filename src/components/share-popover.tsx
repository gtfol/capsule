"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, Link2Off, List, Loader2, RefreshCw, Save, Share2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconAction } from "@/components/ui/icon-action";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ShareLinkManager } from "@/components/share-link-manager";
import { useWardrobe } from "@/lib/store";
import { useSyncStore } from "@/lib/sync";
import { DEFAULT_SHARE_EXPIRY, type ShareExpiry } from "@/lib/share-types";
import {
  changeShareExpiry,
  createShareLink,
  currentShareOwnerName,
  readShareRecord,
  refreshShareRecord,
  removeShareLink,
  shareTargetKey,
  shareTargetVersion,
  shareUrl,
  updateShareLink,
  type ShareRecord,
  type ShareTarget,
} from "@/lib/share-client";

type Props = { target: ShareTarget; active?: boolean; disabled?: boolean; disabledReason?: string; appearance?: "nav" | "icon" };
type ShareMutation = "create" | "update" | "expiry" | "remove";

function targetLabel(target: ShareTarget) {
  return target.kind === "piece" ? "piece" : target.kind;
}

function snapshotDescription(target: ShareTarget) {
  if (target.kind === "piece") return "Includes this piece’s photos and saved details.";
  const count = target.pieces.length;
  if (target.kind === "outfit") return `Includes the rendered outfit and ${count} selected ${count === 1 ? "piece" : "pieces"}. Your original model photo stays private.`;
  return `Includes your full ${target.kind}: ${count} ${count === 1 ? "piece" : "pieces"}, with front photos and saved details.`;
}

export function SharePopover({ target, active = true, disabled = false, disabledReason, appearance = "icon" }: Props) {
  const space = useWardrobe((state) => state.space);
  const [open, setOpen] = useState(false);
  if ((!active || disabled) && open) setOpen(false);
  const targetKey = shareTargetKey(target);
  const label = targetLabel(target);
  return <Popover open={open && active && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" disabled={disabled} title={disabled && disabledReason ? disabledReason : `Share ${label}`} aria-label={`Share ${label}`} className={appearance === "nav" ? "nav-button disabled:opacity-40" : "inline-flex shrink-0 items-center justify-center p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-40"}>{appearance === "nav" ? "Share" : <Share2 size={14} strokeWidth={1.5} aria-hidden="true" />}</button></PopoverTrigger>
    {open && active && !disabled && <ShareSession key={`${space}:${targetKey}`} space={space} targetKey={targetKey} target={target} appearance={appearance} />}
  </Popover>;
}

function ShareSession({ space, targetKey, target, appearance }: { space: string; targetKey: string; target: ShareTarget; appearance: "nav" | "icon" }) {
  const user = useSyncStore((state) => state.user);
  const ownerName = user ? currentShareOwnerName() : undefined;
  const titleId = useId();
  const descriptionId = useId();
  const expiryId = useId();
  const alive = useRef(false);
  const mutationRunning = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [record, setRecord] = useState<ShareRecord | null>(null);
  const [expiry, setExpiry] = useState<ShareExpiry>(DEFAULT_SHARE_EXPIRY);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ShareMutation | null>(null);
  const [completed, setCompleted] = useState<ShareMutation | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const [managing, setManaging] = useState(false);
  const canPublish = target.kind === "piece" || target.kind === "outfit" || target.pieces.length > 0;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/share", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error("Sharing could not be checked. Try again.");
        const config: { enabled?: boolean } = await response.json();
        const local = await readShareRecord(space, targetKey);
        const current = config.enabled && local ? await refreshShareRecord(space, targetKey, local) : local;
        if (controller.signal.aborted || !alive.current) return;
        setEnabled(config.enabled === true);
        setRecord(current);
        setExpiry(current?.expiry ?? DEFAULT_SHARE_EXPIRY);
        if (local && !current) setStatus("This link has expired or been removed. You can create a new one.");
      } catch (cause) {
        if (!controller.signal.aborted && alive.current) setError(cause instanceof Error ? cause.message : "Sharing could not be checked. Try again.");
      } finally {
        if (!controller.signal.aborted && alive.current) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [space, targetKey, reload]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => { setCopied(false); setStatus(""); }, 2_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!completed) return;
    const timer = window.setTimeout(() => { setCompleted(null); setStatus(""); }, 2_500);
    return () => window.clearTimeout(timer);
  }, [completed]);

  async function mutate(action: NonNullable<typeof busy>) {
    if (mutationRunning.current || busy || loading || !enabled || ((action === "create" || action === "update") && !canPublish)) return;
    mutationRunning.current = true;
    setBusy(action); setError(""); setStatus(""); setCopied(false); setCompleted(null);
    try {
      let next: ShareRecord | null;
      if (action === "create") next = await createShareLink(space, target, expiry);
      else {
        if (!record) return;
        if (action === "remove") { await removeShareLink(space, targetKey, record); next = null; }
        else if (action === "expiry") next = await changeShareExpiry(space, targetKey, record, expiry);
        // Updating the snapshot does not silently apply an unsaved expiry choice.
        else next = await updateShareLink(space, target, record);
      }
      if (!alive.current) return;
      setRecord(next);
      if (action !== "update") setExpiry(next?.expiry ?? DEFAULT_SHARE_EXPIRY);
      setCompleted(action);
      setStatus(action === "remove" ? "Link removed. It can no longer be opened." : action === "expiry" ? "Expiry saved." : action === "update" ? "Link updated with your saved changes." : "Link created.");
      if (action === "create" && next && !next.pending) {
        try {
          // Use the confirmed response, not the previous render's empty URL.
          await navigator.clipboard.writeText(shareUrl(next.id));
          if (alive.current) { setCompleted(null); setCopied(true); setStatus("Link created and copied."); }
        } catch {
          if (alive.current) {
            setCompleted(null);
            setStatus("Link created. Use the copy icon or select and copy the link above.");
          }
        }
      }
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : "The link could not be changed. Try again.");
      // A create request may have reached the server before its response was
      // lost. Keep its locally reserved ownership record available for retry.
      try {
        const current = await readShareRecord(space, targetKey);
        if (alive.current) setRecord(current);
      } catch { /* Keep the previous record when browser storage is unavailable. */ }
    } finally {
      mutationRunning.current = false;
      if (alive.current) setBusy(null);
    }
  }

  const confirmed = record && !record.pending ? record : null;
  const url = confirmed ? shareUrl(confirmed.id) : "";
  const changed = confirmed && confirmed.sourceVersion !== shareTargetVersion(target);
  async function copyLink() {
    if (!url) return;
    setCompleted(null); setCopied(false); setStatus("");
    try {
      await navigator.clipboard.writeText(url);
      if (alive.current) { setCopied(true); setStatus("Link copied."); }
    } catch {
      if (alive.current) {
        linkInput.current?.focus(); linkInput.current?.select();
        setStatus("Select and copy the link above.");
      }
    }
  }

  const panelClass = `w-[min(340px,calc(100vw-32px))] ${appearance === "nav" ? "p-3" : "p-5"}`;
  if (managing) return <PopoverContent align={appearance === "nav" ? "center" : "end"} side={appearance === "nav" ? "top" : "bottom"} sideOffset={8} className={panelClass} aria-label="Manage share links"><ShareLinkManager space={space} onBack={() => { setManaging(false); setLoading(true); setError(""); setStatus(""); setCopied(false); setCompleted(null); setReload((value) => value + 1); }} /></PopoverContent>;

  return <PopoverContent ref={panel} tabIndex={-1} align={appearance === "nav" ? "center" : "end"} side={appearance === "nav" ? "top" : "bottom"} sideOffset={8} className={panelClass} aria-labelledby={titleId} aria-describedby={descriptionId} onOpenAutoFocus={(event) => { event.preventDefault(); panel.current?.focus(); }}>
    <div className="flex items-center gap-1"><h2 id={titleId} className="text-[13px] font-normal">Share {targetLabel(target)}</h2><InfoTooltip label="About this share link">{snapshotDescription(target)}{ownerName ? ` Your name, ${ownerName}, appears on the shared page.` : ""} Changes appear only when you update the link.</InfoTooltip></div>
    <p id={descriptionId} className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{target.kind === "wardrobe" || target.kind === "wishlist" ? `Anyone with the link can view your full ${target.kind}.` : "Anyone with the link can view it."}</p>
    {loading ? <p role="status" className="mt-5 flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 size={13} className="animate-spin" aria-hidden="true" />Checking share link…</p> : <>
      {!enabled && !error && <p role="status" className="mt-5 text-[12px] text-muted-foreground">Sharing is not available right now.</p>}
      {confirmed && <div className="mt-5">
        <div className="flex items-center gap-3 border-b border-border pb-2"><input ref={linkInput} type="text" readOnly value={url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground" /><IconAction label={copied ? "Link copied" : "Copy share link"} icon={Copy} complete={copied} disabled={!!busy} onClick={() => void copyLink()} /></div>
        <p className="mt-2 text-[11px] text-subtle">{confirmed.expiresAt === null ? "Never expires." : `Expires ${new Date(confirmed.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`}</p>
      </div>}
      {enabled && <>
        {record?.pending && <p className="mt-5 text-[12px] leading-relaxed text-muted-foreground">Link creation has not been confirmed. Retry to finish, or remove it.</p>}
        <div className="mt-5 flex items-center justify-between gap-4"><label htmlFor={expiryId} className="text-[12px] text-muted-foreground">Expires</label><select id={expiryId} value={expiry} disabled={!!busy} onChange={(event) => { setExpiry(event.target.value as ShareExpiry); setStatus(""); }} className="max-w-40 border-b border-border bg-background px-1 py-1 text-[12px] font-normal outline-none focus-visible:border-foreground disabled:opacity-40"><option value="7d">After 7 days</option><option value="30d">After 30 days</option><option value="never">Never</option></select></div>
        {!canPublish && <p className="mt-4 text-[11px] text-subtle">Add a piece before {confirmed ? "updating" : "creating"} this link.</p>}
        {!confirmed && <Button type="button" className="mt-5 w-full" disabled={!!busy || !canPublish} onClick={() => void mutate("create")}>{busy === "create" ? <><Loader2 size={13} className="animate-spin" aria-hidden="true" />Creating link…</> : record?.pending ? "Retry creating link" : "Create link"}</Button>}
      </>}
    </>}
    {error && <div className="mt-4"><p role="alert" className="text-[12px] leading-relaxed">{error}</p>{!enabled && !loading && <button type="button" className="mt-3 text-[12px] underline underline-offset-4" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }}>Try again</button>}</div>}
    {status && <p role="status" className={completed || copied ? "sr-only" : "mt-4 text-[11px] leading-relaxed text-muted-foreground"}>{status}</p>}
    {((!loading && enabled && record) || target.kind === "wardrobe" || target.kind === "wishlist") && <div role="group" aria-label="Share link actions" className="mt-2 flex items-center justify-end gap-2">
      {!loading && enabled && <>
        {confirmed && <IconAction label={completed === "update" ? "Link updated" : changed ? "Update link with saved changes" : "Update link"} icon={RefreshCw} loading={busy === "update"} complete={completed === "update"} disabled={!!busy || !canPublish} onClick={() => void mutate("update")} />}
        {confirmed && expiry !== confirmed.expiry && <IconAction label="Save expiry" icon={Save} loading={busy === "expiry"} disabled={!!busy} onClick={() => void mutate("expiry")} />}
        {record && <IconAction label="Remove link" icon={Link2Off} loading={busy === "remove"} disabled={!!busy} onClick={() => void mutate("remove")} />}
      </>}
      {(target.kind === "wardrobe" || target.kind === "wishlist") && <IconAction label="Manage links" icon={List} disabled={!!busy} onClick={() => setManaging(true)} />}
    </div>}
  </PopoverContent>;
}
