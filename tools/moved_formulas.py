#!/usr/bin/env python3
"""นักเรียนย้ายออกระหว่างเทอม 2 (ช่องเทอม 2 เป็น "ย้าย" แต่คะแนนเทอม 1 คงไว้): ผลทั้งปีต้องเป็นค่าว่าง ไม่นำมาคำนวณ
  - คะแนนรายวิชา N: รวมทั้งปี (AC) = "" ถ้าคะแนนสอบเทอม 2 (AA) เป็น "ย้าย"
  - คุณลักษณะ รวม (O) / กิจกรรมพัฒนาผู้เรียน รวม (K) = "" ถ้าหัวข้อแรกของเทอม 2 เป็น "ย้าย"
  python3 tools/moved_formulas.py data/p1.json && node tools/fill_cache.js data/p1.json      (รันซ้ำได้)
"""
import json, re, sys
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
TAG = '="ย้าย","",'
n = 0
def wrap(c, cond):
    global n
    if not c or not c.get('f') or TAG in c['f']: return
    c['f'] = f'IF({cond}{TAG}{c["f"]})'; c.pop('c', None); n += 1
for s in d['sheets']:
    nm, cells = s['name'], s['cells']
    if re.fullmatch(r'คะแนนรายวิชา \d+', nm):
        for k, c in cells.items():
            m = re.fullmatch(r'AC(\d+)', k)
            if m and 6 <= int(m[1]) <= 45 and 'SUM(O' in (c.get('f') or ''): wrap(c, f'$AA{m[1]}')
    for base, col in (('คุณลักษณะ', 'O'), ('กิจกรรมพัฒนาผู้เรียน', 'K')):
        if nm == base + ' รวม':
            for k, c in cells.items():
                m = re.fullmatch(col + r'(\d+)', k)
                if m and 4 <= int(m[1]) <= 43 and 'COUNTIF' in (c.get('f') or ''): wrap(c, f"'{base} เทอม2'!$C${m[1]}")
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('moved-student year formulas:', n, path)
