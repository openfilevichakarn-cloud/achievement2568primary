/* ui.js — หน้าใช้งานแบบเว็บ (ฟอร์ม/การ์ด) ที่อ่านและเขียนข้อมูลชุดเดียวกับตารางต้นแบบ Excel
 * ทุกค่าที่กรอกส่งผ่าน PPApp.applyValue → ตรวจเงื่อนไข + มาโคร + บันทึกอัตโนมัติ เหมือนกรอกในไฟล์ Excel */
(function (root) {
  'use strict';
  const P = root.PPEngine, R = root.PPRender, M = root.PPMacros;
  const $ = (s, e) => (e || document).querySelector(s);
  const $$ = (s, e) => Array.from((e || document).querySelectorAll(s));
  const esc = R.esc;
  const A = () => root.PPApp;
  const LEVELS = ['เริ่มต้น', 'พัฒนา', 'ชำนาญ', 'เชี่ยวชาญ'];
  const U = { book: { term: 'sum', assess: false }, tab: 'home', sub: { data: 'school' }, scoreTerm: 1, slot: null, kind: 'trait', aTerm: 1, repMode: 'one', repTerm: 'sum', p5Term: 1, pendSub: new Set() };
  let L = null;

  // ---------------------------------------------------------------- เข้าถึงข้อมูลในเวิร์กบุ๊ก
  const WB = () => A().S.wb;
  function get(n, r, c) {
    const wb = WB(); const sh = wb.sheet(n); if (!sh) return null;
    let v = wb.get(sh, r, c); if (v && v.isRange) v = wb.scalar(v);
    return (v === undefined || v === null || P.isErr(v)) ? null : v;
  }
  const txt = (n, r, c) => { const v = get(n, r, c); return v === null ? '' : String(v); };
  const num = (n, r, c) => { const v = get(n, r, c); return typeof v === 'number' ? v : null; };
  const setv = (n, r, c, v) => A().applyValue(n, r, c, v);
  const isPh = (v) => typeof v === 'string' && /^กรุณากรอก/.test(v);
  const lvIdx = (s) => LEVELS.indexOf(s);
  const lvChip = (s) => s ? `<span class="lvl l${lvIdx(s)}">${esc(s)}</span>` : '<span class="lvl none">ยังไม่มีผล</span>';
  const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ');

  function buildLayout() {
    const S = A().S, wb = S.wb, N = S.names;
    const find = (re) => wb.sheets.map(s => s.name).find(n => re.test(n));
    L = {
      info: N.info, subj: N.subj, sub: 'รายวิชา', stu: N.p1, sum: N.sum, sumBeh: N.sumBeh, term: N.term, termBeh: N.termBeh,
      stage: N.stage, stageBeh: N.stageBeh, stageLabel: N.stage ? (/ต้น/.test(N.stage) ? 'สรุปประถมตอนต้น' : 'สรุปประถมตอนปลาย') : null,
      beh: 'ค่าพฤติกรรม', cover1: find(/^ปก ปพ\.5 รายชั้น.*เทอม1$/),
      trait: (t) => find(new RegExp('^คุณลักษณะ.*เทอม' + t + '$')),
      act: (t) => find(new RegExp('^กิจกรรมพัฒนาผู้เรียน.*เทอม' + t + '$')),
      traitY: find(/^คุณลักษณะ.* รวม$/), actY: find(/^กิจกรรมพัฒนาผู้เรียน.* รวม$/),   // ผลทั้งปี (คำนวณจาก 2 เทอม)
      score: (slot) => 'คะแนนรายวิชา ' + slot,
    };
    L.stuFirst = 3; L.stuLast = wb.sheet(L.stu).def.dim[0];
    L.subFirst = 2; L.subLast = wb.sheet(L.subj).def.dim[0];
    // ความสามารถชั้นปี: 8 ช่อง (ปพ.6 รวม แถว 6,9,...,27) ชื่ออยู่ที่ I6:I13 — ชื่อว่าง = ไม่ใช้
    L.abAll = Array.from({ length: AB_MAX }, (_, i) => 6 + 3 * i);
    syncAbilities();
    // แถวคำอธิบายพฤติกรรมของแต่ละความสามารถ (อ่านจากสูตรชีท ป.1-2)
    L.behRow = L.abAll.map((r, i) => {
      const sh = wb.sheet(L.sumBeh); const cell = sh && sh.cells.get(P.KEY(4 + i, 4));
      const m = cell && cell.f && /ค่าพฤติกรรม!\$?B\$?(\d+)/.exec(cell.f);
      return m ? +m[1] : null;
    });
    L.maxSub = L.subLast - L.subFirst + 1;
  }

  const AB_MAX = 8;
  const abName = (i) => txt(L.sum, 6 + i, 9);
  function syncAbilities() {   // L.ab / L.abText = เฉพาะความสามารถที่ใช้งาน (เรียงต่อกันจากข้อ 1)
    L.ab = L.abAll.filter((r, i) => abName(i).trim());
    L.abText = L.ab.map((r, i) => abName(i));
  }
  // คุณลักษณะ / กิจกรรม: หัวข้อ C.. (ชื่อในแถว 3 ของชีทเทอม 1) และคอลัมน์สรุป
  const AS = { trait: { max: 12, sum: 15 }, act: { max: 8, sum: 11 } };
  const asSheet = (kind, t) => t === 'y' ? (kind === 'trait' ? L.traitY : L.actY) : kind === 'trait' ? L.trait(t) : L.act(t);
  const activeItems = (kind) => range(3, AS[kind].max).filter(c => txt(asSheet(kind, 1), 3, c).trim());
  const stuScoreRow = (r) => r + 3, stuTraitRow = (r) => r + 1;
  // ชีทคะแนนรายวิชา: ตัวชี้วัด 1-10 / เก็บ (=รวมตัวชี้วัด) / สอบ / รวม / ระดับ ของแต่ละเทอม
  const NIND = 10, range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
  const SC = { 1: { ind: range(3, NIND), keep: 13, exam: 14, tot: 15, lvl: 30 },
               2: { ind: range(16, NIND), keep: 26, exam: 27, tot: 28, lvl: 31 }, year: 29, yearLvl: 32, note: 33 };
  const IND_NAME_ROW = 47;   // ชื่อตัวชี้วัดเก็บในแถว 47 ของชีทคะแนน (นอกพื้นที่แสดงผล)
  const indLabel = (sc, c, i) => txt(sc, IND_NAME_ROW, c).trim() || 'ตัวชี้วัด ' + (i + 1);
  const SC_EDIT = [...SC[1].ind, SC[1].exam, ...SC[2].ind, SC[2].exam, SC.note];
  // ตัวชี้วัดที่ใช้งาน = ช่องที่กำหนดคะแนนเต็มไว้ (ช่องว่าง = ไม่ใช้/ซ่อน)
  const activeInds = (sc, T) => SC[T].ind.filter(c => get(sc, 4, c) !== null && get(sc, 4, c) !== '');
  // ช่องที่ต้องกรอก = ตัวชี้วัดที่ใช้งาน + สอบ ที่คะแนนเต็มมากกว่า 0
  const scInputs = (sc, T) => [...activeInds(sc, T), SC[T].exam].filter(c => (num(sc, 4, c) ?? 0) > 0);
  function students() {
    const out = [];
    for (let r = L.stuFirst; r <= L.stuLast; r++) {
      const nm = txt(L.stu, r, 2);
      if (nm.trim()) out.push({ r, no: get(L.stu, r, 1) ?? (r - 2), name: nm, sex: txt(L.stu, r, 3), att: get(L.stu, r, 4) });
    }
    return out;
  }
  function subjects() {
    const out = [];
    for (let r = L.subFirst; r <= L.subLast; r++) {
      const nm = txt(L.subj, r, 1);
      if (nm.trim()) out.push({ r, slot: r - 1, name: nm, ab: txt(L.subj, r, 2), idx: get(L.subj, r, 3), sr: r + 3 });
    }
    return out;
  }

  // ---------------------------------------------------------------- โครงหน้า
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    data: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    scores: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    assess: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    report: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
    docs: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/><path d="M17 11.5h.01"/>',
    report5: '<path d="M5 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H5z"/><path d="M19 4h-5a3 3 0 0 0-3 3"/><path d="M19 4v14h-5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7M8 11h7"/>',
    manual: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
  };
  const TABS = [['home', 'หน้าแรก'], ['data', 'ข้อมูล'], ['scores', 'คะแนน'], ['assess', 'ประเมิน'], ['report5', 'รายงาน ปพ.5'], ['book', 'พิมพ์เล่ม ปพ.5'], ['report', 'รายงาน ปพ.6'], ['docs', 'ปริ้นเอกสาร'], ['manual', 'คู่มือ']];
  function renderTabbar() {
    $('#tabbar').innerHTML = TABS.map(([k, t]) => `<button data-tab="${k}" class="t-${k}${U.tab === k ? ' on' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${t}</button>`).join('');
  }
  function mount() {
    buildLayout();
    ensureCurrentStudent();
    const v = $('#view');
    if (!v.dataset.bound) {
      v.dataset.bound = '1';
      v.addEventListener('click', onClick);
      v.addEventListener('change', onChange);
      v.addEventListener('keydown', onKey);
      v.addEventListener('paste', onPaste);
      // เลือกทั้งช่องเมื่อเข้าช่อง (พิมพ์ทับได้ทันทีเหมือน Excel) และกันคลิกเมาส์ยกเลิกการเลือก
      v.addEventListener('focusin', (e) => { const el = e.target; if (el.matches && el.matches('input.gc')) { el.select(); el.dataset.fresh = '1'; } });
      v.addEventListener('mouseup', (e) => { const el = e.target; if (el.dataset && el.dataset.fresh) { delete el.dataset.fresh; if (el.selectionStart === el.selectionEnd) el.select(); } });
      v.addEventListener('input', (e) => { if (e.target.dataset) delete e.target.dataset.fresh; });
      v.addEventListener('dblclick', (e) => { const el = e.target; if (el.matches && el.matches('input.gc[data-t=pass]')) { el.value = el.value === '' ? 'ผ่าน' : el.value === 'ผ่าน' ? 'ไม่ผ่าน' : ''; el.dispatchEvent(new Event('change', { bubbles: true })); el.select(); } });
      $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
    }
    U.slot = null;
    go('home');
  }
  function go(tab, sub) {
    if (tab === 'docs') { U.tab = 'docs'; } else U.tab = tab;
    if (sub) U.sub[tab] = sub;
    A().closeDoc && !$('#docviewer').hidden && A().closeDoc();
    renderTabbar(); render(); $('#view').scrollTop = 0;
  }
  function refresh() { if (!L) return; const v = $('#view'); const top = v.scrollTop; renderTabbar(); render(); v.scrollTop = top; }
  function render() {
    if (L) { syncAbilities(); ensureCurrentStudent(); }
    const fn = { home: vHome, data: vData, scores: vScores, assess: vAssess, report: vReport, report5: vReport5, book: vBook, docs: vDocs, manual: vManual }[U.tab];
    $('#view').innerHTML = `<div class="page">${fn()}</div>`;
    if (U.tab === 'report') afterReport();
  }

  const seg = (items, cur, act) => `<div class="seg" role="tablist">${items.map(([k, t]) => `<button role="tab" data-act="${act}" data-k="${k}" class="${String(cur) === String(k) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
  const field = (label, inner, cls) => `<label class="fld ${cls || ''}"><span>${esc(label)}</span>${inner}</label>`;
  function bind(sheet, r, c, kind, extra) {
    return `data-s="${esc(sheet)}" data-r="${r}" data-c="${c}" data-t="${kind || 't'}"${extra || ''}`;
  }
  function inputFor(sheet, r, c, o) {
    o = o || {}; const raw = get(sheet, r, c); const v = raw === null || isPh(raw) ? '' : String(raw);
    const ph = isPh(raw) ? String(raw) : (o.ph || '');
    const b = bind(sheet, r, c, o.kind, ` data-old="${esc(v)}"${o.after ? ` data-after="${o.after}"` : ''}${o.chk ? ` data-chk="${o.chk}"` : ''}`);
    if (o.area) return `<textarea ${b} rows="${o.rows || 2}" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
    return `<input ${b} type="text" value="${esc(v)}" placeholder="${esc(ph)}"${o.mode ? ` inputmode="${o.mode}"` : ''} autocomplete="off"${o.dis ? ' disabled' : ''}>`;
  }

  // ---------------------------------------------------------------- หน้าแรก
  function progress() {
    const stu = students(), subs = subjects();
    const info = L.info;
    const needInfo = [5, 8];
    const infoDone = needInfo.every(r => { const v = get(info, r, 2); return v !== null && !isPh(v) && String(v).trim() !== ''; });
    const abDone = subs.length > 0 && subs.every(s => s.ab);
    let filled = 0, total = 0;
    for (const s of subs) for (const st of stu) for (const c of [...scInputs(L.score(s.slot), 1), ...scInputs(L.score(s.slot), 2)]) { total++; const v = get(L.score(s.slot), stuScoreRow(st.r), c); if (v !== null && v !== '') filled++; }
    let af = 0, at = 0;
    for (const t of [1, 2]) for (const st of stu) {
      for (const c of activeItems('trait')) { at++; if (txt(L.trait(t), stuTraitRow(st.r), c)) af++; }
      for (const c of activeItems('act')) { at++; if (txt(L.act(t), stuTraitRow(st.r), c)) af++; }
    }
    return { stu, subs, infoDone, abDone, sp: total ? filled / total : 0, ap: at ? af / at : 0 };
  }
  function vHome() {
    const p = progress(), S = A().S;
    const step = (n, title, desc, done, to, pct) => `<button class="step ${done ? 'done' : ''}" data-act="goto" data-to="${to}"><span class="no">${done ? '✓' : n}</span><span style="flex:1;min-width:0"><b>${esc(title)}</b><small>${esc(desc)}</small>${pct !== undefined ? `<div class="prog"><i style="width:${Math.round(pct * 100)}%"></i></div>` : ''}</span><span class="go">›</span></button>`;
    return `
    <div class="card hello">${S.view.logo ? `<img class="logo" src="${S.view.logo}" alt="ตราโรงเรียน">` : ''}<div><h2>${esc(S.school.name)} 🔒</h2><p>ชั้นประถมศึกษาปีที่ ${S.grade}/${S.room} · ปีการศึกษา ${esc(txt(L.info, 9, 2))}</p></div></div>
    <div class="stat"><div><b>${p.stu.length}</b><span>นักเรียน</span></div><div><b>${p.subs.length}</b><span>รายวิชา</span></div><div><b>${Math.round(p.sp * 100)}%</b><span>คะแนนกรอกแล้ว</span></div></div>
    <div class="steps">
      ${step(1, 'ตั้งค่าโรงเรียน', p.infoDone ? 'กรอกชื่อครูและผู้อำนวยการแล้ว' : 'กรอกชื่อครูประจำชั้น ผู้อำนวยการ และตราโรงเรียน', p.infoDone, 'data:school')}
      ${step(2, 'รายชื่อนักเรียน', p.stu.length ? p.stu.length + ' คน' : 'เพิ่มนักเรียน หรือวางรายชื่อจาก Excel ทีเดียว', p.stu.length > 0, 'data:students')}
      ${step(3, 'รายวิชาและความสามารถ', p.subs.length ? p.subs.length + ' วิชา' + (p.abDone ? '' : ' (บางวิชายังไม่เลือกความสามารถ)') : 'เพิ่มวิชา แล้วเลือกว่าวิชาไหนอยู่ในความสามารถข้อใด', p.subs.length > 0 && p.abDone, 'data:subjects')}
      ${step(4, 'บันทึกคะแนน', 'เลือกวิชาแล้วกรอกคะแนนรายตัวชี้วัดและคะแนนสอบ ทีละเทอม', p.sp >= 0.999, 'scores', p.sp)}
      ${step(5, 'ประเมินคุณลักษณะและกิจกรรม', 'แตะช่องเพื่อเลือก ผ่าน / ไม่ผ่าน', p.ap >= 0.999, 'assess', p.ap)}
      ${step(6, 'ดูรายงานและพิมพ์ ปพ.6', 'ผลรายคน ภาพรวมห้อง และพิมพ์ทั้งห้อง', false, 'report')}
    </div>
    <div class="card backup"><h3>สำรองข้อมูล</h3>
      <p class="hint">ดาวน์โหลดข้อมูลทุกชั้นของโรงเรียนเก็บไว้เป็นไฟล์ (แนะนำทุกครั้งหลังกรอกคะแนนเสร็จ และก่อนส่งผลปลายภาค) และนำไฟล์กลับเข้ามาได้เมื่อต้องการกู้คืน</p>
      <div class="row"><button class="btn primary" data-act="backup-out">⬇ สำรองข้อมูล (ดาวน์โหลดไฟล์)</button><button class="btn" data-act="backup-in">⬆ นำเข้าไฟล์สำรอง</button></div></div>
    <p class="hint" style="margin-top:14px">ระบบบันทึกอัตโนมัติขึ้นเซิร์ฟเวอร์ ใช้ได้ทั้งคอมพิวเตอร์และมือถือ ข้อมูลของโรงเรียนอื่นมองไม่เห็นกัน</p>`;
  }

  // ---------------------------------------------------------------- ข้อมูล
  function vData() {
    const sub = U.sub.data || 'school';
    const head = `<div class="bar">${seg([['school', 'โรงเรียน'], ['students', 'นักเรียน'], ['subjects', 'รายวิชา'], ['abilities', 'ความสามารถ']], sub, 'dsub')}</div>`;
    return head + ({ school: vSchool, students: vStudents, subjects: vSubjects, abilities: vAbilities }[sub] || vSchool)();
  }

  function vSchool() {
    const S = A().S, i = L.info;
    const cov = L.cover1;
    const covBox = cov ? `
    <div class="card"><h3>นักเรียนออก / เข้าระหว่างปีการศึกษา</h3><p class="hint">ใช้ในหน้าปก ปพ.5 (ถ้าไม่มี ใส่ 0)</p>
      <div class="grid2">
        ${field('ออกกลางปี — ชาย (คน)', inputFor(cov, 8, 6, { kind: 'n', mode: 'numeric' }))}
        ${field('ออกกลางปี — หญิง (คน)', inputFor(cov, 8, 9, { kind: 'n', mode: 'numeric' }))}
        ${field('เข้าระหว่างปี — ชาย (คน)', inputFor(cov, 9, 6, { kind: 'n', mode: 'numeric' }))}
        ${field('เข้าระหว่างปี — หญิง (คน)', inputFor(cov, 9, 9, { kind: 'n', mode: 'numeric' }))}
      </div></div>` : '';
    return `<div class="card"><h3>ข้อมูลโรงเรียน</h3>
      <div class="grid2">
        ${field('ชื่อโรงเรียน (ล็อกตามรหัสสิทธิ์ แก้ไม่ได้)', `<input type="text" value="${esc(S.school.name)}" disabled>`)}
        ${field('ปีการศึกษา (พ.ศ.)', inputFor(i, 9, 2, { kind: 'n', mode: 'numeric', ph: '2569' }))}
        ${field('สังกัด (จังหวัด / เขตพื้นที่)', inputFor(i, 4, 2))}
        ${field('ชั้น (ล็อกตามชั้น/ห้องที่เลือก · ชั้นที่มีห้องเดียวไม่แสดงเลขห้อง)', `<input type="text" value="${esc(A().classText())}" disabled>`)}
        ${field('ชื่อ-สกุล ครูประจำชั้น', inputFor(i, 5, 2))}
        ${field('ชื่อ-สกุล หัวหน้างานวิชาการ', inputFor(i, 6, 2))}
        ${field('ชื่อ-สกุล รองผู้อำนวยการ (ถ้าไม่มี เว้นว่าง ระบบจะซ่อนลายเซ็น)', inputFor(i, 7, 2, { after: 'noop' }))}
        ${field('ชื่อ-สกุล ผู้อำนวยการ', inputFor(i, 8, 2))}
      </div>
      <p class="hint">ปีการศึกษา สังกัด และชื่อผู้บริหาร ใช้ร่วมกันทุกชั้นทุกห้อง — แก้ที่ห้องใดจะอัปเดตทุกห้องอัตโนมัติ${A().otherRoomCount() > 0 ? ' <button class="btn sm" data-act="info-school">🏫 ใช้ข้อมูลนี้กับทุกห้อง</button>' : ''}</p></div>
    <div class="card"><h3>ตราโรงเรียน</h3>
      <div class="row">${S.view.logo ? `<img src="${S.view.logo}" alt="ตราโรงเรียน" style="height:84px;width:84px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:12px">` : '<span class="hint">ยังไม่ได้ใส่ตรา</span>'}
        <button class="btn primary" data-act="logo">เลือกรูปตรา</button>${S.view.logo ? '<button class="btn danger" data-act="logo-del">ลบตรา</button>' : ''}</div>
      <p class="hint">ตราจะแสดงในหน้าปก ปพ.5 และ ปพ.6 โดยอัตโนมัติ (ไฟล์ PNG/JPG)</p></div>${covBox}`;
  }

  // --- นักเรียน (ตารางแบบชีท: ทุกแถวกรอก/วางได้ทันที)
  function vStudents() {
    const n = students().length, rows = [];
    for (let r = L.stuFirst; r <= L.stuLast; r++) rows.push(r);
    const head = `<tr><th class="no">ที่</th><th class="stk wide ctr">ชื่อ - สกุล</th><th class="sex">เพศ</th><th class="att">เข้าเรียน %</th><th class="del"></th></tr>`;
    const body = rows.map((r, i) => {
      const nm = txt(L.stu, r, 2), att = get(L.stu, r, 4);
      return `<tr data-row="${r}"><td class="no">${esc(get(L.stu, r, 1) ?? (r - 2))}</td>
        ${gcell(L.stu, r, 2, 't', i, 0, { after: 'stu', cls: 'stk wide', align: 'left' })}${gcell(L.stu, r, 3, 'sex', i, 1, { cls: 'sex' })}${gcell(L.stu, r, 4, 'n', i, 2, { lo: 0, hi: 100, cls: 'att' })}
        <td class="del">${nm.trim() || att !== null || txt(L.stu, r, 3) ? `<button class="btn ghost sm" data-act="stu-del" data-r="${r}" aria-label="ลบนักเรียน">ลบ</button>` : ''}</td></tr>`;
    }).join('');
    return `<div class="bar"><span><b>${n}</b> / ${rows.length} คน</span><span class="grow"></span>${xlBtn('stu')}</div>
      <p class="sub">ใช้งานเหมือนชีท Excel: คลิกช่องแล้วพิมพ์ หรือคัดลอกหลายช่องจาก Excel / Google Sheets มาวาง (Ctrl+V) ได้ทันที · เพศพิมพ์ ช / ญ ได้ (ถ้าเว้นว่าง ระบบเดาจากคำนำหน้า)</p>
      ${gridWrap('stu', head, body, 'fit')}`;
  }
  function uiModal(o) {
    return new Promise((resolve) => {
      const rootEl = $('#modal');
      rootEl.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>${esc(o.title)}</h3><div class="modal-body">${o.body}</div><div class="modal-actions"><button class="btn" data-m="x">${esc(o.cancel || 'ยกเลิก')}</button><button class="btn ${o.danger ? 'danger' : 'primary'}" data-m="ok">${esc(o.ok || 'ตกลง')}</button></div></div>`;
      rootEl.hidden = false;
      const close = (v) => { rootEl.hidden = true; rootEl.innerHTML = ''; resolve(v); };
      $('[data-m=x]', rootEl).onclick = () => close(null);
      $('[data-m=ok]', rootEl).onclick = () => { const v = o.read ? o.read(rootEl) : true; close(v); };
      const f = $('textarea,input', rootEl); if (f) f.focus();
    });
  }
  async function delStudent(r) {
    const nm = txt(L.stu, r, 2);
    if (nm.trim()) {
      const ok = await uiModal({ title: 'ลบนักเรียน', body: `<p>ลบ <b>${esc(nm)}</b> พร้อมคะแนน คุณลักษณะ และกิจกรรมของนักเรียนคนนี้ทั้งหมด? ย้อนกลับไม่ได้</p>`, ok: 'ลบ', danger: true });
      if (!ok) return;
    }
    A().batch(() => {
      for (const c of [2, 3, 4]) setv(L.stu, r, c, null);
      for (const s of subjects()) for (const c of SC_EDIT) setv(L.score(s.slot), stuScoreRow(r), c, null);
      for (const t of [1, 2]) {
        for (let c = 3; c < 3 + AS.trait.max; c++) setv(L.trait(t), stuTraitRow(r), c, null);
        for (let c = 3; c < 3 + AS.act.max; c++) setv(L.act(t), stuTraitRow(r), c, null);
      }
    });
    if (currentStudent() === nm) { const f = students()[0]; WB().setValue(L.sum, { r: 3, c: 2 }, f ? f.name : null); }
    refresh();
  }

  // --- รายวิชา
  function vSubjects() {
    const list = subjects(); const have = new Set(list.map(s => s.r));
    const pend = [...U.pendSub].filter(r => !have.has(r));
    const rows = [...list.map(s => s.r), ...pend].sort((a, b) => a - b);
    const cnt = abCounts();
    const body = rows.length ? rows.map(r => subCard(r, cnt)).join('') : '<div class="card empty"><b>ยังไม่มีรายวิชา</b>กด “เพิ่มวิชา”</div>';
    return `<p class="sub">แต่ละความสามารถรองรับได้ไม่เกิน 3 วิชา (เหมือนในไฟล์ Excel)</p>
      <div class="bar"><span><b>${list.length}</b> / ${L.maxSub} วิชา</span><span class="grow"></span><button class="btn primary" data-act="sub-add"${list.length + pend.length >= L.maxSub ? ' disabled' : ''}>＋ เพิ่มวิชา</button></div>${body}`;
  }
  function abCounts() {
    const c = {}; for (const s of subjects()) if (s.ab) c[s.ab] = (c[s.ab] || 0) + 1; return c;
  }
  function subCard(r, cnt) {
    const sr = r + 3; const cur = txt(L.subj, r, 2);
    const opts = L.abText.map((t, i) => {
      const full = (cnt[t] || 0) >= 3 && t !== cur;
      return `<option value="${esc(t)}"${t === cur ? ' selected' : ''}${full ? ' disabled' : ''}>ข้อ ${i + 1}: ${esc(oneLine(t).slice(0, 60))}${full ? ' (เต็ม 3 วิชา)' : ''}</option>`;
    }).join('');
    return `<div class="card" data-row="${r}">
      <div class="row sp" style="margin-bottom:8px"><b>วิชาที่ ${r - 1}</b><button class="btn danger sm" data-act="sub-del" data-r="${r}">ลบวิชา</button></div>
      <div class="grid2">
        ${field('ชื่อวิชา (ขึ้นบรรทัดใหม่ได้)', inputFor(L.subj, r, 1, { area: true, rows: 2, chk: 'subname', after: 'sub', ph: 'เช่น ภาษาไทย (การอ่าน)' }), 'full')}
        ${field('อยู่ในความสามารถข้อ', `<select ${bind(L.subj, r, 2, 't', ` data-old="${esc(cur)}" data-after="rerender"`)}><option value="">— เลือก —</option>${opts}</select>`)}
        ${field('รหัสวิชา', inputFor(L.sub, sr, 2, { ph: 'เช่น ท11101' }))}
        ${field('เวลาเรียน (ชั่วโมง/ปี)', inputFor(L.sub, sr, 4, { kind: 'n', mode: 'numeric' }))}
        ${field('กลุ่มสาระการเรียนรู้', inputFor(L.sub, sr, 5))}
        ${field('ครูประจำวิชา (เว้นว่าง = ใช้ครูประจำชั้น)', inputFor(L.sub, sr, 6))}
      </div></div>`;
  }
  function addSubject() {
    for (let r = L.subFirst; r <= L.subLast; r++) {
      if (!txt(L.subj, r, 1).trim() && !U.pendSub.has(r)) { U.pendSub.add(r); refresh(); const el = $(`[data-row="${r}"] textarea`); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } return; }
    }
    A().toast('ครบจำนวนวิชาสูงสุดแล้ว', 'warn');
  }
  async function delSubject(r) {
    const nm = txt(L.subj, r, 1);
    if (nm.trim()) {
      const ok = await uiModal({ title: 'ลบวิชา', body: `<p>ลบวิชา <b>${esc(oneLine(nm))}</b> พร้อมคะแนนของวิชานี้ทั้งหมด? ย้อนกลับไม่ได้</p>`, ok: 'ลบ', danger: true });
      if (!ok) return;
    }
    A().batch(() => {
      const slot = r - 1;
      for (const st of students()) for (const c of SC_EDIT) setv(L.score(slot), stuScoreRow(st.r), c, null);
      for (const c of [2, 4, 5, 6]) setv(L.sub, r + 3, c, null);
      setv(L.subj, r, 2, null); setv(L.subj, r, 1, null);
    });
    U.pendSub.delete(r); if (U.slot === r) U.slot = null;
    refresh();
  }

  // --- ความสามารถ
  function vAbilities() {
    const subs = subjects(), n = L.ab.length;
    return `<p class="sub">ความสามารถชั้นปีตามหลักสูตร 2568 — แก้ชื่อหัวข้อได้ เลือกระดับที่คาดหวัง (ใช้เปรียบเทียบพัฒนาการใน ปพ.6) · สูงสุด ${AB_MAX} ข้อ</p>` + L.ab.map((r, i) => {
      const exp = txt(L.sum, r, 2); const t = L.abText[i];
      const mine = subs.filter(s => s.ab === t);
      const br = L.behRow[i];
      return `<div class="card"><div class="row" style="align-items:flex-start;flex-wrap:nowrap"><div class="badge">${i + 1}</div><div style="flex:1;min-width:0">
        ${field('ชื่อความสามารถข้อ ' + (i + 1), inputFor(L.sum, 6 + i, 9, { area: true, rows: 2, after: 'abname' }))}
        <div class="chips" style="margin:6px 0">${mine.length ? mine.map(s => `<span class="chip">${esc(oneLine(s.name))}</span>`).join('') : '<span class="chip warn">ยังไม่มีวิชาในข้อนี้</span>'}</div></div></div>
        <div class="fld"><span>ระดับที่คาดหวัง</span><div class="seg" role="group">${LEVELS.map(l => `<button data-act="exp" data-i="${i}" data-v="${l}" class="${exp === l ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${br ? `<details class="more"><summary>แก้คำอธิบายพฤติกรรมแต่ละระดับ</summary><div class="grid2" style="margin-top:8px">${LEVELS.map((l, k) => field(l, inputFor(L.beh, br, 2 + k, { area: true, rows: 3 }))).join('')}</div></details>` : ''}
      </div>`;
    }).join('') + stageExpCard() + `<div class="card soft"><div class="row"><button class="btn primary" data-act="ab-add"${n >= AB_MAX ? ' disabled' : ''}>＋ เพิ่มความสามารถ</button><button class="btn danger" data-act="ab-del"${n <= 1 ? ' disabled' : ''}>－ ลดความสามารถ (ข้อสุดท้าย)</button><span class="hint">ใช้ ${n} / ${AB_MAX} ข้อ</span></div></div>`;
  }
  // ป.3 / ป.6: ระดับที่คาดหวังของหน้าสรุปประถมตอนต้น/ตอนปลาย (ผลที่ได้และพัฒนาการคำนวณอัตโนมัติ)
  function stageExpCard() {
    if (!L.stage) return '';
    const rows = readStage();
    return `<div class="card"><h3>ระดับที่คาดหวัง — ${esc(L.stageLabel)}</h3><p class="hint">ใช้ในหน้า “${esc(L.stage)}” ระดับที่ได้คำนวณจากคะแนนทั้งปีอัตโนมัติ และเทียบกับระดับที่คาดหวังเป็นพัฒนาการ</p>
      ${rows.map(a => `<div class="stexp"><div><b>${a.i + 1}.</b> ${a.group ? `<span class="hint">${esc(oneLine(a.group))} · </span>` : ''}${esc(oneLine(a.text).split(' ผู้เรียน')[0])}</div>${expSeg(a)}</div>`).join('')}</div>`;
  }
  // แก้ชื่อความสามารถ: วิชาที่ผูกกับชื่อเดิมย้ายตามชื่อใหม่
  function renameAbility(oldName, newName) {
    if (!oldName || oldName === newName) return;
    A().batch(() => { for (const s of subjects()) if (s.ab === oldName) setv(L.subj, s.r, 2, newName || null); });
  }
  function abAdd() {
    const i = L.ab.length; if (i >= AB_MAX) return;
    A().batch(() => { setv(L.sum, 6 + i, 9, 'ความสามารถข้อที่ ' + (i + 1) + ' (แก้ชื่อได้)'); if (!txt(L.sum, L.abAll[i], 2)) setExpected(i, 'เริ่มต้น', true); });
    refresh();
  }
  async function abDel() {
    const i = L.ab.length - 1; if (i < 1) return;
    const name = abName(i), mine = subjects().filter(s => s.ab === name);
    const ok = await uiModal({ title: 'ลดความสามารถ', body: `<p>ลบ <b>ความสามารถข้อ ${i + 1}</b>${mine.length ? ` และยกเลิกการผูกวิชา ${mine.map(s => esc(oneLine(s.name))).join(', ')}` : ''}?</p>`, ok: 'ลบ', danger: true });
    if (!ok) return;
    A().batch(() => { for (const s of mine) setv(L.subj, s.r, 2, null); setv(L.sum, 6 + i, 9, null); });
    refresh();
  }
  function setExpected(i, lv, quiet) {
    A().batch(() => {
      const r = L.abAll[i]; setv(L.sum, r, 2, lv);
      for (const t of [1, 2]) if (L.term[t]) setv(L.term[t], r, 2, lv);
    });
    if (!quiet) refresh();
  }

  // ---------------------------------------------------------------- คะแนน
  function curSubject() {
    const subs = subjects(); if (!subs.length) return null;
    return subs.find(s => s.r === U.slot) || (U.slot = subs[0].r, subs[0]);
  }
  function vScores() {
    const subs = subjects();
    if (!subs.length) return `<div class="card empty"><b>ยังไม่มีรายวิชา</b>เพิ่มวิชาก่อนจึงจะกรอกคะแนนได้<br><br><button class="btn primary" data-act="goto" data-to="data:subjects">ไปเพิ่มวิชา</button></div>`;
    const stu = students();
    if (!stu.length) return `<div class="card empty"><b>ยังไม่มีนักเรียน</b>เพิ่มรายชื่อนักเรียนก่อน<br><br><button class="btn primary" data-act="goto" data-to="data:students">ไปเพิ่มนักเรียน</button></div>`;
    const cur = curSubject(); const sc = L.score(cur.slot); const T = U.scoreTerm;
    const idx = subs.indexOf(cur);
    const pickBar = `<div class="pick"><button class="btn" data-act="subj-step" data-d="-1" aria-label="วิชาก่อนหน้า"${idx === 0 ? ' disabled' : ''}>‹</button>
      <select data-act-change="subj">${subs.map(s => `<option value="${s.r}"${s.r === cur.r ? ' selected' : ''}>${esc(oneLine(s.name))}</option>`).join('')}</select>
      <button class="btn" data-act="subj-step" data-d="1" aria-label="วิชาถัดไป"${idx === subs.length - 1 ? ' disabled' : ''}>›</button></div>`;
    const termSeg = `<div class="bar" style="margin-top:10px">${seg([[1, 'เทอม 1'], [2, 'เทอม 2'], ['y', 'สรุปทั้งปี']], T, 'sterm')}${T === 'y' ? '' : `<span class="grow"></span>${xlBtn('score')}`}</div>`;
    const mxs = (c) => num(sc, 4, c) ?? '';
    if (T === 'y') {
      const yc = [[SC[1].keep, 'เก็บ เทอม 1'], [SC[1].exam, 'สอบ เทอม 1'], [SC[2].keep, 'เก็บ เทอม 2'], [SC[2].exam, 'สอบ เทอม 2']];
      const head = `<tr><th class="no">ที่</th><th class="stk">ชื่อ - สกุล</th>${yc.map(([c, l]) => `<th>${l}<br><small>(${mxs(c)})</small></th>`).join('')}<th>รวมทั้งปี<br><small>(${mxs(SC.year)})</small></th><th>ระดับทั้งปี</th></tr>`;
      const body = stu.map(st => { const r = stuScoreRow(st.r); return `<tr><td class="no">${esc(st.no)}</td><td class="stk">${esc(st.name)}</td>${yc.map(([c]) => rocell(sc, r, c)).join('')}${rocell(sc, r, SC.year, 'b')}${rocell(sc, r, SC.yearLvl, 'lvl')}</tr>`; }).join('');
      return `${pickBar}${termSeg}<div class="card soft"><span class="hint">ระดับคำนวณจากคะแนนรวมทั้งปี ตามเกณฑ์ ร้อยละ 75 / 65 / 55</span></div>${gridWrap('score', head, body)}`;
    }
    const inds = activeInds(sc, T), mf = (c) => inputFor(sc, 4, c, { kind: 'n', mode: 'numeric', after: 'maxchg' });
    const maxBox = `<div class="card soft"><div class="hint" style="margin-bottom:6px">คะแนนเต็มรายตัวชี้วัด (คะแนนเก็บ = ผลรวมคะแนนตัวชี้วัด)</div>
      <div class="maxbox">${inds.map((c, i) => `<div class="indset"><b>ตัวชี้วัด ${i + 1}</b>${field('ชื่อ', inputFor(sc, IND_NAME_ROW, c, { after: 'rerender', ph: 'ตัวชี้วัด ' + (i + 1) }), 'wname')}${field('คะแนนเต็ม', mf(c))}</div>`).join('')}
      <div class="row indbtn"><button class="btn sm" data-act="ind-add"${inds.length >= NIND ? ' disabled' : ''}>＋ เพิ่มตัวชี้วัด</button><button class="btn sm" data-act="ind-del"${inds.length <= 1 ? ' disabled' : ''}>－ ลดตัวชี้วัด</button></div></div>
      <div class="maxbox" style="margin-top:10px"><span class="hint">คะแนนเก็บ เต็ม <b>${num(sc, 4, SC[T].keep) ?? 0}</b></span>${field('คะแนนสอบ เต็ม', mf(SC[T].exam))}<span class="hint">รวมเต็ม <b>${mxs(SC[T].tot)}</b></span>${subs.length > 1 ? `<button class="btn sm" data-act="max-all" title="คัดลอกจำนวนตัวชี้วัดและคะแนนเต็มของวิชานี้ไปใช้กับวิชาอื่นทุกวิชา">⇉ ใช้คะแนนเต็มนี้กับทุกวิชา</button>` : ''}</div></div>`;
    // คอลัมน์ที่กรอกได้ (เรียงตามตาราง): ตัวชี้วัด..., สอบ, หมายเหตุ
    const head = `<tr><th class="no">ที่</th><th class="stk">ชื่อ - สกุล</th>${inds.map((c, i) => `<th title="${esc(indLabel(sc, c, i))}">${esc(indLabel(sc, c, i))}<br><small>(${mxs(c)})</small></th>`).join('')}
      <th class="ro">เก็บ<br><small>(${mxs(SC[T].keep)})</small></th><th>สอบ<br><small>(${mxs(SC[T].exam)})</small></th><th class="ro">รวม<br><small>(${mxs(SC[T].tot)})</small></th><th class="ro">ระดับ</th><th class="wide">หมายเหตุ</th></tr>`;
    const body = stu.map((st, i) => {
      const r = stuScoreRow(st.r);
      return `<tr><td class="no">${esc(st.no)}</td><td class="stk">${esc(st.name)}</td>
        ${inds.map((c, j) => gcell(sc, r, c, 'n', i, j)).join('')}${rocell(sc, r, SC[T].keep)}${gcell(sc, r, SC[T].exam, 'n', i, inds.length)}${rocell(sc, r, SC[T].tot, 'b')}${rocell(sc, r, SC[T].lvl, 'lvl')}${gcell(sc, r, SC.note, 't', i, inds.length + 1, { cls: 'wide', align: 'left' })}</tr>`;
    }).join('');
    return `${pickBar}${termSeg}${maxBox}<p class="sub">ใช้งานเหมือนชีท Excel: คลิกช่องแล้วพิมพ์ ลูกศร/Enter เลื่อนช่อง หรือคัดลอกคะแนนหลายช่องจาก Excel มาวาง (Ctrl+V) ได้ทันที</p>${gridWrap('score', head, body)}`;
  }

  // ---------------------------------------------------------------- ตารางแบบชีท (ใช้ร่วม นักเรียน / คะแนน / ประเมิน)
  // ช่องกรอก: data-gr/data-gc = ตำแหน่งในตาราง (ใช้เลื่อนด้วยลูกศรและวางหลายช่อง)
  function gcell(sheet, r, c, kind, gr, gc, o) {
    o = o || {}; const raw = get(sheet, r, c); const v = raw === null || isPh(raw) ? '' : String(raw);
    const dis = kind === 'n' && sheet !== L.stu && (num(sheet, 4, c) ?? 0) <= 0;
    const extra = ` data-old="${esc(v)}" data-gr="${gr}" data-gc="${gc}" data-after="${o.after || 'grid'}"${o.lo !== undefined ? ` data-lo="${o.lo}" data-hi="${o.hi}"` : ''}`;
    const cls = kind === 'pass' ? ` ${v === 'ผ่าน' ? 'ok' : v === 'ไม่ผ่าน' ? 'no' : ''}` : '';
    return `<td class="gtd ${o.cls || ''}"><input class="gc${cls}" ${bind(sheet, r, c, kind)}${extra} type="text" value="${esc(v)}"${kind === 'n' ? ' inputmode="decimal"' : ''}${o.align ? ` style="text-align:${o.align}"` : ''} autocomplete="off" spellcheck="false"${dis ? ' disabled title="ตั้งคะแนนเต็มก่อน"' : ''}></td>`;
  }
  // ช่องแสดงผล (คำนวณ): อัปเดตเองหลังแก้ไขในตาราง
  const roHtml = (sheet, r, c, fmt) => { const v = get(sheet, r, c); return fmt === 'lvl' ? (v ? lvChip(String(v)) : '<span class="hint">–</span>') : fmt === 'pass' ? passChip(v === null ? '' : String(v)) : fmt === 'b' ? `<b>${v ?? '–'}</b>` : esc(v ?? '–'); };
  const rocell = (sheet, r, c, fmt) => `<td class="ro" data-ro="${esc(sheet)}|${r}|${c}|${fmt || ''}">${roHtml(sheet, r, c, fmt)}</td>`;
  const gridWrap = (kind, head, body, cls) => `<div class="tw ${cls || ''}"><table class="t sheet ${cls || ''}" data-grid="${kind}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  function updateRo(scope) {
    $$('[data-ro]', scope).forEach(td => { const [s, r, c, f] = td.dataset.ro.split('|'); td.innerHTML = roHtml(s, +r, +c, f); });
  }
  const gridAt = (tbl, gr, gc) => $(`input.gc[data-gr="${gr}"][data-gc="${gc}"]`, tbl);
  function gridMove(el, dr, dc) {
    const nx = gridAt(el.closest('table'), +el.dataset.gr + dr, +el.dataset.gc + dc);
    if (nx) { nx.focus(); nx.select(); nx.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    return !!nx;
  }
  // แปลงค่าที่พิมพ์/วาง ตามชนิดช่อง (undefined = ไม่ถูกต้อง)
  const normSex = (x) => /^(ช|ชาย|ด\.?ช\.?|เด็กชาย|m|male)$/i.test(x) ? 'ชาย' : /^(ญ|หญิง|ด\.?ญ\.?|เด็กหญิง|f|female)$/i.test(x) ? 'หญิง' : x === '' ? null : undefined;
  const normPass = (x) => /^(ผ่าน|ผ|✓|✔|1|\/|p|pass)$/i.test(x) ? 'ผ่าน' : /^(ไม่ผ่าน|มผ|✗|✘|0|x|f|fail)$/i.test(x) ? 'ไม่ผ่าน' : x === '' || x === '-' ? null : undefined;
  const guessSex = (name) => /^(เด็กชาย|ด\.ช\.|ดช\.?|นาย)/.test(name) ? 'ชาย' : /^(เด็กหญิง|ด\.ญ\.|ดญ\.?|นางสาว|นาง)/.test(name) ? 'หญิง' : null;
  function convert(kind, x) {
    x = String(x ?? '').trim();
    if (kind === 'n') return toNum(x);
    if (kind === 'sex') return normSex(x);
    if (kind === 'pass') return normPass(x);
    return x === '' ? null : x;
  }
  // หลังแก้ชื่อนักเรียน: เดาเพศจากคำนำหน้า และตั้งนักเรียนที่เลือกในรายงานถ้ายังไม่มี
  function afterStudentNames(rows) {
    for (const r of rows) { const nm = txt(L.stu, r, 2); if (nm && !txt(L.stu, r, 3)) { const g = guessSex(nm); if (g) setv(L.stu, r, 3, g); } }
    ensureCurrentStudent();
  }

  // ---------------------------------------------------------------- วางข้อมูลจาก Excel / Google Sheets
  // ข้อความที่คัดลอกจากตาราง: แถวคั่นด้วยขึ้นบรรทัด คอลัมน์คั่นด้วย Tab
  const parseGrid = (s) => String(s || '').replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
  const toNum = (x) => { if (x === '' || x === '-' || x === '–') return null; const n = Number(String(x).replace(/,/g, '').replace(/%$/, '')); return isFinite(n) ? n : undefined; };
  // เขียนค่าลงหลายช่อง คืนจำนวนที่สำเร็จ/ไม่ผ่านเงื่อนไข (ไม่แสดงข้อความเตือนทีละช่อง)
  function writeMany(list) {
    let ok = 0, bad = 0;
    A().batch(() => { for (const [s, r, c, v] of list) { if (v === undefined) { bad++; continue; } if (A().validate(s, r, c, v)) { bad++; continue; } if (setv(s, r, c, v)) ok++; else bad++; } });
    return { ok, bad };
  }
  // วางตารางลงช่องใดก็ได้ในตาราง: เริ่มที่ช่องที่เลือก กระจายลงล่างและไปทางขวา เหมือน Excel
  function onPaste(e) {
    const el = e.target; if (!el.matches || !el.matches('input.gc')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.replace(/\n+$/, ''))) return;   // ค่าเดียว: วางตามปกติ แล้วบันทึกเมื่อออกจากช่อง
    e.preventDefault();
    const tbl = el.closest('table'), gr0 = +el.dataset.gr, gc0 = +el.dataset.gc, list = [], stuRows = [];
    let outside = 0;
    parseGrid(text).forEach((cells, i) => cells.forEach((x, j) => {
      const t = gridAt(tbl, gr0 + i, gc0 + j);
      if (!t || t.disabled) { if (String(x).trim() !== '') outside++; return; }
      const s = t.dataset.s, r = +t.dataset.r, c = +t.dataset.c;
      let v = convert(t.dataset.t, x);
      if (typeof v === 'number' && t.dataset.lo !== undefined && (v < +t.dataset.lo || v > +t.dataset.hi)) v = undefined;
      list.push([s, r, c, v]);
      if (s === L.stu && c === 2) stuRows.push(r);
    }));
    const res = writeMany(list);
    if (stuRows.length) A().batch(() => afterStudentNames(stuRows));
    let msg = `วางข้อมูลแล้ว ${res.ok} ช่อง`;
    if (res.bad) msg += ` · ข้าม ${res.bad} ช่อง (ค่าไม่ถูกต้องหรือเกินคะแนนเต็ม)`;
    if (outside) msg += ` · ${outside} ค่าเกินขอบตาราง`;
    A().toast(msg, res.bad || outside ? 'warn' : 'ok');
    const kind = tbl.dataset.grid; refresh();
    const back = gridAt($(`table[data-grid="${kind}"]`), gr0, gc0); if (back) back.focus();
  }
  function onKey(e) {
    const el = e.target; if (!el.matches || !el.matches('input.gc')) return;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0, atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    let mv = null;
    if (e.key === 'Enter') mv = [e.shiftKey ? -1 : 1, 0];
    else if (e.key === 'ArrowDown') mv = [1, 0];
    else if (e.key === 'ArrowUp') mv = [-1, 0];
    else if (e.key === 'ArrowRight' && (atEnd || all)) mv = [0, 1];
    else if (e.key === 'ArrowLeft' && (atStart || all)) mv = [0, -1];
    else if (e.key === ' ' && el.dataset.t === 'pass') { e.preventDefault(); const v = el.value; el.value = v === '' ? 'ผ่าน' : v === 'ผ่าน' ? 'ไม่ผ่าน' : ''; el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (!mv) return;
    e.preventDefault();
    if (el.value !== (el.dataset.old || '')) el.dispatchEvent(new Event('change', { bubbles: true }));
    gridMove(el, mv[0], mv[1]);
  }

  // เพิ่ม/ลดตัวชี้วัดของเทอมที่เลือก (ตั้ง/ล้างคะแนนเต็มในแถว 4 ของชีทคะแนน)
  function indAdd() {
    const sc = L.score(curSubject().slot), T = U.scoreTerm;
    const c = SC[T].ind.find(x => !activeInds(sc, T).includes(x)); if (!c) return;
    setv(sc, 4, c, 10); refresh();
  }
  // คัดลอกโครงคะแนนเต็ม (จำนวนตัวชี้วัด + คะแนนเต็มแต่ละตัว + คะแนนสอบ) ของวิชานี้ไปวิชาอื่นทุกวิชา
  // เช่น โรงเรียนเก็บเทอมละ 100: ตั้งวิชาเดียวแล้วกดปุ่มนี้ (ชื่อตัวชี้วัด / คะแนนที่กรอกแล้วไม่เปลี่ยน)
  async function maxAll() {
    const cur = curSubject(), sc = L.score(cur.slot), T = U.scoreTerm, inds = activeInds(sc, T);
    const mx = inds.map(c => num(sc, 4, c) ?? 0), ex = num(sc, 4, SC[T].exam) ?? 0;
    const others = subjects().filter(x => x.slot !== cur.slot);
    const which = await uiModal({ title: 'ใช้คะแนนเต็มนี้กับทุกวิชา', ok: 'ตั้งค่าทุกวิชา',
      body: `<p>คัดลอกคะแนนเต็มของ <b>${esc(oneLine(cur.name))}</b> เทอม ${T}:<br>ตัวชี้วัด ${inds.length} ตัว (${mx.join(' + ')}) + สอบ ${ex} = <b>รวม ${mx.reduce((a, b) => a + b, 0) + ex}</b></p>
        <p>ไปใช้กับอีก <b>${others.length} วิชา</b></p>
        <label class="chk"><input type="radio" name="mx-t" value="this" checked> เฉพาะเทอม ${T}</label>
        <label class="chk"><input type="radio" name="mx-t" value="both"> ทั้งเทอม 1 และเทอม 2</label>
        <p class="hint">ชื่อตัวชี้วัดและคะแนนที่กรอกไว้แล้วไม่เปลี่ยน — ตัวชี้วัดที่เกินจำนวนนี้และมีคะแนนกรอกไว้แล้วจะไม่ถูกลบ</p>`,
      read: (m) => $('input[name=mx-t]:checked', m).value });
    if (!which) return;
    const terms = which === 'both' ? [1, 2] : [T];
    let kept = 0;
    A().batch(() => {
      for (const o of others) for (const t of terms) {
        const osc = L.score(o.slot);
        SC[t].ind.forEach((c, i) => {
          if (i < mx.length) { setv(osc, 4, c, mx[i]); return; }
          if (get(osc, 4, c) === null) return;
          const used = students().some(st => get(osc, stuScoreRow(st.r), c) !== null);
          if (used) kept++; else setv(osc, 4, c, null);
        });
        setv(osc, 4, SC[t].exam, ex);
      }
      if (which === 'both') {   // วิชานี้เอง: อีกเทอมให้เหมือนกันด้วย
        const t2 = T === 1 ? 2 : 1;
        SC[t2].ind.forEach((c, i) => { if (i < mx.length) setv(sc, 4, c, mx[i]); else if (get(sc, 4, c) !== null && !students().some(st => get(sc, stuScoreRow(st.r), c) !== null)) setv(sc, 4, c, null); });
        setv(sc, 4, SC[t2].exam, ex);
      }
    });
    A().toast(`ตั้งคะแนนเต็มให้ ${others.length} วิชาแล้ว${kept ? ` · คงตัวชี้วัดที่มีคะแนนแล้วไว้ ${kept} ช่อง` : ''}`, kept ? 'warn' : 'ok');
    refresh();
  }
  async function indDel() {
    const sc = L.score(curSubject().slot), T = U.scoreTerm, inds = activeInds(sc, T);
    if (inds.length <= 1) return;
    const c = inds[inds.length - 1], stu = students();
    const used = stu.filter(st => get(sc, stuScoreRow(st.r), c) !== null).length;
    if (used) {
      const ok = await uiModal({ title: 'ลดตัวชี้วัด', body: `<p>ลบ <b>ตัวชี้วัด ${inds.length}</b> ของเทอม ${T} พร้อมคะแนนที่กรอกไว้ ${used} คน? ย้อนกลับไม่ได้</p>`, ok: 'ลบ', danger: true });
      if (!ok) return;
    }
    A().batch(() => { for (const st of stu) setv(sc, stuScoreRow(st.r), c, null); setv(sc, 4, c, null); setv(sc, IND_NAME_ROW, c, null); });
    refresh();
  }
  function vAssess() {
    const stu = students();
    if (!stu.length) return `<div class="card empty"><b>ยังไม่มีนักเรียน</b><br><button class="btn primary" data-act="goto" data-to="data:students">ไปเพิ่มนักเรียน</button></div>`;
    const t = U.aTerm, kind = U.kind, Y = t === 'y';
    const sheet = asSheet(kind, t), kc = AS[kind].sum, heads = activeItems(kind);
    const names = `<div class="card soft"><div class="hint" style="margin-bottom:6px">ชื่อหัวข้อ${kind === 'trait' ? 'คุณลักษณะ' : 'กิจกรรม'} (ใช้ทั้งเทอม 1 และเทอม 2) · สูงสุด ${AS[kind].max} หัวข้อ</div>
      <div class="maxbox">${heads.map((c, i) => field('หัวข้อ ' + (i + 1), inputFor(asSheet(kind, 1), 3, c, { after: 'rerender' }), 'wname')).join('')}
      <div class="row indbtn"><button class="btn sm" data-act="as-add"${heads.length >= AS[kind].max ? ' disabled' : ''}>＋ เพิ่มหัวข้อ</button><button class="btn sm" data-act="as-del"${heads.length <= 1 ? ' disabled' : ''}>－ ลดหัวข้อ</button>
      <button class="btn sm" data-act="as-school"${A().otherRoomCount() < 1 ? ' disabled title="โรงเรียนมีห้องเดียว"' : ''} title="ตั้งชื่อหัวข้อแบบนี้ให้ทุกชั้นทุกห้องของโรงเรียน">🏫 ใช้หัวข้อนี้ทั้งโรงเรียน</button></div></div></div>`;
    const head = `<tr><th class="no">ที่</th><th class="stk">ชื่อ - สกุล</th>${heads.map(c => Y ? `<th style="cursor:default">${esc(oneLine(txt(sheet, 3, c)))}</th>` : `<th data-act="acol" data-c="${c}" title="แตะเพื่อตั้งทั้งห้องเป็น ผ่าน">${esc(oneLine(txt(sheet, 3, c)))}</th>`).join('')}<th class="ro" style="min-width:70px;cursor:default">สรุป</th></tr>`;
    const body = stu.map((st, i) => {
      const r = stuTraitRow(st.r);
      return `<tr><td class="no">${esc(st.no)}</td><td class="stk">${esc(st.name)}</td>${heads.map((c, j) => Y ? rocell(sheet, r, c, 'pass') : gcell(sheet, r, c, 'pass', i, j)).join('')}${rocell(sheet, r, kc, 'pass')}</tr>`;
    }).join('');
    return `<div class="bar">${seg([['trait', 'คุณลักษณะอันพึงประสงค์'], ['act', 'กิจกรรมพัฒนาผู้เรียน']], kind, 'akind')}${seg([[1, 'เทอม 1'], [2, 'เทอม 2'], ['y', 'ทั้งปี']], t, 'aterm')}</div>${names}
      ${Y ? `<p class="sub">ผลทั้งปีคำนวณจากเทอม 1 และเทอม 2 อัตโนมัติ (แก้ไขที่หน้าเทอม): หัวข้อที่ <b>ไม่ผ่าน</b> เทอมใดเทอมหนึ่ง = ไม่ผ่าน · <b>ผ่าน</b> ทั้ง 2 เทอม = ผ่าน · ยังประเมินไม่ครบ = ว่าง</p>${gridWrap('assess', head, body)}` : `<p class="sub">ใช้งานเหมือนชีท Excel: พิมพ์ <b>ผ่าน</b> / <b>ไม่ผ่าน</b> (หรือ 1 / 0, ✓ / ✗) · Space สลับค่า · ดับเบิลคลิกเพื่อสลับ · วางหลายช่องจาก Excel ได้ · แตะหัวคอลัมน์เพื่อตั้งทั้งห้องเป็น “ผ่าน”</p>
      <div class="bar"><button class="btn" data-act="aall" data-v="ผ่าน">ตั้งทั้งหมดเป็น “ผ่าน”</button><button class="btn danger" data-act="aall" data-v="">ล้างทั้งหมด</button><span class="grow"></span>${xlBtn('assess')}</div>
      ${gridWrap('assess', head, body)}`}`;
  }
  function asAdd() {
    const kind = U.kind, used = activeItems(kind);
    const c = range(3, AS[kind].max).find(x => !used.includes(x)); if (!c) return;
    setv(asSheet(kind, 1), 3, c, 'หัวข้อใหม่'); refresh();
  }
  async function asDel() {
    const kind = U.kind, used = activeItems(kind); if (used.length <= 1) return;
    const c = used[used.length - 1], stu = students();
    const filled = [1, 2].reduce((n, t) => n + stu.filter(st => txt(asSheet(kind, t), stuTraitRow(st.r), c)).length, 0);
    const ok = await uiModal({ title: 'ลดหัวข้อ', body: `<p>ลบหัวข้อ <b>${esc(oneLine(txt(asSheet(kind, 1), 3, c)))}</b>${filled ? ` พร้อมผลประเมินที่บันทึกไว้ ${filled} ช่อง (ทั้ง 2 เทอม)` : ''}?</p>`, ok: 'ลบ', danger: true });
    if (!ok) return;
    A().batch(() => { for (const t of [1, 2]) for (const st of stu) setv(asSheet(kind, t), stuTraitRow(st.r), c, null); setv(asSheet(kind, 1), 3, c, null); });
    refresh();
  }
  // ใช้ชื่อหัวข้อคุณลักษณะ / กิจกรรมชุดนี้กับทุกชั้นทุกห้อง (ผลประเมินที่กรอกไว้ไม่หาย)
  async function asSchool() {
    const kind = U.kind, sh = asSheet(kind, 1), label = kind === 'trait' ? 'คุณลักษณะอันพึงประสงค์' : 'กิจกรรมพัฒนาผู้เรียน';
    const n = A().otherRoomCount(); if (n < 1) return;
    const cols = range(3, AS[kind].max), heads = cols.filter(c => txt(sh, 3, c).trim());
    const ok = await uiModal({ title: 'ใช้หัวข้อนี้ทั้งโรงเรียน', ok: 'ใช้กับทุกห้อง',
      body: `<p>ตั้งหัวข้อ<b>${label}</b> ${heads.length} หัวข้อนี้ให้<b>ทุกชั้นทุกห้อง</b> (อีก ${n} ห้อง)</p>
        <ol class="hint" style="margin:6px 0 8px 18px">${heads.map(c => `<li>${esc(oneLine(txt(sh, 3, c)))}</li>`).join('')}</ol>
        <p class="hint">หัวข้อที่ห้องอื่นตั้งไว้จะถูกแทนที่ · ผลประเมินที่กรอกไว้แล้วไม่หาย</p>` });
    if (!ok) return;
    const m = {}; for (const c of cols) { const v = get(sh, 3, c); m[P.numToCol(c) + '3'] = v === null || v === undefined || String(v).trim() === '' ? null : v; }
    A().toast('กำลังตั้งค่าให้ทุกห้อง...', 'ok');
    const { done, fail } = await A().applyToSchool({ [sh]: m });
    if (fail.length) A().toast(`ตั้งค่าแล้ว ${done.length} ห้อง · ไม่สำเร็จ: ${fail.join(', ')} (ลองใหม่อีกครั้ง)`, 'warn');
    else A().toast(`ใช้หัวข้อ${label}นี้กับทุกห้องแล้ว (${done.length} ห้อง)`, 'ok');
  }
  const passChip = (v) => v ? `<span class="pass ${v === 'ผ่าน' ? 'ok' : 'no'}">${esc(v)}</span>` : '<span class="hint">–</span>';
  function assessSheet() { return U.kind === 'trait' ? L.trait(U.aTerm) : L.act(U.aTerm); }
  function setAssessAll(v, col) {
    const sheet = assessSheet(); const cols = col ? [col] : activeItems(U.kind);
    A().batch(() => { for (const st of students()) for (const c of cols) setv(sheet, stuTraitRow(st.r), c, v === '' ? null : v); });
    refresh();
  }

  // ---------------------------------------------------------------- รายงาน
  const currentStudent = () => { const v = get(L.sum, 3, 2); return v === null ? null : String(v); };
  // นักเรียนที่เลือกในรายงานต้องมีอยู่ในรายชื่อ (ไฟล์ต้นแบบบางชั้นมีชื่อตัวอย่างค้างอยู่) ไม่งั้นเลือกคนแรก
  function ensureCurrentStudent() {
    const cur = currentStudent(), list = students();
    if (cur && list.some(s => s.name === cur)) return;
    WB().setValue(L.sum, { r: 3, c: 2 }, list.length ? list[0].name : null);
  }
  function readReport(which) {
    const sheet = which === 'sum' ? L.sum : L.term[which]; const beh = which === 'sum' ? L.sumBeh : L.termBeh[which];
    return L.ab.map((r, i) => {
      const subs = [0, 1, 2].map(k => ({ name: txt(sheet, r + k, 5), max: num(sheet, r + k, 6), got: num(sheet, r + k, 7) })).filter(x => x.name.trim());
      const has = subs.some(x => x.got !== null); // ยังไม่มีคะแนนเลย = ยังไม่มีผล (กันสูตรต้นฉบับที่ให้ "เชี่ยวชาญ" เมื่อว่าง)
      return { i, text: txt(sheet, r, 1).replace(/^\s*\d+\s*\.\s*/, ''), exp: txt(sheet, r, 2), got: has ? txt(sheet, r, 3) : '', dev: has ? txt(sheet, r, 4) : '', subs, desc: beh ? txt(beh, 4 + i, 4) : '' };
    });
  }
  function passFor(st, which) {
    const ts = which === 'sum' ? [1, 2] : [which];
    const res = {};
    for (const [k, getSheet, kc] of [['trait', L.trait, AS.trait.sum], ['act', L.act, AS.act.sum]]) {
      const vals = ts.map(t => txt(getSheet(t), stuTraitRow(st.r), kc));
      res[k] = vals.every(v => v === 'ผ่าน') ? 'ผ่าน' : vals.some(v => v === 'ไม่ผ่าน') ? 'ไม่ผ่าน' : '';
    }
    return res;
  }
  function vReport() {
    const stu = students();
    if (!stu.length) return `<div class="card empty"><b>ยังไม่มีนักเรียน</b><br><button class="btn primary" data-act="goto" data-to="data:students">ไปเพิ่มนักเรียน</button></div>`;
    const W = U.repTerm;
    const top = `<div class="bar">${seg([['one', 'รายคน'], ['all', 'ทั้งห้อง']], U.repMode, 'rmode')}${seg([['sum', 'ทั้งปี'], [1, 'เทอม 1'], [2, 'เทอม 2'], ...(L.stage ? [['stage', L.stageLabel]] : [])], W, 'rterm')}</div>`;
    return top + (U.repMode === 'all' ? vClass() : vOne());
  }
  function vOne() {
    const stu = students(); const W = U.repTerm;
    let curName = currentStudent(); let st = stu.find(s => s.name === curName);
    if (!st) { st = stu[0]; WB().setValue(L.sum, { r: 3, c: 2 }, st.name); }
    const idx = stu.indexOf(st);
    const abs = W === 'stage' ? readStage() : readReport(W); const ps = passFor(st, W === 'stage' ? 'sum' : W);
    const sheetName = W === 'stage' ? L.stage : W === 'sum' ? L.sum : L.term[W];
    const cards = W === 'stage' ? stageCards(abs) : abs.map(a => `<div class="card abil"><header><div class="n">${a.i + 1}</div><div class="tx"><div>${esc(oneLine(a.text))}</div>
        <div class="lv"><span>คาดหวัง ${lvChip(a.exp)}</span><span>ได้ ${lvChip(a.got)}</span>${a.dev ? `<span class="dev ${a.dev === 'สูงกว่าเกณฑ์' ? 'up' : a.dev === 'เข้าใกล้เกณฑ์' ? 'down' : ''}">${esc(a.dev)}</span>` : ''}</div></div></header>
        ${a.subs.length ? `<div class="subs">${a.subs.map(s => { const pc = s.max ? Math.min(100, Math.round((s.got || 0) / s.max * 100)) : 0; return `<div class="sline"><span class="nm">${esc(oneLine(s.name))}</span><span><b>${s.got ?? '–'}</b> / ${s.max ?? ''}</span><div class="meter"><i style="width:${s.got === null ? 0 : pc}%"></i></div></div>`; }).join('')}</div>` : ''}
        ${a.desc && a.got ? `<div class="desc">${esc(a.desc)}</div>` : ''}</div>`).join('');
    return `<div class="card"><div class="pick"><button class="btn" data-act="stu-step" data-d="-1"${idx === 0 ? ' disabled' : ''} aria-label="คนก่อนหน้า">‹</button>
        <select data-act-change="stu-pick">${stu.map(s => `<option value="${esc(s.name)}"${s.name === st.name ? ' selected' : ''}>${esc(s.no)}. ${esc(s.name)}</option>`).join('')}</select>
        <button class="btn" data-act="stu-step" data-d="1"${idx === stu.length - 1 ? ' disabled' : ''} aria-label="คนถัดไป">›</button></div>
      <div class="rhead" style="margin-top:12px"><div><h3>${esc(st.name)}</h3><span class="hint">เลขที่ ${esc(st.no)} · ${esc(st.sex || '–')} · เข้าเรียน ${st.att ?? '–'}%</span></div>
        <div class="row"><span>กิจกรรม ${passChip2(ps.act)}</span><span>คุณลักษณะ ${passChip2(ps.trait)}</span></div></div></div>
      ${cards}
      <div class="card"><div class="row"><button class="btn primary" data-act="print-one">พิมพ์${W === 'stage' ? L.stageLabel : ' ปพ.6'} คนนี้</button><button class="btn" data-act="print-all">พิมพ์ทั้งห้อง</button><button class="btn" data-act="open-doc" data-n="${esc(sheetName)}">ดูแบบฟอร์มทางการ</button></div>
      <p class="hint">การพิมพ์: เลือก “บันทึกเป็น PDF” ในหน้าต่างพิมพ์ได้ (บนมือถือใช้เมนูแชร์/พิมพ์ของเบราว์เซอร์)</p></div>`;
  }
  const passChip2 = (v) => v ? `<span class="pass ${v === 'ผ่าน' ? 'ok' : 'no'}">${esc(v)}</span>` : '<span class="pass">ยังไม่ประเมิน</span>';
  function stepStudent(d) {
    const stu = students(); const i = stu.findIndex(s => s.name === currentStudent()); const n = stu[i + d]; if (!n) return;
    WB().setValue(L.sum, { r: 3, c: 2 }, n.name); refresh();
  }
  function vClass() {
    const stu = students(); const W = U.repTerm; const keep = currentStudent();
    if (W === 'stage') return vClassStage(stu, keep);
    const data = stu.map(st => { WB().setValue(L.sum, { r: 3, c: 2 }, st.name); return { st, abs: readReport(W).map(a => a.got) }; });
    WB().setValue(L.sum, { r: 3, c: 2 }, keep);
    const dist = L.ab.map((r, i) => { const c = [0, 0, 0, 0]; let n = 0; for (const d of data) { const k = lvIdx(d.abs[i]); if (k >= 0) { c[k]++; n++; } } return { c, n }; });
    const sumBar = `<div class="card"><h3>สรุปภาพรวมห้อง</h3>${L.ab.map((r, i) => { const d = dist[i]; return `<div style="margin:8px 0"><div class="row sp"><span>ข้อ ${i + 1} <span class="hint">${esc(oneLine(L.abText[i]).slice(0, 48))}…</span></span><span class="hint">${d.n ? d.c.map((x, k) => `${LEVELS[k]} ${x}`).join(' · ') : 'ยังไม่มีผล'}</span></div><div class="dist">${d.n ? d.c.map((x, k) => `<i class="d${k}" style="width:${x / d.n * 100}%"></i>`).join('') : ''}</div></div>`; }).join('')}</div>`;
    const head = `<tr><th class="stk">ชื่อ - สกุล</th>${L.ab.map((r, i) => `<th style="cursor:default">ข้อ ${i + 1}</th>`).join('')}</tr>`;
    const rows = data.map(d => `<tr data-act="open-stu" data-name="${esc(d.st.name)}" style="cursor:pointer"><td class="stk">${esc(d.st.no)}. ${esc(d.st.name)}</td>${d.abs.map(g => `<td>${lvChip(g)}</td>`).join('')}</tr>`).join('');
    return `${sumBar}<div class="tw"><table class="t"><thead>${head}</thead><tbody>${rows}</tbody></table></div><p class="hint">แตะชื่อนักเรียนเพื่อดูรายงานรายคน</p>
      <div class="card" style="margin-top:12px"><div class="row"><button class="btn primary" data-act="print-all">พิมพ์ ปพ.6 ทั้งห้อง</button></div></div>`;
  }
  // หน้าสรุปประถมตอนต้น (ป.3) / ตอนปลาย (ป.6): แถวความสามารถตั้งแต่แถว 5 จนถึงแถว 'กิจกรรมพัฒนาผู้เรียน'
  function readStage() {
    const sh = L.stage, beh = L.stageBeh, out = []; let group = '';
    const scored = readReport('sum').some(a => a.got);   // ยังไม่มีคะแนนเลย = ยังไม่มีผล
    for (let r = 5, i = 0; r <= 40; r++) {
      const a = txt(sh, r, 1).trim(), b = txt(sh, r, 2).trim();
      if (/^กิจกรรมพัฒนาผู้เรียน|^คุณลักษณะ/.test(a)) break;
      if (!a && !b) continue;
      if (a && b) group = a; else if (a) group = '';
      const exp = txt(sh, r, 4), got = scored ? txt(sh, r, 7) : '';
      out.push({ i, r, group, text: b || a, exp, got, dev: stageDev(exp, got), desc: beh ? txt(beh, 3 + i, 3) : '' });
      i++;
    }
    return out;
  }
  // เทียบระดับที่ได้กับที่คาดหวัง (คำเดียวกับคอลัมน์พัฒนาการใน ปพ.6)
  function stageDev(exp, got) {
    const e = lvIdx(exp), g = lvIdx(got);
    if (e < 0 || g < 0) return '';
    return g > e ? 'สูงกว่าเกณฑ์' : g < e ? 'เข้าใกล้เกณฑ์' : 'พอดีเกณฑ์';
  }
  const devChip = (d) => d ? `<span class="dev ${d === 'สูงกว่าเกณฑ์' ? 'up' : d === 'เข้าใกล้เกณฑ์' ? 'down' : ''}">${esc(d)}</span>` : '';
  const expSeg = (a) => `<div class="seg sm" role="group" aria-label="ระดับที่คาดหวัง">${LEVELS.map(l => `<button data-act="sexp" data-r="${a.r}" data-v="${l}" class="${a.exp === l ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  function stageCards(rows) {
    return rows.map(a => `<div class="card abil"><header><div class="n">${a.i + 1}</div><div class="tx">${a.group ? `<div class="hint">${esc(oneLine(a.group))}</div>` : ''}<div>${esc(oneLine(a.text))}</div>
      <div class="lv"><span>คาดหวัง</span>${expSeg(a)}<span>ได้ ${lvChip(a.got)}</span>${devChip(a.dev)}</div></div></header>${a.desc && a.got ? `<div class="desc">${esc(a.desc)}</div>` : ''}</div>`).join('');
  }
  function vClassStage(stu, keep) {
    const data = stu.map(st => { WB().setValue(L.sum, { r: 3, c: 2 }, st.name); return { st, rows: readStage() }; });
    WB().setValue(L.sum, { r: 3, c: 2 }, keep);
    const heads = (data[0] ? data[0].rows : readStage()).map(a => oneLine(a.text.split('\n')[0]));
    const head = `<tr><th class="stk">ชื่อ - สกุล</th>${heads.map(h => `<th style="cursor:default" title="${esc(h)}">${esc(h.length > 28 ? h.slice(0, 28) + '…' : h)}</th>`).join('')}</tr>`;
    const rows = data.map(d => `<tr data-act="open-stu" data-name="${esc(d.st.name)}" style="cursor:pointer"><td class="stk">${esc(d.st.no)}. ${esc(d.st.name)}</td>${d.rows.map(a => `<td>${lvChip(a.got)}${a.dev ? `<div class="hint" style="font-size:.75rem">${esc(a.dev)}</div>` : ''}</td>`).join('')}</tr>`).join('');
    return `<div class="card"><h3>${esc(L.stageLabel)} — ทั้งห้อง</h3><p class="hint">ผลสรุปจากคะแนนทั้งปีของชั้นนี้ (ตามสูตรในไฟล์ต้นฉบับ)</p></div><div class="tw"><table class="t"><thead>${head}</thead><tbody>${rows}</tbody></table></div><p class="hint">แตะชื่อนักเรียนเพื่อดูรายคน</p>
      <div class="card" style="margin-top:12px"><div class="row"><button class="btn primary" data-act="print-all">พิมพ์${esc(L.stageLabel)} ทั้งห้อง</button></div></div>`;
  }
  function afterReport() { /* ที่ว่างสำหรับต่อยอด */ }
  const whichKey = () => U.repTerm;

  // ---------------------------------------------------------------- เอกสาร
  // ---------------------------------------------------------------- รายงาน ปพ.5 (ตารางสรุปผล)
  function vReport5() {
    const subs = subjects(), T = U.p5Term;
    if (!subs.length) return `<div class="card empty"><b>ยังไม่มีรายวิชา</b><br><button class="btn primary" data-act="goto" data-to="data:subjects">ไปเพิ่มวิชา</button></div>`;
    return `<div class="bar">${seg([[1, 'เทอม 1'], [2, 'เทอม 2'], ['sum', 'ทั้งปี (รวม)']], T, 'p5term')}</div>
      ${p5Summary(T, subs)}`;
  }
  // ตารางสรุป ปพ.5 ของเทอมที่เลือก (คำนวณจากชีทคะแนน/คุณลักษณะ/กิจกรรม)
  function p5Summary(T, subs) {
    const stu = students(), n = stu.length;
    const col = T === 'sum' ? { tot: SC.year, lvl: SC.yearLvl } : { tot: SC[T].tot, lvl: SC[T].lvl };
    const male = stu.filter(s => s.sex === 'ชาย').length, female = stu.filter(s => s.sex === 'หญิง').length;
    const fmt = (x, d = 1) => x === null ? '–' : (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('th-TH');
    const rows = subs.map(s => {
      const sc = L.score(s.slot), max = num(sc, 4, col.tot), cnt = [0, 0, 0, 0];
      let sum = 0, got = 0;
      for (const st of stu) {
        const r = stuScoreRow(st.r), v = num(sc, r, col.tot);
        if (v === null) continue;
        got++; sum += v; const k = lvIdx(txt(sc, r, col.lvl)); if (k >= 0) cnt[k]++;
      }
      const avg = got ? sum / got : null;
      return { s, code: txt(L.sub, s.sr, 2), max, got, avg, pct: avg !== null && max ? avg / max * 100 : null, cnt };
    });
    const tot = rows.reduce((a, r) => { r.cnt.forEach((x, k) => a[k] += x); return a; }, [0, 0, 0, 0]), totN = tot.reduce((a, b) => a + b, 0);
    const filled = rows.reduce((a, r) => a + r.got, 0), need = rows.length * n;
    const allAvg = rows.filter(r => r.pct !== null); const avgPct = allAvg.length ? allAvg.reduce((a, r) => a + r.pct, 0) / allAvg.length : null;
    const distBar = (c) => { const m = c.reduce((a, b) => a + b, 0); return m ? `<div class="dist">${c.map((x, k) => `<i class="d${k}" style="width:${x / m * 100}%" title="${LEVELS[k]} ${x} คน"></i>`).join('')}</div>` : '<div class="hint">ยังไม่มีผล</div>'; };
    const lvCell = (x, k) => `<td class="num">${x ? `<span class="lvn l${k}">${x}</span>` : '<span class="hint">–</span>'}</td>`;
    // คุณลักษณะ / กิจกรรม: นับจากช่องสรุปของชีทเทอม (หรือชีททั้งปี)
    const asRow = (kind, label) => {
      const sh = T === 'sum' ? (kind === 'trait' ? L.traitY : L.actY) : asSheet(kind, T); if (!sh) return '';
      let ok = 0, no = 0;
      for (const st of stu) { const v = txt(sh, stuTraitRow(st.r), AS[kind].sum); if (v === 'ผ่าน') ok++; else if (v === 'ไม่ผ่าน') no++; }
      return `<tr><td style="text-align:left">${label}</td><td class="num"><span class="pass ok">${ok}</span></td><td class="num">${no ? `<span class="pass no">${no}</span>` : '0'}</td><td class="num hint">${n - ok - no}</td><td>${n ? `<div class="dist"><i class="d3" style="width:${ok / n * 100}%"></i><i class="d0" style="width:${no / n * 100}%"></i></div>` : ''}</td></tr>`;
    };
    const tLabel = T === 'sum' ? 'ทั้งปี' : 'เทอม ' + T;
    return `<div class="p5stats">
        <div class="stat"><b>${n}</b><span>นักเรียน (ชาย ${male} · หญิง ${female})</span></div>
        <div class="stat"><b>${rows.length}</b><span>รายวิชา</span></div>
        <div class="stat"><b>${need ? Math.round(filled / need * 100) : 0}%</b><span>กรอกคะแนนแล้ว (${tLabel})</span></div>
        <div class="stat"><b>${fmt(avgPct)}${avgPct === null ? '' : '%'}</b><span>คะแนนเฉลี่ยทุกวิชา</span></div>
      </div>
      <div class="card"><h3>สรุปผลสัมฤทธิ์รายวิชา — ${tLabel}</h3>
        <div class="tw p5tw"><table class="t p5t"><thead><tr><th class="stk">รายวิชา</th><th>กรอกแล้ว</th><th>เฉลี่ย</th><th>ร้อยละ</th>${LEVELS.map((l, k) => `<th class="lvh l${k}">${l}</th>`).join('')}<th style="min-width:140px">การกระจาย</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="stk"><b>${esc(oneLine(r.s.name))}</b>${r.code ? `<div class="hint">${esc(r.code)}</div>` : ''}</td>
          <td class="num ${r.got < n ? 'warnc' : ''}">${r.got}/${n}</td><td class="num">${fmt(r.avg)}<span class="hint"> / ${r.max ?? '–'}</span></td><td class="num">${r.pct === null ? '–' : fmt(r.pct) + '%'}</td>
          ${r.cnt.map(lvCell).join('')}<td>${distBar(r.cnt)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td class="stk"><b>รวมทุกวิชา</b></td><td class="num">${filled}/${need}</td><td></td><td class="num"><b>${avgPct === null ? '–' : fmt(avgPct) + '%'}</b></td>${tot.map(lvCell).join('')}<td>${distBar(tot)}</td></tr></tfoot></table></div>
        <p class="hint">ระดับตามเกณฑ์ร้อยละ 75 / 65 / 55 · นับเฉพาะนักเรียนที่มีคะแนนแล้ว${totN ? ` · รวม ${totN} ผลการประเมิน` : ''}</p></div>
      <div class="card"><h3>สรุปคุณลักษณะอันพึงประสงค์ / กิจกรรมพัฒนาผู้เรียน — ${tLabel}</h3>
        <div class="tw p5tw"><table class="t p5t"><thead><tr><th style="text-align:left">รายการ</th><th>ผ่าน</th><th>ไม่ผ่าน</th><th>ยังไม่ประเมิน</th><th style="min-width:140px">สัดส่วน</th></tr></thead>
        <tbody>${asRow('trait', 'คุณลักษณะอันพึงประสงค์')}${asRow('act', 'กิจกรรมพัฒนาผู้เรียน')}</tbody></table></div></div>`;
  }
  function vDocs() {
    const wb = WB(); const all = wb.sheets.filter(s => !s.def.hidden).map(s => s.name);
    const subs = subjects(); const used = new Set();
    const grp = (title, names, label) => {
      names = names.filter(n => all.includes(n) && !used.has(n)); names.forEach(n => used.add(n));
      if (!names.length) return '';
      return `<div class="card"><h3>${esc(title)}</h3><div class="dlist">${names.map(n => `<div class="ditem"><button class="open" data-act="open-doc" data-n="${esc(n)}">${esc(label ? label(n) : n)}</button><button class="btn" data-act="print-doc" data-n="${esc(n)}">พิมพ์</button></div>`).join('')}</div></div>`;
    };
    const scoreNames = subs.map(s => L.score(s.slot));
    return `<h2>เอกสารรูปแบบทางการ</h2><p class="sub">ดูตัวอย่างและพิมพ์แบบฟอร์ม ปพ.5 / ปพ.6 ตามต้นฉบับ (แก้ข้อมูลที่หน้าอื่น เอกสารจะอัปเดตเอง)</p>` +
      grp('ปพ.6 แจ้งผลการเรียน', [L.sum, L.sumBeh, L.term[1], L.termBeh[1], L.term[2], L.termBeh[2], L.stage, L.stageBeh].filter(Boolean)) +
      grp('ปก ปพ.5', all.filter(n => /^ปก /.test(n))) +
      scoreGrp(scoreNames.filter(n => all.includes(n) && !used.has(n)), subs) +
      grp('คุณลักษณะและกิจกรรม', all.filter(n => /^(คุณลักษณะ|กิจกรรมพัฒนาผู้เรียน)/.test(n)));
  }

  // แบบบันทึกคะแนนรายวิชา: พิมพ์ทั้งหมด หรือแยก เทอม 1 / เทอม 2 / รวมทั้งปี (รายวิชา หรือทุกวิชา)
  function scoreGrp(names, subs) {
    if (!names.length) return '';
    const parts = (n) => `<button class="btn" data-act="print-score" data-n="${esc(n)}">พิมพ์</button>` +
      [['1', 'ท.1'], ['2', 'ท.2'], ['sum', 'รวม']].map(([k, t]) => `<button class="btn sm" data-act="print-score" data-n="${esc(n)}" data-part="${k}" title="พิมพ์เฉพาะ${k === 'sum' ? 'สรุปทั้งปี' : 'เทอม ' + k}">${t}</button>`).join('');
    const label = (n) => { const s = subs.find(x => L.score(x.slot) === n); return s ? oneLine(s.name) : n; };
    return `<div class="card"><h3>แบบบันทึกคะแนนรายวิชา (ปพ.5)</h3>
      <div class="row" style="margin-bottom:8px"><span class="hint">พิมพ์ทุกวิชา:</span>
        <button class="btn sm primary" data-act="print-score" data-n="*">ทั้งหมด</button><button class="btn sm" data-act="print-score" data-n="*" data-part="1">เทอม 1</button><button class="btn sm" data-act="print-score" data-n="*" data-part="2">เทอม 2</button><button class="btn sm" data-act="print-score" data-n="*" data-part="sum">รวมทั้งปี</button></div>
      <div class="dlist">${names.map(n => `<div class="ditem"><button class="open" data-act="open-doc" data-n="${esc(n)}">${esc(label(n))}</button>${parts(n)}</div>`).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- พิมพ์ ปพ.5 รายวิชาเป็นเล่ม (แยกเล่มรายวิชา พิมพ์หน้าเดียว)
  // ลำดับต่อ 1 วิชา: ปกรายวิชา → ข้อมูลนักเรียน → แบบบันทึกคะแนน (ทั้งปี: เทอม 1 → เทอม 2 → สรุปทั้งปี) → [คุณลักษณะ → กิจกรรม]
  // เรียงวิชาตามลำดับในเมนู ข้อมูล → รายวิชา
  function bookPlan() {
    const B = U.book, all = WB().sheets.map(s => s.name), key = B.term === 'sum' ? 'รวม' : 'เทอม' + B.term;
    const tl = B.term === 'sum' ? 'ทั้งปี' : 'เทอม ' + B.term;
    const cover = all.find(n => n === 'ปก ปพ.5 รายวิชา ' + key);
    const subs = subjects();
    const parts = B.term === 'sum' ? [[1, 'แบบบันทึกคะแนน เทอม 1'], [2, 'แบบบันทึกคะแนน เทอม 2'], ['sum', 'แบบบันทึกคะแนน สรุปทั้งปี']] : [[B.term, 'แบบบันทึกคะแนน เทอม ' + B.term]];
    const assess = B.term === 'sum' ? [[L.traitY, 'คุณลักษณะอันพึงประสงค์ ทั้งปี'], [L.actY, 'กิจกรรมพัฒนาผู้เรียน ทั้งปี']] : [[L.trait(B.term), 'คุณลักษณะอันพึงประสงค์ เทอม ' + B.term], [L.act(B.term), 'กิจกรรมพัฒนาผู้เรียน เทอม ' + B.term]];
    const groups = [];
    let page = 0;
    subs.forEach((s, i) => {
      const g = { slot: s.slot, title: `เล่มที่ ${i + 1}: ${oneLine(s.name)}`, pages: [], items: [] };
      const add = (it, label) => { page++; g.pages.push({ n: g.pages.length + 1, label }); g.items.push(it); };
      if (cover) add({ sheet: cover, subj: s.name }, 'ปก ปพ.5 รายวิชา ' + tl);
      add({ stuInfo: s }, 'ข้อมูลนักเรียน');
      for (const [p, label] of parts) add({ sheet: L.score(s.slot), part: p }, label);
      if (B.assess) for (const [n, label] of assess) if (n) add({ sheet: n }, label);
      groups.push(g);
    });
    return { groups, subs, total: page };
  }
  // หน้า "ข้อมูลนักเรียน" ของเล่มรายวิชา (สร้างจากรายชื่อนักเรียน) — คืน { html, zoom }
  function stuInfoPage(s) {
    const stu = students(), sr = s.sr, g = A().S.grade, cls = txt(L.sub, 2, 3).replace(/^ประถมศึกษาปีที่\s*/, '') || g;
    const teacher = txt(L.sub, sr, 6).trim() || txt(L.info, 5, 2).trim();
    const code = txt(L.sub, sr, 2).trim(), year = txt(L.info, 9, 2), male = stu.filter(x => x.sex === 'ชาย').length, female = stu.filter(x => x.sex === 'หญิง').length;
    const clean = (v) => isPh(v) ? '' : v;
    const rows = stu.map(st => `<tr><td>${esc(st.no)}</td><td class="l">${esc(st.name)}</td><td>${esc(st.sex)}</td><td>${st.att === null || st.att === undefined || st.att === '' ? '' : esc(st.att)}</td><td></td></tr>`).join('');
    const html = `<div class="pp-stu">
      <h1>ข้อมูลนักเรียน</h1>
      <p class="pp-sub">รายวิชา <b>${esc(oneLine(s.name))}</b>${code ? ` &nbsp; รหัสวิชา <b>${esc(code)}</b>` : ''}</p>
      <p class="pp-sub">ชั้นประถมศึกษาปีที่ ${esc(cls)} &nbsp; ปีการศึกษา ${esc(year)} &nbsp; ${esc(A().S.school.name)}</p>
      <p class="pp-sub">ครูผู้สอน ${esc(clean(teacher))}</p>
      <table><thead><tr><th style="width:9%">เลขที่</th><th>ชื่อ - สกุล</th><th style="width:11%">เพศ</th><th style="width:17%">การเข้าชั้นเรียน (%)</th><th style="width:17%">หมายเหตุ</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">ยังไม่มีรายชื่อนักเรียน</td></tr>'}</tbody></table>
      <p class="pp-sum">นักเรียนทั้งหมด <b>${stu.length}</b> คน &nbsp; ชาย <b>${male}</b> คน &nbsp; หญิง <b>${female}</b> คน</p></div>`;
    const h = 175 + 25.5 * Math.max(stu.length, 1);   // ความสูงโดยประมาณ (px) — ย่อให้พอดี A4 1 หน้า
    return { html, zoom: Math.min(1, 1000 / h) };
  }
  function vBook() {
    const all = subjects(), B = U.book;
    if (!all.length) return `<div class="card empty"><b>ยังไม่มีรายวิชา</b><br><button class="btn primary" data-act="goto" data-to="data:subjects">ไปเพิ่มวิชา</button></div>`;
    const plan = bookPlan(), tl = B.term === 'sum' ? 'ทั้งปี' : 'เทอม ' + B.term;
    return `<h2>พิมพ์เล่ม ปพ.5 รายวิชา</h2><p class="sub">1 เล่ม ต่อ 1 วิชา — กดปุ่ม <b>พิมพ์เล่มนี้</b> ของวิชาที่ต้องการ (พิมพ์หน้าเดียว กระดาษ A4 แนวตั้ง)</p>
      <div class="card"><div class="row" style="gap:18px;flex-wrap:wrap"><div><h3>ช่วงเวลา</h3>${seg([['sum', 'ทั้งปี (เทอม 1 + เทอม 2)'], [1, 'เทอม 1'], [2, 'เทอม 2']], B.term, 'bterm')}</div>
        <div><h3>ตัวเลือก</h3><label class="chk"><input type="checkbox" data-act-change="bopt" value="assess"${B.assess ? ' checked' : ''}> แนบ <b>คุณลักษณะ / กิจกรรมพัฒนาผู้เรียน</b> ท้ายเล่ม</label></div></div>
        <p class="hint" style="margin:8px 0 0">ลำดับหน้าในแต่ละเล่ม: ${esc(plan.groups[0].pages.map(p => p.label).join(' → '))}</p></div>
      <div class="books">${plan.groups.map(g => `<div class="card book"><div class="bk-head"><b>${esc(g.title)}</b><span class="hint">${g.pages.length} หน้า · ${tl}</span></div>
        <ol class="bpages">${g.pages.map(p => `<li>${esc(p.label)}</li>`).join('')}</ol>
        <button class="btn primary" data-act="book-one" data-slot="${g.slot}">🖨 พิมพ์เล่มนี้</button></div>`).join('')}</div>
      <p class="hint">ต้องการเก็บเป็นไฟล์: เลือก “บันทึกเป็น PDF” ในหน้าต่างพิมพ์ (ได้ 1 ไฟล์ต่อ 1 วิชา)</p>`;
  }
  function bookPrint(slot) {
    const g = bookPlan().groups.find(x => x.slot === slot); if (!g) return;
    A().printSet(g.items.map(it => it.stuInfo ? stuInfoPage(it.stuInfo) : it));
  }


  // ---------------------------------------------------------------- แบบฟอร์ม Excel (กรอกใน Excel แล้วคัดลอกมาวางในตาราง)
  // คอลัมน์ในไฟล์เรียงตรงกับช่องกรอกในตารางของหน้านั้นทุกประการ — คัดลอกทั้งก้อนแล้ววางที่ช่องแรกได้ทันที
  const xlBtn = (k) => `<button class="btn" data-act="xlform" data-k="${k}" title="ดาวน์โหลดแบบฟอร์ม Excel ที่มีคอลัมน์ตรงกับตารางนี้ กรอกเสร็จแล้วคัดลอกมาวาง">⬇ แบบฟอร์ม Excel</button>`;
  function xlForm(k) {
    const S = A().S, g = S.grade + (S.room > 1 || (S.rooms[S.grade] || []).length > 1 ? '-' + S.room : ''), stu = students(), blank = (v) => v === null || v === undefined || isPh(v) ? '' : v;
    const howTo = (first) => `วิธีใช้: กรอกเฉพาะช่องสีขาว แล้วเลือกช่องสีขาวทั้งหมดตั้งแต่แถวแรก (คลิกช่องแรก แล้วกด Shift ค้างคลิกช่องสุดท้าย) กด Ctrl+C → กลับมาที่โปรแกรม คลิก${first} แล้วกด Ctrl+V · ห้ามสลับลำดับแถวหรือคอลัมน์`;
    let file, o;
    if (k === 'stu') {
      const rows = [];
      for (let r = L.stuFirst; r <= L.stuLast; r++) rows.push([get(L.stu, r, 1) ?? r - 2, blank(get(L.stu, r, 2)), blank(get(L.stu, r, 3)), blank(get(L.stu, r, 4))]);
      file = `form-students-p${g}.xlsx`;
      o = { name: 'นักเรียน', title: `แบบฟอร์มรายชื่อนักเรียน ชั้น ${A().roomLabel(S.grade, S.room)}`, cols: [6, 36, 14, 14], ref: 1,
        head: ['ที่', 'ชื่อ - สกุล\n(เช่น เด็กชายสมชาย ใจดี)', 'เพศ\n(ชาย / หญิง)', 'เข้าเรียน\n(ร้อยละ 0-100)'], rows,
        valid: [{ col: 3, type: 'list', list: ['ชาย', 'หญิง'], msg: 'เลือก ชาย หรือ หญิง' }, { col: 4, type: 'decimal', min: 0, max: 100, msg: 'กรอกตัวเลข 0-100' }],
        note: howTo('ช่อง “ชื่อ - สกุล” ของนักเรียนคนที่ 1') };
    } else if (k === 'score') {
      if (!stu.length) { A().toast('เพิ่มรายชื่อนักเรียนก่อน', 'warn'); return; }
      const cur = curSubject(), sc = L.score(cur.slot), T = U.scoreTerm, inds = activeInds(sc, T), cols = [...inds, SC[T].exam];
      const mx = (c) => num(sc, 4, c) ?? 0;
      file = `form-scores-p${g}-subject${cur.slot}-term${T}.xlsx`;
      o = { name: 'คะแนน เทอม ' + T, title: `แบบฟอร์มคะแนน ${oneLine(cur.name)} · เทอม ${T} · ชั้น ${A().roomLabel(S.grade, S.room)}`, ref: 2,
        cols: [6, 32, ...cols.map(() => 13), 22],
        head: ['ที่', 'ชื่อ - สกุล', ...inds.map((c, i) => `${indLabel(sc, c, i)}\n(เต็ม ${mx(c)})`), `คะแนนสอบ\n(เต็ม ${mx(SC[T].exam)})`, 'หมายเหตุ'],
        rows: stu.map(st => { const r = stuScoreRow(st.r); return [st.no, st.name, ...cols.map(c => blank(get(sc, r, c))), blank(get(sc, r, SC.note))]; }),
        valid: cols.map((c, i) => ({ col: 3 + i, type: 'decimal', min: 0, max: mx(c), msg: `กรอกคะแนน 0-${mx(c)}` })),
        note: howTo('ช่องคะแนนแรกของนักเรียนคนที่ 1') + ' · คะแนนเก็บและคะแนนรวม โปรแกรมคำนวณให้เอง' };
    } else {
      if (!stu.length) { A().toast('เพิ่มรายชื่อนักเรียนก่อน', 'warn'); return; }
      const kind = U.kind, t = U.aTerm, sh = asSheet(kind, t), heads = activeItems(kind), label = kind === 'trait' ? 'คุณลักษณะอันพึงประสงค์' : 'กิจกรรมพัฒนาผู้เรียน';
      file = `form-${kind === 'trait' ? 'trait' : 'activity'}-p${g}-term${t}.xlsx`;
      o = { name: (kind === 'trait' ? 'คุณลักษณะ' : 'กิจกรรม') + ' เทอม ' + t, title: `แบบฟอร์มประเมิน${label} · เทอม ${t} · ชั้น ${A().roomLabel(S.grade, S.room)}`, ref: 2,
        cols: [6, 32, ...heads.map(() => 15)], head: ['ที่', 'ชื่อ - สกุล', ...heads.map(c => oneLine(txt(asSheet(kind, 1), 3, c)))],
        rows: stu.map(st => [st.no, st.name, ...heads.map(c => blank(get(sh, stuTraitRow(st.r), c)))]),
        valid: heads.map((c, i) => ({ col: 3 + i, type: 'list', list: ['ผ่าน', 'ไม่ผ่าน'], msg: 'เลือก ผ่าน หรือ ไม่ผ่าน' })),
        note: howTo('ช่องแรกของนักเรียนคนที่ 1') };
    }
    root.PPXlsx.download(file, o);
    A().toast('ดาวน์โหลดแบบฟอร์มแล้ว — กรอกใน Excel แล้วคัดลอกช่องสีขาวมาวางที่ตาราง', 'ok');
  }

  // ---------------------------------------------------------------- คู่มือการใช้งาน
  const MANUAL = [
    ['start', 'เริ่มต้นใช้งาน', null, `
      <ol><li>เปิดเว็บด้วย <b>Google Chrome</b> หรือ <b>Microsoft Edge</b> (ใช้ได้ทั้งคอมพิวเตอร์ แท็บเล็ต และมือถือ)</li>
      <li>กรอก <b>รหัสสิทธิ์โรงเรียน</b> ที่ได้รับหลังชำระค่าโปรแกรม แล้วกด “เข้าสู่ระบบ” — ติ๊ก “จำรหัสในเครื่องนี้” ถ้าเป็นเครื่องส่วนตัว</li>
      <li>เลือกชั้น/ห้องได้ที่ช่อง <b>ป.?/?</b> ด้านบน ข้อมูลแต่ละห้องแยกกัน — ถ้าชั้นเดียวมีหลายห้อง เลือก <b>⚙ จัดการห้องเรียน…</b> ในช่องเดียวกันเพื่อ <b>เพิ่มห้อง</b> (ชั้นละไม่เกิน 10 ห้อง) หรือลบห้อง</li>
      <li>ทำตามขั้นตอนในหน้า <b>หน้าแรก</b> ทีละข้อ (ข้อที่ทำเสร็จจะขึ้นเครื่องหมาย ✓)</li></ol>
      <p class="hint">ชื่อโรงเรียนถูกล็อกตามรหัสสิทธิ์ แก้เองไม่ได้ ถ้าสะกดผิดให้แจ้งผู้ดูแลระบบ · ใช้รหัสเดียวกันได้หลายเครื่อง แต่ไม่ควรแก้ข้อมูลชั้นเดียวกันพร้อมกัน</p>`],
    ['school', 'ตั้งค่าข้อมูลโรงเรียน', 'data:school', `
      <p>เมนู <b>ข้อมูล → โรงเรียน</b></p>
      <ul><li>กรอกปีการศึกษา สังกัด ชื่อครูประจำชั้น หัวหน้างานวิชาการ รองผู้อำนวยการ และผู้อำนวยการ — ชื่อจะไปปรากฏในช่องลงนามของ ปพ.5 / ปพ.6 อัตโนมัติ</li>
      <li><b>ไม่มีรองผู้อำนวยการ</b> หรือ <b>ไม่มีหัวหน้างานวิชาการ</b>: เว้นว่างไว้ ระบบจะซ่อนบรรทัดลงนามนั้นและจัดตำแหน่งลายเซ็นให้เอง</li>
      <li>กด <b>เลือกรูปตรา</b> เพื่อใส่ตราโรงเรียน (PNG/JPG) จะแสดงบนหน้าปกทุกฉบับ</li>
      <li>กรอกจำนวนนักเรียนออกกลางปี / เข้าระหว่างปี (ถ้าไม่มี ใส่ 0) ใช้ในหน้าปก ปพ.5</li></ul>`],
    ['students', 'รายชื่อนักเรียน', 'data:students', `
      <p>เมนู <b>ข้อมูล → นักเรียน</b> (สูงสุด 40 คนต่อชั้น)</p>
      <ul><li>ใช้งานเหมือน Excel: คลิกช่องแล้วพิมพ์ กด Enter / ลูกศร เพื่อเลื่อนช่อง</li>
      <li><b>วางทีเดียวทั้งห้อง:</b> คัดลอกคอลัมน์ ชื่อ-สกุล (และเพศ, % เข้าเรียน ถ้ามี) จาก Excel / Google Sheets แล้วคลิกช่องแรก กด <kbd>Ctrl</kbd>+<kbd>V</kbd></li>
<li><b>แบบฟอร์ม Excel:</b> กดปุ่ม <b>⬇ แบบฟอร์ม Excel</b> ได้ไฟล์ที่คอลัมน์ตรงกับตารางในหน้านี้ กรอกเฉพาะช่องสีขาว แล้วคัดลอกช่องสีขาวทั้งหมดมาวางที่ช่องแรกของตาราง</li>
      <li>เพศพิมพ์ <b>ช</b> / <b>ญ</b> ได้ ถ้าเว้นว่าง ระบบเดาจากคำนำหน้า (เด็กชาย / เด็กหญิง)</li>
      <li>% เข้าเรียน กรอก 0–100 · ปุ่ม <b>ลบ</b> ท้ายแถวลบนักเรียนพร้อมคะแนนและผลประเมินของคนนั้น</li></ul>`],
    ['subjects', 'รายวิชาและความสามารถ', 'data:subjects', `
      <p>เมนู <b>ข้อมูล → รายวิชา</b> และ <b>ข้อมูล → ความสามารถ</b></p>
      <ul><li>รายวิชาตั้งต้นตามหลักสูตร 2568 มาให้แล้ว เพิ่ม/ลบ/แก้ชื่อได้ (ขึ้นบรรทัดใหม่ในชื่อวิชาได้)</li>
      <li>ทุกวิชาต้องเลือก <b>อยู่ในความสามารถข้อใด</b> — ผลระดับความสามารถใน ปพ.6 คำนวณจากวิชาที่เลือกไว้ (1 ความสามารถรองรับได้ไม่เกิน 3 วิชา)</li>
      <li>กรอกรหัสวิชา เวลาเรียน กลุ่มสาระ และครูประจำวิชา (เว้นว่าง = ใช้ชื่อครูประจำชั้น)</li>
      <li>หน้า <b>ความสามารถ</b>: แก้ชื่อ เพิ่ม หรือลดข้อความสามารถได้ (สูงสุด 8 ข้อ)</li>
      <li>ชั้น ป.3 และ ป.6: กำหนด <b>ระดับที่คาดหวัง</b> ของแต่ละความสามารถ เพื่อใช้ในหน้าสรุปประถมตอนต้น / ตอนปลาย</li></ul>`],
    ['scores', 'บันทึกคะแนน', 'scores', `
      <p>เมนู <b>คะแนน</b> — เลือกวิชาจากช่องด้านบน (หรือกด ‹ › เปลี่ยนวิชา) และเลือก <b>เทอม 1 / เทอม 2</b></p>
      <ul><li><b>ตั้งคะแนนเต็มก่อน:</b> กำหนดคะแนนเต็มของแต่ละตัวชี้วัดและคะแนนสอบ — กด <b>＋ เพิ่มตัวชี้วัด</b> / <b>－ ลดตัวชี้วัด</b> (สูงสุด 10 ตัวต่อเทอม) และตั้งชื่อตัวชี้วัดได้</li>
<li><b>แบบฟอร์ม Excel:</b> กดปุ่ม <b>⬇ แบบฟอร์ม Excel</b> ได้ไฟล์ที่คอลัมน์ตรงกับตารางในหน้านี้ (มีรายชื่อนักเรียนให้แล้ว) กรอกเฉพาะช่องสีขาว แล้วคัดลอกช่องสีขาวทั้งหมดมาวางที่ช่องแรกของตาราง</li>
      <li><b>เก็บคะแนนเทอมละ 50 หรือ 100 ก็ได้</b> — ตั้งคะแนนเต็มตามที่โรงเรียนใช้ ระดับคิดจากร้อยละเสมอ · ตั้งวิชาแรกเสร็จแล้วกด <b>⇉ ใช้คะแนนเต็มนี้กับทุกวิชา</b> ไม่ต้องตั้งทีละวิชา</li>
      <li><b>คะแนนเก็บ = ผลรวมคะแนนตัวชี้วัด</b> คำนวณให้อัตโนมัติ ไม่ต้องกรอก</li>
      <li>กรอกคะแนนรายตัวชี้วัดและคะแนนสอบ หรือวางจาก Excel ทีละหลายช่อง (<kbd>Ctrl</kbd>+<kbd>V</kbd>) — กรอกเกินคะแนนเต็มระบบจะไม่รับ</li>
      <li>ระดับผลการเรียนคำนวณอัตโนมัติจากร้อยละ: <b>75</b> ขึ้นไป = เชี่ยวชาญ · <b>65</b> = ชำนาญ · <b>55</b> = พัฒนา · ต่ำกว่า = เริ่มต้น</li>
      <li>แท็บ <b>สรุปทั้งปี</b> แสดงคะแนนรวม 2 เทอมและระดับทั้งปี (ดูอย่างเดียว)</li></ul>`],
    ['assess', 'ประเมินคุณลักษณะและกิจกรรม', 'assess', `
      <p>เมนู <b>ประเมิน</b> — เลือก <b>คุณลักษณะอันพึงประสงค์</b> หรือ <b>กิจกรรมพัฒนาผู้เรียน</b> และเลือกเทอม</p>
      <ul><li>ในแต่ละช่องพิมพ์ <b>ผ่าน</b> / <b>ไม่ผ่าน</b> (หรือ 1 / 0) · <b>ดับเบิลคลิก</b> หรือกด <kbd>Space</kbd> เพื่อสลับค่า</li>
      <li>กดปุ่ม <b>ตั้งทั้งหมดเป็น “ผ่าน”</b> แล้วค่อยแก้เฉพาะคนที่ไม่ผ่าน จะเร็วที่สุด · แตะหัวคอลัมน์ = ตั้งทั้งห้องเป็นผ่านเฉพาะหัวข้อนั้น</li>
<li><b>แบบฟอร์ม Excel:</b> กดปุ่ม <b>⬇ แบบฟอร์ม Excel</b> ได้ไฟล์ที่คอลัมน์ตรงกับตารางในหน้านี้ (มีรายชื่อนักเรียนให้แล้ว) กรอกเฉพาะช่องสีขาว แล้วคัดลอกช่องสีขาวทั้งหมดมาวางที่ช่องแรกของตาราง</li>
      <li>เพิ่ม / ลด / แก้ชื่อหัวข้อได้ (คุณลักษณะสูงสุด 12 · กิจกรรมสูงสุด 8) ใช้ร่วมกันทั้ง 2 เทอม</li>
      <li>ปุ่ม <b>🏫 ใช้หัวข้อนี้ทั้งโรงเรียน</b> — ตั้งชื่อหัวข้อชุดเดียวกันให้ทุกชั้นทุกห้อง (ผลประเมินที่กรอกไว้ไม่หาย)</li>
      <li>แท็บ <b>ทั้งปี</b> คำนวณเอง: ไม่ผ่านเทอมใดเทอมหนึ่ง = ไม่ผ่าน · ผ่านทั้ง 2 เทอม = ผ่าน</li></ul>`],
    ['reports', 'รายงาน ปพ.5 และ ปพ.6', 'report', `
      <ul><li><b>รายงาน ปพ.5:</b> ตารางสรุปผลทั้งห้อง จำนวนนักเรียนแต่ละระดับ ค่าเฉลี่ย และผลคุณลักษณะ/กิจกรรม เลือกดูเทอม 1 / เทอม 2 / ทั้งปี</li>
      <li><b>รายงาน ปพ.6:</b> ดูผลรายคน (เลือกนักเรียน) หรือภาพรวมทั้งห้อง ของเทอม 1 / เทอม 2 / ทั้งปี</li>
      <li>ชั้น ป.3 และ ป.6 มีหน้า <b>สรุปประถมตอนต้น / ตอนปลาย</b> เทียบผลกับระดับที่คาดหวัง</li>
      <li>กด <b>พิมพ์ ปพ.6 คนนี้</b> หรือ <b>พิมพ์ทั้งห้อง</b> (คนละ 2 หน้า: ผลการเรียน + คำอธิบายพฤติกรรม)</li></ul>`],
    ['book', 'พิมพ์เล่ม ปพ.5 รายวิชา', 'book', `
      <p>เมนู <b>พิมพ์เล่ม ปพ.5</b> พิมพ์ 1 เล่ม ต่อ 1 วิชา (พิมพ์หน้าเดียว)</p>
      <ol><li>เลือกช่วงเวลา: <b>ทั้งปี</b> / <b>เทอม 1</b> / <b>เทอม 2</b> (และติ๊กแนบคุณลักษณะ / กิจกรรมท้ายเล่มถ้าต้องการ)</li>
      <li>กดปุ่ม <b>🖨 พิมพ์เล่มนี้</b> ของวิชาที่ต้องการ — หรือเลือก “บันทึกเป็น PDF” เพื่อเก็บเป็นไฟล์ 1 ไฟล์ต่อ 1 วิชา</li></ol>
      <p class="hint">ลำดับหน้าในเล่ม (ทั้งปี): ปกรายวิชา → ข้อมูลนักเรียน → คะแนนเทอม 1 → คะแนนเทอม 2 → สรุปทั้งปี [→ คุณลักษณะ → กิจกรรม]</p>`],
    ['print', 'พิมพ์เอกสาร / บันทึกเป็น PDF', 'docs', `
      <p>เมนู <b>ปริ้นเอกสาร</b> รวมแบบฟอร์มทางการทุกฉบับ — กดชื่อเอกสารเพื่อดูตัวอย่าง หรือกด <b>พิมพ์</b></p>
      <ul><li><b>แบบบันทึกคะแนนรายวิชา:</b> พิมพ์ครบ 3 หน้า หรือแยก <b>ท.1 / ท.2 / รวม</b> และพิมพ์ทุกวิชาพร้อมกันได้</li>
      <li>ในหน้าต่างพิมพ์ ตั้งค่า: ขนาดกระดาษ <b>A4</b> · ระยะขอบ <b>ค่าเริ่มต้น</b> · สเกล <b>ค่าเริ่มต้น (100%)</b> · ติ๊ก <b>กราฟิกพื้นหลัง</b> เพื่อให้สีพื้นช่องตารางออกมา</li>
      <li>ต้องการไฟล์: เลือกเครื่องพิมพ์เป็น <b>บันทึกเป็น PDF</b> (Save as PDF)</li>
      <li>หน้ากระดาษตั้งเป็นแนวตั้ง และย่อให้พอดีหน้าอัตโนมัติ ไม่ต้องปรับเอง</li></ul>`],
    ['save', 'การบันทึกและสำรองข้อมูล', 'home', `
      <ul><li>ระบบ <b>บันทึกอัตโนมัติ</b> ขึ้นเซิร์ฟเวอร์ทุกครั้งที่แก้ไข ดูสถานะที่มุมขวาบน (“บันทึกแล้ว …”) หรือกดปุ่ม <b>บันทึก</b> เองได้</li>
      <li>ถ้าอินเทอร์เน็ตหลุด ข้อมูลจะเก็บไว้ในเครื่องก่อน และส่งขึ้นเซิร์ฟเวอร์เมื่อกลับมาออนไลน์ — อย่าเพิ่งปิดหน้าเว็บจนสถานะขึ้นว่าบันทึกแล้ว</li>
      <li>ถ้ามีการแก้จากอีกเครื่องพร้อมกัน ระบบจะถามว่าจะ <b>โหลดข้อมูลล่าสุด</b> หรือ <b>บันทึกทับ</b></li>
      <li><b>สำรองข้อมูล:</b> ที่หน้าแรก กด <b>⬇ สำรองข้อมูล</b> จะได้ไฟล์ข้อมูลทุกชั้นเก็บไว้ในเครื่อง (แนะนำทุกครั้งหลังกรอกคะแนนเสร็จ และก่อนส่งผลปลายภาค)</li>
      <li><b>กู้คืน:</b> กด <b>⬆ นำเข้าไฟล์สำรอง</b> แล้วเลือกไฟล์ ข้อมูลปัจจุบันจะถูกแทนที่ด้วยข้อมูลในไฟล์</li></ul>`],
    ['faq', 'คำถามที่พบบ่อย', null, `
      <dl class="faq">
        <dt>ลืมรหัสสิทธิ์ / รหัสหลุดไปถึงคนอื่น</dt><dd>ติดต่อผู้ดูแลระบบเพื่อรีเซ็ตรหัสใหม่ รหัสเดิมจะใช้ไม่ได้ทันที ข้อมูลของโรงเรียนยังอยู่ครบ</dd>
        <dt>เข้าระบบไม่ได้ ขึ้นว่าพยายามผิดหลายครั้ง</dt><dd>ระบบล็อกชั่วคราวเพื่อความปลอดภัย รอ 10 นาทีแล้วลองใหม่ ตรวจว่าพิมพ์รหัสถูกต้อง</dd>
        <dt>กรอกคะแนนไม่ได้ ช่องเป็นสีเทา</dt><dd>ยังไม่ได้ตั้งคะแนนเต็มของตัวชี้วัด/คะแนนสอบนั้น ตั้งคะแนนเต็มด้านบนตารางก่อน</dd>
        <dt>ผลความสามารถใน ปพ.6 ว่าง</dt><dd>ตรวจว่าทุกวิชาเลือก “อยู่ในความสามารถข้อ” แล้ว (เมนู ข้อมูล → รายวิชา) และกรอกคะแนนครบ</dd>
        <dt>พิมพ์แล้วไม่มีสีพื้นตาราง / ตารางเล็กหรือเกินหน้า</dt><dd>ติ๊ก “กราฟิกพื้นหลัง” และตั้งสเกลเป็นค่าเริ่มต้น ขนาดกระดาษ A4</dd>
        <dt>มีหลายห้อง เช่น ป.1/1 และ ป.1/2</dt><dd>เพิ่มห้องที่ช่องเลือกชั้นด้านบน → ⚙ จัดการห้องเรียน… ทุกห้องใช้รหัสโรงเรียนเดียวกัน ชื่อชั้นในเอกสารจะแสดงห้องให้อัตโนมัติ (แก้เองได้ที่ ข้อมูล → โรงเรียน → ชั้น) ตราโรงเรียนใส่ครั้งเดียวใช้ได้ทุกห้อง</dd>
        <dt>ข้อมูลนักเรียนปลอดภัยไหม / ข้อกำหนด PDPA</dt><dd>ข้อมูลของแต่ละโรงเรียนแยกกัน เข้าถึงได้ด้วยรหัสสิทธิ์ของโรงเรียนเท่านั้น ไม่ขายหรือเปิดเผยให้ผู้อื่น โรงเรียนแก้ไข ลบ และสำรองข้อมูลได้เองทุกเมื่อ — อ่านรายละเอียด <a href="../register.html#pdpa" target="_blank" rel="noopener">ข้อกำหนดการคุ้มครองข้อมูลส่วนบุคคล (PDPA)</a></dd>
        <dt>เห็นหน้าเว็บแบบเก่าหลังมีการปรับปรุง</dt><dd>กด <kbd>Ctrl</kbd>+<kbd>F5</kbd> (มือถือ: ปิดแล้วเปิดเบราว์เซอร์ใหม่)</dd>
      </dl>`],
  ];
  function vManual() {
    const toc = MANUAL.map(([id, t], i) => `<button class="chip" data-act="man-go" data-id="${id}">${i + 1}. ${esc(t)}</button>`).join('');
    const sec = MANUAL.map(([id, t, to, body], i) => `<details class="card man" id="man-${id}"${i === 0 ? ' open' : ''}><summary><span class="no">${i + 1}</span>${esc(t)}</summary>
      <div class="man-body">${body}${to ? `<p><button class="btn sm primary" data-act="goto" data-to="${to}">ไปที่หน้านี้ ›</button></p>` : ''}</div></details>`).join('');
    return `<h2>คู่มือการใช้งาน</h2><p class="sub">โปรแกรมแจ้งผลการศึกษา ปพ.5 และ ปพ.6 หลักสูตร 2568 — ทำตามลำดับหัวข้อครั้งแรก แล้วกลับมาดูเฉพาะหัวข้อที่ต้องการได้</p>
      <div class="man-toc">${toc}</div>${sec}
      <p class="hint">สอบถามหรือแจ้งปัญหาการใช้งาน: <a href="https://www.facebook.com/filevichakan/" target="_blank" rel="noopener">เพจเปิดไฟล์วิชาการ</a></p>`;
  }

  // ---------------------------------------------------------------- เหตุการณ์
  function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT') return;
    const a = b.dataset.act;
    switch (a) {
      case 'goto': { const [t, s] = b.dataset.to.split(':'); go(t, s); break; }
      case 'dsub': U.sub.data = b.dataset.k; refresh(); break;
      case 'logo': A().pickLogo(); break;
      case 'logo-del': A().removeLogo(); break;
      case 'stu-del': delStudent(+b.dataset.r); break;
      case 'sex': { const r = +b.dataset.r; const nx = txt(L.stu, r, 3) === b.dataset.v ? null : b.dataset.v; if (setv(L.stu, r, 3, nx)) refresh(); break; }
      case 'sub-add': addSubject(); break;
      case 'sub-del': delSubject(+b.dataset.r); break;
      case 'exp': setExpected(+b.dataset.i, b.dataset.v); break;
      case 'sexp': setv(L.stage, +b.dataset.r, 4, b.dataset.v); refresh(); break;
      case 'ind-add': indAdd(); break;
      case 'ab-add': abAdd(); break;
      case 'ab-del': abDel(); break;
      case 'as-add': asAdd(); break;
      case 'as-del': asDel(); break;
      case 'as-school': asSchool(); break;
      case 'info-school': A().toast('กำลังอัปเดตทุกห้อง...', 'ok'); A().syncSchoolInfo().then(res => { if (res && !res.fail.length) A().toast('ใช้ข้อมูลโรงเรียนนี้กับทุกห้องแล้ว (' + res.done.length + ' ห้อง)', 'ok'); }); break;
      case 'ind-del': indDel(); break;
      case 'max-all': maxAll(); break;
      case 'sterm': U.scoreTerm = b.dataset.k === 'y' ? 'y' : +b.dataset.k; refresh(); break;
      case 'subj-step': { const subs = subjects(); const i = subs.findIndex(s => s.r === curSubject().r) + (+b.dataset.d); if (subs[i]) { U.slot = subs[i].r; refresh(); } break; }
      case 'akind': U.kind = b.dataset.k; refresh(); break;
      case 'aterm': U.aTerm = b.dataset.k === 'y' ? 'y' : +b.dataset.k; refresh(); break;
      case 'acol': setAssessAll('ผ่าน', +b.dataset.c); break;
      case 'aall': setAssessAll(b.dataset.v); break;
      case 'rmode': U.repMode = b.dataset.k; refresh(); break;
      case 'rterm': U.repTerm = ['sum', 'stage'].includes(b.dataset.k) ? b.dataset.k : +b.dataset.k; refresh(); break;
      case 'stu-step': stepStudent(+b.dataset.d); break;
      case 'open-stu': WB().setValue(L.sum, { r: 3, c: 2 }, b.dataset.name); U.repMode = 'one'; refresh(); break;
      case 'print-one': A().printOne(whichKey()); break;
      case 'print-all': A().printAll(whichKey()); break;
      case 'open-doc': A().openDoc(b.dataset.n); break;
      case 'bterm': U.book.term = b.dataset.k === 'sum' ? 'sum' : +b.dataset.k; refresh(); break;
      case 'p5term': U.p5Term = b.dataset.k === 'sum' ? 'sum' : +b.dataset.k; refresh(); break;
      case 'print-doc': A().printSheets([b.dataset.n]); break;
      case 'backup-out': A().exportBackup(); break;
      case 'xlform': xlForm(b.dataset.k); break;
      case 'book-one': bookPrint(+b.dataset.slot); break;
      case 'man-go': { const d = $('#man-' + b.dataset.id); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } break; }
      case 'backup-in': A().pickBackup(); break;
      case 'print-score': A().printScores(b.dataset.n === '*' ? subjects().map(s => L.score(s.slot)) : [b.dataset.n], b.dataset.part); break;
      default: break;
    }
  }

  function onChange(e) {
    const el = e.target;
    const ac = el.dataset && el.dataset.actChange;
    if (ac === 'subj') { U.slot = +el.value; refresh(); return; }
    if (ac === 'bopt') { U.book[el.value] = el.checked; refresh(); return; }
    if (ac === 'stu-pick') { WB().setValue(L.sum, { r: 3, c: 2 }, el.value); refresh(); return; }
    if (!el.dataset || el.dataset.s === undefined) return;
    const sheet = el.dataset.s, r = +el.dataset.r, c = +el.dataset.c;
    let val; const raw = el.value;
    const revert = () => { el.value = el.dataset.old || ''; };
    if (el.dataset.t === 'n') {
      const t = raw.trim().replace(/,/g, '');
      if (t === '') val = null;
      else { val = Number(t); if (!isFinite(val)) { A().toast('กรุณากรอกเป็นตัวเลข', 'warn'); revert(); return; } }
      if (val !== null && el.dataset.lo !== undefined && (val < +el.dataset.lo || val > +el.dataset.hi)) { A().toast('ต้องอยู่ระหว่าง ' + el.dataset.lo + ' ถึง ' + el.dataset.hi, 'warn'); revert(); return; }
    } else if (el.dataset.t === 'sex' || el.dataset.t === 'pass') {
      val = convert(el.dataset.t, raw);
      if (val === undefined) { A().toast(el.dataset.t === 'sex' ? 'เพศ: พิมพ์ ชาย / หญิง (หรือ ช / ญ)' : 'พิมพ์ ผ่าน / ไม่ผ่าน (หรือ 1 / 0)', 'warn'); revert(); return; }
    } else val = raw.trim() === '' ? null : raw.replace(/\r/g, '').trim();
    if (el.dataset.chk === 'subname' && val !== null) {
      const dup = subjects().find(s => s.r !== r && s.name.trim() === val);
      if (dup) { A().toast('มีวิชาชื่อนี้แล้ว กรุณาใช้ชื่ออื่น', 'warn'); revert(); return; }
    }
    const err = A().validate(sheet, r, c, val);
    if (err) { A().toast(err, 'warn'); el.classList.add('bad'); revert(); return; }
    el.classList.remove('bad');
    const wasCur = sheet === L.stu && c === 2 && el.dataset.old && el.dataset.old === currentStudent();
    const oldVal = el.dataset.old || '';
    if (el.dataset.after === 'abname' && val === null) { A().toast('ชื่อความสามารถว่างไม่ได้ (ถ้าต้องการลบ ใช้ปุ่ม “ลดความสามารถ”)', 'warn'); revert(); return; }
    if (!setv(sheet, r, c, val)) { revert(); return; }
    if (val !== null && (el.dataset.t === 'sex' || el.dataset.t === 'pass')) el.value = val;
    el.dataset.old = el.value;
    if (el.dataset.t === 'pass') { el.classList.toggle('ok', val === 'ผ่าน'); el.classList.toggle('no', val === 'ไม่ผ่าน'); }
    const af = el.dataset.after;
    // ข้อมูลระดับโรงเรียน (สังกัด / ผู้บริหาร / ปีการศึกษา): ใช้กับทุกห้องอัตโนมัติ
    if (sheet === L.info && c === 2 && A().SCHOOL_REFS.includes('B' + r)) A().syncSchoolInfo(['B' + r]).then(res => { if (res && !res.fail.length) A().toast('อัปเดตทุกห้องแล้ว (' + res.done.length + ' ห้อง)', 'ok'); });
    if (af === 'grid') updateRo(el.closest('table'));
    // วาดหน้าใหม่หลังจบเหตุการณ์ change (กันวาดซ้อนตอนช่องที่โฟกัสอยู่ถูกลบแล้วเกิด blur)
    else if (af === 'rerender') setTimeout(refresh, 0);
    else if (af === 'abname') { renameAbility(oldVal, String(val)); setTimeout(refresh, 0); }
    else if (af === 'maxchg') setTimeout(refresh, 0);
    else if (af === 'sub') U.pendSub.delete(r);
    else if (af === 'stu') {
      if (val !== null && wasCur) WB().setValue(L.sum, { r: 3, c: 2 }, val);
      if (val !== null) { A().batch(() => afterStudentNames([r])); const sx = gridAt(el.closest('table'), +el.dataset.gr, 1); if (sx) { sx.value = txt(L.stu, r, 3); sx.dataset.old = sx.value; } }
    }
  }

  root.PPUI = { mount, go, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
