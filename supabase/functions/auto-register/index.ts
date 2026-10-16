// Supabase Edge Function: auto-register — สมัครใช้งานอัตโนมัติด้วยสลิปโอนเงิน
//   เว็บ (register.html) ส่ง { order: {...ข้อมูลโรงเรียน, grades, amount, transfer_at, slip_image(dataURL)} }
//   1) order_start   : ตรวจข้อมูล + คำนวณยอดจากราคาในระบบ (ไม่เชื่อยอดจากเว็บ) + บันทึกคำสั่งซื้อ
//   2) ตรวจสลิปกับบริการตรวจสลิป (EasySlip — อ่าน QR บนสลิปแล้วดึงข้อมูลจริงจากธนาคาร)
//   3) เทียบ: ยอดเงิน = ราคา · บัญชีผู้รับ = บัญชีร้าน · เวลาในสลิปใกล้เวลาที่ลูกค้ากรอก · สลิปไม่เก่า/ไม่ซ้ำ
//   4) order_finish  : ผ่าน = ออกรหัสสิทธิ์ทันที / ไม่ผ่าน = รอผู้ดูแลตรวจในหน้า admin.html
// ตั้งค่า (Supabase > Edge Functions > Secrets): EASYSLIP_API_KEY  (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติ)
// ถ้ายังไม่ตั้ง EASYSLIP_API_KEY: ทุกคำสั่งซื้อจะ "รอผู้ดูแลตรวจ" (ไม่ออกรหัสอัตโนมัติ)

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SLIP_KEY = Deno.env.get('EASYSLIP_API_KEY') || '';
// จำลองเหตุการณ์สำหรับทดสอบ (ตั้ง Secret EASYSLIP_SIMULATE แล้วลบออกเมื่อทดสอบเสร็จ):
//   quota = โควตาหมด · unauthorized = API key ผิด/หมดอายุ · down = บริการตรวจสลิปล่ม · invalid = สลิปอ่าน QR ไม่ได้
const SIMULATE = (Deno.env.get('EASYSLIP_SIMULATE') || '').trim().toLowerCase();
// เวอร์ชัน API: v1 (ค่าเริ่มต้น ส่งรูปสลิป) หรือ v2 (ส่งข้อความ QR ที่เว็บถอดจากรูปสลิป) — ตั้ง Secret EASYSLIP_VERSION=v2
const VERSION = (Deno.env.get('EASYSLIP_VERSION') || 'v1').trim().toLowerCase();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${t}`);
  return JSON.parse(t);
}

function dataUrlToBlob(d: string): Blob {
  const m = /^data:([^;]+);base64,(.+)$/.exec(d || '');
  if (!m) throw new Error('bad image');
  const bin = atob(m[2]); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: m[1] });
}

// เลขบัญชีในสลิปมักถูกปิดบางหลัก เช่น "xxx-x-x4146-x" — หลักที่เห็นต้องตรงกับบัญชีร้านทุกหลัก (อย่างน้อย 3 หลัก)
function accountMatches(masked: string, target: string): boolean {
  const m = String(masked || '').replace(/[^0-9xX*]/g, '').toLowerCase().replace(/\*/g, 'x');
  const t = String(target || '').replace(/\D/g, '');
  if (!m || !t) return false;
  const visible = m.replace(/x/g, '').length;
  if (visible < 3) return false;
  if (m.length === t.length) return [...m].every((ch, i) => ch === 'x' || ch === t[i]);
  const digits = m.replace(/x/g, '');   // รูปแบบความยาวไม่ตรง: หลักที่เห็นต้องเรียงอยู่ในเลขบัญชี
  return t.includes(digits);
}

type Slip = { amount: number; date: string; transRef: string; account: string; name: string; raw: unknown };
// kind: 'system' = ปัญหาฝั่งบริการตรวจสลิป (โควตาหมด / key ผิด / ล่ม) -> ลูกค้าไม่ผิด แจ้งข้อความกลาง ๆ และเตือนผู้ดูแล
//       'slip'   = ปัญหาที่ตัวสลิป (อ่าน QR ไม่ได้ / ไม่พบรายการ)
type Fail = { ok: false; kind: 'system' | 'slip'; reason: string; raw?: unknown };
const SYS = {
  quota: '[ระบบ] โควตาตรวจสลิป EasySlip หมด — เติมโควตา แล้วตรวจคำสั่งซื้อนี้เอง',
  unauthorized: '[ระบบ] API key ของ EasySlip ไม่ถูกต้องหรือหมดอายุ — ตรวจ Secret EASYSLIP_API_KEY',
  down: '[ระบบ] ติดต่อบริการตรวจสลิป EasySlip ไม่ได้ — ตรวจคำสั่งซื้อนี้เอง',
  nokey: '[ระบบ] ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY — ตรวจคำสั่งซื้อนี้เอง',
};
// ดึงค่าจากผลตรวจ (รองรับชื่อฟิลด์ทั้ง v1 / v2)
function pickSlip(d: any): Slip {
  const recv = d?.receiver || {}, acc = recv.account || {};
  const amount = Number(d?.amount?.amount ?? d?.amount?.value ?? d?.amount);
  const date = String(d?.date || d?.transDate && `${d.transDate}T${d.transTime || '00:00:00'}+07:00` || d?.transactionDate || d?.dateTime || '');
  const account = String(acc.bank?.account || acc.proxy?.account || acc.value || acc.number || recv.bank?.account || recv.accountNumber || '');
  return { amount, date, transRef: String(d?.transRef || d?.transactionId || d?.ref || ''), account,
    name: String(acc.name?.th || acc.name?.en || recv.name?.th || recv.name || recv.displayName || ''), raw: d };
}
function classify(status: number, msg: string, raw: unknown): Fail {
  if (/quota|limit|exceed|credit|insufficient/i.test(msg) || status === 429 || status === 402) return { ok: false, kind: 'system', reason: SYS.quota, raw };
  if (status === 401 || /unauthori[sz]ed|invalid.?(api.?)?key|token|forbidden_key/i.test(msg)) return { ok: false, kind: 'system', reason: SYS.unauthorized, raw };
  if (/slip_not_found|not_found|qrcode|invalid_payload|invalid_image|payload/i.test(msg) && status < 500) return { ok: false, kind: 'slip', reason: 'อ่าน QR บนสลิปไม่ได้ หรือไม่พบรายการโอนนี้ (' + msg + ')', raw };
  return { ok: false, kind: 'system', reason: `[ระบบ] บริการตรวจสลิปตอบผิดพลาด (${msg}) — ตรวจคำสั่งซื้อนี้เอง`, raw };
}
// EasySlip API v2: POST https://api.easyslip.com/v2/verify/bank  { payload: "<ข้อความใน QR>" } -> { success, data } / { success:false, error:{ code, message } }
async function verifyV2(qr: string): Promise<{ ok: true; slip: Slip } | Fail> {
  if (!qr) return { ok: false, kind: 'slip', reason: 'อ่าน QR บนสลิปไม่ได้ (รูปไม่ชัด / ถูกครอป / ถ่ายจากหน้าจอ)' };
  let r: Response;
  try {
    r = await fetch('https://api.easyslip.com/v2/verify/bank', {
      method: 'POST', headers: { Authorization: `Bearer ${SLIP_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: qr }), signal: AbortSignal.timeout(20_000),
    });
  } catch (e) { return { ok: false, kind: 'system', reason: SYS.down, raw: { error: String(e) } }; }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.success === false || !j.data) {
    const code = String(j?.error?.code || j?.code || j?.message || `HTTP ${r.status}`);
    return classify(r.status, code + (j?.error?.message ? ' ' + j.error.message : ''), { status: r.status, body: j, api: 'v2' });
  }
  return { ok: true, slip: pickSlip(j.data) };
}
async function verifySlip(image: string, qr = ''): Promise<{ ok: true; slip: Slip } | Fail> {
  if (SIMULATE === 'quota') return { ok: false, kind: 'system', reason: SYS.quota + ' (จำลอง)', raw: { simulated: 'quota', status: 403, message: 'quota_exceeded' } };
  if (SIMULATE === 'unauthorized') return { ok: false, kind: 'system', reason: SYS.unauthorized + ' (จำลอง)', raw: { simulated: 'unauthorized', status: 401 } };
  if (SIMULATE === 'down') return { ok: false, kind: 'system', reason: SYS.down + ' (จำลอง)', raw: { simulated: 'down' } };
  if (SIMULATE === 'invalid') return { ok: false, kind: 'slip', reason: 'อ่าน QR บนสลิปไม่ได้ หรือไม่พบรายการโอนนี้ (จำลอง)', raw: { simulated: 'invalid' } };
  if (!SLIP_KEY) return { ok: false, kind: 'system', reason: SYS.nokey };
  if (VERSION === 'v2') return verifyV2(qr);
  const fd = new FormData();
  fd.append('file', dataUrlToBlob(image), 'slip.jpg');
  let r: Response;
  try {
    r = await fetch('https://developer.easyslip.com/api/v1/verify', { method: 'POST', headers: { Authorization: `Bearer ${SLIP_KEY}` }, body: fd, signal: AbortSignal.timeout(20_000) });
  } catch (e) { return { ok: false, kind: 'system', reason: SYS.down, raw: { error: String(e) } }; }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.data) {
    const msg = String((j && (j.message || j.error)) || `HTTP ${r.status}`);
    const f = classify(r.status, msg, { status: r.status, body: j, api: 'v1' });
    if (f.kind === 'system' && r.status === 403 && !/quota|limit|exceed|credit/i.test(msg)) f.reason = SYS.quota;   // v1: 403 = โควตาหมด / ไม่มีสิทธิ์
    return f;
  }
  return { ok: true, slip: pickSlip(j.data) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  let body: { order?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, 400); }
  const order = body.order || {};
  const image = String(order.slip_image || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > 1_500_000) return json({ ok: false, error: 'กรุณาแนบรูปสลิป (ไฟล์ภาพไม่เกิน ~1 MB)' });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

  let st: any = null;
  try {
    st = await rpc('order_start', { p: order, p_ip: ip });
    if (!st.ok) return json(st);
    const S = st.settings || {}, tol = Number(S.time_tolerance_min || 15);

    const v = await verifySlip(image, String(order.slip_qr || '').slice(0, 1000));
    let ok = false, reason: string | null = null, transRef: string | null = null, slipInfo: unknown = null, system = false;
    if (!v.ok) { reason = v.reason; system = v.kind === 'system'; slipInfo = { error: v.reason, kind: v.kind, raw: v.raw ?? null }; }
    else {
      const s = v.slip; transRef = s.transRef || null;
      slipInfo = { amount: s.amount, date: s.date, account: s.account, name: s.name, transRef: s.transRef, raw: s.raw };
      const slipT = Date.parse(s.date), userT = Date.parse(String(st.transfer_at)), now = Date.now();
      const fails: string[] = [];
      if (!(Math.abs(s.amount - Number(st.amount)) < 0.005)) fails.push(`ยอดในสลิป ${s.amount} บาท ไม่ตรงกับยอดที่ต้องโอน ${st.amount} บาท`);
      if (!accountMatches(s.account, S.account_no)) fails.push(`บัญชีผู้รับในสลิป (${s.account || 'ไม่ทราบ'}) ไม่ใช่บัญชีของร้าน`);
      if (!isFinite(slipT)) fails.push('อ่านเวลาโอนในสลิปไม่ได้');
      else {
        if (Math.abs(slipT - userT) > tol * 60_000) fails.push(`เวลาโอนในสลิปไม่ตรงกับที่กรอก (ต่างเกิน ${tol} นาที)`);
        if (now - slipT > 3 * 86_400_000) fails.push('สลิปเก่าเกิน 3 วัน');
        if (slipT - now > 10 * 60_000) fails.push('เวลาในสลิปเป็นเวลาในอนาคต');
      }
      if (!transRef) fails.push('ไม่พบเลขอ้างอิงธุรกรรมในสลิป');
      ok = fails.length === 0; reason = fails.join(' · ') || null;
    }
    const fin = await rpc('order_finish', { p_id: st.id, p_ok: ok, p_trans_ref: transRef, p_slip: slipInfo, p_reason: reason });
    // ปัญหาฝั่งระบบ (เช่น โควตาหมด): ไม่บอกรายละเอียดภายในกับลูกค้า
    if (system && fin.status === 'review') fin.reason = 'ระบบตรวจสลิปอัตโนมัติไม่พร้อมใช้งานชั่วคราว';
    return json({ ...fin, ref: st.ref, amount: st.amount });
  } catch (e) {
    console.error(e);
    // บันทึกคำสั่งซื้อไปแล้ว: เก็บไว้ให้ผู้ดูแลตรวจ (ไม่ให้เว็บส่งซ้ำเป็นคำสั่งซื้อที่ 2)
    if (st && st.id) {
      try {
        await rpc('order_finish', { p_id: st.id, p_ok: false, p_trans_ref: null, p_slip: { error: String(e) }, p_reason: '[ระบบ] ฟังก์ชันตรวจสลิปขัดข้อง — ตรวจคำสั่งซื้อนี้เอง' });
        return json({ ok: true, status: 'review', ref: st.ref, amount: st.amount, reason: 'ระบบตรวจสลิปอัตโนมัติไม่พร้อมใช้งานชั่วคราว' });
      } catch (e2) { console.error(e2); }
    }
    return json({ ok: false, error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หรือติดต่อทางเพจ' }, 500);
  }
});
