/* app.js — แอปหลัก: เข้าสู่ระบบด้วยรหัสโรงเรียน, โหลด/บันทึก Supabase, แสดงชีท, กรอกข้อมูล, มาโคร, พิมพ์ */
(function () {
  'use strict';
  const P = window.PPEngine, R = window.PPRender, M = window.PPMacros;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = R.esc;
  const CFG = window.PP_CONFIG || {};
  const backend = window.PPBackend.create(CFG);
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const S = {
    code: null, school: null, grade: 1, data: null, wb: null, styles: null, names: null,
    view: { rowHidden: {}, colHidden, bg: {}, locked: new Set(), logo: null },
    userEdits: {}, version: 0, dirty: false, saving: false, active: null, editing: null, sel: null,
    dvCache: {}, zoom: 'fit', saveTimer: null, offline: false,
  };

  // ---------------------------------------------------------------- UI helpers
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }
  function modal(title, body, buttons) {
    return new Promise((resolve) => {
      const root = $('#modal');
      root.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions"></div></div>`;
      const act = $('.modal-actions', root);
      (buttons || [{ label: 'ตกลง', value: true, primary: true }]).forEach((b) => {
        const btn = document.createElement('button');
        btn.textContent = b.label; btn.className = 'btn' + (b.primary ? ' primary' : '');
        btn.onclick = () => { root.hidden = true; root.innerHTML = ''; resolve(b.value); };
        act.appendChild(btn);
      });
      root.hidden = false;
      const first = $('.btn.primary', act) || $('.btn', act); if (first) first.focus();
    });
  }
  function setStatus(txt, cls) { const el = $('#savestat'); el.textContent = txt; el.className = 'savestat ' + (cls || ''); }

  // ---------------------------------------------------------------- login
  async function doLogin(code, remember) {
    $('#login-err').textContent = '';
    const btn = $('#login-go'); btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ...';
    try {
      const res = await backend.login(code);
      if (!res || !res.ok) throw new Error((res && res.error) || 'รหัสสิทธิ์ไม่ถูกต้อง');
      S.code = code; S.school = { name: res.school_name, grades: res.grades && res.grades.length ? res.grades : [1] };
      if (remember) LS.set('pp_code', code); else LS.del('pp_code');
      await openGrade(S.school.grades.length === 1 ? S.school.grades[0] : (+LS.get('pp_grade') || S.school.grades[0]));
    } catch (e) {
      $('#login-err').textContent = e.offline ? 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่' : (e.message || 'เข้าสู่ระบบไม่สำเร็จ');
      LS.del('pp_code');
    } finally { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }
  }

  function logout() {
    if (S.dirty && !confirm('ยังมีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากระบบหรือไม่')) return;
    LS.del('pp_code'); location.reload();
  }

  // ---------------------------------------------------------------- open workbook
  async function openGrade(g) {
    S.grade = g; LS.set('pp_grade', String(g));
    $('#login').hidden = true; $('#app').hidden = false; $('#loading').hidden = false;
    $('#loading-msg').textContent = 'กำลังโหลดโปรแกรม ป.' + g + ' ...';
    try {
      const resp = await fetch('data/p' + g + '.json?v=' + '20261010m');
      if (!resp.ok) throw new Error('ไม่พบข้อมูลโปรแกรม ป.' + g);
      S.data = await resp.json();
    } catch (e) { $('#loading-msg').textContent = e.message; return; }
    S.styles = S.data.styles;
    $('#xl-css').textContent = R.styleCss(S.styles);
    S.wb = new P.Workbook(S.data);
    S.names = M.detectNames(S.wb);
    S.view = { rowHidden: {}, colHidden, bg: {}, locked: new Set(), logo: null };
    S.userEdits = {}; S.dvCache = {};
    buildDvIndex();
    // โหลดข้อมูลที่บันทึกไว้
    $('#loading-msg').textContent = 'กำลังโหลดข้อมูลของโรงเรียน...';
    let doc = null;
    try {
      const res = await backend.load(S.code, g);
      S.version = (res && res.version) || 0; doc = res && res.data;
      S.offline = false;
    } catch (e) {
      S.offline = true;
      const draft = LS.get(draftKey());
      if (draft) { try { doc = JSON.parse(draft).data; S.version = JSON.parse(draft).version || 0; } catch (x) { /* ignore */ } }
      toast('โหลดจากเซิร์ฟเวอร์ไม่ได้ ใช้ข้อมูลที่เก็บในเครื่องนี้แทน', 'warn');
    }
    applyDoc(doc);
    $('#school-name').textContent = S.school.name;
    $('#grade-label').textContent = 'ป.' + g;
    buildGradeSwitch();
    $('#loading').hidden = true;
    window.PPUI.mount();
    setStatus(S.offline ? 'ออฟไลน์ (ใช้ข้อมูลในเครื่อง)' : 'พร้อมใช้งาน', S.offline ? 'warn' : 'ok');
  }

  function draftKey() { return 'pp_draft_' + P_hash(S.code) + '_' + S.grade; }
  function P_hash(s) { let h = 5381; for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }

  function ctx() { return { wb: S.wb, view: S.view, names: S.names, toast }; }

  // ข้อมูลที่บันทึกด้วยผังชีทคะแนนรายวิชาแบบเก่า -> ผังปัจจุบัน (ตัวชี้วัด 1-10 / เก็บ=รวมตัวชี้วัด / สอบ / รวม ต่อเทอม)
  //  v1: A B เก็บ1 สอบ1 รวม1 เก็บ2 สอบ2 รวม2 ... หมายเหตุ(M)  -> คะแนนเก็บเดิมกลายเป็นตัวชี้วัด 1
  //  v2: A B ตัวชี้วัด1 เก็บ1 สอบ1 รวม1 ตัวชี้วัด2 เก็บ2 สอบ2 ... หมายเหตุ(O) -> ตัวชี้วัด + เก็บเดิม เป็นตัวชี้วัด 1, 2
  const SCORE_MAP = {
    1: { C: 'C', D: 'N', F: 'P', G: 'AA', M: 'AG' },
    2: { C: 'C', D: 'D', E: 'N', G: 'P', H: 'Q', I: 'AA', O: 'AG' },
  };
  const V2_MAX = { C4: 20, D4: 15, E4: 15, G4: 20, H4: 15, I4: 15 };   // คะแนนเต็มค่าเริ่มต้นของผัง v2
  function migrateDoc(doc) {
    const v = (doc && doc.v) || 1;
    if (!doc || !doc.cells || v >= 3) return doc;
    for (const [sheet, m] of Object.entries(doc.cells)) {
      if (!/^คะแนนรายวิชา \d+$/.test(sheet)) continue;
      const src = Object.keys(m).length && v === 2 ? { ...V2_MAX, ...m } : m;
      const out = {};
      for (const [ref, val] of Object.entries(src)) {
        const a = /^([A-Z]+)(\d+)$/.exec(ref); if (!a) continue;
        const col = P.colToNum(a[1]) <= 2 ? a[1] : SCORE_MAP[v][a[1]];
        if (col) out[col + a[2]] = val;
      }
      doc.cells[sheet] = out;
    }
    doc.v = 3;
    return doc;
  }

  // ชีทคะแนนรายวิชา: ซ่อนคอลัมน์ตัวชี้วัดที่ยังไม่ได้กำหนดคะแนนเต็ม (แถว 4)
  function colHidden(sheetName, c) {
    const sh = S.wb.sheet(sheetName); if (!sh) return undefined;
    // คุณลักษณะ / กิจกรรม: ซ่อนหัวข้อที่ชื่อว่าง (แถว 3)
    const fx = sh.def.flex;
    if (fx && fx.items) {
      if (c < fx.items[0] || c > fx.items[1]) return undefined;
      const h = S.wb.get(sh, 3, c); return h === null || h === undefined || String(h).trim() === '';
    }
    const n = sh.def.indicator; if (!n) return undefined;
    if (!((c >= 3 && c < 3 + n) || (c >= 16 && c < 16 + n))) return undefined;
    const v = S.wb.get(sh, 4, c);
    return v === null || v === undefined || v === '';
  }

  function applyDoc(doc) {
    const wb = S.wb;
    doc = migrateDoc(doc);
    if (doc && doc.cells) {
      for (const [sheet, m] of Object.entries(doc.cells)) {
        if (!wb.sheet(sheet)) continue;
        for (const [ref, val] of Object.entries(m)) { wb.setValue(sheet, ref, val); (S.userEdits[sheet] = S.userEdits[sheet] || {})[ref] = val; }
      }
    }
    if (doc && doc.logo) S.view.logo = doc.logo;
    lockSchoolName();
    // ผลลัพธ์ของมาโครคำนวณใหม่จากข้อมูลที่กรอก
    M.update1Full(ctx());
  }

  function lockSchoolName() {
    // ชื่อโรงเรียนมาจากเซิร์ฟเวอร์ตามรหัสสิทธิ์ แก้ไม่ได้
    S.wb.setValue(S.names.info, 'B3', S.school.name);
    S.view.locked.add(S.names.info + '!B3');
    delete (S.userEdits[S.names.info] || {}).B3;
  }

  // ---------------------------------------------------------------- navigation
  function buildGradeSwitch() {
    const sel = $('#grade-switch');
    if (S.school.grades.length < 2) { sel.hidden = true; return; }
    sel.hidden = false; sel.innerHTML = S.school.grades.map(g => `<option value="${g}"${g === S.grade ? ' selected' : ''}>ป.${g}</option>`).join('');
    sel.onchange = async () => { await flushSave(); openGrade(+sel.value); };
  }

  // ---------------------------------------------------------------- data validation
  function buildDvIndex() {
    for (const sh of S.wb.sheets) {
      const arr = [];
      for (const dv of sh.def.dv) {
        const ranges = String(dv.sq || '').split(/\s+/).filter(Boolean).map(R.parseRange).filter(Boolean);
        arr.push({ dv, ranges });
      }
      S.dvCache[sh.name] = arr;
    }
  }
  function findDv(sheetName, r, c) {
    const arr = S.dvCache[sheetName] || [];
    for (const e of arr) for (const g of e.ranges) if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) return e.dv;
    return null;
  }
  function evalFormulaIn(sheetName, f) {
    try {
      const sh = S.wb.sheet(sheetName); const ast = P.parse(String(f).replace(/^=/, ''));
      return S.wb.evalNode(ast, sh);
    } catch (e) { return P.E.REF; }
  }
  function listItems(sheetName, dv) {
    const f = String(dv.f1 || '');
    if (f.startsWith('"')) return f.replace(/^"|"$/g, '').split(',');
    const v = evalFormulaIn(sheetName, f); const out = [];
    if (v && v.isRange) { for (const x of S.wb.cellsOf(v)) if (x !== null && x !== '' && !P.isErr(x)) out.push(x); }
    return out;
  }
  function validate(sheetName, r, c, val) { // คืน null ถ้าผ่าน หรือข้อความผิดพลาด
    const dv = findDv(sheetName, r, c); if (!dv || val === null || val === '') return null;
    let bad = dv.e || 'ค่าที่กรอกไม่ถูกต้อง';
    bad = bad.replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (m, a, b) => { const v = S.wb.scalar(evalFormulaIn(sheetName, a + b)); return (typeof v === 'number') ? String(v) : m; });
    if (dv.t === 'list') { const items = listItems(sheetName, dv).map(String); return items.includes(String(val)) ? null : (dv.e || 'กรุณาเลือกจากรายการเท่านั้น'); }
    if (dv.t === 'whole' || dv.t === 'decimal') {
      if (typeof val !== 'number') return bad;
      if (dv.t === 'whole' && !Number.isInteger(val)) return bad;
      const lo = S.wb.scalar(evalFormulaIn(sheetName, dv.f1)); const hi = dv.f2 !== null && dv.f2 !== undefined ? S.wb.scalar(evalFormulaIn(sheetName, dv.f2)) : null;
      const op = dv.op || 'between';
      if (typeof lo !== 'number') return null;
      if (op === 'between') return (val >= lo && val <= hi) ? null : bad;
      if (op === 'notBetween') return (val < lo || val > hi) ? null : bad;
      const t = { equal: val === lo, notEqual: val !== lo, greaterThan: val > lo, lessThan: val < lo, greaterThanOrEqual: val >= lo, lessThanOrEqual: val <= lo }[op];
      return t === false ? bad : null;
    }
    return null;
  }

  // ---------------------------------------------------------------- เอกสาร (ดู/พิมพ์รูปแบบทางการ)
  function openDoc(name) {
    S.active = name;
    $('#docviewer').hidden = false; document.body.classList.add('docopen');
    $('#sheet-title').textContent = name;
    renderSheet(); renderToolbar();
    const sc = $('#sheet-scroll'); sc.scrollTop = 0; sc.scrollLeft = 0;
  }
  function closeDoc() { $('#docviewer').hidden = true; document.body.classList.remove('docopen'); if (window.PPUI) PPUI.refresh(); }
  function refreshDoc() { if (!$('#docviewer').hidden) renderSheet(); }

  function sheetHtmlFor(name, edit, area) {
    return R.sheetHtml({ wb: S.wb, sheetName: name, view: S.view, edit, area, styles: S.styles, hasList: (s, r, c) => { const d = findDv(s, r, c); return d && d.t === 'list'; }, logo: S.view.logo, logoAt: logoAnchor });
  }
  function renderSheet() {
    const pa = S.wb.sheet(S.active).def.print; const area = pa && pa.area ? pa.area.replace(/^.*!/, '') : null;
    const out = sheetHtmlFor(S.active, false, area);
    const host = $('#sheet-host'); host.innerHTML = out.html;
    const avail = Math.max(200, $('#sheet-scroll').clientWidth - 28);
    const z = S.zoom === 'fit' ? Math.min(1.6, avail / Math.max(1, out.width)) : +S.zoom;   // พอดีจอ: ขยายเกิน 100% ได้บนจอใหญ่
    host.style.zoom = Math.max(0.2, z);
  }

  function logoAnchor(sheetName) {
    if (sheetName === S.names.info) return { r: 10, c: 2, fit: true };
    if (/^ปก /.test(sheetName)) return { r: 2, c: 2, limitRow: 6 };
    if (/^ปพ\.6/.test(sheetName)) return { r: 2, c: 1, limitRow: 4 };
    return null;
  }

  function renderToolbar() {
    const tb = $('#sheet-tools'); tb.innerHTML = '';
    const add = (label, fn, cls) => { const b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.textContent = label; b.onclick = fn; tb.appendChild(b); };
    const n = S.active, N = S.names;
    const isRep = n === N.sum || n === N.term[1] || n === N.term[2];
    if (isRep) {
      const sel = document.createElement('select'); sel.className = 'docsel'; sel.setAttribute('aria-label', 'เลือกนักเรียน');
      const cur = S.wb.get(S.wb.sheet(N.sum), 3, 2);
      sel.innerHTML = M.studentList(ctx()).map(x => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
      sel.onchange = () => { S.wb.setValue(N.sum, { r: 3, c: 2 }, sel.value); renderSheet(); };
      tb.appendChild(sel);
      const which = n === N.sum ? 'sum' : (n === N.term[1] ? 1 : 2);
      add('พิมพ์คนนี้', () => printOne(which), 'primary'); add('พิมพ์ทั้งห้อง', () => printAll(which));
    } else {
      add('พิมพ์', () => printSheets([n]), 'primary');
    }
    if (/^ปก ปพ\.5 รายวิชา/.test(n)) {
      const sel = document.createElement('select'); sel.className = 'docsel'; sel.setAttribute('aria-label', 'เลือกวิชา');
      const cur = String(S.wb.get(S.wb.sheet(n), 6, 18) || '');
      const subs = []; const sj = S.wb.sheet(N.subj);
      for (let r = 2; r <= sj.def.dim[0]; r++) { const v = S.wb.get(sj, r, 1); if (v !== null && v !== '') subs.push(String(v)); }
      sel.innerHTML = subs.map(x => `<option value="${esc(x)}"${x === cur ? ' selected' : ''}>${esc(x.replace(/\n/g, ' '))}</option>`).join('');
      sel.onchange = () => { applyValue(n, 6, 18, sel.value); renderSheet(); };
      tb.appendChild(sel);
    }
    const sp = document.createElement('span'); sp.className = 'grow'; tb.appendChild(sp);
    const z = document.createElement('label'); z.className = 'zoom';
    z.innerHTML = 'ขนาด <select id="zoom"><option value="fit"' + (S.zoom === 'fit' ? ' selected' : '') + '>พอดีหน้าจอ</option>' + [0.6, 0.75, 1, 1.25, 1.5].map(v => `<option value="${v}"${+S.zoom === v ? ' selected' : ''}>${Math.round(v * 100)}%</option>`).join('') + '</select>';
    tb.appendChild(z);
    $('#zoom').onchange = (e) => { S.zoom = e.target.value === 'fit' ? 'fit' : +e.target.value; renderSheet(); };
  }

  // ---------------------------------------------------------------- กำหนดค่า (ตรวจเงื่อนไข + มาโคร + เก็บลงเอกสาร)
  function batch(fn) {
    S.batch = (S.batch || 0) + 1;
    try { return fn(); } finally { S.batch--; if (!S.batch && S.pendingDirty) { S.pendingDirty = false; markDirty(); } }
  }
  // กำหนดค่า + ตรวจ + มาโคร (คืน true ถ้าสำเร็จ)
  function applyValue(sheet, r, c, val) {
    const tgt = M.redirectStudent(ctx(), sheet, r, c);
    const sName = tgt ? tgt.sheet : sheet, rr = tgt ? tgt.r : r, cc = tgt ? tgt.c : c;
    const err = validate(sName, rr, cc, val);
    if (err) { toast(err, 'warn'); return false; }
    S.wb.setValue(sName, { r: rr, c: cc }, val);
    const ref = P.numToCol(cc) + rr;
    (S.userEdits[sName] = S.userEdits[sName] || {})[ref] = val;
    const ok = M.onChange(ctx(), sName, rr, cc);
    if (ok === false) { delete S.userEdits[sName][ref]; }
    markDirty();
    return ok !== false;
  }


  // ---------------------------------------------------------------- logo
  function loadLogo(file) {
    if (!file) return;
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 360; const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      S.view.logo = cv.toDataURL('image/png');
      URL.revokeObjectURL(url);
      markDirty(); refreshDoc(); if (window.PPUI) PPUI.refresh(); toast('ใส่ตราโรงเรียนในหน้าปกและ ปพ.6 เรียบร้อยแล้ว', 'ok');
    };
    img.onerror = () => { toast('อ่านไฟล์รูปไม่ได้', 'warn'); };
    img.src = url;
  }
  async function removeLogo() {
    const yes = await modal('ตราโรงเรียน', '<p>ต้องการลบตราโรงเรียนออกจากทุกชีทใช่หรือไม่</p>', [{ label: 'ยกเลิก', value: false }, { label: 'ลบตรา', value: true, primary: true }]);
    if (yes) { S.view.logo = null; markDirty(); refreshDoc(); if (window.PPUI) PPUI.refresh(); }
  }

  // ---------------------------------------------------------------- save
  function buildDoc() { return { v: 3, grade: S.grade, cells: S.userEdits, logo: S.view.logo || null, active: S.active, savedAt: new Date().toISOString() }; }
  function markDirty() {
    if (S.batch) { S.pendingDirty = true; S.dirty = true; return; }
    S.dirty = true; setStatus('มีการแก้ไข... (จะบันทึกอัตโนมัติ)', 'dirty');
    LS.set(draftKey(), JSON.stringify({ data: buildDoc(), version: S.version }));
    clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 1500);
  }
  async function save(force) {
    if (S.saving) { S.saveTimer = setTimeout(save, 800); return; }
    if (!S.dirty && !force) return;
    S.saving = true; setStatus('กำลังบันทึก...', 'saving');
    const snapshot = buildDoc();
    try {
      const res = await backend.save(S.code, S.grade, snapshot, S.version, force === true);
      if (res && res.conflict) {
        S.saving = false;
        const choice = await modal('ข้อมูลถูกแก้ไขจากเครื่องอื่น', '<p>มีการบันทึกข้อมูลใหม่กว่าจากอีกเครื่องหรืออีกแท็บ</p><p>ต้องการ <b>โหลดข้อมูลล่าสุด</b> (ข้อมูลที่แก้ในหน้านี้จะหายไป) หรือ <b>บันทึกทับ</b> ด้วยข้อมูลในหน้านี้?</p>',
          [{ label: 'โหลดข้อมูลล่าสุด', value: 'reload' }, { label: 'บันทึกทับ', value: 'force', primary: true }]);
        if (choice === 'reload') { S.dirty = false; LS.del(draftKey()); location.reload(); return; }
        return save(true);
      }
      S.version = res.version; S.dirty = false; S.offline = false; LS.set(draftKey(), JSON.stringify({ data: snapshot, version: S.version }));
      setStatus('บันทึกแล้ว ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), 'ok');
    } catch (e) {
      S.offline = !!e.offline;
      setStatus(e.offline ? 'ออฟไลน์ — เก็บไว้ในเครื่อง จะบันทึกขึ้นระบบเมื่อมีเน็ต' : 'บันทึกไม่สำเร็จ: ' + e.message, 'err');
      clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 15000);
    } finally { S.saving = false; }
  }
  async function flushSave() { clearTimeout(S.saveTimer); if (S.dirty) await save(); }

  // ---------------------------------------------------------------- print
  const PAPER = { 9: [210, 297], 8: [297, 420], 1: [216, 279], 5: [216, 356], 7: [184, 267] };
  function printBlock(sheetName) {
    const d = S.wb.sheet(sheetName).def; const pr = d.print;
    const [pw, ph] = PAPER[pr.paper] || PAPER[9];
    const land = pr.orient === 'landscape';
    const W = (land ? ph : pw) / 25.4 * 96, H = (land ? pw : ph) / 25.4 * 96;
    const m = pr.m || [0.7, 0.7, 0.75, 0.75];
    const availW = W - (m[0] + m[1]) * 96, availH = H - (m[2] + m[3]) * 96;
    let area = pr.area ? pr.area.replace(/^.*!/, '') : null;
    const out = sheetHtmlFor(sheetName, false, area);
    let zoom = 1;
    if (pr.fitPage) {
      const fw = pr.fw === 0 ? 0 : (pr.fw || 1), fh = pr.fh === 0 ? 0 : (pr.fh || 1);
      const zw = fw ? availW * fw / out.width : Infinity, zh = fh ? availH * fh / out.height : Infinity;
      zoom = Math.min(1, zw, zh);
    } else if (pr.scale) zoom = pr.scale / 100;
    zoom = Math.max(0.2, zoom * 0.985);
    return { html: out.html, zoom, land, m, hc: pr.hc, width: out.width * zoom };
  }
  async function printSheets(list, preBuilt) {
    const blocks = preBuilt || list.filter(Boolean).map(printBlock);
    const root = $('#print-root');
    root.innerHTML = blocks.map(b => `<section class="pp-page ${b.land ? 'land' : 'port'}" style="padding:${b.m[2]}in ${b.m[1]}in ${b.m[3]}in ${b.m[0]}in"><div class="pp-zoom" style="zoom:${b.zoom}${b.hc ? ';margin:0 auto;width:max-content' : ''}">${b.html}</div></section>`).join('');
    document.body.classList.add('printing');
    await new Promise(r => setTimeout(r, 120));
    window.print();
    setTimeout(() => { document.body.classList.remove('printing'); root.innerHTML = ''; }, 500);
  }
  function printOne(which) { printSheets(M.sheetsFor(ctx(), which)); }
  async function printAll(which) {
    const students = M.studentList(ctx());
    if (!students.length) { toast('ไม่พบรายชื่อนักเรียน', 'warn'); return; }
    const yes = await modal('สั่งปริ้นทั้งหมด', `<p>จะพิมพ์ ${students.length} คน (คนละ 2 หน้า) ต้องการดำเนินการต่อหรือไม่</p><p class="hint">เลือก "บันทึกเป็น PDF" ในหน้าต่างพิมพ์ได้</p>`, [{ label: 'ยกเลิก', value: false }, { label: 'พิมพ์ทั้งหมด', value: true, primary: true }]);
    if (!yes) return;
    const sumSheet = S.wb.sheet(S.names.sum); const old = S.wb.get(sumSheet, 3, 2);
    const names = M.sheetsFor(ctx(), which).filter(Boolean); const blocks = [];
    for (const st of students) {
      S.wb.setValue(S.names.sum, { r: 3, c: 2 }, st);
      for (const n of names) blocks.push(printBlock(n));
    }
    S.wb.setValue(S.names.sum, { r: 3, c: 2 }, old);
    await printSheets(null, blocks);
    refreshDoc();
  }

  // พิมพ์หลายเอกสารรวดเดียว: items = [{ sheet, subj? }] (subj = วิชาที่ให้หน้าปก ปพ.5 รายวิชา แสดง)
  const SUBJ_CELL = { r: 6, c: 18 };   // ปก ปพ.5 รายวิชา!R6
  function setCoverSubject(sheet, subj) { S.wb.setValue(sheet, SUBJ_CELL, subj); }
  async function printSet(items) {
    items = items.filter(x => x && S.wb.sheet(x.sheet));
    if (!items.length) { toast('ไม่มีเอกสารให้พิมพ์', 'warn'); return; }
    const old = {}; const blocks = [];
    for (const it of items) {
      if (it.subj !== undefined) { if (!(it.sheet in old)) old[it.sheet] = S.wb.get(S.wb.sheet(it.sheet), SUBJ_CELL.r, SUBJ_CELL.c); setCoverSubject(it.sheet, it.subj); }
      blocks.push(printBlock(it.sheet));
    }
    for (const [sh, v] of Object.entries(old)) setCoverSubject(sh, v);
    await printSheets(null, blocks);
  }
  function openCover(sheet, subj) { if (subj !== undefined) applyValue(sheet, SUBJ_CELL.r, SUBJ_CELL.c, subj); openDoc(sheet); }

  // ---------------------------------------------------------------- boot
  function boot() {
    $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); doLogin($('#login-code').value, $('#login-remember').checked); });
    $('#logout').onclick = logout;
    $('#doc-close').onclick = closeDoc;
    $('#open-docs').onclick = () => { if (window.PPUI) PPUI.go('docs'); };
    $('#logo-file').addEventListener('change', (e) => { loadLogo(e.target.files[0]); e.target.value = ''; });
    $('#save-now').onclick = () => save(true);
    window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('online', () => { if (S.dirty) save(); });
    window.addEventListener('resize', () => { if (!$('#docviewer').hidden && S.zoom === 'fit') renderSheet(); });
    if (backend.demo) { $('#demo-note').hidden = false; $('#login-code').value = 'DEMO'; }
    const saved = LS.get('pp_code');
    if (saved && !backend.demo) { $('#login-code').value = saved; $('#login-remember').checked = true; doLogin(saved, true); }
  }
  document.addEventListener('DOMContentLoaded', boot);
  window.PPApp = {
    S, ctx, toast, modal, applyValue, validate, markDirty, save, batch, printSheets, printOne, printAll, printBlock,
    openDoc, closeDoc, refreshDoc, printSet, openCover, pickLogo: () => $('#logo-file').click(), removeLogo, setStatus, flushSave,
  };
})();
