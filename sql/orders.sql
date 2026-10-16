-- =====================================================================
--  สมัครใช้งานอัตโนมัติ: ลูกค้าโอนเงิน + อัปโหลดสลิป -> ตรวจสลิป -> ออกรหัสสิทธิ์อัตโนมัติ
--  วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้) — รวมอยู่ใน schema.sql แล้ว
--  ส่วนตรวจสลิปอยู่ใน Edge Function: supabase/functions/auto-register (ดูวิธีติดตั้งใน docs/auto-register.md)
--  * ฟังก์ชัน order_start / order_finish เรียกได้เฉพาะ service_role (Edge Function) เท่านั้น — เว็บ (anon) เรียกไม่ได้
-- =====================================================================

-- ---------- ตั้งค่าการขาย (ราคา / บัญชีรับเงิน) แก้ได้ในหน้าผู้ดูแล ----------
create table if not exists public.app_settings (
  key    text primary key,
  value  jsonb not null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings(key, value) values
  ('sales', jsonb_build_object(
    'auto', true,                         -- เปิด/ปิดการออกรหัสอัตโนมัติ (ปิด = ทุกคำสั่งซื้อรอผู้ดูแลตรวจ)
    'price_per_grade', null,              -- ราคาต่อ 1 ชั้น (บาท) — ยังไม่ตั้ง = ปิดการสั่งซื้อ
    'price_all', null,                    -- ราคาเหมา 6 ชั้น (ถ้ามี) — ว่าง = คิดตามจำนวนชั้น
    'bank', 'ธนาคารกรุงไทย',
    'account_no', '9600441464',
    'account_name', 'นายเบญจรงค์ นุ่มวัฒนะ',
    'time_tolerance_min', 15              -- เวลาโอนที่ลูกค้ากรอก ต่างจากเวลาในสลิปได้ไม่เกินกี่นาที
  ))
on conflict (key) do nothing;

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  school       text not null,
  area         text,
  contact      text,
  position     text,
  phone        text,
  line_id      text,
  email        text,
  grades       smallint[] not null,
  amount       numeric(10,2) not null,          -- ยอดที่ต้องโอน (คำนวณจากราคาในระบบ)
  transfer_at  timestamptz,                     -- เวลาโอนที่ลูกค้ากรอก
  slip_image   text,                            -- รูปสลิป (ย่อแล้ว) สำหรับผู้ดูแลตรวจ
  slip         jsonb,                           -- ผลตรวจจากบริการตรวจสลิป
  trans_ref    text,                            -- เลขอ้างอิงธุรกรรมในสลิป (กันใช้สลิปซ้ำ)
  status       text not null default 'checking' check (status in ('checking', 'approved', 'review', 'rejected')),
  reason       text,                            -- เหตุผลที่ไม่ผ่านอัตโนมัติ
  school_id    uuid references public.schools(id) on delete set null,
  ip           text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
-- แบบฟอร์มสั่งซื้อไม่ถามชื่อผู้ติดต่อ / เบอร์โทรแล้ว (ลูกค้าติดต่อทางแชทเพจด้วยเลขคำสั่งซื้อ)
alter table public.orders alter column contact drop not null, alter column phone drop not null;
create unique index if not exists orders_trans_ref_uq on public.orders (trans_ref) where trans_ref is not null and status in ('approved', 'review', 'checking');
create index if not exists orders_ip_at on public.orders (ip, created_at);
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

create or replace function public._sales() returns jsonb
language sql stable security definer set search_path = public as $$ select value from public.app_settings where key = 'sales' $$;

-- ราคาตามชั้นที่เลือก (null = ยังไม่ได้ตั้งราคา)
create or replace function public._order_amount(p_grades smallint[]) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s jsonb := public._sales(); n int := cardinality(p_grades); per numeric; allp numeric;
begin
  per := nullif(s->>'price_per_grade', '')::numeric; allp := nullif(s->>'price_all', '')::numeric;
  if per is null and allp is null then return null; end if;
  if n = 6 and allp is not null then return allp; end if;
  if per is null then return null; end if;
  return case when allp is not null then least(per * n, allp) else per * n end;
end $$;

-- ข้อมูลสำหรับหน้าสั่งซื้อ (เรียกจากเว็บได้): ราคา บัญชีรับเงิน
create or replace function public.sales_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'price_per_grade', s->'price_per_grade', 'price_all', s->'price_all', 'auto', s->'auto',
    'bank', s->'bank', 'account_no', s->'account_no', 'account_name', s->'account_name') from (select public._sales() s) x
$$;

-- เริ่มคำสั่งซื้อ (Edge Function เรียก): ตรวจข้อมูล จำกัดความถี่ คำนวณยอด
create or replace function public.order_start(p jsonb, p_ip text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare g smallint[]; amt numeric; o public.orders; t text; tat timestamptz;
begin
  if (select count(*) from public.orders where ip = p_ip and created_at > now() - interval '1 hour') >= 6 then
    return jsonb_build_object('ok', false, 'error', 'ส่งคำสั่งซื้อบ่อยเกินไป กรุณาลองใหม่ภายหลัง หรือติดต่อทางเพจ');
  end if;
  t := btrim(coalesce(p->>'school', ''));
  if length(t) < 3 or length(t) > 200 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อโรงเรียน'); end if;
  select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into g
    from jsonb_array_elements_text(coalesce(p->'grades', '[]')) x where x ~ '^[1-6]$';
  if cardinality(g) = 0 then return jsonb_build_object('ok', false, 'error', 'กรุณาเลือกชั้นที่ต้องการอย่างน้อย 1 ชั้น'); end if;
  amt := public._order_amount(g);
  if amt is null then return jsonb_build_object('ok', false, 'error', 'ยังไม่เปิดสั่งซื้ออัตโนมัติ กรุณาติดต่อทางเพจ'); end if;
  if p ? 'amount' and round((p->>'amount')::numeric, 2) <> round(amt, 2) then
    return jsonb_build_object('ok', false, 'error', 'ราคามีการเปลี่ยนแปลง กรุณารีเฟรชหน้าแล้วตรวจยอดโอนอีกครั้ง');
  end if;
  begin tat := (p->>'transfer_at')::timestamptz; exception when others then tat := null; end;
  if tat is null then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกวันและเวลาที่โอนเงิน'); end if;
  insert into public.orders(school, area, contact, position, phone, line_id, email, grades, amount, transfer_at, slip_image, ip)
  values (left(t, 200), left(btrim(p->>'area'), 200), left(btrim(p->>'contact'), 100), left(btrim(p->>'position'), 100),
          left(btrim(p->>'phone'), 30), left(btrim(p->>'line_id'), 60), left(btrim(p->>'email'), 120), g, amt, tat,
          case when length(coalesce(p->>'slip_image', '')) < 1500000 and p->>'slip_image' like 'data:image/%' then p->>'slip_image' end, p_ip)
  returning * into o;
  return jsonb_build_object('ok', true, 'id', o.id, 'ref', upper(left(replace(o.id::text, '-', ''), 6)), 'amount', o.amount,
    'transfer_at', o.transfer_at, 'settings', public._sales());
end $$;

-- ออกรหัสสิทธิ์ให้คำสั่งซื้อ (ใช้ร่วมกันทั้งอัตโนมัติและผู้ดูแลอนุมัติเอง)
create or replace function public._order_issue(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare o public.orders; code text; sid uuid;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบคำสั่งซื้อ'); end if;
  if o.status = 'approved' then return jsonb_build_object('ok', false, 'error', 'คำสั่งซื้อนี้ออกรหัสไปแล้ว (ถ้าลูกค้าทำรหัสหาย ใช้ปุ่มรีเซ็ตรหัสของโรงเรียน)'); end if;
  code := public._new_code();
  insert into public.schools(name, code_hash, grades, note)
  values (o.school, public._code_hash(code), public._clean_grades(o.grades),
          concat_ws(' ', 'สั่งซื้อ ' || upper(left(replace(o.id::text, '-', ''), 6)), nullif(concat_ws(' ', o.contact, o.phone, 'LINE ' || o.line_id), '')))
  returning id into sid;
  update public.orders set status = 'approved', school_id = sid, decided_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'code', code, 'school', o.school, 'grades', to_jsonb(public._clean_grades(o.grades)));
end $$;

-- จบคำสั่งซื้อ (Edge Function เรียก หลังตรวจสลิป): ผ่าน = ออกรหัส / ไม่ผ่าน = รอผู้ดูแลตรวจ
create or replace function public.order_finish(p_id uuid, p_ok boolean, p_trans_ref text, p_slip jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_trans_ref is not null and exists (select 1 from public.orders where trans_ref = p_trans_ref and id <> p_id and status in ('approved', 'review', 'checking')) then
    update public.orders set status = 'review', slip = p_slip, reason = 'สลิปนี้เคยใช้สั่งซื้อแล้ว (เลขอ้างอิงซ้ำ)' where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'review', 'reason', 'สลิปนี้เคยถูกใช้แล้ว');
  end if;
  update public.orders set trans_ref = p_trans_ref, slip = p_slip, reason = p_reason where id = p_id;
  if p_ok and coalesce((public._sales()->>'auto')::boolean, true) then
    return public._order_issue(p_id) || jsonb_build_object('status', 'approved');
  end if;
  update public.orders set status = 'review', reason = coalesce(p_reason, 'ปิดการออกรหัสอัตโนมัติไว้ — รอผู้ดูแลตรวจ') where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'review', 'reason', coalesce(p_reason, 'รอผู้ดูแลตรวจสอบ'));
end $$;

-- สำรอง: ถ้าเว็บติดต่อ Edge Function ตรวจสลิปไม่ได้ (ยังไม่ติดตั้ง / ขัดข้อง) รับคำสั่งซื้อ + สลิปไว้ให้ผู้ดูแลตรวจเอง (ไม่ออกรหัสอัตโนมัติ)
create or replace function public.order_submit_manual(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if coalesce(p->>'website', '') <> '' then return jsonb_build_object('ok', true, 'status', 'review', 'ref', 'OK'); end if;   -- กับดักบอท
  r := public.order_start(p, public._client_ip());
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  update public.orders set status = 'review', reason = 'ระบบตรวจสลิปอัตโนมัติไม่พร้อมใช้งาน — รอผู้ดูแลตรวจสลิป' where id = (r->>'id')::uuid;
  return jsonb_build_object('ok', true, 'status', 'review', 'ref', r->>'ref', 'amount', r->'amount', 'reason', 'ระบบตรวจสลิปอัตโนมัติไม่พร้อมใช้งานชั่วคราว');
end $$;
revoke all on function public.order_submit_manual(jsonb) from public, anon, authenticated;
grant execute on function public.order_submit_manual(jsonb) to anon, authenticated;

-- ---------- ผู้ดูแล ----------
create or replace function public.admin_orders(p_pass text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  return jsonb_build_object('ok', true, 'settings', public._sales(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'ref', upper(left(replace(id::text, '-', ''), 6)), 'school', school, 'area', area,
      'contact', contact, 'position', position, 'phone', phone, 'line_id', line_id, 'email', email, 'grades', to_jsonb(grades),
      'amount', amount, 'transfer_at', transfer_at, 'slip_amount', slip #>> '{amount}', 'slip_date', slip #>> '{date}',
      'trans_ref', trans_ref, 'status', status, 'reason', reason, 'has_slip', slip_image is not null,
      'created_at', created_at, 'decided_at', decided_at) order by created_at desc)
    from (select * from public.orders order by created_at desc limit 500) x), '[]'::jsonb));
end $$;

create or replace function public.admin_order_slip(p_pass text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  return jsonb_build_object('ok', true, 'image', (select slip_image from public.orders where id = p_id),
    'slip', (select slip from public.orders where id = p_id));
end $$;

create or replace function public.admin_order_decide(p_pass text, p_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  if p_approve then return public._order_issue(p_id); end if;
  update public.orders set status = 'rejected', decided_at = now() where id = p_id and status <> 'approved';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_sales_set(p_pass text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cur jsonb := coalesce(public._sales(), '{}'::jsonb); k text;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  foreach k in array array['auto', 'price_per_grade', 'price_all', 'bank', 'account_no', 'account_name', 'time_tolerance_min'] loop
    if p_settings ? k then cur := jsonb_set(cur, array[k], p_settings->k); end if;
  end loop;
  insert into public.app_settings(key, value) values ('sales', cur) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'settings', cur);
end $$;

revoke all on function public._sales(), public._order_amount(smallint[]), public._order_issue(uuid),
  public.order_start(jsonb, text), public.order_finish(uuid, boolean, text, jsonb, text),
  public.sales_info(), public.admin_orders(text), public.admin_order_slip(text, uuid),
  public.admin_order_decide(text, uuid, boolean), public.admin_sales_set(text, jsonb) from public, anon, authenticated;
grant execute on function public.order_start(jsonb, text), public.order_finish(uuid, boolean, text, jsonb, text) to service_role;
grant execute on function public.sales_info(), public.admin_orders(text), public.admin_order_slip(text, uuid),
  public.admin_order_decide(text, uuid, boolean), public.admin_sales_set(text, jsonb) to anon, authenticated;
