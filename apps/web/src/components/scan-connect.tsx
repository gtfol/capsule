"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ScanConnect({authorization,user,providers}:{authorization:{code_challenge:string;state:string;access?:"capture"|"wardrobe"|"wishlist"|"outfits"};user:{id:string;name:string}|null;providers:{google:boolean;apple:boolean;email:boolean}}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const button = "h-11 w-full bg-foreground px-4 text-sm text-background disabled:opacity-40";
  async function connect() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/scan/authorize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...authorization,expectedUserId:user?.id})});
      if (!response.ok) throw new Error();
      const result = await response.json();
      const url = new URL(result.callbackURL);
      if (url.protocol !== "dev.gtfol.capsulescan:" || url.host !== "auth" || url.pathname !== "/callback") throw new Error();
      window.location.assign(url.toString());
    } catch { setError("couldn’t connect. return to the capsule app and try again."); setBusy(false); }
  }
  async function social(provider: "google" | "apple") {
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.social({provider,callbackURL:window.location.href});
      if (result.error) throw new Error();
    } catch { setError("couldn’t start sign-in. try again."); setBusy(false); }
  }
  async function emailSignIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await authClient.signIn.email({email,password});
      if (result.error) throw new Error();
      setPassword(""); window.location.reload();
    } catch { setError("couldn’t sign in. check your details and try again."); setBusy(false); }
  }
  return <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-12">
    <h1 className="text-lg">capsule</h1>
    <p className="text-sm text-muted-foreground">{user ? (authorization.access === "outfits" ? "manage your wardrobe, wishlist, and outfits. render with your account’s OpenAI key and manage that key in settings." : authorization.access === "wishlist" ? "view, add, edit, and delete wardrobe and wishlist pieces from this iphone." : authorization.access === "wardrobe" ? "view, add, edit, and delete wardrobe pieces from this iphone." : "allow the capsule app to add items to your wardrobe.") : "sign in to save your scans to capsule."}</p>
    {user ? <>
      <button className={button} disabled={busy} onClick={()=>void connect()}>{busy ? "connecting…" : `continue${user.name ? ` as ${user.name}` : ""}`}</button>
      <button className="text-sm text-muted-foreground" disabled={busy} onClick={async()=>{setBusy(true);try { const result=await authClient.signOut();if(result.error) throw new Error();window.location.reload(); } catch {setBusy(false);setError("couldn’t switch accounts. try again.");}}}>use another account</button>
      <p className="text-xs text-muted-foreground">remove access anytime in capsule settings → integrations.</p>
    </> : <>
      {providers.google && <button className={button} disabled={busy} onClick={()=>void social("google")}>{busy ? "connecting…" : "continue with google"}</button>}
      {providers.apple && <button className={button} disabled={busy} onClick={()=>void social("apple")}>{busy ? "connecting…" : "Continue with Apple"}</button>}
      {providers.email && <form className="space-y-4" onSubmit={emailSignIn}>
        <label className="field-label">email<input className="w-full border-b border-border py-2" type="email" required autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} /></label>
        <label className="field-label">password<input className="w-full border-b border-border py-2" type="password" required autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} /></label>
        <button className={button} disabled={busy}>{busy ? "connecting…" : "sign in"}</button>
      </form>}
      {!providers.google && !providers.apple && !providers.email && <p className="text-sm">sign-in is unavailable. try again later.</p>}
    </>}
    {error && <p className="text-sm" role="alert">{error}</p>}
  </main>;
}
