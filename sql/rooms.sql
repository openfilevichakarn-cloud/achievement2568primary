-- =====================================================================
--  อัปเกรดฐานข้อมูลเดิม -> รองรับหลายห้องต่อชั้น (ป.1/1 ... ป.1/10) และตราโรงเรียนที่เดียว
--  วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run (รันครั้งเดียว รันซ้ำได้ ข้อมูลไม่หาย)
--  ข้อมูลเดิมของแต่ละชั้นจะกลายเป็นห้อง 1 (เช่น ป.1 เดิม -> ป.1/1)
--  * ควรรันพร้อมกับการอัปเดตเว็บ (เว็บเวอร์ชันเก่าจะบันทึกไม่ได้หลังรันไฟล์นี้)
-- =====================================================================
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
