import { readFileSync } from 'node:fs';
import pg from 'libpg-query';
const files = process.argv.slice(2);
if (pg.loadModule) await pg.loadModule();
let bad = 0;
for (const f of files) {
  const sql = readFileSync(f, 'utf8');
  try {
    const res = await pg.parse(sql);
    const n = res?.stmts?.length ?? '?';
    console.log(`OK   ${f}  (${n} statements)`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${f}: ${e.message || e}`);
    const pos = e.cursorPosition;
    if (pos != null) console.log('     near: ' + JSON.stringify(sql.slice(Math.max(0,pos-100), pos+100)));
  }
}
process.exit(bad ? 1 : 0);
