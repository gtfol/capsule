"use client";
import { useState } from "react";
import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  const optionClass = "w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-40";
  return <Popover>
    <PopoverTrigger asChild><button type="button" className="nav-button flex items-center justify-center" aria-label="Sync" title="Sync">{sync.status === "syncing" ? <Loader2 size={16} className="animate-spin" /> : sync.user ? <Cloud size={16} /> : <CloudOff size={16} />}</button></PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-72 p-3">
      {sync.status === "loading" ? <p role="status" className="px-1 text-xs text-muted-foreground">Checking sync…</p> : sync.user ? <div className="flex flex-col gap-1">
        <p className="truncate px-1 text-sm">{sync.user.email}</p>
        <p className="px-1 text-xs text-muted-foreground" role="status">{sync.status === "syncing" ? "Syncing…" : sync.status === "offline" ? "Offline. Changes will sync when you reconnect." : sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Ready to sync."}</p>
        <button type="button" className={optionClass} disabled={sync.status === "syncing" || sync.status === "offline"} onClick={() => void sync.syncNow()}>Sync now</button>
        <button type="button" className={optionClass} disabled={working} onClick={async () => { setWorking(true); try { await sync.signOut(); } catch { setError("Could not sign out. Try again."); } finally { setWorking(false); } }}>Sign out</button>
      </div> : <div className="flex flex-col gap-1">
        <p className="px-1 text-xs text-muted-foreground">Sync is optional. Without it, everything stays in this browser.</p>
        {sync.enabled && sync.providers.google && <button type="button" className={optionClass} disabled={working || sync.status === "offline"} onClick={() => void google()}>{working ? "Connecting…" : "Continue with Google"}</button>}
        {sync.enabled && sync.providers.email && !showEmail && <button type="button" className={optionClass} onClick={() => setShowEmail(true)}>Continue with email</button>}
        {sync.enabled && sync.providers.email && showEmail && <form className="space-y-3 px-1 pt-2" onSubmit={emailAuth}>
          {register && <label className="field-label">Name<Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
          <label className="field-label">Email<Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field-label">Password<Input type="password" required minLength={8} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className={optionClass} type="submit" disabled={working}>{working ? "Connecting…" : register ? "Create account" : "Sign in"}</button>
          <button type="button" className="text-xs text-muted-foreground" onClick={() => setRegister(!register)}>{register ? "Use an existing account" : "Create an account"}</button>
        </form>}
        {sync.enabled && !sync.providers.google && !sync.providers.email && <p className="px-1 text-xs text-muted-foreground">Sign-in is not configured yet.</p>}
        {!sync.enabled && sync.status !== "error" && sync.status !== "offline" && <p className="px-1 text-xs text-muted-foreground">Sync is not configured yet.</p>}
      </div>}
      {(error || sync.error) && <p className="mt-2 px-1 text-xs leading-relaxed" role="alert">{error || sync.error}</p>}
    </PopoverContent>
  </Popover>;
}
