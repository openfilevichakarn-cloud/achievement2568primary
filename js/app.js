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
    code: null, school: null, grade: 1, room: 1, rooms: {}, data: null, wb: null, styles: null, names: null,
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
      const ready = (window.PP_CONFIG && PP_CONFIG.GRADES_READY) || [1];
      const granted = res.grades && res.grades.length ? res.grades : [1];
      const grades = granted.filter(g => ready.includes(g));
      if (!grades.length) throw new Error('ชั้นที่โรงเรียนได้รับสิทธิ์ (ป.' + granted.join(', ป.') + ') ยังไม่เปิดให้ใช้งาน กรุณาติดต่อผู้ดูแล');
      S.code = code; S.school = { name: res.school_name, grades, logo: res.logo || null };
      // ห้องเรียนที่มีข้อมูลแล้ว (ชั้นที่ยังไม่มี = ห้อง 1)
      S.rooms = {};
      for (const x of res.rooms || []) if (grades.includes(x.grade)) (S.rooms[x.grade] = S.rooms[x.grade] || []).push(x.room);
      for (const g of grades) S.rooms[g] = [...new Set(S.rooms[g] && S.rooms[g].length ? S.rooms[g] : [1])].sort((a, b) => a - b);
      if (remember) LS.set('pp_code', code); else LS.del('pp_code');
      const last = +LS.get('pp_grade'), lastRoom = +LS.get('pp_room') || 1;
      const g0 = S.school.grades.includes(last) ? last : S.school.grades[0];
      await openGrade(g0, S.rooms[g0].includes(lastRoom) ? lastRoom : S.rooms[g0][0]);
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
  const roomLabel = (g, r) => 'ป.' + g + '/' + r;
  async function openGrade(g, room) {
    room = room || (S.rooms[g] && S.rooms[g][0]) || 1;
    S.grade = g; S.room = room; LS.set('pp_grade', String(g)); LS.set('pp_room', String(room));
    if (!S.rooms[g].includes(room)) S.rooms[g] = [...S.rooms[g], room].sort((a, b) => a - b);
    $('#login').hidden = true; $('#app').hidden = false; $('#loading').hidden = false;
    $('#loading-msg').textContent = 'กำลังโหลดโปรแกรม ' + roomLabel(g, room) + ' ...';
    try {
      const resp = await fetch('data/p' + g + '.json?v=' + '20261016q');
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
      const res = await backend.load(S.code, g, room);
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
    $('#grade-label').textContent = roomLabel(g, room);
    buildGradeSwitch();
    $('#loading').hidden = true;
    window.PPUI.mount();
    setStatus(S.offline ? 'ออฟไลน์ (ใช้ข้อมูลในเครื่อง)' : 'พร้อมใช้งาน', S.offline ? 'warn' : 'ok');
  }

  function draftKey() { return 'pp_draft_' + P_hash(S.code) + '_' + S.grade + (S.room > 1 ? '_' + S.room : ''); }
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
    // ตราโรงเรียนเก็บที่เดียวต่อโรงเรียน — ข้อมูลรุ่นเก่าที่เก็บตราไว้ในข้อมูลชั้น: ย้ายขึ้นไปที่โรงเรียนครั้งแรกที่เปิด
    if (!S.school.logo && doc && doc.logo) { S.school.logo = doc.logo; backend.setLogo(S.code, doc.logo).catch(() => {}); }
    S.view.logo = S.school.logo || null;
    lockSchoolName();
    roomClassLabel();
    // ผลลัพธ์ของมาโครคำนวณใหม่จากข้อมูลที่กรอก
    M.update1Full(ctx());
  }

  // ชื่อชั้นในเอกสาร (รายวิชา!C2 ใช้ในสูตรของเอกสารทุกฉบับ): ถ้าครูยังไม่ได้แก้เอง ใส่ห้องให้อัตโนมัติเมื่อชั้นนั้นมีหลายห้อง
  function roomClassLabel() {
    if ((S.userEdits['รายวิชา'] || {}).C2 !== undefined || !S.wb.sheet('รายวิชา')) return;
    const multi = S.room > 1 || (S.rooms[S.grade] || []).length > 1;
    S.wb.setValue('รายวิชา', 'C2', 'ประถมศึกษาปีที่ ' + S.grade + (multi ? '/' + S.room : ''));
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
    sel.hidden = false;
    sel.innerHTML = S.school.grades.map(g => `<optgroup label="ชั้น ป.${g}">${S.rooms[g].map(r => `<option value="${g}-${r}"${g === S.grade && r === S.room ? ' selected' : ''}>${roomLabel(g, r)}</option>`).join('')}</optgroup>`).join('')
      + '<option value="manage">⚙ จัดการห้องเรียน…</option>';
    sel.onchange = async () => {
      if (sel.value === 'manage') { sel.value = S.grade + '-' + S.room; manageRooms(); return; }
      const [g, r] = sel.value.split('-').map(Number);
      await flushSave(); openGrade(g, r);
    };
  }
  // จัดการห้องเรียน: เพิ่ม / ลบห้อง (ชั้นละไม่เกิน 10 ห้อง) — ใช้รหัสโรงเรียนเดียวกันทุกห้อง
  const MAX_ROOMS = 10;
  function manageRooms() {
    const root = $('#modal');
    const draw = () => {
      root.innerHTML = `<div class="modal-card rooms-card" role="dialog" aria-modal="true"><h3>จัดการห้องเรียน</h3><div class="modal-body">
        <p class="hint">แต่ละห้องมีข้อมูลแยกกัน (นักเรียน คะแนน ผลประเมิน) · ชั้นละไม่เกิน ${MAX_ROOMS} ห้อง · ทุกห้องใช้รหัสโรงเรียนเดียวกัน</p>
        ${S.school.grades.map(g => `<div class="rm-row"><b>ป.${g}</b><div class="rm-chips">${S.rooms[g].map(r => `<span class="rm-chip${g === S.grade && r === S.room ? ' cur' : ''}"><button class="rm-open" data-g="${g}" data-r="${r}" title="เปิดห้องนี้">${roomLabel(g, r)}</button>${S.rooms[g].length > 1 ? `<button class="rm-del" data-g="${g}" data-r="${r}" aria-label="ลบ ${roomLabel(g, r)}" title="ลบห้องนี้">×</button>` : ''}</span>`).join('')}
          ${S.rooms[g].length < MAX_ROOMS ? `<button class="btn sm rm-add" data-g="${g}">＋ เพิ่มห้อง</button>` : '<span class="hint">ครบ 10 ห้องแล้ว</span>'}</div></div>`).join('')}
        </div><div class="modal-actions"><button class="btn primary" data-x>ปิด</button></div></div>`;
      root.hidden = false;
    };
    const close = () => { root.hidden = true; root.innerHTML = ''; root.onclick = null; };
    root.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-x')) { close(); return; }
      const g = +b.dataset.g, r = +b.dataset.r;
      if (b.classList.contains('rm-open')) { close(); await flushSave(); openGrade(g, r); return; }
      if (b.classList.contains('rm-add')) {
        const n = Array.from({ length: MAX_ROOMS }, (_, i) => i + 1).find(x => !S.rooms[g].includes(x)); if (!n) return;
        b.disabled = true;
        try {
          // ห้องเดิมที่ยังไม่เคยบันทึก (เช่น ห้อง 1 ที่ยังว่าง) บันทึกไว้ก่อน ไม่ให้หายจากรายการเมื่อเข้าระบบครั้งหน้า
          await flushSave();
          for (const r0 of S.rooms[g]) {
            if (g === S.grade && r0 === S.room && S.version > 0) continue;
            const cur = await backend.load(S.code, g, r0);
            if (cur && !cur.version) await backend.save(S.code, g, r0, cur.data || { v: 3, grade: g, room: r0, cells: {}, savedAt: new Date().toISOString() }, 0, false);
          }
          const res = await backend.save(S.code, g, n, { v: 3, grade: g, room: n, cells: {}, savedAt: new Date().toISOString() }, 0, false);
          if (!res || res.ok === false) throw new Error((res && res.error) || 'เพิ่มห้องไม่สำเร็จ');
        } catch (x) { toast(x.message || 'เพิ่มห้องไม่สำเร็จ', 'warn'); b.disabled = false; return; }
        S.rooms[g] = [...S.rooms[g], n].sort((a, c) => a - c);
        close(); await flushSave(); toast('เพิ่มห้อง ' + roomLabel(g, n) + ' แล้ว', 'ok'); openGrade(g, n); return;
      }
      if (b.classList.contains('rm-del')) {
        if (!confirm(`ลบห้อง ${roomLabel(g, r)} พร้อมข้อมูลทั้งหมดของห้องนี้ (นักเรียน คะแนน ผลประเมิน)?\nย้อนกลับไม่ได้ — แนะนำให้กด “สำรองข้อมูล” ที่หน้าแรกก่อน`)) return;
        try { const res = await backend.deleteRoom(S.code, g, r); if (res && res.ok === false) throw new Error(res.error); }
        catch (x) { toast('ลบห้องไม่สำเร็จ: ' + (x.message || ''), 'warn'); return; }
        S.rooms[g] = S.rooms[g].filter(x => x !== r);
        LS.del('pp_draft_' + P_hash(S.code) + '_' + g + (r > 1 ? '_' + r : ''));
        toast('ลบห้อง ' + roomLabel(g, r) + ' แล้ว', 'ok');
        if (g === S.grade && r === S.room) { S.dirty = false; clearTimeout(S.saveTimer); close(); openGrade(g, S.rooms[g][0]); return; }
        buildGradeSwitch(); draw();
      }
    };
    draw();
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

  function sheetHtmlFor(name, edit, area, viewOv) {
    return R.sheetHtml({ wb: S.wb, sheetName: name, view: viewOv ? { ...S.view, ...viewOv } : S.view, edit, area, styles: S.styles, hasList: (s, r, c) => { const d = findDv(s, r, c); return d && d.t === 'list'; }, logo: S.view.logo, logoAt: logoAnchor });
  }
  function renderSheet() {
    const pa = S.wb.sheet(S.active).def.print; const area = pa && pa.area ? pa.area.replace(/^.*!/, '') : null;
    const out = sheetHtmlFor(S.active, false, area);
    const host = $('#sheet-host'); host.innerHTML = out.html;
    const avail = Math.max(200, $('#sheet-scroll').clientWidth - 28);
    const z = S.zoom === 'fit' ? Math.min(1.6, avail / Math.max(1, out.width)) : +S.zoom;   // พอดีจอ: ขยายเกิน 100% ได้บนจอใหญ่
    host.style.zoom = Math.max(0.2, z); host.style.setProperty('--bw', (1 / Math.max(0.2, z)) + 'px');
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
    const isRep = n === N.sum || n === N.term[1] || n === N.term[2] || (N.stage && n === N.stage);
    if (isRep) {
      const sel = document.createElement('select'); sel.className = 'docsel'; sel.setAttribute('aria-label', 'เลือกนักเรียน');
      const cur = S.wb.get(S.wb.sheet(N.sum), 3, 2);
      sel.innerHTML = M.studentList(ctx()).map(x => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
      sel.onchange = () => { S.wb.setValue(N.sum, { r: 3, c: 2 }, sel.value); renderSheet(); };
      tb.appendChild(sel);
      const which = n === N.sum ? 'sum' : n === N.stage ? 'stage' : (n === N.term[1] ? 1 : 2);
      add('พิมพ์คนนี้', () => printOne(which), 'primary'); add('พิมพ์ทั้งห้อง', () => printAll(which));
    } else if (S.wb.sheet(n) && S.wb.sheet(n).def.indicator) {   // แบบบันทึกคะแนนรายวิชา: พิมพ์ทั้งหมด หรือแยกเทอม 1 / เทอม 2 / รวมทั้งปี
      add('พิมพ์ทั้งหมด (3 หน้า)', () => printScores([n]), 'primary');
      add('เทอม 1', () => printScores([n], 1)); add('เทอม 2', () => printScores([n], 2)); add('รวมทั้งปี', () => printScores([n], 'sum'));
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
      const max = 300; const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const logo = cv.toDataURL('image/png');
      URL.revokeObjectURL(url);
      backend.setLogo(S.code, logo).then((res) => {
        if (res && res.ok === false) throw new Error(res.error);
        S.school.logo = S.view.logo = logo;
        refreshDoc(); if (window.PPUI) PPUI.refresh(); toast('ใส่ตราโรงเรียนแล้ว (ใช้กับทุกชั้น ทุกห้อง)', 'ok');
      }).catch((e) => toast('บันทึกตราไม่สำเร็จ: ' + (e.message || ''), 'warn'));
    };
    img.onerror = () => { toast('อ่านไฟล์รูปไม่ได้', 'warn'); };
    img.src = url;
  }
  async function removeLogo() {
    const yes = await modal('ตราโรงเรียน', '<p>ต้องการลบตราโรงเรียนออกจากทุกชีทใช่หรือไม่</p>', [{ label: 'ยกเลิก', value: false }, { label: 'ลบตรา', value: true, primary: true }]);
    if (!yes) return;
    try { const res = await backend.setLogo(S.code, null); if (res && res.ok === false) throw new Error(res.error); }
    catch (e) { toast('ลบตราไม่สำเร็จ: ' + (e.message || ''), 'warn'); return; }
    S.school.logo = S.view.logo = null; refreshDoc(); if (window.PPUI) PPUI.refresh();
  }

  // ---------------------------------------------------------------- save
  function buildDoc() { return { v: 3, grade: S.grade, room: S.room, cells: S.userEdits, active: S.active, savedAt: new Date().toISOString() }; }
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
      const res = await backend.save(S.code, S.grade, S.room, snapshot, S.version, force === true);
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

  // ---------------------------------------------------------------- สำรองข้อมูล (ไฟล์ .json ทุกชั้นที่โรงเรียนมีสิทธิ์)
  const BACKUP_TAG = 'pp56-backup';
  // ไฟล์รุ่น 2: rooms = { "ชั้น/ห้อง": ข้อมูล } + ตราโรงเรียน  (รุ่น 1: grades = { ชั้น: ข้อมูล } = ห้อง 1)
  async function exportBackup() {
    await flushSave();
    const rooms = {};
    for (const g of S.school.grades) for (const r of S.rooms[g]) {
      if (g === S.grade && r === S.room) { rooms[g + '/' + r] = buildDoc(); continue; }
      try { const res = await backend.load(S.code, g, r); if (res && res.data) rooms[g + '/' + r] = res.data; }
      catch (e) { toast('โหลดข้อมูล ' + roomLabel(g, r) + ' ไม่ได้ — ' + (e.message || ''), 'warn'); return; }
    }
    const file = { app: BACKUP_TAG, ver: 2, school: S.school.name, exportedAt: new Date().toISOString(), logo: S.school.logo || null, rooms };
    const d = new Date(), pad = (x) => String(x).padStart(2, '0');
    const name = `backup-pp5-pp6_${d.getFullYear() + 543}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;   // ชื่อไฟล์ภาษาอังกฤษ: บางเบราว์เซอร์ไม่รองรับชื่อภาษาไทย
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('ดาวน์โหลดไฟล์สำรองแล้ว (' + Object.keys(rooms).length + ' ห้อง)', 'ok');
  }
  function pickBackup() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => { if (inp.files[0]) importBackup(inp.files[0]); };
    inp.click();
  }
  async function importBackup(f) {
    let file;
    try { file = JSON.parse(await f.text()); } catch (e) { file = null; }
    const src = file && file.app === BACKUP_TAG ? (file.rooms || (file.grades && Object.fromEntries(Object.entries(file.grades).map(([g, d]) => [g + '/1', d])))) : null;
    if (!src || typeof src !== 'object') { toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของโปรแกรม', 'warn'); return; }
    const all = Object.entries(src).map(([k, doc]) => { const [g, r] = k.split('/').map(Number); return { g, r, doc }; }).filter(x => x.doc && x.doc.cells);
    const list = all.filter(x => S.school.grades.includes(x.g) && x.r >= 1 && x.r <= MAX_ROOMS).sort((a, b) => a.g - b.g || a.r - b.r);
    const skip = all.filter(x => !list.includes(x));
    if (!list.length) { toast('ไฟล์สำรองไม่มีข้อมูลของชั้นที่โรงเรียนนี้ใช้งาน', 'warn'); return; }
    const when = file.exportedAt ? new Date(file.exportedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
    const other = file.school && file.school !== S.school.name;
    const yes = await modal('นำเข้าข้อมูลสำรอง', `<p>ไฟล์สำรองของ <b>${esc(file.school || '-')}</b> เมื่อ ${esc(when)}</p>
      ${other ? '<p class="err">ชื่อโรงเรียนในไฟล์ไม่ตรงกับโรงเรียนที่เข้าสู่ระบบอยู่</p>' : ''}
      <p>ข้อมูลปัจจุบันของ <b>${list.map(x => roomLabel(x.g, x.r)).join(', ')}</b> จะถูก<b>แทนที่ทั้งหมด</b>ด้วยข้อมูลในไฟล์ (ย้อนกลับไม่ได้)</p>
      ${skip.length ? `<p class="hint">ข้าม ${skip.map(x => roomLabel(x.g, x.r)).join(', ')} (โรงเรียนนี้ไม่มีสิทธิ์ชั้นนี้)</p>` : ''}
      <p class="hint">แนะนำ: กด “สำรองข้อมูล” เก็บข้อมูลปัจจุบันไว้ก่อน</p>`,
      [{ label: 'ยกเลิก', value: false }, { label: 'แทนที่ด้วยไฟล์สำรอง', value: true, primary: true }]);
    if (!yes) return;
    clearTimeout(S.saveTimer); S.dirty = false;
    try {
      for (const { g, r, doc: d } of list) {
        const cur = await backend.load(S.code, g, r);
        const doc = { ...d, grade: g, room: r, savedAt: new Date().toISOString() }; delete doc.logo;
        const res = await backend.save(S.code, g, r, doc, (cur && cur.version) || 0, true);
        if (!res || res.ok === false) throw new Error((res && res.error) || 'บันทึกไม่สำเร็จ');
        if (!S.rooms[g].includes(r)) S.rooms[g] = [...S.rooms[g], r].sort((a, b) => a - b);
        LS.del('pp_draft_' + P_hash(S.code) + '_' + g + (r > 1 ? '_' + r : ''));
      }
      const logo = file.logo || (list.find(x => x.doc.logo) || {}).doc?.logo;
      if (logo && !S.school.logo) { await backend.setLogo(S.code, logo); S.school.logo = logo; }
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + (e.message || e), 'warn'); return; }
    toast('นำเข้าข้อมูลสำรองแล้ว (' + list.length + ' ห้อง)', 'ok');
    const keep = list.some(x => x.g === S.grade && x.r === S.room);
    openGrade(keep ? S.grade : list[0].g, keep ? S.room : list[0].r);
  }

  // ---------------------------------------------------------------- print
  const PAPER = { 9: [210, 297], 8: [297, 420], 1: [216, 279], 5: [216, 356], 7: [184, 267] };
  function printBlock(sheetName, viewOv, fitBoth) {
    const d = S.wb.sheet(sheetName).def; const pr = d.print;
    const [pw, ph] = PAPER[pr.paper] || PAPER[9];
    const land = false;   // พิมพ์แนวตั้งทุกหน้า
    const W = (land ? ph : pw) / 25.4 * 96, H = (land ? pw : ph) / 25.4 * 96;
    const m = pr.m || [0.7, 0.7, 0.75, 0.75];
    const availW = W - (m[0] + m[1]) * 96, availH = H - (m[2] + m[3]) * 96;
    let area = pr.area ? pr.area.replace(/^.*!/, '') : null;
    const out = sheetHtmlFor(sheetName, false, area, viewOv);
    if (d.flex && d.flex.items) fitBoth = true;   // คุณลักษณะ / กิจกรรม: พอดี 1 หน้า
    let zoom = 1;
    if (pr.fitPage || fitBoth) {
      const fw = fitBoth ? 1 : pr.fw === 0 ? 0 : (pr.fw || 1), fh = fitBoth ? 1 : pr.fh === 0 ? 0 : (pr.fh || 1);
      const zw = fw ? availW * fw / out.width : Infinity, zh = fh ? availH * fh / out.height : Infinity;
      zoom = Math.min(1, zw, zh);
    } else if (pr.scale) zoom = pr.scale / 100;
    zoom = Math.max(0.2, zoom * 0.985);
    // ปก ปพ.5: จัดกึ่งกลางหน้ากระดาษทั้งแนวนอนและแนวตั้ง
    const cover = /^ปก /.test(sheetName);
    return { html: out.html, zoom, fit: !!(pr.fitPage || fitBoth), land, m, hc: pr.hc || cover || !!(d.flex && d.flex.items), vc: cover, width: out.width * zoom };
  }
  // แบบบันทึกคะแนนรายวิชา: พิมพ์ 3 หน้า (เทอม 1 / เทอม 2 / สรุปทั้งปี) โดยซ่อนคอลัมน์ที่ไม่เกี่ยวในแต่ละหน้า
  const SCORE_PAGES = [
    { inds: 3, cols: [13, 14, 15, 30] },          // เทอม 1: ตัวชี้วัด C-L, เก็บ, สอบ, รวม, ระดับ ท.1
    { inds: 16, cols: [26, 27, 28, 31] },         // เทอม 2: ตัวชี้วัด P-Y, เก็บ, สอบ, รวม, ระดับ ท.2
    { inds: 0, cols: [13, 14, 26, 27, 29, 32] },  // ทั้งปี: เก็บ ท.1, สอบ ท.1, เก็บ ท.2, สอบ ท.2, รวมทั้งปี, ระดับทั้งปี
  ];
  // part: 1 = เทอม 1, 2 = เทอม 2, 'sum' = สรุปทั้งปี, ไม่ระบุ = ครบ 3 หน้า (ใช้กับชีทคะแนนรายวิชาเท่านั้น)
  const SCORE_PART = { 1: 0, 2: 1, sum: 2 };
  function blocksFor(sheetName, part) {
    const sh = S.wb.sheet(sheetName); const n = sh && sh.def.indicator;
    if (!n) return [printBlock(sheetName)];
    const pages = part in SCORE_PART ? [SCORE_PAGES[SCORE_PART[part]]] : SCORE_PAGES;
    return pages.map(pg => {
      const show = new Set([1, 2, 33, ...pg.cols]);
      if (pg.inds) for (let c = pg.inds; c < pg.inds + n; c++) { const v = S.wb.get(sh, 4, c); if (v !== null && v !== '') show.add(c); }
      const blk = printBlock(sheetName, { colHidden: (name, c) => name === sheetName ? !show.has(c) : undefined }, true);   // 1 หน้าต่อส่วน
      blk.hc = true; return blk;
    });
  }
  // ขนาดตัวอักษรตอนพิมพ์ (เท่าของขนาดในแบบฟอร์ม) — จำไว้ในเครื่องนี้
  const FS_KEY = 'pp.printFs', FS_MIN = 0.8, FS_MAX = 1.8;
  function getFs() { try { const v = +localStorage.getItem(FS_KEY); return v >= FS_MIN && v <= FS_MAX ? v : 1; } catch (e) { return 1; } }
  function setFs(v) { try { localStorage.setItem(FS_KEY, String(v)); } catch (e) { /* ไม่มี storage ก็ใช้ได้ */ } }
  // จัดหน้าพิมพ์แบบพอดีข้อความ (หน้าที่ตั้ง "พอดี 1 หน้า"): วางตารางเต็มความกว้างกระดาษที่ขนาดจริง (ซูม 100%)
  // คอลัมน์ขยายตามข้อความ แถวสูงพอดีข้อความ ระยะบรรทัดชิด — ถ้ายังล้นกระดาษจึงย่อทั้งหน้าเท่าที่จำเป็น
  function compactPrep(z) {
    if (z._cmp !== undefined) return z._cmp;
    const box = z.querySelector('.xlbox'), tb = box && box.querySelector('table.xl');
    if (!tb) return (z._cmp = null);
    const cols = [...tb.querySelectorAll('col')], rows = [...tb.rows];
    const cw = cols.map(c => parseFloat(c.style.width) || 0);
    // แถวที่มีข้อความ: สูงพอดีข้อความ / แถวว่าง (ระยะเว้น) คงความสูงตามแบบฟอร์ม
    const rh = rows.map(tr => [...tr.cells].some(td => td.textContent.trim() || td.querySelector('img')) ? 0 : (parseFloat(tr.style.height) || 0));
    const W = cw.reduce((a, x) => a + x, 0);
    // รูปทรง/ตราโรงเรียนที่วางทับ: ผูกกับเซลล์ที่อยู่ใต้มุมซ้ายบน เพื่อย้ายตามเมื่อตารางเปลี่ยนขนาด
    const tds = [...tb.querySelectorAll('td')];
    const ovs = [...box.children].filter(el => el.matches('.xlshape, img.logo.ov')).map(el => {
      const r = el.getBoundingClientRect(), x = r.left + 0.5, y = r.top + 0.5;
      const td = tds.find(t => { const q = t.getBoundingClientRect(); return x >= q.left && x < q.right && y >= q.top && y < q.bottom; });
      if (!td) return null;
      const q = td.getBoundingClientRect();
      return { el, td, fx: (x - q.left) / q.width, fy: (y - q.top) / q.height, w: parseFloat(el.style.width) || 0, h: parseFloat(el.style.height) || 0,
        mh: parseFloat(el.style.maxHeight) || 0, mw: parseFloat(el.style.maxWidth) || 0 };
    }).filter(Boolean);
    // ข้อความที่ไหลทับช่องว่างข้าง ๆ (แบบ Excel) ไม่ให้ดันคอลัมน์ให้กว้างขึ้น
    for (const td of tds) if (td.style.overflow === 'visible' && !td.querySelector('.spill')) td.innerHTML = `<div class="spill">${td.innerHTML}</div>`;
    return (z._cmp = { box, tb, cols, rows, cw, rh, W, ovs });
  }
  function compactLayout(z, c, TW, rs) {
    const s = TW / c.W;
    z.style.zoom = 1; z.style.setProperty('--bw', '1px'); z.style.width = TW + 'px'; z.style.margin = '0 auto';
    c.box.style.width = TW + 'px'; c.tb.style.width = TW + 'px'; c.tb.classList.add('cmp');
    c.cols.forEach((col, i) => { col.style.width = (c.cw[i] * s) + 'px'; });
    c.rows.forEach((tr, i) => { tr.style.height = c.rh[i] ? (c.rh[i] * rs) + 'px' : ''; });
    const bx = c.box.getBoundingClientRect();
    for (const v of c.ovs) {
      const q = v.td.getBoundingClientRect(), st = v.el.style;
      st.left = (q.left - bx.left + v.fx * q.width) + 'px'; st.top = (q.top - bx.top + v.fy * q.height) + 'px';
      if (v.w) { st.width = (v.w * rs) + 'px'; st.height = (v.h * rs) + 'px'; }
      if (v.mh) { st.maxHeight = (v.mh * rs) + 'px'; st.maxWidth = (v.mw * rs) + 'px'; }
    }
  }
  // ใช้ขนาดตัวอักษร fs แล้วจัดแต่ละหน้าใหม่ — คืนอัตราย่อของหน้าแรก (ขนาดพิมพ์จริง = ขนาดในแบบฟอร์ม × fs × อัตราย่อ)
  function fitPages(root, blocks, fs) {
    root.style.setProperty('--fs', fs);
    let first = null; const firstIdx = blocks.findIndex(b => !b.custom);
    root.querySelectorAll('.pp-page').forEach((sec, i) => {
      const b = blocks[i], z = sec.firstElementChild;
      const setZ = (v) => { z.style.zoom = v; z.style.setProperty('--bw', (1 / v) + 'px'); };
      const cs = getComputedStyle(sec), availH = sec.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const availW = sec.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // จัดแบบพอดีข้อความ: หน้าที่ตั้งพอดี 1 หน้า หรือหน้าที่อยู่ใน 1 หน้ากระดาษอยู่แล้ว (ไม่แตะหน้าที่ยาวหลายหน้า)
      if (z._cmp === undefined && !b.custom && !b.fit) { setZ(b.zoom); if (z.querySelector('tr.pbreak') || z.getBoundingClientRect().height > availH + 1) z._cmp = null; }
      const c = !b.custom ? compactPrep(z) : null;
      if (!c) { setZ(b.zoom); if (i === firstIdx) first = b.zoom; if (!b.fit) return; }
      if (c) {
        const rs = Math.min(1, availW / c.W);
        // ลองความกว้างตาราง: เต็มกระดาษก่อน ถ้าล้นแนวตั้งลองขยายให้กว้างขึ้น (แถวที่ตัดบรรทัดจะเตี้ยลง) เลือกแบบที่ตัวอักษรใหญ่สุด
        let TW = availW, best = null;
        for (let it = 0; it < 4; it++) {
          compactLayout(z, c, TW, rs);
          const r = z.getBoundingClientRect();
          const k = Math.min(1, availW / r.width, availH / r.height);
          if (!best || k > best.k + 0.005) best = { k, TW };
          if (k > 0.995) break;
          const next = Math.max(availW, r.width) / k;
          if (next > TW * 1.6 || Math.abs(next - TW) < 4) break;
          TW = next;
        }
        if (best.TW !== TW) compactLayout(z, c, best.TW, rs);
        const k = best.k < 0.995 ? best.k * 0.99 : 1;
        setZ(k); if (i === firstIdx) first = k;
        return;
      }
      const r = z.getBoundingClientRect(); let k = 1;
      if (r.height > availH + 1) k = Math.min(k, availH / r.height);
      if (r.width > availW + 1) k = Math.min(k, availW / r.width);
      if (k < 1) { const zz = b.zoom * k * 0.995; setZ(zz); if (i === firstIdx) first = zz; }
    });
    return first;
  }
  // ตัวอย่างก่อนพิมพ์: ปรับขนาดตัวอักษรได้ แล้วกดพิมพ์
  async function printSheets(list, preBuilt) {
    const blocks = preBuilt || list.filter(Boolean).flatMap(blocksFor);
    if (!blocks.length) return;
    const root = $('#print-root');
    root.innerHTML = blocks.map(b => `<section class="pp-page ${b.land ? 'land' : 'port'}${b.vc ? ' vc' : ''}" style="padding:${b.m[2]}in ${b.m[1]}in ${b.m[3]}in ${b.m[0]}in"><div class="pp-zoom" style="zoom:${b.zoom};--bw:${1 / b.zoom}px${b.hc ? ';margin:0 auto;width:max-content' : ''}">${b.html}</div>${wmLayer(14)}</section>`).join('');
    let bar = $('#pv-bar');
    if (!bar) {
      document.body.insertAdjacentHTML('beforeend', `<div id="pv-bar" class="pv-bar" role="toolbar" aria-label="ตัวอย่างก่อนพิมพ์">
        <b>ตัวอย่างก่อนพิมพ์</b><span class="hint" id="pv-n"></span>
        <span class="pv-fs">ขนาดตัวอักษร <button class="btn sm" data-fs="-1" title="เล็กลง">A−</button><output id="pv-fsv"></output><button class="btn sm" data-fs="1" title="ใหญ่ขึ้น">A+</button><button class="btn sm ghost" data-fs="0" title="กลับเป็นขนาดตามแบบฟอร์ม">ค่าเดิม</button></span>
        <span class="hint" id="pv-eff"></span>
        <span class="pv-act"><button class="btn primary" id="pv-print">พิมพ์</button><button class="btn" id="pv-close">ปิด</button></span></div>`);
      bar = $('#pv-bar');
    }
    let fs = getFs();
    const apply = () => {
      const z = fitPages(root, blocks, fs);
      $('#pv-fsv').textContent = Math.round(fs * 100) + '%';
      $('#pv-eff').textContent = z ? `ตัวอักษร 16 pt ในแบบฟอร์ม พิมพ์ออกมาประมาณ ${(16 * fs * z).toFixed(1)} pt (หน้าแรก)` : '';
    };
    const close = () => { document.body.classList.remove('previewing', 'printing'); root.innerHTML = ''; root.style.removeProperty('--fs'); document.removeEventListener('keydown', onKey); window.scrollTo(0, S.pvScroll || 0); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    $('#pv-n').textContent = blocks.length + ' หน้า';
    bar.querySelectorAll('[data-fs]').forEach(btn => { btn.onclick = () => {
      const d = +btn.dataset.fs; fs = d ? Math.min(FS_MAX, Math.max(FS_MIN, Math.round((fs + d * 0.1) * 10) / 10)) : 1; setFs(fs); apply();
    }; });
    $('#pv-close').onclick = close;
    $('#pv-print').onclick = async () => {
      document.body.classList.add('printing');
      await new Promise(r => setTimeout(r, 60));
      window.print();
      setTimeout(() => document.body.classList.remove('printing'), 300);
    };
    document.addEventListener('keydown', onKey);
    S.pvScroll = window.scrollY;
    document.body.classList.add('previewing'); window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => r()));
    try { await document.fonts.ready; } catch (e) { /* ใช้ฟอนต์สำรอง */ }
    apply();
  }
  // พิมพ์แบบบันทึกคะแนนรายวิชา (หลายวิชาได้) เฉพาะส่วนที่เลือก
  function printScores(names, part) { printSheets(null, names.filter(n => S.wb.sheet(n)).flatMap(n => blocksFor(n, part))); }
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
  // items = [{ sheet, subj?, part? } | { html, zoom? }]  (html = หน้าที่สร้างเอง เช่น ข้อมูลนักเรียนในเล่ม ปพ.5 รายวิชา)
  async function printSet(items) {
    items = items.filter(x => x && (x.html || S.wb.sheet(x.sheet)));
    if (!items.length) { toast('ไม่มีเอกสารให้พิมพ์', 'warn'); return; }
    const old = {}; const blocks = [];
    for (const it of items) {
      if (it.html) { blocks.push({ html: it.html, zoom: it.zoom || 1, land: false, m: [0.6, 0.6, 0.5, 0.5], hc: false, vc: false, custom: true, fit: true }); continue; }
      if (it.subj !== undefined) { if (!(it.sheet in old)) old[it.sheet] = S.wb.get(S.wb.sheet(it.sheet), SUBJ_CELL.r, SUBJ_CELL.c); setCoverSubject(it.sheet, it.subj); }
      blocks.push(...blocksFor(it.sheet, it.part));
    }
    for (const [sh, v] of Object.entries(old)) setCoverSubject(sh, v);
    await printSheets(null, blocks);
  }
  function openCover(sheet, subj) { if (subj !== undefined) applyValue(sheet, SUBJ_CELL.r, SUBJ_CELL.c, subj); openDoc(sheet); }

  // ลายน้ำ (เว็บตัวอย่าง: PP_CONFIG.WATERMARK) — ทับทุกหน้าจอและทุกหน้าที่พิมพ์
  function wmLayer(n) { return CFG.WATERMARK ? `<div class="wm-layer" aria-hidden="true">${`<span>${esc(CFG.WATERMARK)}</span>`.repeat(n)}</div>` : ''; }

  // ---------------------------------------------------------------- boot
  function boot() {
    if (CFG.WATERMARK) document.body.insertAdjacentHTML('beforeend', wmLayer(80));
    if (CFG.SAMPLE_DIR) {   // เว็บตัวอย่าง: ข้อความหน้าเข้าสู่ระบบ + ปุ่มคืนค่าข้อมูลตัวอย่าง
      $('#demo-note').innerHTML = '<b>เว็บตัวอย่างสำหรับทดลองใช้</b> — มีข้อมูลนักเรียนสมมติ 40 คนทุกชั้น (ป.1–ป.6) แก้ไขได้อิสระ การแก้ไขเก็บในเบราว์เซอร์นี้เท่านั้น กด “เข้าสู่ระบบ” ได้ทันที (รหัส <code>DEMO</code>)';
      $('#save-now').insertAdjacentHTML('beforebegin', '<button id="sample-reset" class="btn" title="ล้างการแก้ไขทั้งหมด กลับเป็นข้อมูลตัวอย่าง">คืนค่าตัวอย่าง</button>');
      $('#sample-reset').onclick = async () => {
        const yes = await modal('คืนค่าข้อมูลตัวอย่าง', '<p>ล้างการแก้ไขทั้งหมดในเบราว์เซอร์นี้ และกลับไปใช้ข้อมูลตัวอย่างเดิมทุกชั้น?</p>', [{ label: 'ยกเลิก', value: false }, { label: 'คืนค่า', value: true, primary: true }]);
        if (!yes) return;
        S.dirty = false; clearTimeout(S.saveTimer); backend.reset(); location.reload();
      };
    }
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
    S, ctx, toast, roomLabel, modal, applyValue, validate, markDirty, save, batch, printSheets, printOne, printAll, printBlock,
    openDoc, closeDoc, refreshDoc, printSet, printScores, exportBackup, pickBackup, openCover, pickLogo: () => $('#logo-file').click(), removeLogo, setStatus, flushSave,
  };
})();
