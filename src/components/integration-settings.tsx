"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Trash2, X } from "lucide-react";
import { SyncPopover } from "./sync-popover";
import { Button } from "./ui/button";
import { IconAction } from "./ui/icon-action";
import { InfoTooltip } from "./ui/info-tooltip";

type Scope = "items:read" | "wishlist:write" | "wardrobe:write";
type Token = {id:string;name:string;prefix:string;scopes:Scope[];expires_at:string;last_used_at:string|null};
const choices: {scope:Scope;label:string}[] = [{scope:"items:read",label:"Look up pieces"},{scope:"wishlist:write",label:"Add to wishlist"},{scope:"wardrobe:write",label:"Add to wardrobe"}];

export function IntegrationSettings({userId,active,disabled}: {userId:string|null;active:boolean;disabled:boolean}) {
  return <section>
    <div className="flex items-center gap-1"><h2 className="text-[13px]">Integrations</h2><InfoTooltip active={active} label="About integrations">Connect an AI agent to your synced items. Tokens expire in 90 days; revoke anytime.</InfoTooltip></div>
    {userId ? active && <TokenControls key={userId} userId={userId} disabled={disabled} /> : active && <div className="mt-2"><SyncPopover appearance="text" disabled={disabled} /></div>}
  </section>;
}
function TokenControls({userId,disabled}:{userId:string;disabled:boolean}) {
  const [now] = useState(()=>Date.now());
  const [tokens,setTokens] = useState<Token[]>([]);
  const [ready,setReady] = useState(false);
  const [adding,setAdding] = useState(false);
  const [name,setName] = useState("Instinct");
  const [scopes,setScopes] = useState<Scope[]>(choices.map(c=>c.scope));
  const [secret,setSecret] = useState("");
  const [copied,setCopied] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [revoking,setRevoking] = useState<string|null>(null);
  const load = useCallback(async (signal?:AbortSignal) => {
    const res = await fetch(`/api/integrations/tokens?expectedUserId=${encodeURIComponent(userId)}`,{signal});
    const data = await res.json();
    if (!res.ok || data.userId !== userId) throw new Error(data.error?.message ?? "Could not load integrations.");
    return data.tokens as Token[];
  },[userId]);
  useEffect(()=>{
    const controller = new AbortController();
    void load(controller.signal).then(values=>{if (!controller.signal.aborted) {setTokens(values);setReady(true);}}).catch(cause=>{if (!controller.signal.aborted) setError(cause.message);});
    return ()=>controller.abort();
  },[load]);
  async function mutate(id?:string) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/integrations/tokens",{method:id ? "DELETE" : "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedUserId:userId,...(id ? {id} : {name,scopes})})});
      const data = await res.json();
      if (!res.ok || data.userId !== userId) throw new Error(data.error?.message ?? "Could not update this integration.");
      if (id) {setRevoking(null);setSecret("");}
      else {setSecret(data.token);setCopied(false);setAdding(false);}
      setTokens(await load());setReady(true);
    } catch(cause) {setError(cause instanceof Error ? cause.message : "Could not update this integration.");}
    finally {setBusy(false);}
  }
  return <div className="mt-3 text-[13px]">
    {tokens.map(token=><div key={token.id} className="mb-3 flex items-start justify-between gap-4">
      <div><p>{token.name}</p><p className="mt-1 text-[11px] text-subtle">{Date.parse(token.expires_at)<now ? "Expired" : `Expires ${new Date(token.expires_at).toLocaleDateString()}`} · {token.scopes.map(scope=>choices.find(choice=>choice.scope===scope)?.label).join(", ")}</p></div>
      {revoking===token.id ? <div className="flex items-center gap-2"><button type="button" className="text-[11px]" disabled={busy||disabled} onClick={()=>void mutate(token.id)}>Revoke access</button><IconAction icon={X} label="Cancel revocation" disabled={busy} onClick={()=>setRevoking(null)} /></div> : <IconAction icon={Trash2} label={`Revoke ${token.name}`} disabled={busy||disabled} onClick={()=>setRevoking(token.id)} />}
    </div>)}
    {secret && <div className="ph-no-capture mb-4" data-private="true">
      <p className="mb-2 text-[11px] text-subtle">Copy this token now. It is shown only once.</p>
      <div className="flex items-center gap-2"><input aria-label="New integration token" className="field-input min-w-0 flex-1 font-mono text-[11px]" readOnly value={secret} autoComplete="off" spellCheck={false} /><IconAction icon={Copy} label="Copy integration token" complete={copied} onClick={()=>{void navigator.clipboard.writeText(secret).then(()=>setCopied(true),()=>setError("Could not copy. Select the token and copy it manually."));}} /></div>
      <button type="button" className="mt-2 text-[11px] text-subtle" onClick={()=>setSecret("")}>Done</button>
    </div>}
    {adding ? <form className="space-y-3" onSubmit={event=>{event.preventDefault();if(!busy) void mutate();}}>
      <label className="block text-[11px] text-subtle">Name<input className="field-input mt-1" value={name} onChange={event=>setName(event.target.value)} maxLength={80} required disabled={busy||disabled} /></label>
      <fieldset disabled={busy||disabled} className="space-y-2"><legend className="mb-2 text-[11px] text-subtle">Permissions</legend>{choices.map(choice=><label key={choice.scope} className="flex items-center gap-2 text-[12px]"><input type="checkbox" className="accent-foreground" checked={scopes.includes(choice.scope)} onChange={event=>setScopes(current=>event.target.checked ? [...current,choice.scope] : current.filter(s=>s!==choice.scope))} />{choice.label}</label>)}</fieldset>
      <p className="text-[11px] text-subtle">Expires after 90 days.</p>
      <div className="flex items-center gap-4"><Button type="submit" disabled={busy||disabled||!scopes.length||!name.trim()}>{busy ? "Creating…" : "Create token"}</Button><button type="button" className="text-muted-foreground" disabled={busy} onClick={()=>setAdding(false)}>Cancel</button></div>
    </form> : <button type="button" className="min-h-10 text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={disabled||busy||!ready} onClick={()=>{setSecret("");setAdding(true);}}>Connect an AI agent</button>}
    <a className="mt-2 block text-[11px] text-subtle hover:text-foreground" href="https://github.com/gtfol/capsule/blob/main/docs/integrations.md" target="_blank" rel="noopener noreferrer">API documentation</a>
    {error && <p role="alert" className="mt-3 text-[12px]">{error}</p>}
  </div>;
}
