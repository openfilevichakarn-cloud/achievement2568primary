#!/usr/bin/env python3
"""ล้างข้อมูลทดสอบที่ติดมาจากไฟล์ Excel ต้นฉบับ ให้โรงเรียนใหม่เริ่มจากต้นแบบว่าง  (รันหลัง score_print.py / cover_sign.py)
  python3 tools/clear_sample.py data/p1.json && node tools/fill_cache.js data/p1.json
ล้าง: รายชื่อ/เพศ/การมาเรียน, คะแนนนักเรียนทุกวิชา, ผลคุณลักษณะ/กิจกรรม, รหัสวิชา/เวลาเรียน/กลุ่มสาระ/ครูประจำวิชา,
      นักเรียนที่เลือกในหน้า ปพ.6  — ค่าแคชสูตรทั้งหมดถูกลบเพื่อคำนวณใหม่ด้วย fill_cache.js
คงไว้: คะแนนเต็ม ชื่อวิชา ความสามารถ หัวข้อประเมิน ข้อความ 'กรุณากรอก...' ในข้อมูลพื้นฐาน
"""
import json, re, sys
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n
def clear(s, rows, cols):
    n = 0
    for k, c in s['cells'].items():
        m = re.fullmatch(r'([A-Z]+)(\d+)', k)
        if 'v' in c and not c.get('f') and int(m[2]) in rows and col2n(m[1]) in cols: del c['v']; n += 1
    return n
n = 0
for s in d['sheets']:
    nm = s['name']
    if re.match(r'^ข้อมูลป\.\d+$', nm): n += clear(s, range(3, 43), range(2, 5))
    elif re.match(r'^คะแนนรายวิชา \d+$', nm): n += clear(s, range(6, 46), range(3, 34))
    elif s.get('flex', {}).get('items'): n += clear(s, range(4, 44), range(3, s['flex']['items'][1] + 1))
    elif nm == 'รายวิชา': n += clear(s, range(5, 25), (2, 4, 5, 6))
    elif re.match(r'^ปพ\.6 ป\.\d+รวม$', nm): n += clear(s, (3,), (2,))
# ปพ.6: ยังไม่มีนักเรียน -> การเข้าชั้นเรียนแสดงว่าง (ไม่ใช่ #N/A)
for s in d['sheets']:
    for k, c in s['cells'].items():
        f = c.get('f') or ''
        if s['name'].startswith('ปพ.6') and f.startswith('VLOOKUP(') and 'ข้อมูลป.' in f: c['f'] = f'IFERROR({f},"")'
for s in d['sheets']:
    for c in s['cells'].values():
        if c.get('f'): c.pop('c', None)
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('cleared', n, 'values', path)
