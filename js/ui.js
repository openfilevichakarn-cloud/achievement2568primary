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
  const U = { tab: 'home', sub: { data: 'school' }, scoreTerm: 1, slot: null, kind: 'trait', aTerm: 1, repMode: 'one', repTerm: 'sum', pendStu: new Set(), pendSub: new Set(), openNote: new Set() };
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
      beh: 'ค่าพฤติกรรม', cover1: find(/^ปก ปพ\.5 รายชั้น.*เทอม1$/),
      trait: (t) => find(new RegExp('^คุณลักษณะ.*เทอม' + t + '$')),
      act: (t) => find(new RegExp('^กิจกรรมพัฒนาผู้เรียน.*เทอม' + t + '$')),
      score: (slot) => 'คะแนนรายวิชา ' + slot,
    };
    L.stuFirst = 3; L.stuLast = wb.sheet(L.stu).def.dim[0];
    L.subFirst = 2; L.subLast = wb.sheet(L.subj).def.dim[0];
    const sm = wb.sheet(L.sum); L.ab = [];
    for (let r = 6; r <= sm.def.dim[0]; r++) { const v = wb.get(sm, r, 1); if (typeof v === 'string' && /^\s*\d+\s*\.\s/.test(v)) L.ab.push(r); }
    L.abText = L.ab.map((r, i) => txt(L.sum, 6 + i, 9));
    // แถวคำอธิบายพฤติกรรมของแต่ละความสามารถ (อ่านจากสูตรชีท ป.1-2)
    L.behRow = L.ab.map((r, i) => {
      const sh = wb.sheet(L.sumBeh); const cell = sh && sh.cells.get(P.KEY(4 + i, 4));
      const m = cell && cell.f && /ค่าพฤติกรรม!\$?B\$?(\d+)/.exec(cell.f);
      return m ? +m[1] : null;
    });
    L.maxSub = L.subLast - L.subFirst + 1;
  }

  const stuScoreRow = (r) => r + 3, stuTraitRow = (r) => r + 1;
  // ชีทคะแนนรายวิชา: [ตัวชี้วัด, เก็บ, สอบ] / รวม / ระดับ ของแต่ละเทอม
  const SC = { 1: { inp: [3, 4, 5], tot: 6, lvl: 12 }, 2: { inp: [7, 8, 9], tot: 10, lvl: 13 }, year: 11, yearLvl: 14, note: 15 };
  const SC_LABEL = ['คะแนนรายตัวชี้วัด', 'คะแนนเก็บ', 'คะแนนสอบ'];
  const SC_SHORT = ['ตัวชี้วัด', 'เก็บ', 'สอบ'];
  const SC_EDIT = [...SC[1].inp, ...SC[2].inp, SC.note];
  // ช่องที่ต้องกรอก = ช่องที่คะแนนเต็มมากกว่า 0
  const scInputs = (sc, T) => SC[T].inp.filter(c => (num(sc, 4, c) ?? 0) > 0);
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
  };
  const TABS = [['home', 'หน้าแรก'], ['data', 'ข้อมูล'], ['scores', 'คะแนน'], ['assess', 'ประเมิน'], ['report', 'รายงาน']];
  function renderTabbar() {
    $('#tabbar').innerHTML = TABS.map(([k, t]) => `<button data-tab="${k}" class="${U.tab === k ? 'on' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${t}</button>`).join('');
  }
  function mount() {
    buildLayout();
    const sel = currentStudent(); if (!sel && students().length) A().S.wb.setValue(L.sum, { r: 3, c: 2 }, students()[0].name);
    const v = $('#view');
    if (!v.dataset.bound) {
      v.dataset.bound = '1';
      v.addEventListener('click', onClick);
      v.addEventListener('change', onChange);
      v.addEventListener('keydown', onKey);
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
    const fn = { home: vHome, data: vData, scores: vScores, assess: vAssess, report: vReport, docs: vDocs }[U.tab];
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
      for (let c = 3; c <= 10; c++) { at++; if (txt(L.trait(t), stuTraitRow(st.r), c)) af++; }
      for (let c = 3; c <= 5; c++) { at++; if (txt(L.act(t), stuTraitRow(st.r), c)) af++; }
    }
    return { stu, subs, infoDone, abDone, sp: total ? filled / total : 0, ap: at ? af / at : 0 };
  }
  function vHome() {
    const p = progress(), S = A().S;
    const step = (n, title, desc, done, to, pct) => `<button class="step ${done ? 'done' : ''}" data-act="goto" data-to="${to}"><span class="no">${done ? '✓' : n}</span><span style="flex:1;min-width:0"><b>${esc(title)}</b><small>${esc(desc)}</small>${pct !== undefined ? `<div class="prog"><i style="width:${Math.round(pct * 100)}%"></i></div>` : ''}</span><span class="go">›</span></button>`;
    return `
    <div class="card hello">${S.view.logo ? `<img class="logo" src="${S.view.logo}" alt="ตราโรงเรียน">` : ''}<div><h2>${esc(S.school.name)} 🔒</h2><p>ชั้นประถมศึกษาปีที่ ${S.grade} · ปีการศึกษา ${esc(txt(L.info, 9, 2))}</p></div></div>
    <div class="stat"><div><b>${p.stu.length}</b><span>นักเรียน</span></div><div><b>${p.subs.length}</b><span>รายวิชา</span></div><div><b>${Math.round(p.sp * 100)}%</b><span>คะแนนกรอกแล้ว</span></div></div>
    <div class="steps">
      ${step(1, 'ตั้งค่าโรงเรียน', p.infoDone ? 'กรอกชื่อครูและผู้อำนวยการแล้ว' : 'กรอกชื่อครูประจำชั้น ผู้อำนวยการ และตราโรงเรียน', p.infoDone, 'data:school')}
      ${step(2, 'รายชื่อนักเรียน', p.stu.length ? p.stu.length + ' คน' : 'เพิ่มนักเรียน หรือวางรายชื่อจาก Excel ทีเดียว', p.stu.length > 0, 'data:students')}
      ${step(3, 'รายวิชาและความสามารถ', p.subs.length ? p.subs.length + ' วิชา' + (p.abDone ? '' : ' (บางวิชายังไม่เลือกความสามารถ)') : 'เพิ่มวิชา แล้วเลือกว่าวิชาไหนอยู่ในความสามารถข้อใด', p.subs.length > 0 && p.abDone, 'data:subjects')}
      ${step(4, 'บันทึกคะแนน', 'เลือกวิชาแล้วกรอกคะแนนตัวชี้วัด/เก็บ/สอบ ทีละเทอม', p.sp >= 0.999, 'scores', p.sp)}
      ${step(5, 'ประเมินคุณลักษณะและกิจกรรม', 'แตะช่องเพื่อเลือก ผ่าน / ไม่ผ่าน', p.ap >= 0.999, 'assess', p.ap)}
      ${step(6, 'ดูรายงานและพิมพ์ ปพ.6', 'ผลรายคน ภาพรวมห้อง และพิมพ์ทั้งห้อง', false, 'report')}
    </div>
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
        ${field('ชั้น', inputFor(L.sub, 2, 3))}
        ${field('ชื่อ-สกุล ครูประจำชั้น', inputFor(i, 5, 2))}
        ${field('ชื่อ-สกุล หัวหน้างานวิชาการ', inputFor(i, 6, 2))}
        ${field('ชื่อ-สกุล รองผู้อำนวยการ (ถ้าไม่มี เว้นว่าง ระบบจะซ่อนลายเซ็น)', inputFor(i, 7, 2, { after: 'noop' }))}
        ${field('ชื่อ-สกุล ผู้อำนวยการ', inputFor(i, 8, 2))}
      </div></div>
    <div class="card"><h3>ตราโรงเรียน</h3>
      <div class="row">${S.view.logo ? `<img src="${S.view.logo}" alt="ตราโรงเรียน" style="height:84px;width:84px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:12px">` : '<span class="hint">ยังไม่ได้ใส่ตรา</span>'}
        <button class="btn primary" data-act="logo">เลือกรูปตรา</button>${S.view.logo ? '<button class="btn danger" data-act="logo-del">ลบตรา</button>' : ''}</div>
      <p class="hint">ตราจะแสดงในหน้าปก ปพ.5 และ ปพ.6 โดยอัตโนมัติ (ไฟล์ PNG/JPG)</p></div>${covBox}`;
  }

  // --- นักเรียน
  function vStudents() {
    const list = students(); const have = new Set(list.map(s => s.r));
    const pend = [...U.pendStu].filter(r => !have.has(r));
    const rows = [...list.map(s => s.r), ...pend].sort((a, b) => a - b);
    const body = rows.length ? rows.map(r => stuCard(r)).join('') : '<div class="card empty"><b>ยังไม่มีนักเรียน</b>กด “เพิ่มนักเรียน” หรือ “วางรายชื่อ” ด้านบน</div>';
    const full = list.length + pend.length >= L.stuLast - L.stuFirst + 1;
    return `<div class="bar"><span><b>${list.length}</b> / ${L.stuLast - L.stuFirst + 1} คน</span><span class="grow"></span>
      <button class="btn" data-act="stu-paste">วางรายชื่อ</button><button class="btn primary" data-act="stu-add"${full ? ' disabled' : ''}>＋ เพิ่มนักเรียน</button></div>${body}`;
  }
  function stuCard(r) {
    const sex = txt(L.stu, r, 3), att = get(L.stu, r, 4);
    return `<div class="card item" data-row="${r}">
      <div class="badge">${esc(get(L.stu, r, 1) ?? (r - 2))}</div>
      <input class="in" ${bind(L.stu, r, 2, 't', ` data-old="${esc(txt(L.stu, r, 2))}" data-after="stu"`)} type="text" value="${esc(txt(L.stu, r, 2))}" placeholder="ชื่อ - สกุล" autocomplete="off">
      <button class="btn danger sm" data-act="stu-del" data-r="${r}" aria-label="ลบนักเรียน">ลบ</button>
      <div class="full row sp">
        <div class="sexseg" role="group" aria-label="เพศ"><button data-act="sex" data-r="${r}" data-v="ชาย" class="${sex === 'ชาย' ? 'on' : ''}">ชาย</button><button data-act="sex" data-r="${r}" data-v="หญิง" class="${sex === 'หญิง' ? 'on' : ''}">หญิง</button></div>
        <label class="row" style="gap:6px">เข้าเรียน <input class="in" style="width:92px;text-align:center" ${bind(L.stu, r, 4, 'n', ` data-old="${att === null ? '' : esc(att)}" data-lo="0" data-hi="100"`)} type="text" inputmode="decimal" value="${att === null ? '' : esc(att)}" placeholder="%"> %</label>
      </div></div>`;
  }
  function addStudent() {
    for (let r = L.stuFirst; r <= L.stuLast; r++) {
      if (!txt(L.stu, r, 2).trim() && !U.pendStu.has(r)) { U.pendStu.add(r); refresh(); const el = $(`[data-row="${r}"] input[type=text]`); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } return; }
    }
    A().toast('ครบจำนวนนักเรียนสูงสุดแล้ว', 'warn');
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
  async function pasteStudents() {
    const free = []; for (let r = L.stuFirst; r <= L.stuLast; r++) if (!txt(L.stu, r, 2).trim()) free.push(r);
    const v = await uiModal({
      title: 'วางรายชื่อนักเรียน',
      body: `<p class="hint">พิมพ์หรือวางทีละบรรทัด 1 คน (คัดลอกจาก Excel ได้) รับได้อีก ${free.length} คน<br>รูปแบบ: <b>ชื่อ-สกุล</b> หรือ <b>ชื่อ-สกุล [Tab] เพศ [Tab] เข้าเรียน%</b> — ถ้าชื่อขึ้นต้น เด็กชาย/ด.ช. หรือ เด็กหญิง/ด.ญ. ระบบเดาเพศให้</p><textarea id="pasteBox" placeholder="เด็กชายสมชาย ใจดี&#10;เด็กหญิงสมศรี รักเรียน"></textarea>`,
      ok: 'เพิ่มรายชื่อ', read: (r) => $('#pasteBox', r).value,
    });
    if (v === null || !String(v).trim()) return;
    const lines = String(v).replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
    let n = 0, skipped = 0;
    A().batch(() => {
      for (const ln of lines) {
        if (!free.length) { skipped++; continue; }
        const parts = ln.split('\t').map(x => x.trim());
        const name = parts[0].replace(/^\d+[.)\s]+/, '').trim(); if (!name) continue;
        let sex = parts[1] || '';
        if (/^(ช|ชาย|ด\.?ช\.?|เด็กชาย)$/.test(sex)) sex = 'ชาย'; else if (/^(ญ|หญิง|ด\.?ญ\.?|เด็กหญิง)$/.test(sex)) sex = 'หญิง'; else sex = '';
        if (!sex) { if (/^(เด็กชาย|ด\.ช\.|ดช\.?)/.test(name)) sex = 'ชาย'; else if (/^(เด็กหญิง|ด\.ญ\.|ดญ\.?)/.test(name)) sex = 'หญิง'; }
        const r = free.shift();
        setv(L.stu, r, 2, name); if (sex) setv(L.stu, r, 3, sex);
        const att = parts[2] ? Number(parts[2].replace('%', '')) : NaN; if (isFinite(att) && att >= 0 && att <= 100) setv(L.stu, r, 4, att);
        n++;
      }
    });
    const first = students()[0]; if (first && !currentStudent()) WB().setValue(L.sum, { r: 3, c: 2 }, first.name);
    refresh(); A().toast('เพิ่มนักเรียน ' + n + ' คน' + (skipped ? ' (เกินจำนวนสูงสุด ข้าม ' + skipped + ' คน)' : ''), skipped ? 'warn' : 'ok');
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
        for (let c = 3; c <= 10; c++) setv(L.trait(t), stuTraitRow(r), c, null);
        for (let c = 3; c <= 5; c++) setv(L.act(t), stuTraitRow(r), c, null);
      }
    });
    U.pendStu.delete(r);
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
    const subs = subjects();
    return `<p class="sub">ความสามารถชั้นปีตามหลักสูตร 2568 — เลือกระดับที่คาดหวังของแต่ละข้อ (ใช้เปรียบเทียบพัฒนาการใน ปพ.6)</p>` + L.ab.map((r, i) => {
      const exp = txt(L.sum, r, 2); const t = L.abText[i];
      const mine = subs.filter(s => s.ab === t);
      const br = L.behRow[i];
      return `<div class="card"><div class="row" style="align-items:flex-start;flex-wrap:nowrap"><div class="badge">${i + 1}</div><div style="flex:1;min-width:0"><div>${esc(oneLine(t))}</div>
        <div class="chips" style="margin:6px 0">${mine.length ? mine.map(s => `<span class="chip">${esc(oneLine(s.name))}</span>`).join('') : '<span class="chip warn">ยังไม่มีวิชาในข้อนี้</span>'}</div></div></div>
        <div class="fld"><span>ระดับที่คาดหวัง</span><div class="seg" role="group">${LEVELS.map(l => `<button data-act="exp" data-i="${i}" data-v="${l}" class="${exp === l ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${br ? `<details class="more"><summary>แก้คำอธิบายพฤติกรรมแต่ละระดับ</summary><div class="grid2" style="margin-top:8px">${LEVELS.map((l, k) => field(l, inputFor(L.beh, br, 2 + k, { area: true, rows: 3 }))).join('')}</div></details>` : ''}
      </div>`;
    }).join('');
  }
  function setExpected(i, lv) {
    A().batch(() => {
      const r = L.ab[i]; setv(L.sum, r, 2, lv);
      for (const t of [1, 2]) if (L.term[t]) setv(L.term[t], r, 2, lv);
    });
    refresh();
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
    const termSeg = `<div class="bar" style="margin-top:10px">${seg([[1, 'เทอม 1'], [2, 'เทอม 2'], ['y', 'สรุปทั้งปี']], T, 'sterm')}</div>`;
    let maxBox = '';
    if (T !== 'y') maxBox = `<div class="card soft"><div class="maxbox">${SC[T].inp.map((c, i) => field(SC_LABEL[i] + ' เต็ม', inputFor(sc, 4, c, { kind: 'n', mode: 'numeric', after: 'maxchg' }))).join('')}<span class="hint">รวมเต็ม <b id="maxsum">${num(sc, 4, SC[T].tot) ?? ''}</b></span></div></div>`;
    else maxBox = `<div class="card soft"><span class="hint">คะแนนเต็มทั้งปี <b>${num(sc, 4, SC.year) ?? ''}</b> (เทอม 1 + เทอม 2) — ระดับคำนวณจากคะแนนรวมทั้งปี ตามเกณฑ์ ร้อยละ 75 / 65 / 55</span></div>`;
    const rows = stu.map(st => scoreRow(sc, st, T)).join('');
    const need = T === 'y' ? [] : scInputs(sc, T);
    let filled = 0; for (const st of stu) for (const c of need) if (get(sc, stuScoreRow(st.r), c) !== null) filled++;
    const prog = T === 'y' ? '' : `<div class="hint" style="margin:0 0 8px">กรอกแล้ว <b id="fillcnt">${filled}</b> / ${stu.length * need.length} ช่อง</div>`;
    return `${pickBar}${termSeg}${maxBox}${prog}<div class="srows" id="srows">${rows}</div>`;
  }
  function scoreRow(sc, st, T) {
    const r = stuScoreRow(st.r);
    const nameHtml = `<div class="badge">${esc(st.no)}</div><div class="sname">${esc(st.name)}</div>`;
    if (T === 'y') {
      const e = num(sc, r, SC[1].tot), h = num(sc, r, SC[2].tot), i = num(sc, r, SC.year);
      return `<div class="srow yr" data-row="${st.r}">${nameHtml}<div class="inps"><span class="ro">${e ?? '–'}</span><span class="ro">${h ?? '–'}</span><span class="ro"><b>${i ?? '–'}</b></span></div><div class="res">${lvChip(txt(sc, r, SC.yearLvl))}</div></div>`;
    }
    const tc = SC[T].tot, lc = SC[T].lvl;
    const mk = (c, lab) => `<label><span>${lab}</span><input type="text" inputmode="numeric" enterkeyhint="next" ${bind(sc, r, c, 'n', ` data-old="${esc(get(sc, r, c) ?? '')}" data-after="row" data-col="${c}"`)} value="${esc(get(sc, r, c) ?? '')}" autocomplete="off"${(num(sc, 4, c) ?? 0) > 0 ? ' placeholder="–"' : ' placeholder="ตั้งคะแนนเต็มก่อน" disabled'}></label>`;
    const tot = num(sc, r, tc), max = num(sc, 4, tc);
    const note = txt(sc, r, SC.note), noteOpen = U.openNote.has(st.r) || note;
    return `<div class="srow" data-row="${st.r}" data-sc="${esc(sc)}" data-tc="${tc}" data-lc="${lc}">${nameHtml}
      <div class="tot"><b data-role="tot">${tot ?? '–'}</b><span class="hint"> / ${max ?? ''}</span></div>
      <div class="inps">${SC[T].inp.map((c, i) => mk(c, SC_SHORT[i])).join('')}</div>
      <div class="res"><span data-role="lvl">${lvChip(txt(sc, r, lc))}</span><button class="btn sm ghost" data-act="note" data-r="${st.r}">${note ? '📝 หมายเหตุ' : '＋ หมายเหตุ'}</button></div>
      ${noteOpen ? `<div class="note"><input class="in" ${bind(sc, r, SC.note, 't', ` data-old="${esc(note)}"`)} type="text" value="${esc(note)}" placeholder="หมายเหตุ"></div>` : ''}</div>`;
  }
  function updateScoreRow(row) {
    if (!row || !row.dataset.sc) return;
    const sc = row.dataset.sc, r = stuScoreRow(+row.dataset.row), tc = +row.dataset.tc, lc = +row.dataset.lc;
    const tot = num(sc, r, tc); $('[data-role=tot]', row).textContent = tot ?? '–';
    $('.tot .hint', row).textContent = ' / ' + (num(sc, 4, tc) ?? '');
    $('[data-role=lvl]', row).innerHTML = lvChip(txt(sc, r, lc));
    const need = new Set(scInputs(sc, tc === SC[1].tot ? 1 : 2));
    const f = $('#fillcnt'); if (f) f.textContent = $$('#srows input[data-col]').filter(i => i.value !== '' && need.has(+i.dataset.col)).length;
  }
  function onKey(e) {
    if (e.key !== 'Enter') return;
    const el = e.target; if (!el.matches('input[data-col]')) return;
    e.preventDefault(); el.blur();
    const all = $$(`#srows input[data-col="${el.dataset.col}"]`); const nxt = all[all.indexOf(el) + 1];
    if (nxt) { nxt.focus(); nxt.select && nxt.select(); }
  }

  // ---------------------------------------------------------------- ประเมิน
  function vAssess() {
    const stu = students();
    if (!stu.length) return `<div class="card empty"><b>ยังไม่มีนักเรียน</b><br><button class="btn primary" data-act="goto" data-to="data:students">ไปเพิ่มนักเรียน</button></div>`;
    const t = U.aTerm, kind = U.kind;
    const sheet = kind === 'trait' ? L.trait(t) : L.act(t);
    const c0 = 3, c1 = kind === 'trait' ? 10 : 5, kc = c1 + 1;
    const heads = []; for (let c = c0; c <= c1; c++) heads.push(c);
    const head = `<tr><th class="stk">ชื่อ - สกุล</th>${heads.map(c => `<th data-act="acol" data-c="${c}" title="แตะเพื่อตั้งทั้งห้องเป็น ผ่าน">${esc(oneLine(txt(sheet, 3, c)))}</th>`).join('')}<th style="min-width:70px;cursor:default">สรุป</th></tr>`;
    const body = stu.map(st => {
      const r = stuTraitRow(st.r);
      return `<tr data-row="${st.r}"><td class="stk">${esc(st.no)}. ${esc(st.name)}</td>${heads.map(c => cellBtn(sheet, r, c)).join('')}<td data-role="sum">${passChip(txt(sheet, r, kc))}</td></tr>`;
    }).join('');
    return `<div class="bar">${seg([['trait', 'คุณลักษณะอันพึงประสงค์'], ['act', 'กิจกรรมพัฒนาผู้เรียน']], kind, 'akind')}${seg([[1, 'เทอม 1'], [2, 'เทอม 2']], t, 'aterm')}</div>
      <p class="sub">แตะช่องเพื่อสลับ ว่าง → ผ่าน → ไม่ผ่าน · แตะหัวคอลัมน์เพื่อตั้งทั้งห้องเป็น “ผ่าน”</p>
      <div class="bar"><button class="btn" data-act="aall" data-v="ผ่าน">ตั้งทั้งหมดเป็น “ผ่าน”</button><button class="btn danger" data-act="aall" data-v="">ล้างทั้งหมด</button></div>
      <div class="tw"><table class="t"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }
  const passChip = (v) => v ? `<span class="pass ${v === 'ผ่าน' ? 'ok' : 'no'}">${esc(v)}</span>` : '<span class="hint">–</span>';
  function cellBtn(sheet, r, c) {
    const v = txt(sheet, r, c);
    return `<td><button class="pc ${v === 'ผ่าน' ? 'ok' : v === 'ไม่ผ่าน' ? 'no' : ''}" data-act="pc" data-r="${r}" data-c="${c}">${v === 'ผ่าน' ? '✓ ผ่าน' : v === 'ไม่ผ่าน' ? '✗ ไม่ผ่าน' : '·'}</button></td>`;
  }
  function assessSheet() { return U.kind === 'trait' ? L.trait(U.aTerm) : L.act(U.aTerm); }
  function toggleAssess(btn) {
    const sheet = assessSheet(), r = +btn.dataset.r, c = +btn.dataset.c;
    const cur = txt(sheet, r, c); const nx = cur === '' ? 'ผ่าน' : cur === 'ผ่าน' ? 'ไม่ผ่าน' : null;
    if (!setv(sheet, r, c, nx)) return;
    refreshAssessRow(btn.closest('tr'), sheet);
  }
  function refreshAssessRow(tr, sheet) {
    const r = stuTraitRow(+tr.dataset.row); const kc = (U.kind === 'trait' ? 10 : 5) + 1;
    $$('button.pc', tr).forEach(b => { const td = b.closest('td'); td.innerHTML = cellBtn(sheet, r, +b.dataset.c).replace(/^<td>|<\/td>$/g, ''); });
    $('[data-role=sum]', tr).innerHTML = passChip(txt(sheet, r, kc));
  }
  function setAssessAll(v, col) {
    const sheet = assessSheet(); const c1 = U.kind === 'trait' ? 10 : 5;
    A().batch(() => { for (const st of students()) for (let c = col || 3; c <= (col || c1); c++) setv(sheet, stuTraitRow(st.r), c, v === '' ? null : v); });
    refresh();
  }

  // ---------------------------------------------------------------- รายงาน
  const currentStudent = () => { const v = get(L.sum, 3, 2); return v === null ? null : String(v); };
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
    for (const [k, getSheet, kc] of [['trait', L.trait, 11], ['act', L.act, 6]]) {
      const vals = ts.map(t => txt(getSheet(t), stuTraitRow(st.r), kc));
      res[k] = vals.every(v => v === 'ผ่าน') ? 'ผ่าน' : vals.some(v => v === 'ไม่ผ่าน') ? 'ไม่ผ่าน' : '';
    }
    return res;
  }
  function vReport() {
    const stu = students();
    if (!stu.length) return `<div class="card empty"><b>ยังไม่มีนักเรียน</b><br><button class="btn primary" data-act="goto" data-to="data:students">ไปเพิ่มนักเรียน</button></div>`;
    const W = U.repTerm;
    const top = `<div class="bar">${seg([['one', 'รายคน'], ['all', 'ทั้งห้อง']], U.repMode, 'rmode')}${seg([['sum', 'ทั้งปี'], [1, 'เทอม 1'], [2, 'เทอม 2']], W, 'rterm')}</div>`;
    return top + (U.repMode === 'all' ? vClass() : vOne());
  }
  function vOne() {
    const stu = students(); const W = U.repTerm;
    let curName = currentStudent(); let st = stu.find(s => s.name === curName);
    if (!st) { st = stu[0]; WB().setValue(L.sum, { r: 3, c: 2 }, st.name); }
    const idx = stu.indexOf(st);
    const abs = readReport(W); const ps = passFor(st, W);
    const sheetName = W === 'sum' ? L.sum : L.term[W];
    const cards = abs.map(a => `<div class="card abil"><header><div class="n">${a.i + 1}</div><div class="tx"><div>${esc(oneLine(a.text))}</div>
        <div class="lv"><span>คาดหวัง ${lvChip(a.exp)}</span><span>ได้ ${lvChip(a.got)}</span>${a.dev ? `<span class="dev ${a.dev === 'สูงกว่าเกณฑ์' ? 'up' : a.dev === 'เข้าใกล้เกณฑ์' ? 'down' : ''}">${esc(a.dev)}</span>` : ''}</div></div></header>
        ${a.subs.length ? `<div class="subs">${a.subs.map(s => { const pc = s.max ? Math.min(100, Math.round((s.got || 0) / s.max * 100)) : 0; return `<div class="sline"><span class="nm">${esc(oneLine(s.name))}</span><span><b>${s.got ?? '–'}</b> / ${s.max ?? ''}</span><div class="meter"><i style="width:${s.got === null ? 0 : pc}%"></i></div></div>`; }).join('')}</div>` : ''}
        ${a.desc && a.got ? `<div class="desc">${esc(a.desc)}</div>` : ''}</div>`).join('');
    return `<div class="card"><div class="pick"><button class="btn" data-act="stu-step" data-d="-1"${idx === 0 ? ' disabled' : ''} aria-label="คนก่อนหน้า">‹</button>
        <select data-act-change="stu-pick">${stu.map(s => `<option value="${esc(s.name)}"${s.name === st.name ? ' selected' : ''}>${esc(s.no)}. ${esc(s.name)}</option>`).join('')}</select>
        <button class="btn" data-act="stu-step" data-d="1"${idx === stu.length - 1 ? ' disabled' : ''} aria-label="คนถัดไป">›</button></div>
      <div class="rhead" style="margin-top:12px"><div><h3>${esc(st.name)}</h3><span class="hint">เลขที่ ${esc(st.no)} · ${esc(st.sex || '–')} · เข้าเรียน ${st.att ?? '–'}%</span></div>
        <div class="row"><span>กิจกรรม ${passChip2(ps.act)}</span><span>คุณลักษณะ ${passChip2(ps.trait)}</span></div></div></div>
      ${cards}
      <div class="card"><div class="row"><button class="btn primary" data-act="print-one">พิมพ์ ปพ.6 คนนี้</button><button class="btn" data-act="print-all">พิมพ์ทั้งห้อง</button><button class="btn" data-act="open-doc" data-n="${esc(sheetName)}">ดูแบบฟอร์มทางการ</button></div>
      <p class="hint">การพิมพ์: เลือก “บันทึกเป็น PDF” ในหน้าต่างพิมพ์ได้ (บนมือถือใช้เมนูแชร์/พิมพ์ของเบราว์เซอร์)</p></div>`;
  }
  const passChip2 = (v) => v ? `<span class="pass ${v === 'ผ่าน' ? 'ok' : 'no'}">${esc(v)}</span>` : '<span class="pass">ยังไม่ประเมิน</span>';
  function stepStudent(d) {
    const stu = students(); const i = stu.findIndex(s => s.name === currentStudent()); const n = stu[i + d]; if (!n) return;
    WB().setValue(L.sum, { r: 3, c: 2 }, n.name); refresh();
  }
  function vClass() {
    const stu = students(); const W = U.repTerm; const keep = currentStudent();
    const data = stu.map(st => { WB().setValue(L.sum, { r: 3, c: 2 }, st.name); return { st, abs: readReport(W).map(a => a.got) }; });
    WB().setValue(L.sum, { r: 3, c: 2 }, keep);
    const dist = L.ab.map((r, i) => { const c = [0, 0, 0, 0]; let n = 0; for (const d of data) { const k = lvIdx(d.abs[i]); if (k >= 0) { c[k]++; n++; } } return { c, n }; });
    const sumBar = `<div class="card"><h3>สรุปภาพรวมห้อง</h3>${L.ab.map((r, i) => { const d = dist[i]; return `<div style="margin:8px 0"><div class="row sp"><span>ข้อ ${i + 1} <span class="hint">${esc(oneLine(L.abText[i]).slice(0, 48))}…</span></span><span class="hint">${d.n ? d.c.map((x, k) => `${LEVELS[k]} ${x}`).join(' · ') : 'ยังไม่มีผล'}</span></div><div class="dist">${d.n ? d.c.map((x, k) => `<i class="d${k}" style="width:${x / d.n * 100}%"></i>`).join('') : ''}</div></div>`; }).join('')}</div>`;
    const head = `<tr><th class="stk">ชื่อ - สกุล</th>${L.ab.map((r, i) => `<th style="cursor:default">ข้อ ${i + 1}</th>`).join('')}</tr>`;
    const rows = data.map(d => `<tr data-act="open-stu" data-name="${esc(d.st.name)}" style="cursor:pointer"><td class="stk">${esc(d.st.no)}. ${esc(d.st.name)}</td>${d.abs.map(g => `<td>${lvChip(g)}</td>`).join('')}</tr>`).join('');
    return `${sumBar}<div class="tw"><table class="t"><thead>${head}</thead><tbody>${rows}</tbody></table></div><p class="hint">แตะชื่อนักเรียนเพื่อดูรายงานรายคน</p>
      <div class="card" style="margin-top:12px"><div class="row"><button class="btn primary" data-act="print-all">พิมพ์ ปพ.6 ทั้งห้อง</button></div></div>`;
  }
  function afterReport() { /* ที่ว่างสำหรับต่อยอด */ }
  const whichKey = () => U.repTerm;

  // ---------------------------------------------------------------- เอกสาร
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
      grp('ปพ.6 แจ้งผลการเรียน', [L.sum, L.sumBeh, L.term[1], L.termBeh[1], L.term[2], L.termBeh[2]].filter(Boolean)) +
      grp('ปก ปพ.5', all.filter(n => /^ปก /.test(n))) +
      grp('แบบบันทึกคะแนนรายวิชา (ปพ.5)', scoreNames, (n) => { const s = subs.find(x => L.score(x.slot) === n); return s ? oneLine(s.name) : n; }) +
      grp('คุณลักษณะและกิจกรรม', all.filter(n => /^(คุณลักษณะ|กิจกรรมพัฒนาผู้เรียน)/.test(n))) +
      grp('คู่มือ', all.filter(n => n === 'คู่มือ'));
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
      case 'stu-add': addStudent(); break;
      case 'stu-paste': pasteStudents(); break;
      case 'stu-del': delStudent(+b.dataset.r); break;
      case 'sex': { const r = +b.dataset.r; const nx = txt(L.stu, r, 3) === b.dataset.v ? null : b.dataset.v; if (setv(L.stu, r, 3, nx)) refresh(); break; }
      case 'sub-add': addSubject(); break;
      case 'sub-del': delSubject(+b.dataset.r); break;
      case 'exp': setExpected(+b.dataset.i, b.dataset.v); break;
      case 'sterm': U.scoreTerm = b.dataset.k === 'y' ? 'y' : +b.dataset.k; refresh(); break;
      case 'subj-step': { const subs = subjects(); const i = subs.findIndex(s => s.r === curSubject().r) + (+b.dataset.d); if (subs[i]) { U.slot = subs[i].r; refresh(); } break; }
      case 'note': { const r = +b.dataset.r; if (U.openNote.has(r)) U.openNote.delete(r); else U.openNote.add(r); refresh(); break; }
      case 'akind': U.kind = b.dataset.k; refresh(); break;
      case 'aterm': U.aTerm = +b.dataset.k; refresh(); break;
      case 'pc': toggleAssess(b); break;
      case 'acol': setAssessAll('ผ่าน', +b.dataset.c); break;
      case 'aall': setAssessAll(b.dataset.v); break;
      case 'rmode': U.repMode = b.dataset.k; refresh(); break;
      case 'rterm': U.repTerm = b.dataset.k === 'sum' ? 'sum' : +b.dataset.k; refresh(); break;
      case 'stu-step': stepStudent(+b.dataset.d); break;
      case 'open-stu': WB().setValue(L.sum, { r: 3, c: 2 }, b.dataset.name); U.repMode = 'one'; refresh(); break;
      case 'print-one': A().printOne(whichKey()); break;
      case 'print-all': A().printAll(whichKey()); break;
      case 'open-doc': A().openDoc(b.dataset.n); break;
      case 'print-doc': A().printSheets([b.dataset.n]); break;
      default: break;
    }
  }

  function onChange(e) {
    const el = e.target;
    const ac = el.dataset && el.dataset.actChange;
    if (ac === 'subj') { U.slot = +el.value; refresh(); return; }
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
    } else val = raw.trim() === '' ? null : raw.replace(/\r/g, '').trim();
    if (el.dataset.chk === 'subname' && val !== null) {
      const dup = subjects().find(s => s.r !== r && s.name.trim() === val);
      if (dup) { A().toast('มีวิชาชื่อนี้แล้ว กรุณาใช้ชื่ออื่น', 'warn'); revert(); return; }
    }
    const err = A().validate(sheet, r, c, val);
    if (err) { A().toast(err, 'warn'); el.classList.add('bad'); revert(); return; }
    el.classList.remove('bad');
    const wasCur = sheet === L.stu && c === 2 && el.dataset.old && el.dataset.old === currentStudent();
    if (!setv(sheet, r, c, val)) { revert(); return; }
    el.dataset.old = el.value;
    const af = el.dataset.after;
    if (af === 'row') updateScoreRow(el.closest('.srow'));
    else if (af === 'rerender') refresh();
    else if (af === 'maxchg') refresh();
    else if (af === 'sub') U.pendSub.delete(r);
    else if (af === 'stu') {
      U.pendStu.delete(r);
      if (val !== null && (wasCur || !currentStudent())) WB().setValue(L.sum, { r: 3, c: 2 }, val);
      if (val === null) refresh();
    }
  }

  root.PPUI = { mount, go, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
