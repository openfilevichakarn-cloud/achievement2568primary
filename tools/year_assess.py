#!/usr/bin/env python3
"""เพิ่มชีท 'คุณลักษณะ รวม' และ 'กิจกรรมพัฒนาผู้เรียน รวม' (ผลทั้งปี คำนวณจากเทอม 1 + เทอม 2)  (รันหลัง flex_items.py)
  python3 tools/year_assess.py data/p1.json && node tools/fill_cache.js data/p1.json

ผลรายหัวข้อทั้งปี: มี 'ไม่ผ่าน' เทอมใดเทอมหนึ่ง = ไม่ผ่าน, ผ่านทั้ง 2 เทอม = ผ่าน, ยังประเมินไม่ครบ = ว่าง
ช่องสรุป: สูตรเดียวกับชีทเทอม (ผ่านทุกหัวข้อ)
ปก ปพ.5 (รายชั้น/รายวิชา) รวม: สรุปคุณลักษณะ/กิจกรรมเปลี่ยนจากอ้างเทอม 2 มาอ้างชีททั้งปี
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
S = {s['name']: s for s in d['sheets']}
if any(s['name'].endswith(' รวม') and s['name'].startswith('คุณลักษณะ') for s in d['sheets']):
    sys.exit('already patched')

def n2col(n):
    s = ''
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s

for prefix, title in (('คุณลักษณะ', 'แบบประเมินคุณลักษณะอันพึงประสงค์ ทั้งปีการศึกษา'),
                      ('กิจกรรมพัฒนาผู้เรียน', 'แบบประเมินกิจกรรมพัฒนาผู้เรียน ทั้งปีการศึกษา')):
    t2 = S[f'{prefix} เทอม2']
    y = copy.deepcopy(t2); name = f'{prefix} รวม'; y['name'] = name
    c0, c1 = y['flex']['items']; cs = y['flex']['sum']
    t1n, t2n = f"'{prefix} เทอม1'", f"'{prefix} เทอม2'"
    y['cells']['A1'] = {**y['cells']['A1'], 'v': title}
    for r in range(4, y['dim'][0] + 1):
        for c in range(c0, c1 + 1):
            k = n2col(c) + str(r); cell = y['cells'].get(k)
            if cell is None: continue
            a, b = f'{t1n}!{k}', f'{t2n}!{k}'
            y['cells'][k] = {'s': cell['s'], 'f': f'IF(OR({a}="ไม่ผ่าน",{b}="ไม่ผ่าน"),"ไม่ผ่าน",IF(AND({a}="ผ่าน",{b}="ผ่าน"),"ผ่าน",""))'}
        sk = n2col(cs) + str(r)
        if sk in y['cells']: y['cells'][sk].pop('c', None)
    y['dv'] = []
    y['flex'] = {**y['flex'], 'year': 1}
    d['sheets'].insert(d['sheets'].index(t2) + 1, y)
    S[name] = y
    # ปก ปพ.5 รวม -> อ้างชีททั้งปี
    for cov in ('ปก ปพ.5 รายชั้น รวม', 'ปก ปพ.5 รายวิชา รวม'):
        for cell in S[cov]['cells'].values():
            f = cell.get('f')
            if f and f'{prefix} เทอม2' in f: cell['f'] = f.replace(f"'{prefix} เทอม2'", f"'{name}'"); cell.pop('c', None)

json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', path)
