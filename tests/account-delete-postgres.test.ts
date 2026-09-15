import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { removeAccount } from "../src/lib/server/account-api";
import { getPool } from "../src/lib/server/db";

test("account deletion cascades through private records and revokes only owned link capabilities", { skip: !process.env.TEST_ACCOUNT_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_ACCOUNT_DATABASE_URL;
  const pool = new Pool({ connectionString: process.env.TEST_ACCOUNT_DATABASE_URL });
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  const share = crypto.randomUUID().replaceAll('-', '').slice(0,22), wrongShare = crypto.randomUUID().replaceAll('-', '').slice(0,22);
  const hash = 'a'.repeat(64);
  try {
    for (const id of [owner, other]) {
      await pool.query('insert into public."user" (id,name,email) values ($1, $1, $2)', [id, `${id}@test.invalid`]);
      await pool.query('insert into public."session" (id,"expiresAt",token,"userId") values ($1,now(),$1,$1)', [id]);
      await pool.query('insert into public."account" (id,"accountId","providerId","userId") values ($1,$1,\'google\',$1)', [id]);
      await pool.query("insert into capsule_records (user_id,collection,id,record) values ($1,'items',$2,'{}')", [id, crypto.randomUUID()]);
      await pool.query("insert into capsule_render_keys (user_id,encrypted_key) values ($1,'encrypted')", [id]);
    }
    for (const id of [share, wrongShare]) await pool.query("insert into capsule_shares (id,token_hash,snapshot) values ($1,$2,'{}')",[id,hash]);
    await removeAccount(owner, [{ id:share,hash }, { id:wrongShare,hash:'b'.repeat(64) }]);
    for(const table of ['user','session','account']) assert.equal((await pool.query(`select count(*)::int as count from public."${table}" where id=$1`, [owner])).rows[0].count,0);
    for(const table of ['capsule_records','capsule_render_keys']) {
      assert.equal((await pool.query(`select count(*)::int as count from ${table} where user_id=$1`, [owner])).rows[0].count,0);
      assert.equal((await pool.query(`select count(*)::int as count from ${table} where user_id=$1`, [other])).rows[0].count,1);
    }
    assert.equal((await pool.query('select snapshot from capsule_shares where id=$1',[share])).rows[0].snapshot,null);
    assert.deepEqual((await pool.query('select snapshot from capsule_shares where id=$1',[wrongShare])).rows[0].snapshot,{});
  } finally {
    await pool.query('delete from public."user" where id=any($1)',[[owner,other]]);
    await pool.query('delete from capsule_shares where id=any($1)',[[share,wrongShare]]);
    await pool.end(); await getPool().end();
  }
});
