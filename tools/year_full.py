#!/usr/bin/env python3
"""ปพ.6 รวม (ทั้งปี) + ค่า ป.N: คะแนนเต็มรายวิชา (คอลัมน์ F) เดิมกำหนดตายตัว 100 — เปลี่ยนเป็นคะแนนเต็มทั้งปีจริงของวิชานั้น
('คะแนนรายวิชา N'!AC4 = เต็มเทอม 1 + เต็มเทอม 2) เหมือนชีทเทอม 1/2 ที่อ่าน O4 / AB4 อยู่แล้ว
ทำให้โรงเรียนที่เก็บคะแนนเทอมละ 50 (ปีละ 100) หรือเทอมละ 100 (ปีละ 200) หรือค่าอื่น คำนวณระดับความสามารถถูกต้อง
  python3 tools/year_full.py data/p1.json && node tools/fill_cache.js data/p1.json
"""
import json, re, sys
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
n = 0
for s in d['sheets']:
    if not re.match(r'^ปพ\.6 ป\.\d+ ?รวม$', s['name']): continue
    for k, c in s['cells'].items():
        m = re.fullmatch(r'IF\((E\d+)<>"",100,""\)', c.get('f') or '')
        if not m: continue
        e = m[1]
        c['f'] = f'IF({e}="","",IFERROR(INDIRECT("\'คะแนนรายวิชา "&MATCH({e},ข้อมูลวิชา!$A$2:$A$21,0)&"\'!$AC$4"),""))'
        c.pop('c', None); n += 1
# ค่า ป.N (ค่าเฉลี่ยของความสามารถแต่ละข้อ ใช้ตัดสินระดับใน ปพ.6 รวม): เดิมเฉลี่ย "คะแนนดิบ" (ถูกเฉพาะเต็ม 100)
# -> เฉลี่ย "ร้อยละ" (ได้ ÷ เต็ม × 100) แบบเดียวกับชีทเทอม — ถ้าเต็ม 100 ผลเท่าเดิมทุกกรณี
for s in d['sheets']:
    if not re.match(r'^ค่า ป\.\d+$', s['name']): continue
    for k, c in s['cells'].items():
        m = re.fullmatch(r"IF\(COUNT\('([^']+)'!G(\d+):G(\d+)\)=0,\"\",SUM\('[^']+'!G\d+:G\d+\)/COUNT\('[^']+'!G\d+:G\d+\)\)", c.get('f') or '')
        if not m: continue
        sh, r0, r1 = m[1], int(m[2]), int(m[3])
        pct = '+'.join(f"IFERROR('{sh}'!G{r}/'{sh}'!F{r},0)" for r in range(r0, r1 + 1))
        c['f'] = f"IF(COUNT('{sh}'!G{r0}:G{r1})=0,\"\",ROUND(({pct})/COUNT('{sh}'!G{r0}:G{r1})*100,6))"
        c.pop('c', None); n += 1
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', n, 'cells', path)
