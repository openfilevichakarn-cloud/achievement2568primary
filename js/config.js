/* ตั้งค่าการเชื่อมต่อ Supabase
 * 1) Supabase > Project Settings > API : คัดลอก "Project URL" และ "anon public key" มาใส่
 * 2) ถ้าเว้นว่าง เว็บจะทำงานใน "โหมดทดลอง" (เก็บข้อมูลในเบราว์เซอร์เครื่องนี้ ใช้รหัส DEMO) — ห้ามใช้ขายจริง
 * anon key ออกแบบมาให้เปิดเผยในเว็บได้ ความปลอดภัยอยู่ที่ RLS + ฟังก์ชันใน sql/schema.sql  */
window.PP_CONFIG = {
  SUPABASE_URL: 'https://htyytgkpufyhythcbofq.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0eXl0Z2twdWZ5aHl0aGNib2ZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTc1NjcsImV4cCI6MjEwNzAzMzU2N30.FvV_iWfzuUdJlrMIHz-DrmZAhjS-XNzevK3bbtu2xIM',
  BUILD: '1',
  GRADES_READY: [1, 2, 3, 4, 5, 6],   // ชั้นที่มีข้อมูลโปรแกรมแล้ว (data/pN.json)
  // ---- หน้าสมัครใช้งาน (register.html) — แก้ข้อมูลการขายได้ที่นี่ ----
  SALES: {
    DEMO_URL: '',            // ลิงก์เว็บตัวอย่าง (โฟลเดอร์ demo/) เช่น 'https://xxx.github.io/achievement2568primary/demo/' — เว้นว่าง = ใช้ 'demo/'
    FACEBOOK: 'https://www.facebook.com/filevichakan/',
    LINE_ID: '',             // เช่น '@filevichakan' — เว้นว่าง = ไม่แสดง
    PHONE: '',               // เช่น '08x-xxx-xxxx' — เว้นว่าง = ไม่แสดง
    // แพ็กเกจราคา — เว้นว่าง [] = แสดง "ติดต่อสอบถามราคา"
    // ตัวอย่าง: { name: 'รายชั้น', price: 'xxx บาท', unit: '/ ชั้น / ปีการศึกษา', items: ['ใช้ได้ทุกห้องในชั้นนั้น', '...'], hot: false }
    PACKAGES: [],
    BANK: null,              // ตัวอย่าง: { bank: 'ธนาคาร...', name: 'ชื่อบัญชี', no: 'xxx-x-xxxxx-x' } — แสดงหลังส่งแบบฟอร์ม
  },
};
