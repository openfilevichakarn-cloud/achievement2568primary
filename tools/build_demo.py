#!/usr/bin/env python3
"""สร้าง "เว็บตัวอย่าง" (ให้ลูกค้าทดลองก่อนตัดสินใจ) แยกจากเว็บขายจริง ไว้ในโฟลเดอร์ demo/
  python3 tools/build_demo.py              # คัดลอกโปรแกรมล่าสุด + ตั้งค่าโหมดตัวอย่าง
  node tools/make_demo_sample.js           # สร้างข้อมูลนักเรียนสมมติ 40 คน ทุกชั้น -> demo/sample/pN.json

demo/ ใช้งานได้ด้วยตัวเอง (deploy เป็นเว็บแยกได้ทันที เช่น ตั้ง publish directory = demo)
- ไม่เชื่อม Supabase (ไม่มีกุญแจ ไม่แตะข้อมูลโรงเรียนจริง) การแก้ไขเก็บในเบราว์เซอร์ของผู้ทดลองเท่านั้น
- มีลายน้ำทุกหน้าจอและทุกหน้าที่พิมพ์ / ไม่มีหน้าผู้ดูแลระบบ
รันใหม่ทุกครั้งที่แก้โปรแกรมหลัก (ข้อมูลตัวอย่างใน demo/sample ไม่ถูกลบ)
"""
import os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'demo')
os.makedirs(OUT, exist_ok=True)

for d in ('js', 'css', 'fonts', 'img', 'data'):
    shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d))
os.remove(os.path.join(OUT, 'js', 'admin.js'))
os.remove(os.path.join(OUT, 'css', 'admin.css'))

src = open(os.path.join(ROOT, 'js', 'config.js'), encoding='utf-8').read()
grades = re.search(r'GRADES_READY:\s*(\[[^\]]*\])', src)[1]
build = re.search(r"js/app\.js\?v=(\w+)", open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read())[1]
open(os.path.join(OUT, 'js', 'config.js'), 'w', encoding='utf-8').write(f"""/* เว็บตัวอย่าง — สร้างโดย tools/build_demo.py (อย่าแก้ไฟล์นี้โดยตรง)
 * ไม่เชื่อมต่อ Supabase: ข้อมูลตัวอย่างโหลดจาก sample/ และการแก้ไขเก็บในเบราว์เซอร์เท่านั้น */
window.PP_CONFIG = {{
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  BUILD: '{build}',
  GRADES_READY: {grades},
  SAMPLE_DIR: 'sample',
  DEMO_SCHOOL: 'โรงเรียนสาธิตตัวอย่าง (เว็บทดลอง)',
  WATERMARK: 'ตัวอย่าง · ห้ามใช้งานจริง',
}};
""")

html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
html = html.replace('<title>โปรแกรมแจ้งผลการศึกษา ปพ.5 และ ปพ.6</title>',
                    '<title>ทดลองใช้ — โปรแกรมแจ้งผลการศึกษา ปพ.5 และ ปพ.6</title>\n<meta name="robots" content="noindex">')
html = re.sub(r'<p class="lead">.*?</p>', '<p class="lead">ทดลองใช้งานโปรแกรมได้ทุกเมนู พร้อมข้อมูลตัวอย่างครบทุกชั้น เพื่อประกอบการตัดสินใจก่อนสั่งซื้อ</p>', html, flags=re.S)
html = html.replace('<a href="register.html">ดูรายละเอียดและสมัครใช้งาน</a>', '<a href="../register.html">ดูรายละเอียดและสั่งซื้อ</a>')   # เว็บตัวอย่างอยู่ในโฟลเดอร์ demo/ ของเว็บจริง
html = html.replace('<script src="js/config.js"></script>', f'<script src="js/config.js?v={build}"></script>')
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)
print('built', OUT)
