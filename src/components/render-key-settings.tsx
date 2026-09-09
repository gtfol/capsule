"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { RenderCredential } from "@/lib/render-credential";

type Props = { userId: string | null; sessionKey?: string; disabled?: boolean; active?: boolean; onCredentialChange: (credential: RenderCredential | null) => void };
export function RenderKeySettings(props: Props) {
  return props.userId ? <AccountKeySettings key={props.userId} {...props} userId={props.userId} /> : <GuestKeySettings {...props} />;
}
const inputProps = { type: "text", className: "render-key-input", autoComplete: "off", autoCorrect: "off", autoCapitalize: "none", spellCheck: false, maxLength: 503 } as const;
const actionClass = "min-h-9 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40";
function GuestKeySettings({ disabled, active, sessionKey = "", onCredentialChange }: Props) {
  const id = useId();
  const draft = sessionKey;
  const note = "Used for this session only. Sign in through Sync to save a key to your account.";
  return <section aria-labelledby={`${id}-title`}>
    <div className="flex items-center gap-1"><h2 id={`${id}-title`} className="text-[12px]">OpenAI API key</h2><InfoTooltip active={active} label="About your OpenAI API key">{note}</InfoTooltip></div>
    <p id={`${id}-note`} className="sr-only">{note}</p>
    <div className="relative mt-2">
      <Input {...inputProps} aria-label="OpenAI API key" aria-describedby={`${id}-note`} placeholder="Paste your API key" disabled={disabled} value={draft} onChange={(event) => { const key = event.target.value; onCredentialChange(key.trim() ? { type: "session", apiKey: key } : null); }} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
      <span className="render-key-fallback" aria-hidden="true">{"•".repeat(Math.min(draft.length, 24))}</span>
    </div>
  </section>;
}

function AccountKeySettings({ userId, disabled = false, active, onCredentialChange }: Props & { userId: string }) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef({ version: 0 });
  const writing = useRef(false);
  const callback = useRef(onCredentialChange);
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"input" | "change" | null>(null);
  useEffect(() => { callback.current = onCredentialChange; }, [onCredentialChange]);
  useEffect(() => {
    const current = sequence.current;
    const version = ++current.version;
    const controller = new AbortController();
    callback.current(null);
    void fetch(`/api/render/key?expectedUserId=${encodeURIComponent(userId)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in again through Sync to use your saved API key." : response.status === 409 ? "Your signed-in account changed. Reopen Outfits to continue." : "Your saved key could not be checked. Try again.");
      if (data.userId !== userId) throw new Error("Your signed-in account changed. Reopen Outfits to continue.");
      if (current.version !== version) return;
      const usable = data.available === true;
      const hasKey = usable && data.saved === true;
      setAvailable(usable); setSaved(hasKey); setReady(true); setError(usable ? "" : "Saving API keys is not available right now.");
      callback.current(hasKey ? { type: "saved", userId } : null);
    }).catch((cause) => { if (current.version === version) setError(cause instanceof Error && cause.name !== "AbortError" && /^(Sign in again|Your signed-in account|Your saved key)/.test(cause.message) ? cause.message : "Your saved key could not be checked. Connect to the internet and try again."); });
    return () => { current.version++; controller.abort(); };
  }, [userId, attempt]);
  useEffect(() => {
    const target = focusNext.current === "input" ? input.current : focusNext.current === "change" ? changeButton.current : null;
    if (target) { target.focus(); focusNext.current = null; }
  }, [saved, editing, ready, pending]);

  async function mutate(remove: boolean) {
    if (disabled || !ready || !available || writing.current) return;
    const key = draft.trim();
    if (!remove && !/^sk-[A-Za-z0-9_-]{16,500}$/.test(key)) { setInvalid(true); setError("Enter an OpenAI API key beginning with sk-."); input.current?.focus(); return; }
    const version = ++sequence.current.version;
    writing.current = true;
    setPending(remove ? "remove" : "save"); setError(""); setInvalid(false); callback.current(null);
    try {
      const response = await fetch("/api/render/key", { method: remove ? "DELETE" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUserId: userId, ...(!remove ? { apiKey: key } : {}) }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok || data.userId !== userId || data.saved !== !remove) throw new Error();
      if (sequence.current.version !== version) return;
      focusNext.current = remove ? "input" : "change";
      setSaved(!remove); setDraft(""); setEditing(false);
      callback.current(remove ? null : { type: "saved", userId });
    } catch {
      if (sequence.current.version === version) {
        // A lost response may follow a committed save/delete; recheck before use.
        setReady(false); setError("Your account key could not be confirmed. Retry to check its saved state.");
      }
    } finally { if (sequence.current.version === version) { writing.current = false; setPending(null); } }
  }
  function cancel() {
    if (disabled || writing.current) return;
    focusNext.current = "change"; setDraft(""); setEditing(false); setError(""); setInvalid(false);
    callback.current(saved ? { type: "saved", userId } : null);
  }
  const locked = disabled || Boolean(pending);
  const note = saved ? "Saved securely to your account and reused for future outfits." : "Save your key securely to your account to reuse it for future outfits.";
  return <section aria-labelledby={`${id}-title`} aria-busy={(!ready && !error) || Boolean(pending)}>
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1"><h2 id={`${id}-title`} className="text-[12px]">OpenAI API key</h2><InfoTooltip active={active} label="About your OpenAI API key">{note}</InfoTooltip></div>{saved && <span className="text-[11px] text-subtle" role="status">Saved</span>}</div>
    <p id={`${id}-note`} className="sr-only">{note}</p>
    {!ready || !available ? <div className="mt-3 text-[11px] text-subtle">{!error && <p role="status">Checking saved key…</p>}{error && <button type="button" className={actionClass} disabled={disabled} onClick={() => { setError(""); setDraft(""); setEditing(false); setAttempt((value) => value + 1); }}>Retry</button>}</div> : saved && !editing ? <div className="mt-2 flex min-h-9 items-center justify-between gap-4">
      <span className="select-none text-[13px] tracking-[0.12em]" aria-label="API key saved">••••••••••••</span>
      <div className="flex items-center gap-4"><button ref={changeButton} type="button" className={actionClass} disabled={locked} onClick={() => { focusNext.current = "input"; setDraft(""); setError(""); setInvalid(false); setEditing(true); callback.current(null); }}>Change</button><button type="button" className={actionClass} disabled={locked} onClick={() => { void mutate(true); }}>{pending === "remove" ? "Removing…" : "Remove"}</button></div>
    </div> : <div className="mt-2">
      <div className="relative"><Input {...inputProps} ref={input} aria-label={saved ? "Replacement OpenAI API key" : "OpenAI API key"} value={draft} placeholder="Paste your API key" disabled={locked} aria-invalid={invalid || undefined} aria-describedby={`${id}-note${error ? ` ${id}-error` : ""}`} onChange={(event) => { setDraft(event.target.value); setError(""); setInvalid(false); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void mutate(false); } if (event.key === "Escape" && saved) { event.preventDefault(); cancel(); } }} /><span className="render-key-fallback" aria-hidden="true">{"•".repeat(Math.min(draft.length, 24))}</span></div>
      <div className="mt-1 flex items-center gap-5"><button type="button" className={`${actionClass} !text-foreground underline underline-offset-4`} disabled={locked || !draft.trim()} onClick={() => { void mutate(false); }}>{pending === "save" ? "Saving…" : "Save key"}</button>{saved && <button type="button" className={actionClass} disabled={locked} onClick={cancel}>Cancel</button>}</div>
    </div>}
    {error && <p id={`${id}-error`} className="mt-3 text-[12px] leading-relaxed" role="alert">{error}</p>}
  </section>;
}
