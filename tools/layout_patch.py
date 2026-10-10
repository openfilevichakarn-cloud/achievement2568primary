#!/usr/bin/env python3
"""ปรับหน้าตาเอกสาร ปพ.5 (ปก) และ ปพ.6 ฉบับเว็บ — รันหลัง extract_xlsx.py
  python3 tools/layout_patch.py data/p1.json
- ฟอนต์ TH Sarabun New 16 ทั้งเอกสาร, พอดี 1 หน้า A4
- ความสูงแถวที่มีข้อความขั้นต่ำ 24pt (ไม่ให้ตัวอักษรไทยโดนตัด)
- ปพ.6: ตัวเลข/% อยู่แนวกลางเดียวกัน, 'กิจกรรมพัฒนาผู้เรียน/คุณลักษณะอันพึงประสงค์' ชิดซ้าย-กึ่งกลางแนวตั้ง
- ปก ปพ.5: ช่องสี่เหลี่ยม อนุมัติ/ไม่อนุมัติ อยู่กึ่งกลางแนวตั้งของข้อความ, ชื่อวิชาไม่ตัดบรรทัด (ขยายคอลัมน์อัตโนมัติ)
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
styles = d['styles']; cache = {}
def variant(i, **kw):
    key = (i, tuple(sorted(kw.items())))
    if key in cache: return cache[key]
    s = copy.deepcopy(styles[i])
    if 'size' in kw: s['f'][0] = 'TH Sarabun New'; s['f'][1] = kw['size']
    if 'h' in kw: s['a'][0] = kw['h']
    if 'v' in kw: s['a'][1] = kw['v']
    if 'wrap' in kw: s['a'][2] = kw['wrap']
    styles.append(s); cache[key] = len(styles) - 1
    return cache[key]
def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n
def n2col(n):
    s = ''
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s
def split(k):
    m = re.fullmatch(r'([A-Z]+)(\d+)', k); return m[1], int(m[2])
def restyle(cells, k, **kw):
    if k in cells: cells[k]['s'] = variant(cells[k]['s'], **kw)

for s in d['sheets']:
    n = s['name']
    cover = n.startswith('ปก ปพ.5')
    p6 = bool(re.match(r'^ปพ\.6 (ป\.\d+ ?(รวม|เทอม[12])|ประถมตอน(ต้น|ปลาย))$', n))   # รวมหน้าสรุปประถมตอนต้น/ตอนปลาย (ป.3/ป.6)
    if not (cover or p6): continue
    cells = s['cells']
    # 1) ฟอนต์ 16
    for k, c in cells.items():
        if c['s'] is not None and styles[c['s']]['f'][1] != 16:
            c['s'] = variant(c['s'], size=16)
    # 2) ความสูงแถวขั้นต่ำ (เฉพาะแถวที่มีข้อความ)
    m = re.match(r".*!\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)", s['print']['area'] or '')
    r1, r2 = (int(m[1]), int(m[2])) if m else (1, s['dim'][0])
    for r in range(r1, r2 + 1):
        has = any(split(k)[1] == r and ('v' in c or 'f' in c) for k, c in cells.items())
        e = s['rh'].get(str(r)) or {}
        h = e.get('h') or s['drh']
        if has and h < 24 and not e.get('x'):
            s['rh'][str(r)] = {**e, 'h': 24.0, 'x': e.get('x', 0)}
    # 3) พอดี 1 หน้า A4
    s['print']['fitPage'] = 1; s['print']['fw'] = 1; s['print']['fh'] = 1; s['print']['hc'] = 1
    if p6:
        for k, c in list(cells.items()):
            v = c.get('v'); col, r = split(k)
            if v == '%':      # ตัวเลขการเข้าชั้นเรียน, % และข้อความทั้งแถว อยู่แนวกลางเดียวกัน
                restyle(cells, k, v='center', h='left')
                for kk in [x for x in cells if split(x)[1] == r and x != k]:
                    restyle(cells, kk, v='center')
            if v in ('กิจกรรมพัฒนาผู้เรียน', 'คุณลักษณะอันพึงประสงค์'):   # กลางซ้าย
                restyle(cells, k, h='left', v='center')
                restyle(cells, n2col(col2n(col) + 1) + str(r), v='center')
    if n.startswith('ปพ.6 ประถมตอน'):   # หน้าสรุปประถมตอนต้น/ปลาย: ชื่อความสามารถยาว ให้ตัดบรรทัดได้
        for k, c in cells.items():
            col, r = split(k)
            if col in ('A', 'B') and 5 <= r <= 12 and isinstance(c.get('v'), str) and c['s'] is not None:
                c['s'] = variant(c['s'], wrap=1)
    if cover:
        shapes = []
        marks = [(k, c['v']) for k, c in cells.items() if c.get('v') in ('อนุมัติ', 'ไม่อนุมัติ')]
        for k, v in marks:
            restyle(cells, k, h='left', v='center')
            shapes.append({'rel': {'cell': k, 'dx': -8, 'w': 24, 'h': 24}, 'g': 'rect', 'fill': '#FFFFFF', 'line': '#000000', 'lw': 1.5})
        if marks: s['shapes'] = shapes
        # ชื่อวิชาไม่ตัดบรรทัด: ขยายคอลัมน์ให้พอ
        if 'รายชั้น' in n:
            s['fit'] = [{'ref': 'D16:D35', 'cols': [4]}]
        else:
            s['fit'] = [{'ref': 'F6', 'cols': [6, 7, 8]}]
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', path, 'styles', len(styles))
