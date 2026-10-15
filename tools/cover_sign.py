#!/usr/bin/env python3
"""ปก ปพ.5 (รายชั้น/รายวิชา ทุกเทอม): แถวลายเซ็น ครูประจำชั้น / หัวหน้างานวิชาการ / รองผู้อำนวยการ
จัดกึ่งกลางหน้ากระดาษ (รวมจุดไข่ปลา + ตำแหน่งไว้ในช่องเดียว กว้างเต็มแถวเหมือนบรรทัดผู้อำนวยการ)
  python3 tools/cover_sign.py data/p1.json      (รันก่อน fill_cache.js)
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8')); st = d['styles']
LABELS = ('ครูประจำชั้น/ครูที่ปรึกษา', 'หัวหน้างานวิชาการโรงเรียน', 'รองผู้อำนวยการโรงเรียน')
DOTS = '.' * 75
ctr = {}
def center(i):
    if i not in ctr:
        s = copy.deepcopy(st[i]); s['a'][0] = 'center'; s['a'][1] = 'center'; st.append(s); ctr[i] = len(st) - 1
    return ctr[i]
n = 0
for s in d['sheets']:
    if not s['name'].startswith('ปก ปพ.5'): continue
    cells = s['cells']
    # ความกว้างเต็มแถว = ช่วงเดียวกับบรรทัดชื่อผู้อำนวยการ
    full = next(m for m in s['merges'] for k, c in cells.items() if m.startswith(k + ':') and 'ผู้อำนวยการ"&' in (c.get('f') or ''))
    c0, c1 = re.fullmatch(r'([A-Z]+)\d+:([A-Z]+)\d+', full).groups()
    for k, c in list(cells.items()):
        if c.get('v') not in LABELS: continue
        r = re.fullmatch(r'[A-Z]+(\d+)', k)[1]
        if f'{c0}{r}:{c1}{r}' in s['merges']: continue
        label = c['v']
        s['merges'] = [m for m in s['merges'] if not re.fullmatch(rf'[A-Z]+{r}:[A-Z]+{r}', m)]
        for kk in [kk for kk in cells if re.fullmatch(rf'[A-Z]+{r}', kk)]:
            cells[kk] = {'s': cells[kk]['s']} if cells[kk].get('s') is not None else {}
        cells[c0 + r] = {'s': center(c['s']), 'v': f'{DOTS} {label}'}
        s['merges'].append(f'{c0}{r}:{c1}{r}'); n += 1
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', n, 'rows', path)
