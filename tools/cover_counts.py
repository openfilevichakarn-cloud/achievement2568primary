#!/usr/bin/env python3
"""ปก ปพ.5 รายวิชา (ทุกเทอม): จำนวนนักเรียน ชาย / หญิง / รวม — แยกเป็น 3 ช่อง (ป้าย | ตัวเลข | คน) ให้ตรงกันทุกแถว
เดิม: ช่องรวม 3 คอลัมน์ข้อความเดียว "ชาย 20 คน" จัดกึ่งกลาง ตำแหน่งเลื่อนตามความยาวตัวเลข
  python3 tools/cover_counts.py data/p1.json      (รันก่อน fill_cache.js)
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8')); st = d['styles']
def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n
def n2col(n):
    s = ''
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s
cache = {}
def align(i, h):
    if (i, h) not in cache:
        s = copy.deepcopy(st[i]); s['a'][0] = h; s['a'][1] = 'center'; st.append(s); cache[(i, h)] = len(st) - 1
    return cache[(i, h)]
PAT = re.compile(r'^"(ชาย|หญิง|รวม) "&(.+?)\s*&\s*" คน "$')
n = 0
for s in d['sheets']:
    if not s['name'].startswith('ปก ปพ.5 รายวิชา'): continue
    cells = s['cells']
    for k, c in list(cells.items()):
        m = PAT.match(c.get('f') or '')
        if not m: continue
        a = re.fullmatch(r'([A-Z]+)(\d+)', k); c0, r = col2n(a[1]), a[2]
        mg = next((x for x in s['merges'] if x.startswith(k + ':')), None)
        if not mg: continue
        c2 = col2n(re.fullmatch(r'[A-Z]+\d+:([A-Z]+)\d+', mg)[1])
        if c2 - c0 != 2: continue
        sty = c['s']
        s['merges'].remove(mg)
        cells[k] = {'s': align(sty, 'right'), 'v': m[1]}
        cells[n2col(c0 + 1) + r] = {'s': align(sty, 'center'), 'f': m[2].strip()}
        cells[n2col(c0 + 2) + r] = {'s': align(sty, 'left'), 'v': 'คน'}
        n += 1
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('split', n, 'cells', path)
