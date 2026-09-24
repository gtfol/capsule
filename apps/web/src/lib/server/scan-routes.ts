import { getAuth } from "./auth";
import { getPool } from "./db";
import { checkRequestLimit } from "./request-limit";
import { integrationFailure } from "./integration-tokens";
import { createScanAuth } from "./scan-auth";

export async function scanRequest(request: Request, action: "authorize" | "exchange" | "session") {
  const limited = await checkRequestLimit(request,"scanAuth");
  if (limited) return limited;
  try {
    return await createScanAuth(getPool(),async req => await getAuth()?.api.getSession({headers:req.headers,query:{disableCookieCache:true}}) ?? null)[action](request);
  } catch(error) { return integrationFailure(error); }
}
