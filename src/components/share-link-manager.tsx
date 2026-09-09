"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Link2Off, Loader2 } from "lucide-react";
import { listShareRecords, refreshShareRecord, removeShareLink, shareUrl, type ShareRecord } from "@/lib/share-client";
import { IconAction } from "./ui/icon-action";
import { InfoTooltip } from "./ui/info-tooltip";

type Entry = { key: string; record: ShareRecord };
function titleOf(entry: Entry) {
  return entry.record.title || (entry.key === "wardrobe" ? "Wardrobe" : entry.key === "wishlist" ? "Wishlist" : entry.key.startsWith("outfit:") ? "Outfit" : "Piece");
}

export function ShareLinkManager({ space, onBack }: { space: string; onBack: () => void }) {
  const alive = useRef(false);
  const actionRunning = useRef(false);
  const fallbackInput = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<{ key: string; action: "copy" | "remove" } | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ message: string; quiet?: boolean } | null>(null);
  const [copied, setCopied] = useState("");
  const [fallback, setFallback] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    void listShareRecords(space).then((records) => {
      if (!cancelled) setEntries(records.toSorted((a, b) => b.record.updatedAt - a.record.updatedAt));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Your share links could not be opened.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [space, reload]);

  useEffect(() => {
    if (!fallback) return;
    fallbackInput.current?.focus(); fallbackInput.current?.select();
  }, [fallback]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(""), 2_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function act(entry: Entry, action: "copy" | "remove") {
    if (actionRunning.current || busy) return;
    actionRunning.current = true;
    setBusy({ key: entry.key, action }); setError(""); setStatus(null); setFallback(""); setCopied("");
    try {
      if (action === "remove") {
        await removeShareLink(space, entry.key, entry.record);
        if (!alive.current) return;
        setEntries((current) => current.filter((candidate) => candidate.record.id !== entry.record.id));
        setStatus({ message: "Link removed. It can no longer be opened.", quiet: true });
      } else {
        const current = await refreshShareRecord(space, entry.key, entry.record);
        if (!alive.current) return;
        if (!current) {
          setEntries((values) => values.filter((candidate) => candidate.record.id !== entry.record.id));
          setStatus({ message: "This link has expired or been removed." });
          return;
        }
        setEntries((values) => values.map((candidate) => candidate.key === entry.key ? { key: entry.key, record: current } : candidate));
        if (current.pending) throw new Error("This link has not been confirmed. Open Share on the original item to retry, or remove the link.");
        const url = shareUrl(current.id);
        try {
          await navigator.clipboard.writeText(url);
          if (alive.current) { setCopied(current.id); setStatus({ message: "Link copied.", quiet: true }); }
        } catch {
          if (alive.current) { setFallback(url); setStatus({ message: "Select and copy the link below." }); }
        }
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "The link could not be changed. Try again.");
    } finally {
      actionRunning.current = false;
      if (alive.current) setBusy(null);
    }
  }

  return <>
    <div className="flex items-center gap-3"><button type="button" onClick={onBack} disabled={!!busy} aria-label="Back to sharing" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"><ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" /></button><div className="flex items-center gap-1"><h2 className="text-[13px] font-normal">Manage links</h2><InfoTooltip label="About managing links">Links you created in this browser, including pieces or outfits you’ve removed.</InfoTooltip></div></div>
    {loading ? <p className="mt-5 flex items-center gap-2 text-[12px] text-muted-foreground" role="status"><Loader2 size={13} className="animate-spin" aria-hidden="true" />Opening links…</p> : entries.length ? <ul className="mt-3 max-h-[min(440px,50dvh)] divide-y divide-border overflow-y-auto">{entries.map((entry) => <li key={entry.record.id} className="py-4">
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-[12px]" title={titleOf(entry)}>{titleOf(entry)}</p><p className="mt-1 text-[11px] text-subtle">{entry.record.pending ? "Creation unconfirmed" : entry.record.expiresAt === null ? "Never expires" : `Expires ${new Date(entry.record.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}</p></div>
        <div className="-mt-1 flex shrink-0 items-center gap-1" role="group" aria-label={`Actions for ${titleOf(entry)}`}>
          {!entry.record.pending && <IconAction label={`Copy link to ${titleOf(entry)}`} tooltip={copied === entry.record.id ? "Link copied" : "Copy link"} icon={Copy} loading={busy?.key === entry.key && busy.action === "copy"} complete={copied === entry.record.id} disabled={!!busy} onClick={() => void act(entry, "copy")} />}
          <IconAction label={`Remove link to ${titleOf(entry)}`} tooltip="Remove link" icon={Link2Off} loading={busy?.key === entry.key && busy.action === "remove"} disabled={!!busy} onClick={() => void act(entry, "remove")} />
        </div>
      </div>
    </li>)}</ul> : !error && <p className="mt-5 text-[12px] text-muted-foreground">No share links in this browser yet.</p>}
    {error && <div className="mt-4"><p role="alert" className="text-[12px] leading-relaxed">{error}</p>{!entries.length && <button type="button" className="mt-3 text-[12px] underline underline-offset-4" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }}>Try again</button>}</div>}
    {status && <p role="status" className={status.quiet ? "sr-only" : "mt-4 text-[11px] leading-relaxed text-muted-foreground"}>{status.message}</p>}
    {fallback && <input ref={fallbackInput} type="text" value={fallback} readOnly aria-label="Share link" onFocus={(event) => event.currentTarget.select()} className="mt-3 w-full border-b border-border bg-transparent py-2 text-[12px] outline-none focus-visible:border-foreground" />}
  </>;
}
