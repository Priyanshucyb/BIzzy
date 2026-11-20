#!/usr/bin/env node
// Business OS v3 — LOCAL → CLOUD migration tool (Stage A)
// Ek maujooda LOCAL (SQLite) database ki SAARI dukaanen/data ko CLOUD
// (Postgres) me copy karta hai — IDs aur relationships same rakh kar, taaki
// bill numbers, links aur history bilkul waisi ki waisi rahe.
//
// Chalane ka tareeka (backend folder se):
//   Windows CMD:        set DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
//   Windows PowerShell: $env:DATABASE_URL="postgres://user:pass@host:5432/db?sslmode=require"
//   phir:               node migrate-to-cloud.js
//                       node migrate-to-cloud.js C:\path\to\business-os.db
//                       node migrate-to-cloud.js --url=postgres://... [--force]
//
// Safety:
//  - Target (Postgres) me pehle se users hain to migration RUK jayegi —
//    galti se kisi live cloud data par overwrite na ho. Pakka ho to --force
//    do (force me bhi maujooda rows overwrite NAHI hoti — same ID wali rows
//    skip ho jati hain, sirf nayi judti hain).
//  - Source SQLite file sirf PADHI jati hai (read-only) — local data ko
//    kuch nahi hota.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const { PG_SCHEMA_SQL, TABLES, MART_TABLES } = require('./db');

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const urlArg = args.find((a) => a.startsWith('--url='));
  const positional = args.filter((a) => !a.startsWith('--'));
  const sqlitePath = positional[0] || path.join(__dirname, 'data', 'business-os.db');
  const databaseUrl = (urlArg ? urlArg.slice('--url='.length) : '') || process.env.DATABASE_URL || '';

  if (!databaseUrl) {
    console.error('  ERROR: DATABASE_URL nahi mila. Pehle env me set karo ya --url=postgres://... do.');
    process.exit(1);
  }
  if (!fs.existsSync(sqlitePath)) {
    console.error(`  ERROR: Local database file nahi mili: ${sqlitePath}`);
    process.exit(1);
  }

  console.log(`  Source (local):  ${sqlitePath}`);
  console.log('  Target (cloud):  Postgres (DATABASE_URL)');

  const src = new DatabaseSync(sqlitePath, { readOnly: true });
  const isLocalHost = /localhost|127\.0\.0\.1/.test(databaseUrl);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isLocalHost ? false : { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    // Schema banao (IF NOT EXISTS — dobara chalane par safe).
    await client.query(PG_SCHEMA_SQL);

    const cnt = await client.query('SELECT COUNT(*) AS c FROM users');
    const existingUsers = Number(cnt.rows[0].c);
    if (existingUsers > 0 && !force) {
      console.error(`  ERROR: Cloud database me pehle se ${existingUsers} users hain — migration roki gayi.`);
      console.error('  Agar pakka yahi karna hai to --force ke saath dobara chalao (purani rows overwrite nahi hongi).');
      process.exit(1);
    }

    await client.query('BEGIN');
    const summary = [];
    for (const t of [...TABLES, ...MART_TABLES]) {
      const rows = src.prepare(`SELECT * FROM ${t}`).all();
      if (!rows.length) { summary.push([t, 0]); continue; }
      const cols = Object.keys(rows[0]);
      const colList = cols.join(', ');
      const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ');
      const sql = `INSERT INTO ${t} (${colList}) VALUES (${placeholders})` + (force ? ' ON CONFLICT DO NOTHING' : '');
      for (const row of rows) {
        await client.query(sql, cols.map((c) => row[c]));
      }
      summary.push([t, rows.length]);
      // Identity sequence ko max ID ke aage set karo, taaki naye records
      // purane IDs se na takrayen.
      if (t !== 'sessions') {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`
        );
      }
    }
    await client.query('COMMIT');

    console.log('');
    console.log('  MIGRATION HO GAYA ✓  Copy hua data:');
    for (const [t, n] of summary) console.log(`    ${t}: ${n} rows`);
    console.log('');
    console.log('  Ab server ko isi DATABASE_URL ke saath chalao — saari dukaanen cloud par aa gayi hain.');
    console.log('  (Login sessions bhi copy hue hain, to chal rahe logins bhi bane rehne chahiye.)');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('  MIGRATION FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    src.close();
  }
}

main().catch((e) => { console.error('  MIGRATION FAIL:', e); process.exit(1); });
