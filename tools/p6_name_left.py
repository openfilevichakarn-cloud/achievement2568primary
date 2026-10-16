#!/usr/bin/env python3
"""ปพ.6 ทุกหน้า (เทอม 1 / เทอม 2 / รวม / ประถมตอนต้น-ตอนปลาย): ป้าย "ชื่อ - สกุล" (A3) และชื่อนักเรียน (B3) ชิดซ้าย
  python3 tools/p6_name_left.py data/p1.json      (รันซ้ำได้)
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8')); st = d['styles']
left = {}
def to_left(i):
    if st[i]['a'][0] == 'left': return i
    if i not in left:
        s = copy.deepcopy(st[i]); s['a'][0] = 'left'; st.append(s); left[i] = len(st) - 1
    return left[i]
n = 0
for s in d['sheets']:
    if not re.match(r'^ปพ\.6 ', s['name']): continue
    for k in ('A3', 'B3'):
        c = s['cells'].get(k)
        if c and c.get('s') is not None:
            new = to_left(c['s'])
            if new != c['s']: c['s'] = new; n += 1
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('left-aligned', n, 'cells', path)
