/* register.js — หน้าสั่งซื้อ: เลือกชั้น -> โอนเงิน -> แนบสลิป -> ตรวจสลิปอัตโนมัติ (Edge Function auto-register) -> ได้รหัสสิทธิ์ทันที
 * ราคา / บัญชีรับเงิน อ่านจากฐานข้อมูล (sales_info — ผู้ดูแลตั้งได้ในหน้า admin.html) ยอดจริงคำนวณซ้ำฝั่งเซิร์ฟเวอร์เสมอ
 * โหมดทดลอง (ไม่มี Supabase): จำลองราคา 500 บาท/ชั้น และออกรหัสตัวอย่าง (ไม่ใช่รหัสจริง) */
(function () {
  'use strict';
  const $ = (s, e) => (e || document).querySelector(s);
  const $$ = (s, e) => Array.from((e || document).querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cfg = window.PP_CONFIG || {}, SALES = cfg.SALES || {};
  const isDemo = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const base = isDemo ? '' : cfg.SUPABASE_URL.replace(/\/$/, '');
  const H = isDemo ? {} : { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  const fmt = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const fmtAcc = (a) => { const d = String(a || '').replace(/\D/g, ''); return d.length === 10 ? `${d.slice(0, 3)}-${d[3]}-${d.slice(4, 9)}-${d[9]}` : a; };
  let INFO = null, slipData = null;

  function contactHtml(cls) {
    const items = [];
    if (SALES.FACEBOOK) items.push(`<a class="btn ${cls || ''}" href="${esc(SALES.FACEBOOK)}" target="_blank" rel="noopener">Facebook: เปิดไฟล์วิชาการ</a>`);
    if (SALES.LINE_ID) items.push(`<span class="btn ${cls || ''}">LINE: ${esc(SALES.LINE_ID)}</span>`);
    if (SALES.PHONE) items.push(`<a class="btn ${cls || ''}" href="tel:${esc(SALES.PHONE.replace(/[^\d+]/g, ''))}">โทร ${esc(SALES.PHONE)}</a>`);
    return items.join('');
  }
  async function loadInfo() {
    if (isDemo) return { ok: true, price_per_grade: 500, price_all: 2500, auto: true, bank: 'ธนาคารกรุงไทย', account_no: '9600441464', account_name: 'นายเบญจรงค์ นุ่มวัฒนะ', demo: true };
    const r = await fetch(`${base}/rest/v1/rpc/sales_info`, { method: 'POST', headers: H, body: '{}' });
    if (!r.ok) throw new Error('sales_info ' + r.status);
    return r.json();
  }
  // ราคาตามจำนวนชั้น (ต้องตรงกับ _order_amount ในฐานข้อมูล)
  function priceFor(n) {
    const per = INFO && INFO.price_per_grade != null ? Number(INFO.price_per_grade) : null, all = INFO && INFO.price_all != null ? Number(INFO.price_all) : null;
    if (!n) return null;
    if (n === 6 && all != null) return all;
    if (per == null) return null;
    return all != null ? Math.min(per * n, all) : per * n;
  }
  const grades = () => $$('[name=grades]:checked').map(x => +x.value);
  function updateAmount() {
    const a = priceFor(grades().length);
    $('#amount').textContent = $('#amount2').textContent = a == null ? '–' : fmt(a);
  }
  function renderPrice() {
    const per = INFO.price_per_grade, all = INFO.price_all;
    const open = per != null || all != null;
    $('#packages').innerHTML = open
      ? `<div class="rg-price">${per != null ? `<div class="rg-pk"><h3>รายชั้น</h3><p class="rg-amt">${fmt(per)} บาท<small>/ ชั้น</small></p><ul><li>เลือกเฉพาะชั้นที่ใช้</li><li>ใช้ได้ทุกห้องในชั้นนั้น (ไม่เกิน 10 ห้อง)</li><li>ปพ.5 + ปพ.6 ครบ</li></ul><a class="btn wide" href="#register">สั่งซื้อ</a></div>` : ''}
          ${all != null ? `<div class="rg-pk hot"><span class="rg-badge">คุ้มที่สุด</span><h3>ทั้งโรงเรียน (ป.1–ป.6)</h3><p class="rg-amt">${fmt(all)} บาท<small>/ 6 ชั้น</small></p><ul><li>ครบทุกชั้น ป.1–ป.6</li><li>ชั้นละไม่เกิน 10 ห้อง</li><li>ใช้รหัสเดียวทั้งโรงเรียน</li></ul><a class="btn primary wide" href="#register" data-all>สั่งซื้อทั้งโรงเรียน</a></div>` : ''}</div>`
      : `<div class="card rg-ask"><h3>ติดต่อสอบถามราคา</h3><p>ส่งข้อความหาเราได้ที่ช่องทางนี้</p><div class="row">${contactHtml()}</div></div>`;
    $$('[data-all]').forEach(a => a.addEventListener('click', () => { $$('[name=grades]').forEach(x => { x.checked = true; }); updateAmount(); }));
    if (per != null && all != null) $('#price-note').textContent = `ราคา ชั้นละ ${fmt(per)} บาท · ทั้ง 6 ชั้น ${fmt(all)} บาท`;
    else if (per != null) $('#price-note').textContent = `ราคา ชั้นละ ${fmt(per)} บาท`;
    $('#bk-bank').textContent = INFO.bank || 'ธนาคารกรุงไทย';
    $('#bk-no').textContent = fmtAcc(INFO.account_no || '9600441464');
    $('#bk-name').textContent = INFO.account_name || '';
    if (!open) { $('#order-form').hidden = true; const c = $('#order-closed'); c.hidden = false; c.innerHTML = `<h3>ยังไม่เปิดสั่งซื้ออัตโนมัติ</h3><p>ติดต่อสั่งซื้อได้ที่ช่องทางนี้</p><div class="row">${contactHtml()}</div>`; }
  }

  // ย่อรูปสลิป (คงความคมของ QR) -> JPEG dataURL
  function readSlip(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
      img.src = url;
    });
  }

  async function submit(order) {
    if (isDemo) {
      await new Promise(r => setTimeout(r, 900));
      const h = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      try { const k = 'pp_demo_orders', x = JSON.parse(localStorage.getItem(k) || '[]'); x.push({ ...order, id: crypto.randomUUID(), ref: h.slice(0, 6), status: 'approved', has_slip: !!order.slip_image, created_at: new Date().toISOString() }); localStorage.setItem(k, JSON.stringify(x)); } catch (e) { /* ignore */ }
      return { ok: true, status: 'approved', code: 'DEMO-' + h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12), school: order.school, grades: order.grades, ref: h.slice(0, 6), demo: true };
    }
    let r;
    try { r = await fetch(`${base}/functions/v1/auto-register`, { method: 'POST', headers: H, body: JSON.stringify({ order }) }); }
    catch (e) { throw new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่'); }
    const j = await r.json().catch(() => null);
    if (r.status === 404) throw new Error('ระบบสั่งซื้ออัตโนมัติยังไม่เปิด กรุณาติดต่อทางเพจ');
    if (!j) throw new Error('ส่งไม่สำเร็จ (' + r.status + ')');
    if (j.ok === false) throw new Error(j.error || 'ส่งไม่สำเร็จ');
    return j;
  }

  function done(res, order) {
    $('#order-form').hidden = true;
    const box = $('#reg-done'); box.hidden = false;
    const gl = (res.grades || order.grades).map(g => 'ป.' + g).join(', ');
    if (res.status === 'approved' && res.code) {
      box.innerHTML = `<div class="rg-ok">✓</div><h3>ชำระเงินเรียบร้อย — นี่คือรหัสสิทธิ์ของโรงเรียน</h3>
        ${res.demo ? '<p class="err">โหมดทดลอง: รหัสนี้เป็นตัวอย่าง ใช้งานจริงไม่ได้</p>' : ''}
        <div class="rg-code" id="the-code">${esc(res.code)}</div>
        <div class="row" style="justify-content:center"><button class="btn" id="copy-code">คัดลอกรหัส</button><a class="btn primary" href="./">เข้าสู่ระบบ</a></div>
        <p><b>${esc(res.school || order.school)}</b> · ชั้น ${esc(gl)} · เลขที่คำสั่งซื้อ ${esc(res.ref || '')}</p>
        <p class="rg-warn">⚠️ <b>จดหรือบันทึกรหัสนี้เก็บไว้</b> ระบบแสดงรหัสครั้งเดียว ครูทุกคนในโรงเรียนใช้รหัสนี้เข้าระบบ ห้ามเผยแพร่ให้บุคคลภายนอก (ถ้ารหัสหาย ติดต่อเพื่อออกรหัสใหม่ได้ ข้อมูลไม่หาย)</p>`;
      $('#copy-code').onclick = () => copy(res.code);
    } else {
      box.innerHTML = `<div class="rg-ok wait">⏳</div><h3>ได้รับคำสั่งซื้อแล้ว — รอเจ้าหน้าที่ตรวจสอบ</h3>
        <p>เลขที่คำสั่งซื้อ <b class="rg-ref">${esc(res.ref || '')}</b> · ${esc(order.school)} · ชั้น ${esc(gl)}</p>
        ${res.reason ? `<p class="hint">ระบบตรวจอัตโนมัติไม่ผ่าน: ${esc(res.reason)}</p>` : ''}
        <p>เจ้าหน้าที่จะตรวจสลิปและติดต่อกลับทางโทรศัพท์${order.line_id ? ' / LINE' : ''} พร้อมรหัสสิทธิ์ ไม่ต้องโอนเงินซ้ำ</p>
        <div class="row" style="justify-content:center">${contactHtml()}</div>`;
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function copy(t) {
    try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    const el = document.createElement('div'); el.className = 'toast ok'; el.textContent = 'คัดลอกแล้ว'; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 2500);
  }

  async function boot() {
    if (SALES.DEMO_URL) $('#demo-link').href = SALES.DEMO_URL;
    $('#contact').innerHTML = `<b>ติดต่อสอบถาม</b><div class="row">${contactHtml('ghost')}</div>`;
    const openPdpa = () => { const d = $('#pdpa'); if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); } };
    $('#pdpa-link').addEventListener('click', (e) => { e.preventDefault(); openPdpa(); });
    if (location.hash === '#pdpa') openPdpa();
    $('#all-grades').onclick = () => { const cb = $$('[name=grades]'); const on = !cb.every(x => x.checked); cb.forEach(x => { x.checked = on; }); updateAmount(); };
    $$('[name=grades]').forEach(x => x.addEventListener('change', updateAmount));
    $('#copy-acc').onclick = () => copy(String(INFO && INFO.account_no || '9600441464').replace(/\D/g, ''));
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); $('[name=transfer_at]').value = now.toISOString().slice(0, 16);
    $('#slip').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { slipData = await readSlip(f); $('#slip-preview').src = slipData; $('#slip-preview').hidden = false; $('#slip-label').textContent = '✓ ' + f.name; }
      catch (x) { slipData = null; $('#reg-err').textContent = x.message; }
    });
    try { INFO = await loadInfo(); } catch (e) { INFO = { price_per_grade: null, price_all: null }; }
    renderPrice(); updateAmount();

    $('#order-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, v = (n) => (f.elements[n].value || '').trim(), err = $('#reg-err');
      const g = grades(), amount = priceFor(g.length);
      const t = v('transfer_at'), tDate = t ? new Date(t) : null;
      const order = { school: v('school'), area: v('area'), contact: v('contact'), position: v('position'), phone: v('phone'), line_id: v('line_id'),
        email: v('email'), website: v('website'), grades: g, amount, transfer_at: tDate && !isNaN(tDate) ? tDate.toISOString() : '', slip_image: slipData };
      const bad = (msg, n) => { err.textContent = msg; if (n) f.elements[n].focus(); };
      if (!g.length) return bad('กรุณาเลือกชั้นที่ต้องการอย่างน้อย 1 ชั้น');
      if (amount == null) return bad('ยังไม่เปิดสั่งซื้อชั้นที่เลือก กรุณาติดต่อทางเพจ');
      if (order.school.length < 3) return bad('กรุณากรอกชื่อโรงเรียน', 'school');
      if (order.contact.length < 2) return bad('กรุณากรอกชื่อผู้ติดต่อ', 'contact');
      if (order.phone.replace(/\D/g, '').length < 9) return bad('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง', 'phone');
      if (!order.transfer_at) return bad('กรุณากรอกวันและเวลาที่โอน', 'transfer_at');
      if (!slipData) return bad('กรุณาแนบรูปสลิปการโอนเงิน');
      if (!$('#consent').checked) return bad('กรุณาติ๊กยอมรับข้อกำหนดก่อนส่ง');
      err.textContent = ''; const btn = $('#reg-go'); btn.disabled = true; btn.textContent = 'กำลังตรวจสลิป...';
      try { done(await submit(order), order); }
      catch (x) { bad(x.message || 'ส่งไม่สำเร็จ'); }
      finally { btn.disabled = false; btn.textContent = 'ส่งสลิปและรับรหัสสิทธิ์'; }
    });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
