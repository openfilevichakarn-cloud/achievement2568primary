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
      'saves', coalesce((select jsonb_agg(jsonb_build_object('grade', d.grade, 'version', d.version, 'updated_at', d.updated_at) order by d.grade)
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
--  ดูว่าโรงเรียนไหนบันทึกล่าสุด:       select s.name, d.grade, d.version, d.updated_at from public.school_data d join public.schools s on s.id = d.school_id order by d.updated_at desc;
