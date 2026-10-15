/* สร้างข้อมูลตัวอย่างของเว็บตัวอย่าง (demo/sample/pN.json) — นักเรียนสมมติ 40 คน ทุกชั้น ป.1-ป.6
 *   python3 tools/build_demo.py && NODE_PATH=$(npm root -g) node tools/make_demo_sample.js
 * ชื่อ-นามสกุลทั้งหมดเป็นชื่อสมมติ (นามสกุลเป็นคำคุณธรรม ไม่ใช่ข้อมูลบุคคลจริง)
 * กรอกผ่าน PPApp.applyValue ของโปรแกรมจริงในเบราว์เซอร์ (ตรวจเงื่อนไข + มาโคร เหมือนครูกรอกเอง) แล้วบันทึกผลที่กรอก */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const DEMO = path.join(__dirname, '..', 'demo');
const OUT = path.join(DEMO, 'sample');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };

const BOYS = ['กิตติพัฒน์', 'ธนกร', 'ภูมิพัฒน์', 'ณัฐวุฒิ', 'ปัณณวิชญ์', 'ศุภกร', 'พีรพัฒน์', 'ธีรภัทร', 'วรเมธ', 'อนุชิต', 'ชยพล', 'ปกรณ์', 'ภาคิน', 'รัชชานนท์', 'สิรภพ', 'ธนภัทร', 'กฤตเมธ', 'จิรายุ', 'ณภัทร', 'ปิยวัฒน์', 'วชิรวิทย์', 'อชิตะ', 'ภูริณัฐ', 'ตรัยคุณ'];
const GIRLS = ['ณัฐธิดา', 'กัญญาณัฐ', 'พิมพ์ชนก', 'ปุณยวีร์', 'ชนัญชิดา', 'ธัญชนก', 'อริสรา', 'ศิริญากร', 'วรัญญา', 'พัชราภา', 'กมลชนก', 'ปภาวรินทร์', 'ณิชาภัทร', 'สุพิชฌาย์', 'อัญชิสา', 'ภัทรวดี', 'ชุติกาญจน์', 'เบญญาภา', 'ธนพร', 'จิดาภา', 'มนัสนันท์', 'รินรดา', 'ปาณิสรา', 'ขวัญข้าว'];
const SURN = ['รักการอ่าน', 'ใฝ่เรียนรู้', 'ตั้งใจเรียนดี', 'มีน้ำใจงาม', 'ขยันหมั่นเพียร', 'ยิ้มแย้มเสมอ', 'ช่างสังเกตดี', 'มีวินัยดี', 'ใจดีเสมอ', 'รักความสะอาด', 'ซื่อตรงดี', 'อ่อนน้อมงาม', 'กตัญญูดี', 'รักษ์โลกดี', 'คิดดีทำดี', 'พอเพียงงาม', 'เรียนรู้ไว', 'สามัคคีดี', 'มุ่งมั่นดี', 'มีระเบียบดี', 'รับผิดชอบดี', 'ใฝ่ดีเสมอ', 'สุภาพงาม', 'อดทนดี', 'ประหยัดดี', 'รักเพื่อนดี', 'กล้าคิดดี', 'ร่าเริงดี', 'ตรงเวลาดี', 'ช่วยเหลือดี', 'สร้างสรรค์ดี', 'ใจเย็นดี', 'มีเหตุผลดี', 'รักธรรมชาติ', 'แบ่งปันดี', 'มีสติดี', 'ขยันอ่านดี', 'รักกีฬาดี', 'ใฝ่ศิลป์ดี', 'รักดนตรีดี'];
const STAFF = {   // บุคลากรสมมติ
  B4: 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาตัวอย่าง เขต 1',
  B6: 'นางสาวสมใจ ใฝ่วิชาการ', B7: 'นายวิชัย บริหารดี', B8: 'นายประเสริฐ นำทางดี',
};
const CLASS_T = ['นางสาวมาลี สอนดีมาก', 'นางสุดา ใจดีสอนเก่ง', 'นางสาวพรทิพย์ รักลูกศิษย์', 'นายสมชาย ครูตัวอย่าง', 'นางวันดี เมตตาศิษย์', 'นางสาวกานดา สอนสนุก'];
const SUBJ_T = { ไทย: 'นางสาวอรุณี รักภาษา', อังกฤษ: 'Ms. Anna Example', คณิต: 'นายธนา เลขดีมาก', วิทย: 'นางสาวนภา ทดลองดี', สังคม: 'นายชาติ รักถิ่นดี', การงาน: 'นางสายใจ ทำงานดี', สุข: 'นายพละ แข็งแรงดี', ศิลป: 'นางสาวศิลปา วาดสวย' };
const GROUP = [['ไทย', 'ท', 'ภาษาไทย'], ['อังกฤษ', 'อ', 'ภาษาต่างประเทศ'], ['คณิต', 'ค', 'คณิตศาสตร์'], ['วิทย', 'ว', 'วิทยาศาสตร์และเทคโนโลยี'], ['สังคม', 'ส', 'สังคมศึกษา ศาสนาและวัฒนธรรม'], ['การงาน', 'ง', 'การงานอาชีพ'], ['สุข', 'พ', 'สุขศึกษาและพลศึกษา'], ['ศิลป', 'ศ', 'ศิลปะ']];

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function plan(g) {
  const r = rng(2568 + g * 97);
  const boys = shuffle(BOYS, r).slice(0, 20), girls = shuffle(GIRLS, r).slice(0, 20), sur = shuffle(SURN, r);
  const kids = shuffle([...boys.map(n => ['ชาย', 'เด็กชาย' + n]), ...girls.map(n => ['หญิง', 'เด็กหญิง' + n])], r)
    .map(([sex, n], i) => ({ sex, name: n + ' ' + sur[i], att: 82 + Math.floor(r() * 19), a: Math.min(0.97, Math.max(0.42, 0.72 + (r() + r() + r() - 1.5) * 0.24)) }));
  return { seed: 9000 + g, kids, classT: CLASS_T[g - 1], staff: STAFF, subjT: SUBJ_T, group: GROUP, surn: SURN };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  for (const g of [1, 2, 3, 4, 5, 6]) {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.route('http://demo.local/**', (route) => {
      const u = new URL(route.request().url()); let f = decodeURIComponent(u.pathname); if (f === '/') f = '/index.html';
      if (f.startsWith('/sample/')) return route.fulfill({ status: 404, body: '' });   // เริ่มจากต้นแบบเปล่า
      const fp = path.join(DEMO, f);
      if (!fs.existsSync(fp)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ body: fs.readFileSync(fp), contentType: TYPES[path.extname(fp)] || 'application/octet-stream' });
    });
    await p.addInitScript((g) => { try { if (!sessionStorage.getItem('x')) { localStorage.clear(); localStorage.setItem('pp_grade', String(g)); sessionStorage.setItem('x', 1); } } catch (e) {} }, g);
    await p.goto('http://demo.local/');
    await p.click('#login-go');
    await p.waitForFunction((g) => window.PPApp && PPApp.S.grade === g && PPApp.S.wb && document.querySelector('#loading').hidden, g, { timeout: 60000 });
    const res = await p.evaluate(({ g, plan }) => {
      const A = PPApp, S = A.S, wb = S.wb, N = S.names, bad = [];
      const r = ((s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; })(plan.seed);
      const set = (sh, row, col, v) => { if (!A.applyValue(sh, row, col, v)) bad.push(`${sh}!${row},${col}=${v}`); };
      const val = (sh, row, col) => { const s = wb.sheet(sh); let v = s && wb.get(s, row, col); if (v && v.isRange) v = wb.scalar(v); return v; };
      const names = wb.sheets.map(s => s.name), find = (re) => names.find(n => re.test(n));
      A.batch(() => {
        // ข้อมูลโรงเรียน / บุคลากรสมมติ
        for (const [k, v] of Object.entries(plan.staff)) set(N.info, +k.slice(1), 2, v);
        set(N.info, 5, 2, plan.classT);
        const cov = find(/^ปก ปพ\.5 รายชั้น.*เทอม1$/);
        if (cov) for (const [rr, cc] of [[8, 6], [8, 9], [9, 6], [9, 9]]) set(cov, rr, cc, 0);
        // นักเรียน 40 คน (แถว 3-42)
        plan.kids.forEach((k, i) => { set(N.p1, 3 + i, 2, k.name); set(N.p1, 3 + i, 3, k.sex); set(N.p1, 3 + i, 4, k.att); });
        // รายวิชา: รหัส / เวลาเรียน / กลุ่มสาระ / ครูผู้สอน
        const subs = [];
        for (let row = 2; row <= 21; row++) { const nm = val(N.subj, row, 1); if (nm) subs.push({ row, slot: row - 1, name: String(nm) }); }
        const seq = {};
        for (const s of subs) {
          const gp = plan.group.find(([kw]) => s.name.includes(kw)) || plan.group[0];
          seq[gp[1]] = (seq[gp[1]] || 0) + 1;
          const hrs = { ท: g <= 3 ? 100 : 160, อ: g <= 3 ? 60 : 80, ค: g <= 3 ? 200 : 160, ว: g <= 3 ? 80 : 120, ส: g <= 3 ? 80 : 120, ง: g <= 3 ? 40 : 80, พ: 80, ศ: 80 }[gp[1]];
          const sr = s.row + 3;
          set('รายวิชา', sr, 2, `${gp[1]}1${g}10${seq[gp[1]]}`); set('รายวิชา', sr, 4, hrs); set('รายวิชา', sr, 5, gp[2]);
          set('รายวิชา', sr, 6, plan.subjT[gp[0]]);
          // คะแนน: ตัวชี้วัด 3 ตัวต่อเทอม (10 / 10 / 15) + สอบ 15
          const sc = 'คะแนนรายวิชา ' + s.slot, off = (r() - 0.5) * 0.14;
          const T = [{ ind: [3, 4, 5], exam: 14 }, { ind: [16, 17, 18], exam: 27 }];
          for (const t of T) { [10, 10, 15].forEach((m, i) => set(sc, 4, t.ind[i], m)); set(sc, 4, t.exam, 15); }
          plan.kids.forEach((k, i) => {
            const row = 6 + i;
            T.forEach((t, ti) => {
              const lv = k.a + off + ti * 0.02;
              for (const [c, m] of [...t.ind.map((c, j) => [c, [10, 10, 15][j]]), [t.exam, 15]]) {
                const x = Math.round(m * Math.min(1, Math.max(0.3, lv + (r() - 0.5) * 0.16)));
                set(sc, row, c, x);
              }
            });
          });
        }
        // คุณลักษณะ / กิจกรรม: ผ่านเป็นส่วนใหญ่ บางคนไม่ผ่านบางข้อ
        for (const kind of ['คุณลักษณะ', 'กิจกรรมพัฒนาผู้เรียน']) {
          const t1 = find(new RegExp('^' + kind + '.*เทอม1$'));
          const items = []; for (let c = 3; c <= 14; c++) { const h = val(t1, 3, c); if (h !== null && h !== undefined && String(h).trim()) items.push(c); }
          for (const t of [1, 2]) {
            const sh = find(new RegExp('^' + kind + '.*เทอม' + t + '$'));
            plan.kids.forEach((k, i) => { for (const c of items) set(sh, 4 + i, c, k.a < 0.55 && r() < 0.25 ? 'ไม่ผ่าน' : 'ผ่าน'); });
          }
        }
      });
      const cells = JSON.parse(JSON.stringify(S.userEdits));
      if (cells[N.info]) delete cells[N.info].B3;    // ชื่อโรงเรียนมาจากการเข้าสู่ระบบ
      return { bad, doc: { v: 3, grade: g, cells, logo: null } };
    }, { g, plan: plan(g) });
    await p.evaluate(() => { PPApp.S.dirty = false; clearTimeout(PPApp.S.saveTimer); });
    fs.writeFileSync(path.join(OUT, `p${g}.json`), JSON.stringify(res.doc));
    const n = Object.values(res.doc.cells).reduce((a, m) => a + Object.keys(m).length, 0);
    console.log(`p${g}: ${n} cells, rejected ${res.bad.length}`, res.bad.slice(0, 5).join(' | '));
    await ctx.close();
  }
  await b.close();
})();
