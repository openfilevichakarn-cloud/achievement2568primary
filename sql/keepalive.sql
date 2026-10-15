-- กันโปรเจกต์ Supabase แบบฟรีหยุดอัตโนมัติเมื่อไม่มีการใช้งาน 7 วัน
-- รันครั้งเดียวใน Supabase > SQL Editor (รวมอยู่ใน schema.sql แล้ว ถ้ารัน schema.sql ใหม่ทั้งไฟล์ไม่ต้องรันไฟล์นี้)
-- ใช้คู่กับ .github/workflows/keepalive.yml ที่เรียกฟังก์ชันนี้ทุก 3 วัน
create or replace function public.ping() returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform 1 from public.schools limit 1;   -- แตะฐานข้อมูลจริง (ไม่เปิดเผยข้อมูลใด ๆ)
  return jsonb_build_object('ok', true, 'at', now());
end $$;
grant execute on function public.ping() to anon, authenticated;
