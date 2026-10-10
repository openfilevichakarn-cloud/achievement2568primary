/* ตั้งค่าการเชื่อมต่อ Supabase
 * 1) Supabase > Project Settings > API : คัดลอก "Project URL" และ "anon public key" มาใส่
 * 2) ถ้าเว้นว่าง เว็บจะทำงานใน "โหมดทดลอง" (เก็บข้อมูลในเบราว์เซอร์เครื่องนี้ ใช้รหัส DEMO) — ห้ามใช้ขายจริง
 * anon key ออกแบบมาให้เปิดเผยในเว็บได้ ความปลอดภัยอยู่ที่ RLS + ฟังก์ชันใน sql/schema.sql  */
window.PP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  BUILD: '1',
};
