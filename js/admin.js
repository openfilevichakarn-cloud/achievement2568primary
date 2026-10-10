/* admin.js — หน้าผู้ดูแล: ออกรหัส / ดูรายชื่อโรงเรียน / รีเซ็ตรหัส / แก้ไข / ระงับ
 * เรียกฟังก์ชัน admin_* ใน Supabase (sql/schema.sql) โดยแนบรหัสผ่านผู้ดูแลทุกครั้ง
 * รหัสผ่านเก็บใน sessionStorage (หายเมื่อปิดแท็บ) — ไม่เก็บถาวรในเครื่อง */
(function () {
  'use strict';
  const $ = (s, e) => (e || document).querySelector(s);
  const $$ = (s, e) => Array.from((e || document).querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cfg = window.PP_CONFIG || {};
  const GRADES = [1, 2, 3, 4, 5, 6];
  const SS = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }, del: (k) => { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const A = { pass: null, schools: [], filter: 'all', q: '' };

  // ---------------------------------------------------------------- backend
  async function rpc(fn, body) {
    let res;
    try {
      res = await fetch(`${cfg.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY }, body: JSON.stringify(body),
      });
    } catch (e) { throw new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้'); }
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
    if (!res.ok) {
      const msg = (json && (json.message || json.hint)) || ('คำขอล้มเหลว (' + res.status + ')');
      throw new Error(/admin_/.test(msg) && /not find|does not exist/i.test(msg) ? 'ยังไม่ได้อัปเดตฐานข้อมูล: รัน sql/schema.sql ใหม่ใน Supabase SQL Editor' : msg);
    }
    if (json && json.ok === false) { const err = new Error(json.error || 'ไม่สำเร็จ'); err.denied = /รหัสผ่านผู้ดูแล/.test(json.error || ''); throw err; }
    return json;
  }
  // โหมดทดลอง (ยังไม่ได้ตั้งค่า Supabase): เก็บในเบราว์เซอร์ รหัสผ่าน DEMO-ADMIN
  const DEMO_KEY = 'pp_demo_admin_schools';
  const demo = {
    load() { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; } },
    save(x) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(x)); } catch (e) { /* ignore */ } },
    code() { const h = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase(); return h.match(/.{4}/g).join('-'); },
    grades(g) { return [...new Set((g || [1]).filter(x => x >= 1 && x <= 6))].sort(); },
    async call(fn, b) {
      if (b.p_pass !== 'DEMO-ADMIN') return Promise.reject(Object.assign(new Error('รหัสผ่านผู้ดูแลไม่ถูกต้อง'), { denied: true }));
      const all = this.load(); const find = (id) => all.find(s => s.id === id);
      if (fn === 'admin_login') return { ok: true };
      if (fn === 'admin_list') return { ok: true, schools: all.slice().reverse() };
      if (fn === 'admin_issue') {
        const issued = b.p_names.map(n => String(n).trim()).filter(Boolean).map(name => { const s = { id: crypto.randomUUID(), name, grades: this.grades(b.p_grades), active: true, note: b.p_note || null, created_at: new Date().toISOString(), saves: [] }; all.push(s); return { id: s.id, name, code: this.code() }; });
        this.save(all); return { ok: true, issued };
      }
      if (fn === 'admin_reset') { if (!find(b.p_id)) throw new Error('ไม่พบโรงเรียน'); return { ok: true, code: this.code() }; }
      if (fn === 'admin_update') {
        const s = find(b.p_id); if (!s) throw new Error('ไม่พบโรงเรียน');
        if (b.p_name != null) s.name = b.p_name.trim() || s.name; if (b.p_grades != null) s.grades = this.grades(b.p_grades);
        if (b.p_active != null) s.active = b.p_active; if (b.p_note != null) s.note = b.p_note.trim() || null;
        this.save(all); return { ok: true };
      }
      throw new Error('ไม่รู้จักคำสั่ง');
    },
  };
  const isDemo = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const call = (fn, body) => isDemo ? demo.call(fn, { p_pass: A.pass, ...body }) : rpc(fn, { p_pass: A.pass, ...body });

  // ---------------------------------------------------------------- ui helpers
  function toast(msg, kind) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
    $('#toasts').appendChild(el); setTimeout(() => el.classList.add('out'), 4200); setTimeout(() => el.remove(), 4800);
  }
  function modal(title, body, buttons, onOpen) {
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = `<div class="modal-card a-modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
      m.hidden = false;
      $$('.modal-actions button', m).forEach(btn => btn.onclick = () => { const b = buttons[+btn.dataset.i]; const v = b.read ? b.read(m) : b.value; m.hidden = true; m.innerHTML = ''; resolve(v); });
      if (onOpen) onOpen(m);
    });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('คัดลอกแล้ว', 'ok'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('คัดลอกแล้ว', 'ok'); }
  }
  const READY = cfg.GRADES_READY || GRADES;
  const gradeChecks = (sel, name) => GRADES.map(g => `<label${READY.includes(g) ? '' : ' class="nr" title="ยังไม่มีข้อมูลโปรแกรมชั้นนี้ (ให้สิทธิ์ไว้ก่อนได้ จะใช้ได้เมื่อเปิดชั้นนี้)"'}><input type="checkbox" name="${name}" value="${g}"${sel.includes(g) ? ' checked' : ''}> ป.${g}${READY.includes(g) ? '' : ' <small>(ยังไม่เปิด)</small>'}</label>`).join('');
  const readGrades = (root, name) => $$(`input[name="${name}"]:checked`, root).map(x => +x.value);
  const fmtDate = (s) => { if (!s) return '–'; const d = new Date(s); return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); };
  function guard(fn) {
    return async (...a) => {
      try { return await fn(...a); }
      catch (e) { if (e.denied) { logout(); $('#a-err').textContent = e.message; } else toast(e.message || 'ไม่สำเร็จ', 'warn'); }
    };
  }

  // แสดงรหัสที่เพิ่งออก (แสดงครั้งเดียว ระบบไม่เก็บรหัสจริง)
  function showCodes(title, rows) {
    const tsv = rows.map(r => `${r.name}\t${r.code}`).join('\n');
    const body = `<p class="hint">⚠️ ระบบเก็บเฉพาะรหัสที่เข้ารหัสแล้ว — <b>คัดลอกหรือดาวน์โหลดเก็บไว้ตอนนี้</b> ปิดหน้าต่างแล้วจะดูรหัสนี้อีกไม่ได้ (ออกรหัสใหม่ได้ด้วยปุ่มรีเซ็ต)</p>
      <div class="a-codes">${rows.map((r, i) => `<div class="a-code"><span>${esc(r.name)}</span><code>${esc(r.code)}</code><button class="btn sm" data-copy="${i}">คัดลอก</button></div>`).join('')}</div>`;
    return modal(title, body, [
      ...(rows.length > 1 ? [{ label: 'ดาวน์โหลด CSV', value: 'csv' }, { label: 'คัดลอกทั้งหมด', value: 'all' }] : []),
      { label: 'ปิด', cls: 'primary', value: null },
    ], (m) => $$('[data-copy]', m).forEach(b => b.onclick = () => copy(rows[+b.dataset.copy].code)))
      .then(v => {
        if (v === 'all') { copy(tsv); return showCodes(title, rows); }
        if (v === 'csv') {
          const csv = '﻿โรงเรียน,รหัสสิทธิ์\n' + rows.map(r => `"${r.name.replace(/"/g, '""')}",${r.code}`).join('\n');
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          a.download = 'รหัสสิทธิ์โรงเรียน-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); URL.revokeObjectURL(a.href);
          return showCodes(title, rows);
        }
      });
  }

  // ---------------------------------------------------------------- views
  function renderList() {
    const q = A.q.trim().toLowerCase();
    const list = A.schools.filter(s => (A.filter === 'all' || (A.filter === 'on') === s.active) && (!q || (s.name + ' ' + (s.note || '')).toLowerCase().includes(q)));
    $('#l-count').textContent = `(${list.length} / ${A.schools.length})`;
    $('#l-body').innerHTML = list.length ? list.map(s => {
      const last = (s.saves || []).reduce((m, x) => (!m || x.updated_at > m.updated_at ? x : m), null);
      return `<tr data-id="${esc(s.id)}" class="${s.active ? '' : 'off'}">
        <td class="stk"><b>${esc(s.name)}</b></td>
        <td>${(s.grades || []).map(g => `<span class="chip">ป.${g}</span>`).join(' ')}</td>
        <td>${s.active ? '<span class="pass ok">ใช้งาน</span>' : '<span class="pass no">ระงับ</span>'}</td>
        <td class="hint">${last ? `${fmtDate(last.updated_at)}<br><small>ป.${last.grade} · ครั้งที่ ${last.version}</small>` : 'ยังไม่เคยบันทึก'}</td>
        <td class="hint a-note">${esc(s.note || '')}</td>
        <td class="hint">${fmtDate(s.created_at)}</td>
        <td><div class="row a-act"><button class="btn sm" data-a="edit">แก้ไข</button><button class="btn sm" data-a="reset">รีเซ็ตรหัส</button>
          <button class="btn sm ${s.active ? 'danger' : ''}" data-a="toggle">${s.active ? 'ระงับ' : 'เปิดใช้'}</button></div></td></tr>`;
    }).join('') : `<tr><td colspan="7" class="hint" style="padding:18px">${A.schools.length ? 'ไม่พบโรงเรียนที่ค้นหา' : 'ยังไม่มีโรงเรียน — ออกรหัสได้จากกล่องด้านบน'}</td></tr>`;
  }
  const load = guard(async () => { const r = await call('admin_list', {}); A.schools = r.schools || []; renderList(); });

  const issue = guard(async () => {
    const names = $('#i-names').value.split('\n').map(x => x.trim()).filter(Boolean);
    const grades = readGrades(document, 'ig');
    if (!names.length) { toast('กรุณากรอกชื่อโรงเรียน', 'warn'); $('#i-names').focus(); return; }
    if (!grades.length) { toast('เลือกชั้นอย่างน้อย 1 ชั้น', 'warn'); return; }
    const dup = names.filter(n => A.schools.some(s => s.name.trim() === n));
    if (dup.length) {
      const ok = await modal('มีชื่อโรงเรียนนี้แล้ว', `<p>มีโรงเรียนชื่อนี้ในระบบแล้ว: <b>${dup.map(esc).join(', ')}</b></p><p class="hint">ถ้าต้องการรหัสใหม่ให้โรงเรียนเดิม ใช้ปุ่ม “รีเซ็ตรหัส” แทน (ข้อมูลเดิมยังอยู่)</p>`, [{ label: 'ยกเลิก', value: false }, { label: 'ออกรหัสใหม่อยู่ดี', cls: 'primary', value: true }]);
      if (!ok) return;
    }
    $('#i-go').disabled = true;
    try {
      const r = await call('admin_issue', { p_names: names, p_grades: grades, p_note: $('#i-note').value.trim() || null });
      $('#i-names').value = ''; $('#i-note').value = '';
      await load();
      await showCodes(`ออกรหัสแล้ว ${r.issued.length} โรงเรียน`, r.issued);
    } finally { $('#i-go').disabled = false; }
  });

  const act = guard(async (id, a) => {
    const s = A.schools.find(x => x.id === id); if (!s) return;
    if (a === 'reset') {
      const ok = await modal('รีเซ็ตรหัส', `<p>ออกรหัสใหม่ให้ <b>${esc(s.name)}</b>?</p><p class="hint">รหัสเดิมจะใช้ไม่ได้ทันที (เครื่องที่จำรหัสไว้ต้องเข้าสู่ระบบใหม่) ข้อมูลของโรงเรียนยังอยู่ครบ</p>`, [{ label: 'ยกเลิก', value: false }, { label: 'ออกรหัสใหม่', cls: 'danger', value: true }]);
      if (!ok) return;
      const r = await call('admin_reset', { p_id: id });
      await showCodes('รหัสใหม่', [{ name: s.name, code: r.code }]);
    } else if (a === 'toggle') {
      if (s.active) {
        const ok = await modal('ระงับสิทธิ์', `<p>ระงับ <b>${esc(s.name)}</b>? โรงเรียนจะเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้อีกครั้ง (ข้อมูลไม่หาย)</p>`, [{ label: 'ยกเลิก', value: false }, { label: 'ระงับ', cls: 'danger', value: true }]);
        if (!ok) return;
      }
      await call('admin_update', { p_id: id, p_active: !s.active }); toast(s.active ? 'ระงับแล้ว' : 'เปิดใช้แล้ว', 'ok'); await load();
    } else if (a === 'edit') {
      const v = await modal('แก้ไขโรงเรียน', `<label class="fld"><span>ชื่อโรงเรียน</span><input id="e-name" class="in" value="${esc(s.name)}"></label>
        <div class="fld" style="margin-top:8px"><span>ชั้นที่ใช้ได้</span><div class="gchk">${gradeChecks(s.grades || [], 'eg')}</div></div>
        <label class="fld" style="margin-top:8px"><span>หมายเหตุ</span><input id="e-note" class="in" value="${esc(s.note || '')}"></label>
        <p class="hint">ชื่อโรงเรียนจะแสดงในเอกสารทุกหน้า โรงเรียนแก้เองไม่ได้</p>`,
      [{ label: 'ยกเลิก', value: null }, { label: 'บันทึก', cls: 'primary', read: (m) => ({ name: $('#e-name', m).value, note: $('#e-note', m).value, grades: readGrades(m, 'eg') }) }]);
      if (!v) return;
      if (!v.name.trim()) { toast('ชื่อโรงเรียนว่างไม่ได้', 'warn'); return; }
      if (!v.grades.length) { toast('เลือกชั้นอย่างน้อย 1 ชั้น', 'warn'); return; }
      await call('admin_update', { p_id: id, p_name: v.name.trim(), p_grades: v.grades, p_note: v.note }); toast('บันทึกแล้ว', 'ok'); await load();
    }
  });

  // ---------------------------------------------------------------- login
  function logout() { A.pass = null; SS.del('pp_admin'); $('#a-app').hidden = true; $('#a-login').hidden = false; }
  async function login(pass) {
    A.pass = pass; $('#a-err').textContent = '';
    try { await call('admin_login', {}); }
    catch (e) { A.pass = null; SS.del('pp_admin'); $('#a-err').textContent = e.message; return; }
    SS.set('pp_admin', pass);
    $('#a-login').hidden = true; $('#a-app').hidden = false;
    await load();
  }

  function boot() {
    $('#a-demo').hidden = !isDemo;
    $('#i-grades').innerHTML = gradeChecks([1], 'ig');
    $('#a-login-form').onsubmit = (e) => { e.preventDefault(); login($('#a-pass').value); };
    $('#a-logout').onclick = logout;
    $('#i-go').onclick = issue;
    $('#l-refresh').onclick = load;
    $('#l-q').oninput = (e) => { A.q = e.target.value; renderList(); };
    $('#l-filter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; A.filter = b.dataset.f; $$('#l-filter button').forEach(x => x.classList.toggle('on', x === b)); renderList(); };
    $('#l-body').onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) act(b.closest('tr').dataset.id, b.dataset.a); };
    const saved = SS.get('pp_admin'); if (saved) login(saved);
  }
  boot();
})();
