import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createScanAuth, scanAuthorization, SCAN_CALLBACK } from "../src/lib/server/scan-auth";
import { authenticateToken, digest } from "../src/lib/server/integration-tokens";

const random = () => randomBytes(32).toString("base64url");
test("native authorization requires S256-sized opaque parameters and has no caller-controlled redirect",()=>{
  assert.equal(scanAuthorization.safeParse({code_challenge:random(),state:random()}).success,true);
  for (const invalid of [{code_challenge:"short",state:random()},{code_challenge:random(),state:""},{code_challenge:random(),state:random(),redirect_uri:"https://evil.test"}]) assert.equal(scanAuthorization.safeParse(invalid).success,false);
  assert.equal(SCAN_CALLBACK,"dev.gtfol.capsulescan://auth/callback");
});

const database = process.env.TEST_INTEGRATION_DATABASE_URL;
test("native sign-in: origin/account checks, PKCE, atomic single-use exchange, expiry, scopes and revocation",{skip:!database},async()=>{
  const url = new URL(database!); assert.equal(url.hostname,"127.0.0.1"); assert.equal(url.pathname,"/capsule_integrations_test");
  const pool = new Pool({connectionString:database,max:8});
  const user = {id:randomUUID(),name:"scan test"};
  const session = {id:randomUUID()};
  const auth = createScanAuth(pool,async()=>({user,session}));
  const verifier = random(), challenge = createHash("sha256").update(verifier).digest("base64url"), state = random();
  const authorization = {code_challenge:challenge,state,expectedUserId:user.id};
  const post = (path:string,body:unknown,origin?:string) => new Request(`https://capsule.test/api/scan/${path}`,{method:"POST",headers:{"content-type":"application/json",...(origin ? {origin} : {})},body:JSON.stringify(body)});
  const authorize = (body:unknown=authorization,origin="https://capsule.test") => auth.authorize(post("authorize",body,origin));
  const exchange = (code:string,proof=verifier) => auth.exchange(post("exchange",{code,code_verifier:proof}));
  async function grant() {
    const response = await authorize(); assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    const callback = new URL((await response.json()).callbackURL);
    assert.equal(`${callback.protocol}//${callback.host}${callback.pathname}`,SCAN_CALLBACK);
    assert.equal(callback.searchParams.get("state"),state);
    assert.deepEqual([...callback.searchParams.keys()].sort(),["code","state"]);
    return callback.searchParams.get("code")!;
  }
  try {
    await pool.query('insert into "user"(id,name,email) values ($1,$2,$3)',[user.id,user.name,`${user.id}@example.test`]);
    await pool.query('insert into "session"(id,"userId",token,"expiresAt") values ($1,$2,$3,now()+interval \'1 day\')',[session.id,user.id,random()]);
    assert.equal((await authorize(authorization,"https://evil.test")).status,403);
    assert.equal((await auth.authorize(post("authorize",authorization))).status,403);
    assert.equal((await authorize({...authorization,expectedUserId:randomUUID()})).status,409);
    assert.equal((await authorize({...authorization,redirect_uri:"https://evil.test"})).status,400);
    assert.equal((await createScanAuth(pool,async()=>null).authorize(post("authorize",authorization,"https://capsule.test"))).status,401);
    const code = await grant();
    const stored = (await pool.query('select identifier,value from "verification" where identifier=$1',[`capsule-scan:${digest(code)}`])).rows[0];
    assert.ok(stored); assert.equal(JSON.stringify(stored).includes(code),false);
    assert.equal((await exchange(code,random())).status,400);
    assert.equal((await auth.exchange(post("exchange",{code,code_verifier:verifier},"https://evil.test"))).status,403);
    const concurrent = await Promise.all([exchange(code),exchange(code),exchange(code)]);
    assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,400,400]);
    const login = await concurrent.find(result=>result.status===200)!.json();
    assert.deepEqual(login.user,user);
    const token = await authenticateToken(pool,digest(login.token),["wardrobe:write"]);
    assert.equal(token.user_id,user.id); assert.deepEqual(token.scopes,["wardrobe:write"]);
    await assert.rejects(authenticateToken(pool,digest(login.token),["items:read"]));
    const sessionRequest = (method="GET") => new Request("https://capsule.test/api/scan/session",{method,headers:{authorization:`Bearer ${login.token}`}});
    assert.deepEqual((await (await auth.session(sessionRequest())).json()).user,user);
    assert.equal((await exchange(code)).status,400);
    const expired = await grant();
    await pool.query('update "verification" set "expiresAt"=now()-interval \'1 second\' where identifier=$1',[`capsule-scan:${digest(expired)}`]);
    assert.equal((await exchange(expired)).status,400);
    const revokedSession = await grant();
    await pool.query('delete from "session" where id=$1',[session.id]);
    assert.equal((await exchange(revokedSession)).status,400);
    assert.equal((await auth.session(sessionRequest("DELETE"))).status,200);
    assert.equal((await auth.session(sessionRequest())).status,401);
    await assert.rejects(authenticateToken(pool,digest(login.token),["wardrobe:write"]));
  } finally {
    await pool.query('delete from "verification" where identifier like \'capsule-scan:%\' and value like $1',[`%${user.id}%`]);
    await pool.query('delete from "user" where id=$1',[user.id]); await pool.end();
  }
});
