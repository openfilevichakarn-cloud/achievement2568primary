-- =====================================================================
--  โปรแกรมแจ้งผลการเรียน หลักสูตร 2568 (เว็บ) — โครงสร้างฐานข้อมูล Supabase
--  วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run  (รันซ้ำได้ ไม่ทำให้ข้อมูลหาย)
--  หลักการ
--   * ตารางทั้งหมดเปิด RLS และไม่มี policy => เว็บ (anon key) อ่าน/เขียนตารางตรง ๆ ไม่ได้เลย
--   * เว็บเรียกได้เฉพาะ 3 ฟังก์ชัน: app_login / app_load / app_save โดยแนบ "รหัสสิทธิ์โรงเรียน"
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
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.school_data (
  school_id   uuid not null references public.schools(id) on delete cascade,
  grade       smallint not null check (grade between 1 and 6),
  data        jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (school_id, grade)
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
create or replace function public.app_login(p_code text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง หรือพยายามเข้าสู่ระบบผิดหลายครั้ง (รอ 10 นาทีแล้วลองใหม่)'); end if;
  return jsonb_build_object('ok', true, 'school_name', s.name, 'grades', to_jsonb(s.grades));
end $$;

create or replace function public.app_load(p_code text, p_grade smallint) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; d public.school_data;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if not (p_grade = any (s.grades)) then return jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้ไม่มีสิทธิ์ใช้งานชั้นนี้'); end if;
  select * into d from public.school_data where school_id = s.id and grade = p_grade;
  if not found then return jsonb_build_object('ok', true, 'data', null, 'version', 0); end if;
  return jsonb_build_object('ok', true, 'data', d.data, 'version', d.version);
end $$;

create or replace function public.app_save(p_code text, p_grade smallint, p_data jsonb, p_base_version integer, p_force boolean default false) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare s public.schools; cur integer; nv integer;
begin
  s := public._auth(p_code);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'รหัสสิทธิ์ไม่ถูกต้อง'); end if;
  if not (p_grade = any (s.grades)) then return jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้ไม่มีสิทธิ์ใช้งานชั้นนี้'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'error', 'รูปแบบข้อมูลไม่ถูกต้อง'); end if;
  if pg_column_size(p_data) > 3000000 then return jsonb_build_object('ok', false, 'error', 'ข้อมูลใหญ่เกินกำหนด (3 MB)'); end if;
  select version into cur from public.school_data where school_id = s.id and grade = p_grade for update;
  if not found then
    insert into public.school_data(school_id, grade, data, version) values (s.id, p_grade, p_data, 1)
    on conflict (school_id, grade) do nothing;
    if found then return jsonb_build_object('ok', true, 'version', 1); end if;
    select version into cur from public.school_data where school_id = s.id and grade = p_grade for update;
  end if;
  if cur <> coalesce(p_base_version, 0) and not coalesce(p_force, false) then
    return jsonb_build_object('ok', true, 'conflict', true, 'version', cur);
  end if;
  update public.school_data set data = p_data, version = cur + 1, updated_at = now()
   where school_id = s.id and grade = p_grade returning version into nv;
  return jsonb_build_object('ok', true, 'version', nv);
end $$;

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
  public.issue_school(text, smallint[]), public.reset_school_code(uuid),
  public.app_login(text), public.app_load(text, smallint), public.app_save(text, smallint, jsonb, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.app_login(text) to anon, authenticated;
grant execute on function public.app_load(text, smallint) to anon, authenticated;
grant execute on function public.app_save(text, smallint, jsonb, integer, boolean) to anon, authenticated;

-- =====================================================================
--  วิธีบริหารโรงเรียน (รันทีละคำสั่งใน SQL Editor)
-- =====================================================================
--  ออกสิทธิ์ ป.1 ให้โรงเรียนใหม่:     select public.issue_school('โรงเรียนบ้านตัวอย่าง');
--  ออกสิทธิ์ ป.1–ป.3:                select public.issue_school('โรงเรียนบ้านตัวอย่าง', '{1,2,3}');
--  ดูรายชื่อโรงเรียน:                select id, name, grades, active, created_at from public.schools order by created_at desc;
--  แก้ชื่อโรงเรียน (ล็อกฝั่งลูกค้า):   update public.schools set name = 'ชื่อใหม่' where id = '...';
--  เพิ่มชั้นที่ใช้ได้:                 update public.schools set grades = '{1,2,3,4,5,6}' where id = '...';
--  ออกรหัสใหม่ (รหัสเดิมใช้ไม่ได้):     select public.reset_school_code('...');
--  ระงับสิทธิ์:                       update public.schools set active = false where id = '...';
--  ดูว่าโรงเรียนไหนบันทึกล่าสุด:       select s.name, d.grade, d.version, d.updated_at from public.school_data d join public.schools s on s.id = d.school_id order by d.updated_at desc;
