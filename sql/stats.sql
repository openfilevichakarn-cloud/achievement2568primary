-- =====================================================================
--  สถิติผู้เข้าชมหน้า register.html (แสดงท้ายหน้า)
--  วิธีใช้: Supabase > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้) — รวมอยู่ใน schema.sql แล้ว
--  นับ 1 ครั้งต่อการเปิดเบราว์เซอร์ 1 รอบ (เว็บกันนับซ้ำเมื่อรีเฟรช) · แยกตามวัน (เวลาประเทศไทย)
-- =====================================================================
create table if not exists public.page_views (
  page  text not null,
  day   date not null,
  n     integer not null default 0,
  primary key (page, day)
);
alter table public.page_views enable row level security;
revoke all on public.page_views from anon, authenticated;

-- p_hit = true: นับเพิ่ม 1 แล้วคืนสถิติ · false: อ่านอย่างเดียว
create or replace function public.page_hit(p_page text, p_hit boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Bangkok')::date; pg text := left(coalesce(nullif(btrim(p_page), ''), 'register'), 40);
begin
  if pg !~ '^[a-z0-9_-]+$' then pg := 'register'; end if;
  if p_hit then
    insert into public.page_views(page, day, n) values (pg, d, 1)
    on conflict (page, day) do update set n = public.page_views.n + 1;
  end if;
  return jsonb_build_object(
    'today', coalesce((select n from public.page_views where page = pg and day = d), 0),
    'yesterday', coalesce((select n from public.page_views where page = pg and day = d - 1), 0),
    'month', coalesce((select sum(n) from public.page_views where page = pg and day >= date_trunc('month', d)::date), 0),
    'total', coalesce((select sum(n) from public.page_views where page = pg), 0));
end $$;
revoke all on function public.page_hit(text, boolean) from public, anon, authenticated;
grant execute on function public.page_hit(text, boolean) to anon, authenticated;
