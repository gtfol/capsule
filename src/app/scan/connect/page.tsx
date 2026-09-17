import { headers } from "next/headers";
import type { Metadata } from "next";
import { getAuth, enabledProviders } from "@/lib/server/auth";
import { scanAuthorization } from "@/lib/server/scan-auth";
import { ScanConnect } from "@/components/scan-connect";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {title:"sign in · capsule scan",robots:{index:false,follow:false}};
export default async function ScanConnectPage({searchParams}: {searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = scanAuthorization.safeParse(await searchParams);
  if (!params.success) return <main className="mx-auto max-w-sm px-6 py-20"><h1 className="text-lg">capsule scan</h1><p className="mt-6 text-sm text-muted-foreground">open capsule scan to sign in.</p></main>;
  const session = await getAuth()?.api.getSession({headers:await headers(),query:{disableCookieCache:true}}).catch(()=>null);
  return <ScanConnect authorization={params.data} user={session ? {id:session.user.id,name:session.user.name} : null} providers={enabledProviders()} />;
}
