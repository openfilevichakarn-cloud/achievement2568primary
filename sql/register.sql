-- =====================================================================
--  หน้าสมัครใช้งาน (register.html) — เก็บคำขอสั่งซื้อจากโรงเรียน ให้ผู้ดูแลเห็นในหน้า admin.html แล้วกดออกรหัสได้
--  วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้) — รวมอยู่ใน schema.sql แล้ว
-- =====================================================================
create table if not exists public.registrations (
  id          uuid primary key default gen_random_uuid(),
  school      text not null,
  area        text,
  contact     text not null,
  position    text,
  phone       text not null,
  line_id     text,
  email       text,
  grades      smallint[] not null default '{}',
  rooms       smallint,
  note        text,
  status      text not null default 'new' check (status in ('new', 'done', 'cancel')),
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists registrations_ip_at on public.registrations (ip, created_at);
alter table public.registrations enable row level security;
revoke all on public.registrations from anon, authenticated;

-- ส่งคำขอสมัคร (เรียกจากหน้าเว็บได้โดยไม่ต้องมีรหัส) — จำกัด 5 ครั้ง/ชั่วโมง/IP และ 300 ครั้ง/วัน ทั้งระบบ
create or replace function public.register_school(p jsonb) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_ip text := public._client_ip(); t text; r public.registrations; g smallint[];
begin
  if coalesce(p->>'website', '') <> '' then return jsonb_build_object('ok', true, 'ref', 'OK'); end if;   -- กับดักบอท
  if (select count(*) from public.registrations where ip = v_ip and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.registrations where created_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'error', 'ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง หรือติดต่อทางเพจ');
  end if;
  t := btrim(coalesce(p->>'school', ''));
  if length(t) < 3 or length(t) > 200 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อโรงเรียน'); end if;
  if length(btrim(coalesce(p->>'contact', ''))) < 2 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อผู้ติดต่อ'); end if;
  if length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) < 9 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง'); end if;
  select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into g
    from jsonb_array_elements_text(coalesce(p->'grades', '[]')) x where x ~ '^[1-6]$';
  if cardinality(g) = 0 then return jsonb_build_object('ok', false, 'error', 'กรุณาเลือกชั้นที่ต้องการอย่างน้อย 1 ชั้น'); end if;
  insert into public.registrations(school, area, contact, position, phone, line_id, email, grades, rooms, note, ip)
  values (left(t, 200), left(btrim(p->>'area'), 200), left(btrim(p->>'contact'), 100), left(btrim(p->>'position'), 100),
          left(btrim(p->>'phone'), 30), left(btrim(p->>'line_id'), 60), left(btrim(p->>'email'), 120), g,
          case when coalesce(p->>'rooms', '') ~ '^\d{1,2}$' then least((p->>'rooms')::int, 60)::smallint end,
          left(btrim(p->>'note'), 1000), v_ip)
  returning * into r;
  return jsonb_build_object('ok', true, 'ref', upper(left(replace(r.id::text, '-', ''), 6)));
end $$;

create or replace function public.admin_registrations(p_pass text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'ref', upper(left(replace(id::text, '-', ''), 6)), 'school', school, 'area', area,
      'contact', contact, 'position', position, 'phone', phone, 'line_id', line_id, 'email', email, 'grades', to_jsonb(grades),
      'rooms', rooms, 'note', note, 'status', status, 'created_at', created_at) order by created_at desc)
    from (select * from public.registrations order by created_at desc limit 500) x), '[]'::jsonb));
end $$;

create or replace function public.admin_registration_set(p_pass text, p_id uuid, p_status text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  if p_status not in ('new', 'done', 'cancel') then return jsonb_build_object('ok', false, 'error', 'สถานะไม่ถูกต้อง'); end if;
  update public.registrations set status = p_status where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.register_school(jsonb), public.admin_registrations(text), public.admin_registration_set(text, uuid, text) from public, anon, authenticated;
grant execute on function public.register_school(jsonb) to anon, authenticated;
grant execute on function public.admin_registrations(text) to anon, authenticated;
grant execute on function public.admin_registration_set(text, uuid, text) to anon, authenticated;
