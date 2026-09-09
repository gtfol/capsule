"use client";
import { useState } from "react";
import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { useSyncStore } from "@/lib/sync";
export function SyncPopover() {
  const sync = useSyncStore();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  async function google() { setWorking(true); setError(""); try { const result = await authClient.signIn.social({ provider: "google", callbackURL: window.location.href }); if (result.error) throw new Error(result.error.message || "Sign-in could not start."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in could not start."); } finally { setWorking(false); } }
  async function emailAuth(event: React.FormEvent) { event.preventDefault(); setWorking(true); setError(""); try { const result = register ? await authClient.signUp.email({ email, password, name: name.trim() || email.split("@")[0] }) : await authClient.signIn.email({ email, password }); if (result.error) throw new Error(result.error.message || "Sign-in failed."); setPassword(""); await sync.refreshSession(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in failed."); } finally { setWorking(false); } }
  return <Popover><PopoverTrigger asChild><button className="nav-button flex items-center justify-center" aria-label="Sync" title="Sync">{sync.status === "syncing" ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : sync.status === "offline" ? <CloudOff size={17} strokeWidth={1.5} /> : <Cloud size={17} strokeWidth={1.5} />}</button></PopoverTrigger><PopoverContent side="top" align="end" className="w-[300px]">
    <p className="text-[13px] font-semibold">Sync</p><p className="mt-3 text-[12px] leading-[1.65] text-neutral-500">Sync is optional. Without it, everything stays in this browser.</p>
    {sync.status === "loading" ? <p role="status" className="mt-5 text-[12px] text-neutral-500">Checking sync…</p> : sync.user ? <div className="mt-5 space-y-4"><p className="truncate text-[12px]">{sync.user.email}</p><p className="text-[12px] text-neutral-500" role="status">{sync.status === "syncing" ? "Syncing…" : sync.status === "offline" ? "Offline. Changes will sync when you reconnect." : sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Ready to sync."}</p><div className="flex items-center justify-between"><Button variant="ghost" disabled={sync.status === "syncing" || sync.status === "offline"} onClick={() => void sync.syncNow()}>Sync now</Button><Button variant="ghost" className="text-neutral-500" disabled={working} onClick={async () => { setWorking(true); try { await sync.signOut(); } catch { setError("Could not sign out. Try again."); } finally { setWorking(false); } }}>Sign out</Button></div></div> : sync.enabled ? <div className="mt-5 space-y-4">
      {sync.providers.google && <Button className="w-full" disabled={working || sync.status === "offline"} onClick={() => void google()}>{working ? "Connecting…" : "Continue with Google"}</Button>}
      {sync.providers.email && !showEmail && <Button variant="ghost" className="w-full text-neutral-500" onClick={() => setShowEmail(true)}>Continue with email</Button>}
      {sync.providers.email && showEmail && <form className="space-y-3" onSubmit={emailAuth}>{register && <label className="field-label">Name<Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}<label className="field-label">Email<Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field-label">Password<Input type="password" required minLength={8} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label><Button className="w-full" type="submit" disabled={working}>{working ? "Connecting…" : register ? "Create account" : "Sign in"}</Button><button type="button" className="text-[12px] text-neutral-500" onClick={() => setRegister(!register)}>{register ? "Use an existing account" : "Create an account"}</button></form>}
      {!sync.providers.google && !sync.providers.email && <p className="text-[12px] text-neutral-500">Sign-in is not configured yet.</p>}
    </div> : sync.status === "error" || sync.status === "offline" ? null : <p className="mt-5 text-[12px] text-neutral-500">Sync is not configured yet.</p>}
    {(error || sync.error) && <p className="mt-4 text-[12px] leading-relaxed" role="alert">{error || sync.error}</p>}
  </PopoverContent></Popover>;
}
