// เติมค่าแคช (c) ให้สูตรที่ยังไม่มีค่า โดยคำนวณด้วย engine.js — ใช้หลังสคริปต์ที่เพิ่ม/แก้สูตร
//   node tools/fill_cache.js data/p1.json
const fs = require('fs'); const P = require('../js/engine.js');
const path = process.argv[2] || 'data/p1.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const wb = new P.Workbook(data); let n = 0;
for (const sd of data.sheets) {
  const sh = wb.sheet(sd.name);
  for (const [ref, c] of Object.entries(sd.cells)) {
    if (!c.f || 'c' in c) continue;
    const a = P.parseA1(ref); let v = wb.get(sh, a.r, a.c); if (P.isRange(v)) v = wb.scalar(v);
    if (v === null || v === undefined || v === '' || P.isErr(v)) continue;
    c.c = v; n++;
  }
}
fs.writeFileSync(path, JSON.stringify(data));
console.log('filled', n, 'cached values');
