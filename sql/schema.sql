-- =====================================================================
--  โปรแกรมแจ้งผลการเรียน หลักสูตร 2568 (เว็บ) — โครงสร้างฐานข้อมูล Supabase
--  วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run  (รันซ้ำได้ ไม่ทำให้ข้อมูลหาย)
--  หลักการ
--   * ตารางทั้งหมดเปิด RLS และไม่มี policy => เว็บ (anon key) อ่าน/เขียนตารางตรง ๆ ไม่ได้เลย
--   * เว็บเรียกได้เฉพาะฟังก์ชัน app_* (login / load / save / delete_room / set_logo) โดยแนบ "รหัสสิทธิ์โรงเรียน"
--   * ข้อมูลเก็บแยก โรงเรียน + ชั้น + ห้อง (ชั้นละไม่เกิน 10 ห้อง) · ตราโรงเรียนเก็บที่ตาราง schools
--   * รหัสสิทธิ์เก็บเป็น SHA-256 เท่านั้น ชื่อโรงเรียนผูกกับรหัสและแก้ได้เฉพาะเจ้าของระบบ (SQL Editor)
--   * ฟังก์ชันออกรหัส (issue_school / reset_school_code) ห้าม anon เรียก ใช้ใน SQL Editor เท่านั้น
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- ตาราง ----------
create table if not exists public.schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  code_hash   text not null unique,
  grades      smallint[] not null default '{1}',
  active      boolean not null default true,
  logo        text,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.school_data (
  school_id   uuid not null references public.schools(id) on delete cascade,
  grade       smallint not null check (grade between 1 and 6),
  room        smallint not null default 1 constraint school_data_room_chk check (room between 1 and 10),
  data        jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  constraint school_data_pkey primary key (school_id, grade, room)
);

create table if not exists public.login_attempts (
  id    bigserial primary key,
  ip    text not null,
  at    timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on public.login_attempts (ip, at);

alter table public.schools        enable row level security;
alter table public.school_data    enable row level security;
alter table public.login_attempts enable row level security;
revoke all on public.schools, public.school_data, public.login_attempts from anon, authenticated;
revoke all on sequence public.login_attempts_id_seq from anon, authenticated;

-- ---------- ฟังก์ชันภายใน ----------
create or replace function public._code_hash(p text) returns text
language sql immutable
set search_path = public, extensions
as $$ select encode(extensions.digest(convert_to(upper(regexp_replace(coalesce(p,''), '[\s-]', '', 'g')), 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public._client_ip() returns text
language sql stable
as $$ select coalesce(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), 'unknown') $$;

-- ตรวจรหัส: คืนแถวโรงเรียน หรือ null (พร้อมบันทึกความพยายามที่ผิด และจำกัด 20 ครั้ง/10 นาที ต่อ IP)
create or replace function public._auth(p_code text) returns public.schools
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; v_ip text := public._client_ip();
begin
  if (select count(*) from public.login_attempts where ip = v_ip and at > now() - interval '10 minutes') >= 20 then
    return null;
  end if;
  select * into s from public.schools where code_hash = public._code_hash(p_code) and active;
  if not found then
    insert into public.login_attempts(ip) values (v_ip);
    delete from public.login_attempts where at < now() - interval '1 day';
    return null;
  end if;
  return s;
end $$;

-- ---------- ฟังก์ชันที่เว็บเรียกได้ ----------
-- ---------- ฟังก์ชันของเจ้าของระบบ (ใช้ใน SQL Editor เท่านั้น) ----------
-- ออกสิทธิ์ให้โรงเรียนใหม่ คืนรหัสสิทธิ์ (แสดงครั้งเดียว ระบบเก็บเฉพาะ hash)
create or replace function public.issue_school(p_name text, p_grades smallint[] default '{1}') returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare raw text := upper(encode(extensions.gen_random_bytes(8), 'hex')); code text;
begin
  code := substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4)||'-'||substr(raw,13,4);
  insert into public.schools(name, code_hash, grades) values (btrim(p_name), public._code_hash(code), p_grades);
  return code;
end $$;

-- ออกรหัสใหม่ให้โรงเรียน (รหัสเดิมใช้ไม่ได้ทันที) คืนรหัสใหม่
create or replace function public.reset_school_code(p_school_id uuid) returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare raw text := upper(encode(extensions.gen_random_bytes(8), 'hex')); code text;
begin
  code := substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4)||'-'||substr(raw,13,4);
  update public.schools set code_hash = public._code_hash(code) where id = p_school_id;
  if not found then raise exception 'ไม่พบโรงเรียน'; end if;
  return code;
end $$;

-- ---------- สิทธิ์การเรียกฟังก์ชัน ----------
revoke all on function public._code_hash(text), public._client_ip(), public._auth(text),
  public.issue_school(text, smallint[]), public.reset_school_code(uuid)
  from public, anon, authenticated;

-- ---------- ปรับตาราง: ข้อมูลรายห้อง + ตราโรงเรียนที่เดียว (รันซ้ำได้) ----------
alter table public.schools add column if not exists logo text;
alter table public.school_data add column if not exists room smallint not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'school_data_room_chk') then
    alter table public.school_data add constraint school_data_room_chk check (room between 1 and 10);
  end if;
  if exists (select 1 from pg_constraint where conname = 'school_data_pkey' and pg_get_constraintdef(oid) not like '%room%') then
    alter table public.school_data drop constraint school_data_pkey;
    alter table public.school_data add constraint school_data_pkey primary key (school_id, grade, room);
  end if;
end $$;
-- ย้ายตราจากข้อมูลรายชั้น (เดิมเก็บซ้ำทุกชั้น) มาไว้ที่โรงเรียน แล้วลบออกจากข้อมูลรายชั้นเพื่อประหยัดพื้นที่
update public.schools s set logo = x.logo
  from (select distinct on (school_id) school_id, data->>'logo' as logo from public.school_data
         where coalesce(data->>'logo', '') like 'data:image/%' order by school_id, updated_at desc) x
 where x.school_id = s.id and s.logo is null;
update public.school_data set data = data - 'logo' where data ? 'logo';

-- ---------- ฟังก์ชันของเว็บ (รายห้อง: ชั้นละไม่เกิน 10 ห้อง) ----------
drop function if exists public.app_load(text, smallint);
drop function if exists public.app_save(text, smallint, jsonb, integer, boolean);

create or replace function public.app_login(p_code text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง หรือพยายามเข้าสู่ระบบผิดหลายครั้ง (รอ 10 นาทีแล้วลองใหม่)'); end if;
  return jsonb_build_object('ok', true, 'school_name', s.name, 'grades', to_jsonb(s.grades), 'logo', s.logo,
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('grade', d.grade, 'room', d.room) order by d.grade, d.room)
                       from public.school_data d where d.school_id = s.id), '[]'::jsonb));
end $$;

create or replace function public.app_load(p_code text, p_grade smallint, p_room smallint) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; d public.school_data;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if not (p_grade = any (s.grades)) then return jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้ไม่มีสิทธิ์ใช้งานชั้นนี้'); end if;
  select * into d from public.school_data where school_id = s.id and grade = p_grade and room = p_room;
  if not found then return jsonb_build_object('ok', true, 'data', null, 'version', 0); end if;
  return jsonb_build_object('ok', true, 'data', d.data, 'version', d.version);
end $$;

create or replace function public.app_save(p_code text, p_grade smallint, p_room smallint, p_data jsonb, p_base_version integer, p_force boolean default false) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; cur integer; nv integer;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if not (p_grade = any (s.grades)) then return jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้ไม่มีสิทธิ์ใช้งานชั้นนี้'); end if;
  if p_room is null or p_room < 1 or p_room > 10 then return jsonb_build_object('ok', false, 'error', 'ห้องเรียนต้องอยู่ระหว่าง 1-10'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'error', 'รูปแบบข้อมูลไม่ถูกต้อง'); end if;
  if pg_column_size(p_data) > 3000000 then return jsonb_build_object('ok', false, 'error', 'ข้อมูลใหญ่เกินกำหนด (3 MB)'); end if;
  select version into cur from public.school_data where school_id = s.id and grade = p_grade and room = p_room for update;
  if not found then
    insert into public.school_data(school_id, grade, room, data, version) values (s.id, p_grade, p_room, p_data, 1)
    on conflict (school_id, grade, room) do nothing;
    if found then return jsonb_build_object('ok', true, 'version', 1); end if;
    select version into cur from public.school_data where school_id = s.id and grade = p_grade and room = p_room for update;
  end if;
  if cur <> coalesce(p_base_version, 0) and not coalesce(p_force, false) then
    return jsonb_build_object('ok', true, 'conflict', true, 'version', cur);
  end if;
  update public.school_data set data = p_data, version = cur + 1, updated_at = now()
   where school_id = s.id and grade = p_grade and room = p_room returning version into nv;
  return jsonb_build_object('ok', true, 'version', nv);
end $$;

-- ลบห้องเรียน (ข้อมูลของห้องนั้นหายถาวร)
create or replace function public.app_delete_room(p_code text, p_grade smallint, p_room smallint) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  delete from public.school_data where school_id = s.id and grade = p_grade and room = p_room;
  return jsonb_build_object('ok', true);
end $$;

-- ตราโรงเรียน: เก็บที่เดียวต่อโรงเรียน (รูปย่อแล้ว ไม่เกิน ~400 KB)
create or replace function public.app_set_logo(p_code text, p_logo text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if p_logo is not null and (p_logo not like 'data:image/%' or length(p_logo) > 400000) then
    return jsonb_build_object('ok', false, 'error', 'ไฟล์รูปตราไม่ถูกต้องหรือใหญ่เกินไป');
  end if;
  update public.schools set logo = p_logo where id = s.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.app_login(text), public.app_load(text, smallint, smallint),
  public.app_save(text, smallint, smallint, jsonb, integer, boolean),
  public.app_delete_room(text, smallint, smallint), public.app_set_logo(text, text) from public, anon, authenticated;
grant execute on function public.app_login(text) to anon, authenticated;
grant execute on function public.app_load(text, smallint, smallint) to anon, authenticated;
grant execute on function public.app_save(text, smallint, smallint, jsonb, integer, boolean) to anon, authenticated;
grant execute on function public.app_delete_room(text, smallint, smallint) to anon, authenticated;
grant execute on function public.app_set_logo(text, text) to anon, authenticated;

-- =====================================================================
--  หน้าผู้ดูแล (admin.html): ออกรหัส / ดูรายชื่อ / รีเซ็ตรหัส / แก้ไข ด้วยการกดปุ่ม
--  * ทุกฟังก์ชันต้องแนบ "รหัสผ่านผู้ดูแล" (เก็บเป็น bcrypt ในตาราง admin_auth)
--  * ผิดเกิน 10 ครั้ง/10 นาที ต่อ IP จะถูกระงับชั่วคราว
--  * ตั้ง/เปลี่ยนรหัสผ่านผู้ดูแลได้เฉพาะใน SQL Editor:  select public.set_admin_password('รหัสผ่านยาวๆ');
-- =====================================================================
create table if not exists public.admin_auth (
  id          smallint primary key default 1 check (id = 1),
  pass_hash   text not null,
  updated_at  timestamptz not null default now()
);
create table if not exists public.admin_attempts (
  id    bigserial primary key,
  ip    text not null,
  at    timestamptz not null default now()
);
create index if not exists admin_attempts_ip_at on public.admin_attempts (ip, at);
alter table public.admin_auth     enable row level security;
alter table public.admin_attempts enable row level security;
revoke all on public.admin_auth, public.admin_attempts from anon, authenticated;
revoke all on sequence public.admin_attempts_id_seq from anon, authenticated;

create or replace function public.set_admin_password(p_pass text) returns text
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_pass, '')) < 10 then raise exception 'รหัสผ่านผู้ดูแลต้องยาวอย่างน้อย 10 ตัวอักษร'; end if;
  insert into public.admin_auth(id, pass_hash) values (1, extensions.crypt(p_pass, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set pass_hash = excluded.pass_hash, updated_at = now();
  return 'ตั้งรหัสผ่านผู้ดูแลแล้ว';
end $$;

-- ตรวจรหัสผ่านผู้ดูแล (true/false) พร้อมจำกัดจำนวนครั้งที่ผิด
create or replace function public._admin_ok(p_pass text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare h text; v_ip text := public._client_ip();
begin
  if (select count(*) from public.admin_attempts where ip = v_ip and at > now() - interval '10 minutes') >= 10 then return false; end if;
  select pass_hash into h from public.admin_auth where id = 1;
  if h is not null and extensions.crypt(coalesce(p_pass, ''), h) = h then return true; end if;
  insert into public.admin_attempts(ip) values (v_ip);
  delete from public.admin_attempts where at < now() - interval '1 day';
  return false;
end $$;

create or replace function public._new_code() returns text
language plpgsql volatile
set search_path = public, extensions
as $$
declare raw text := upper(encode(extensions.gen_random_bytes(8), 'hex'));
begin
  return substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4)||'-'||substr(raw,13,4);
end $$;

create or replace function public._clean_grades(p_grades smallint[]) returns smallint[]
language sql immutable
as $$ select coalesce(array_agg(distinct g order by g), '{1}') from unnest(coalesce(p_grades, '{1}')) g where g between 1 and 6 $$;

create or replace function public.admin_login(p_pass text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง หรือพยายามผิดหลายครั้ง (รอ 10 นาที)'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- รายชื่อโรงเรียนทั้งหมด + การบันทึกล่าสุดของแต่ละชั้น
create or replace function public.admin_list(p_pass text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  return jsonb_build_object('ok', true, 'schools', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'grades', to_jsonb(s.grades), 'active', s.active, 'note', s.note, 'created_at', s.created_at,
      'saves', coalesce((select jsonb_agg(jsonb_build_object('grade', d.grade, 'room', d.room, 'version', d.version, 'updated_at', d.updated_at) order by d.grade, d.room)
                         from public.school_data d where d.school_id = s.id), '[]'::jsonb)
    ) order by s.created_at desc)
    from public.schools s), '[]'::jsonb));
end $$;

-- ออกรหัสให้โรงเรียนใหม่ (หลายโรงเรียนพร้อมกันได้) คืนรหัส (แสดงครั้งเดียว ระบบเก็บเฉพาะ hash)
create or replace function public.admin_issue(p_pass text, p_names text[], p_grades smallint[] default '{1}', p_note text default null) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare n text; code text; out jsonb := '[]'::jsonb; sid uuid;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  if coalesce(array_length(p_names, 1), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อโรงเรียน'); end if;
  if array_length(p_names, 1) > 200 then return jsonb_build_object('ok', false, 'error', 'ออกได้ครั้งละไม่เกิน 200 โรงเรียน'); end if;
  foreach n in array p_names loop
    n := btrim(coalesce(n, ''));
    continue when n = '';
    code := public._new_code();
    insert into public.schools(name, code_hash, grades, note) values (n, public._code_hash(code), public._clean_grades(p_grades), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into sid;
    out := out || jsonb_build_object('id', sid, 'name', n, 'code', code);
  end loop;
  return jsonb_build_object('ok', true, 'issued', out);
end $$;

-- ออกรหัสใหม่ (รหัสเดิมใช้ไม่ได้ทันที) ข้อมูลของโรงเรียนยังอยู่ครบ
create or replace function public.admin_reset(p_pass text, p_id uuid) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare code text := public._new_code();
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  update public.schools set code_hash = public._code_hash(code) where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบโรงเรียน'); end if;
  return jsonb_build_object('ok', true, 'code', code);
end $$;

-- แก้ชื่อ / ชั้นที่ใช้ได้ / สถานะ / หมายเหตุ (ส่ง null = ไม่เปลี่ยน)
create or replace function public.admin_update(p_pass text, p_id uuid, p_name text default null, p_grades smallint[] default null, p_active boolean default null, p_note text default null) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'รหัสผ่านผู้ดูแลไม่ถูกต้อง'); end if;
  if p_name is not null and btrim(p_name) = '' then return jsonb_build_object('ok', false, 'error', 'ชื่อโรงเรียนว่างไม่ได้'); end if;
  update public.schools set
    name   = coalesce(nullif(btrim(p_name), ''), name),
    grades = case when p_grades is null then grades else public._clean_grades(p_grades) end,
    active = coalesce(p_active, active),
    note   = case when p_note is null then note else nullif(btrim(p_note), '') end
   where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบโรงเรียน'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.set_admin_password(text), public._admin_ok(text), public._new_code(), public._clean_grades(smallint[]),
  public.admin_login(text), public.admin_list(text), public.admin_issue(text, text[], smallint[], text),
  public.admin_reset(text, uuid), public.admin_update(text, uuid, text, smallint[], boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_login(text) to anon, authenticated;
grant execute on function public.admin_list(text) to anon, authenticated;
grant execute on function public.admin_issue(text, text[], smallint[], text) to anon, authenticated;
grant execute on function public.admin_reset(text, uuid) to anon, authenticated;
grant execute on function public.admin_update(text, uuid, text, smallint[], boolean, text) to anon, authenticated;

-- =====================================================================
--  วิธีบริหารโรงเรียน (รันทีละคำสั่งใน SQL Editor) — หรือใช้หน้า admin.html หลังตั้งรหัสผ่านผู้ดูแล
-- =====================================================================
--  ตั้งรหัสผ่านหน้าผู้ดูแล (ครั้งแรก): select public.set_admin_password('รหัสผ่านยาวอย่างน้อย10ตัว');
--  ออกสิทธิ์ ป.1 ให้โรงเรียนใหม่:     select public.issue_school('โรงเรียนบ้านตัวอย่าง');
--  ออกสิทธิ์ ป.1–ป.3:                select public.issue_school('โรงเรียนบ้านตัวอย่าง', '{1,2,3}');
--  ดูรายชื่อโรงเรียน:                select id, name, grades, active, created_at from public.schools order by created_at desc;
--  แก้ชื่อโรงเรียน (ล็อกฝั่งลูกค้า):   update public.schools set name = 'ชื่อใหม่' where id = '...';
--  เพิ่มชั้นที่ใช้ได้:                 update public.schools set grades = '{1,2,3,4,5,6}' where id = '...';
--  ออกรหัสใหม่ (รหัสเดิมใช้ไม่ได้):     select public.reset_school_code('...');
--  ระงับสิทธิ์:                       update public.schools set active = false where id = '...';
--  ดูว่าโรงเรียนไหนบันทึกล่าสุด:       select s.name, d.grade, d.room, d.version, d.updated_at from public.school_data d join public.schools s on s.id = d.school_id order by d.updated_at desc;

-- ---------- กันโปรเจกต์ Supabase แบบฟรีหยุดอัตโนมัติ (เรียกจาก .github/workflows/keepalive.yml ทุก 3 วัน) ----------
create or replace function public.ping() returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform 1 from public.schools limit 1;   -- แตะฐานข้อมูลจริง (ไม่เปิดเผยข้อมูลใด ๆ)
  return jsonb_build_object('ok', true, 'at', now());
end $$;
grant execute on function public.ping() to anon, authenticated;

-- ---------- หน้าสมัครใช้งาน (register.html): คำขอสั่งซื้อจากโรงเรียน ----------
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

-- ---------- สมัครใช้งานอัตโนมัติ (ตรวจสลิป + ออกรหัส) ----------

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
