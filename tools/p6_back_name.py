#!/usr/bin/env python3
"""ปพ.6 หน้าหลัง (ป.N-2 / เทอม1 / เทอม2 / ประถมตอนต้น-ตอนปลาย): คอลัมน์ "พฤติกรรมของนักเรียน"
ขึ้นต้นด้วยชื่อนักเรียนที่เลือกไว้ (บรรทัดแรก) แล้วตามด้วยคำอธิบายพฤติกรรม
  python3 tools/p6_back_name.py data/p1.json && node tools/fill_cache.js data/p1.json      (รันซ้ำได้)
"""
import json, re, sys
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
names = {s['name'] for s in d['sheets']}
def front(back):
    m = re.fullmatch(r'ป\.(\d)-2(?: (.+))?', back)
    if not m: return None
    g, tail = m.groups()
    f = f'ปพ.6 ป.{g}รวม' if not tail else f'ปพ.6 {tail}' if tail.startswith('ประถม') else f'ปพ.6 ป.{g} {tail}'
    return f if f in names else None
n = 0
for s in d['sheets']:
    fr = front(s['name'])
    if not fr: continue
    hdr = next((k for k, c in s['cells'].items() if c.get('v') == 'พฤติกรรมของนักเรียน'), None)
    if not hdr: continue
    col, r0 = re.fullmatch(r'([A-Z]+)(\d+)', hdr).groups()
    nm = f"'{fr}'!$B$3"
    for k, c in s['cells'].items():
        m = re.fullmatch(rf'{col}(\d+)', k)
        if not m or int(m[1]) <= int(r0) or not c.get('f') or 'CHAR(10)' in c['f'] or 'ค่าพฤติกรรม' not in c['f']: continue
        x = c['f']
        c['f'] = f'IF(OR({x}="",{nm}=""),{x},{nm}&CHAR(10)&{x})'
        c.pop('c', None); n += 1
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('behaviour cells with student name:', n, path)
