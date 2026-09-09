"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { readRenderApiKey, writeRenderApiKey } from "@/lib/db";

type RenderKeySettingsProps = {
  space: string;
  disabled?: boolean;
  onKeyChange: (key: string) => void;
};

export function RenderKeySettings(props: RenderKeySettingsProps) {
  // Changing accounts discards drafts and invalidates the old account's work.
  return <RenderKeySettingsForSpace key={props.space} {...props} />;
}

function RenderKeySettingsForSpace({ space, disabled = false, onKeyChange }: RenderKeySettingsProps) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const operation = useRef({ version: 0 });
  const writing = useRef(false);
  const savedKey = useRef<string | null>(null);
  const callback = useRef(onKeyChange);
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"input" | "change" | null>(null);

  useEffect(() => { callback.current = onKeyChange; }, [onKeyChange]);

  useEffect(() => {
    const sequence = operation.current;
    const request = ++sequence.version;
    void readRenderApiKey(space).then((key) => {
      if (sequence.version !== request) return;
      savedKey.current = key;
      setSaved(Boolean(key));
      setReady(true);
      setError("");
      callback.current(key ?? "");
    }).catch(() => {
      if (sequence.version === request) setError("Your saved key could not be checked. Try again.");
    });
    return () => { sequence.version++; };
  }, [space, attempt]);

  useEffect(() => {
    const target = focusNext.current === "input" ? input.current : focusNext.current === "change" ? changeButton.current : null;
    if (target) { target.focus(); focusNext.current = null; }
  }, [saved, editing, ready, pending]);

  async function save() {
    if (disabled || !ready || writing.current) return;
    const key = draft.trim();
    if (!/^sk-[A-Za-z0-9_-]{16,500}$/.test(key)) {
      setInvalid(true);
      setError("Enter an OpenAI API key beginning with sk-.");
      input.current?.focus();
      return;
    }
    const request = ++operation.current.version;
    writing.current = true;
    setPending("save"); setError(""); setInvalid(false);
    try {
      await writeRenderApiKey(space, key);
      if (operation.current.version !== request) return;
      savedKey.current = key;
      focusNext.current = "change";
      setSaved(true); setDraft(""); setEditing(false);
      callback.current(key);
    } catch {
      if (operation.current.version === request) setError("Your key could not be saved in this browser. Try again.");
    } finally {
      if (operation.current.version === request) { writing.current = false; setPending(null); }
    }
  }

  async function remove() {
    if (disabled || !ready || writing.current) return;
    const request = ++operation.current.version;
    writing.current = true;
    setPending("remove"); setError("");
    callback.current("");
    try {
      await writeRenderApiKey(space, null);
      if (operation.current.version !== request) return;
      savedKey.current = null;
      focusNext.current = "input";
      setSaved(false); setDraft(""); setEditing(false); setInvalid(false);
      callback.current("");
    } catch {
      if (operation.current.version === request) {
        setError("Your saved key could not be removed. Try again.");
        callback.current(savedKey.current ?? "");
      }
    } finally {
      if (operation.current.version === request) { writing.current = false; setPending(null); }
    }
  }

  function cancel() {
    if (disabled || writing.current) return;
    focusNext.current = "change";
    setDraft(""); setEditing(false); setError(""); setInvalid(false);
    callback.current(savedKey.current ?? "");
  }

  const locked = disabled || Boolean(pending);
  const actionClass = "min-h-9 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40";

  return <section aria-labelledby={`${id}-title`} aria-busy={!ready && !error || Boolean(pending)}>
    <div className="flex items-center justify-between gap-3">
      <h2 id={`${id}-title`} className="text-[12px]">OpenAI API key</h2>
      {saved && <span className="text-[11px] text-subtle" role="status">Saved</span>}
    </div>
    <p id={`${id}-note`} className="mt-2 text-[11px] leading-relaxed text-subtle">{saved ? "Saved in this browser. Never synced. Rendering is billed to your OpenAI account." : "Save your key in this browser to reuse it for future outfits."}</p>
    {!ready ? <div className="mt-3 text-[11px] text-subtle">
      {!error && <p role="status">Checking browser storage…</p>}
      {error && <button type="button" className={actionClass} disabled={disabled} onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry</button>}
    </div> : saved && !editing ? <div className="mt-2 flex min-h-9 items-center justify-between gap-4">
      <span className="select-none text-[13px] tracking-[0.12em]" aria-label="API key saved">••••••••••••</span>
      <div className="flex items-center gap-4">
        <button ref={changeButton} type="button" className={actionClass} disabled={locked} onClick={() => { focusNext.current = "input"; setDraft(""); setError(""); setInvalid(false); setEditing(true); callback.current(""); }}>Change</button>
        <button type="button" className={actionClass} disabled={locked} onClick={() => { void remove(); }}>{pending === "remove" ? "Removing…" : "Remove"}</button>
      </div>
    </div> : <div className="mt-2">
      <label className="sr-only" htmlFor={`${id}-input`}>{saved ? "Replacement OpenAI API key" : "OpenAI API key"}</label>
      <div className="relative">
        <Input ref={input} id={`${id}-input`} type="text" className="render-key-input" value={draft} placeholder="Paste your API key" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={503} disabled={locked} aria-invalid={invalid || undefined} aria-describedby={`${id}-note${error ? ` ${id}-error` : ""}`} onChange={(event) => { setDraft(event.target.value); setError(""); setInvalid(false); }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); }
          if (event.key === "Escape" && saved) { event.preventDefault(); event.stopPropagation(); cancel(); }
        }} />
        <span className="render-key-fallback" aria-hidden="true">{"•".repeat(Math.min(draft.length, 24))}</span>
      </div>
      <div className="mt-1 flex items-center gap-5">
        <button type="button" className={`${actionClass} !text-foreground underline underline-offset-4`} disabled={locked || !draft.trim()} onClick={() => { void save(); }}>{pending === "save" ? "Saving…" : "Save key"}</button>
        {saved && <button type="button" className={actionClass} disabled={locked} onClick={cancel}>Cancel</button>}
      </div>
    </div>}
    {error && <p id={`${id}-error`} className="mt-3 text-[12px] leading-relaxed" role="alert">{error}</p>}
  </section>;
}
