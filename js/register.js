/* register.js — หน้าสมัครใช้งาน: แสดงราคา/ช่องทางติดต่อจาก PP_CONFIG.SALES และส่งแบบฟอร์มเข้า Supabase (register_school)
 * คำขอที่ส่งแล้วไปแสดงในหน้าผู้ดูแล (admin.html) หัวข้อ "คำขอสมัครใช้งาน" — โหมดทดลอง (ไม่มี Supabase) เก็บในเบราว์เซอร์ */
(function () {
  'use strict';
  const $ = (s, e) => (e || document).querySelector(s);
  const $$ = (s, e) => Array.from((e || document).querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cfg = window.PP_CONFIG || {}, SALES = cfg.SALES || {};
  const isDemo = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const DEMO_KEY = 'pp_demo_registrations';

  function contactHtml(cls) {
    const items = [];
    if (SALES.FACEBOOK) items.push(`<a class="btn ${cls || ''}" href="${esc(SALES.FACEBOOK)}" target="_blank" rel="noopener">Facebook: เปิดไฟล์วิชาการ</a>`);
    if (SALES.LINE_ID) items.push(`<span class="btn ${cls || ''}">LINE: ${esc(SALES.LINE_ID)}</span>`);
    if (SALES.PHONE) items.push(`<a class="btn ${cls || ''}" href="tel:${esc(SALES.PHONE.replace(/[^\d+]/g, ''))}">โทร ${esc(SALES.PHONE)}</a>`);
    return items.join('');
  }
  function renderPackages() {
    const pk = Array.isArray(SALES.PACKAGES) ? SALES.PACKAGES : [];
    $('#packages').innerHTML = pk.length
      ? `<div class="rg-price">${pk.map(p => `<div class="rg-pk${p.hot ? ' hot' : ''}">${p.hot ? '<span class="rg-badge">แนะนำ</span>' : ''}<h3>${esc(p.name)}</h3>
          <p class="rg-amt">${esc(p.price)}<small>${esc(p.unit || '')}</small></p><ul>${(p.items || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <a class="btn ${p.hot ? 'primary' : ''} wide" href="#register" data-pk="${esc(p.name)}">เลือกแพ็กเกจนี้</a></div>`).join('')}</div>`
      : `<div class="card rg-ask"><h3>ติดต่อสอบถามราคา</h3><p>ราคาขึ้นอยู่กับจำนวนชั้นที่ใช้งาน ส่งแบบฟอร์มด้านล่าง หรือติดต่อช่องทางนี้ เจ้าหน้าที่จะแจ้งราคาและใบเสนอราคาให้</p><div class="row">${contactHtml()}</div></div>`;
    $$('[data-pk]').forEach(a => a.addEventListener('click', () => { const n = $('#reg-form [name=note]'); if (!n.value) n.value = 'แพ็กเกจที่สนใจ: ' + a.dataset.pk; }));
  }

  async function submit(body) {
    if (isDemo) {
      await new Promise(r => setTimeout(r, 300));
      const all = (() => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; } })();
      const id = crypto.randomUUID();
      all.push({ id, ...body, grades: body.grades.map(Number), status: 'new', created_at: new Date().toISOString() });
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
      return { ok: true, ref: id.replace(/-/g, '').slice(0, 6).toUpperCase() };
    }
    let res;
    try {
      res = await fetch(`${cfg.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/register_school`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY }, body: JSON.stringify({ p: body }),
      });
    } catch (e) { throw new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่'); }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(res.status === 404 ? 'ระบบรับสมัครยังไม่เปิด กรุณาติดต่อทางเพจ' : ((json && json.message) || 'ส่งไม่สำเร็จ (' + res.status + ')'));
    if (!json || json.ok === false) throw new Error((json && json.error) || 'ส่งไม่สำเร็จ');
    return json;
  }

  function done(ref, body) {
    const b = SALES.BANK;
    $('#reg-form').hidden = true;
    const box = $('#reg-done'); box.hidden = false;
    box.innerHTML = `<div class="rg-ok">✓</div><h3>ส่งแบบฟอร์มเรียบร้อยแล้ว</h3>
      <p>เลขที่คำขอ <b class="rg-ref">${esc(ref)}</b> · ${esc(body.school)} · ชั้น ${body.grades.map(g => 'ป.' + g).join(', ')}</p>
      <p>เจ้าหน้าที่จะติดต่อกลับทางโทรศัพท์${body.line_id ? ' / LINE' : ''} เพื่อยืนยันรายละเอียดและแจ้งการชำระเงิน เมื่อชำระแล้วจะได้รับ <b>รหัสสิทธิ์โรงเรียน</b> สำหรับเข้าใช้งาน</p>
      ${b && b.no ? `<div class="rg-bank"><b>ช่องทางชำระเงิน</b><br>${esc(b.bank || '')} · เลขที่บัญชี <b>${esc(b.no)}</b><br>ชื่อบัญชี ${esc(b.name || '')}<br><small>ชำระแล้วส่งหลักฐานพร้อมเลขที่คำขอทางช่องทางด้านล่าง</small></div>` : ''}
      <div class="row" style="justify-content:center;margin-top:12px">${contactHtml()}</div>
      <p class="hint">ระหว่างรอ <a href="${esc($('#demo-link').href)}" target="_blank" rel="noopener">ทดลองใช้เว็บตัวอย่าง</a> ได้เลย</p>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function boot() {
    if (SALES.DEMO_URL) $('#demo-link').href = SALES.DEMO_URL;
    renderPackages();
    $('#contact').innerHTML = `<b>ติดต่อสอบถาม</b><div class="row">${contactHtml('ghost')}</div>`;
    const openPdpa = () => { const d = $('#pdpa'); if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); } };
    $('#pdpa-link').addEventListener('click', (e) => { e.preventDefault(); openPdpa(); });
    if (location.hash === '#pdpa') openPdpa();
    $('#all-grades').onclick = () => { const cb = $$('[name=grades]'); const on = !cb.every(x => x.checked); cb.forEach(x => { x.checked = on; }); };
    $('#reg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, v = (n) => (f.elements[n].value || '').trim(), err = $('#reg-err');
      const body = { school: v('school'), area: v('area'), contact: v('contact'), position: v('position'), phone: v('phone'), line_id: v('line_id'),
        email: v('email'), rooms: v('rooms'), note: v('note'), website: v('website'), grades: $$('[name=grades]:checked', f).map(x => x.value) };
      const bad = (msg, n) => { err.textContent = msg; if (n) f.elements[n].focus(); };
      if (body.school.length < 3) return bad('กรุณากรอกชื่อโรงเรียน', 'school');
      if (body.contact.length < 2) return bad('กรุณากรอกชื่อผู้ติดต่อ', 'contact');
      if (body.phone.replace(/\D/g, '').length < 9) return bad('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง', 'phone');
      if (!body.grades.length) return bad('กรุณาเลือกชั้นที่ต้องการอย่างน้อย 1 ชั้น');
      if (body.rooms && !/^\d{1,2}$/.test(body.rooms)) return bad('จำนวนห้องกรอกเป็นตัวเลข', 'rooms');
      if (!$('#consent').checked) return bad('กรุณาติ๊กยินยอมการใช้ข้อมูลเพื่อการติดต่อ');
      err.textContent = ''; const btn = $('#reg-go'); btn.disabled = true; btn.textContent = 'กำลังส่ง...';
      try { const r = await submit(body); done(r.ref, body); }
      catch (x) { bad(x.message || 'ส่งไม่สำเร็จ'); }
      finally { btn.disabled = false; btn.textContent = 'ส่งแบบฟอร์มสมัครใช้งาน'; }
    });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
