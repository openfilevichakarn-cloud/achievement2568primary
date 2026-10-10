#!/usr/bin/env python3
"""ปรับให้ตั้งชื่อ/เพิ่ม-ลดหัวข้อได้  (รันหลัง add_indicator_cols.py)
  python3 tools/flex_items.py data/p1.json

1) ปก ปพ.5 รายวิชา (เทอม1/เทอม2/รวม): 'กลุ่มสาระการเรียนรู้' ชิดซ้าย, 'ครูประจำวิชา' ชิดซ้ายตรงกับ 'รหัสวิชา'
2) คุณลักษณะ / กิจกรรมพัฒนาผู้เรียน: หัวข้อได้สูงสุด 12 / 8 ข้อ (ช่องสรุปย้ายไปท้าย O / K)
   ชื่อหัวข้ออยู่แถว 3 ของชีทเทอม1 (เทอม2 อ้างจากเทอม1) — หัวข้อที่ชื่อว่าง = ไม่ใช้ (ซ่อนในเอกสาร)
3) ชีทคะแนนรายวิชา: ตั้งชื่อตัวชี้วัดได้ เก็บที่แถว 47 ของคอลัมน์ตัวชี้วัด (นอกพื้นที่แสดงผล)
4) ความสามารถชั้นปี: ชื่ออยู่ที่ ปพ.6 รวม!I6:I13 (8 ช่อง) ข้อความในคอลัมน์ A ของ ปพ.6 ทุกชีทเป็นสูตรจากชื่อนั้น
   ความสามารถที่ชื่อว่าง = ไม่ใช้
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
S = {s['name']: s for s in d['sheets']}
styles = d['styles']
if any(s.get('flex') for s in d['sheets']):
    sys.exit('already patched')

def col2n(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n
def n2col(n):
    s = ''
    while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
    return s
def split(k):
    m = re.fullmatch(r'([A-Z]+)(\d+)', k); return col2n(m[1]), int(m[2])
cache = {}
def align(i, h=None, v=None):
    key = (i, h, v)
    if key not in cache:
        s = copy.deepcopy(styles[i])
        if h: s['a'][0] = h
        if v: s['a'][1] = v
        styles.append(s); cache[key] = len(styles) - 1
    return cache[key]

# ---------------------------------------------------------------- 1) ปก ปพ.5 รายวิชา
for n in ('ปก ปพ.5 รายวิชา เทอม1', 'ปก ปพ.5 รายวิชา เทอม2', 'ปก ปพ.5 รายวิชา รวม'):
    c = S[n]['cells']
    c['B7']['s'] = align(c['B7']['s'], h='left')
    c['I8']['s'] = align(c['I8']['s'], h='left')

# ---------------------------------------------------------------- 2) คุณลักษณะ / กิจกรรม
def flex_assess(prefix, old_sum, new_sum):
    o, nw = col2n(old_sum), col2n(new_sum)
    last_item = o - 1
    mapc = lambda c: nw if c == o else c
    for t in (1, 2):
        s = S[f'{prefix} เทอม{t}']; cells = {}
        for k, c in s['cells'].items():
            cn, r = split(k)
            if cn > o: continue
            cells[n2col(mapc(cn)) + str(r)] = c
        rows = s['dim'][0]
        for r in range(1, rows + 1):                     # ช่องหัวข้อใหม่: รูปแบบเดียวกับหัวข้อสุดท้ายเดิม
            src = s['cells'].get(n2col(last_item) + str(r))
            if src is None: continue
            for cn in range(o, nw):
                cells[n2col(cn) + str(r)] = {'s': src['s'], **({'u': 1} if src.get('u') else {})}
        rng = lambda r: f'C{r}:{n2col(nw - 1)}{r}'
        for r in range(4, rows + 1):
            sc = cells.get(new_sum + str(r))
            if sc and sc.get('f'):
                sc['f'] = f'IF(COUNTIF({rng(r)},"ผ่าน")+COUNTIF({rng(r)},"ไม่ผ่าน")=0,"",IF(COUNTIF({rng(r)},"ไม่ผ่าน")=0,"ผ่าน","ไม่ผ่าน"))'
        # ชื่อหัวข้อ: เทอม 2 ใช้ชื่อจากเทอม 1
        if t == 2:
            for cn in range(3, nw):
                k = n2col(cn) + '3'; v = cells[k].pop('v', None)
                cells[k]['f'] = f"IF('{prefix} เทอม1'!{k}=\"\",\"\",'{prefix} เทอม1'!{k})"
                if v is not None: cells[k]['c'] = v
        # แถว 2: ชื่อโรงเรียน + ครูประจำชั้น รวมไว้ช่องเดียว (ไม่หายเมื่อซ่อนคอลัมน์หัวข้อ)
        school = next(k for k, c in cells.items() if split(k)[1] == 2 and c.get('f') == 'ข้อมูลพื้นฐาน!B3')
        teacher = next(k for k, c in cells.items() if split(k)[1] == 2 and 'ครูประจำชั้น' in (c.get('f') or ''))
        st2 = cells[school]['s']
        for k in [k for k in cells if split(k)[1] == 2 and split(k)[0] >= 3]: cells[k] = {'s': cells[k]['s']}
        cls = next(m for m in s['merges'] if m.startswith('A2:'))          # ช่องชั้น/ปีการศึกษา (A2:..)
        c0 = n2col(col2n(re.match(r'A2:([A-Z]+)2', cls)[1]) + 1)
        info = S['ข้อมูลพื้นฐาน']['cells']; iv = lambda k: str(info.get(k, {}).get('v', info.get(k, {}).get('c', '')) or '')
        cells[c0 + '2'] = {'s': align(st2, h='center'), 'f': 'ข้อมูลพื้นฐาน!B3&"        ครูประจำชั้น "&ข้อมูลพื้นฐาน!B5',
                           'c': iv('B3') + '        ครูประจำชั้น ' + iv('B5')}
        s['merges'] = [m for m in s['merges'] if not re.match(r'[B-Z]+2:', m)]
        s['merges'] = [re.sub(rf'^A1:{old_sum}1$', f'A1:{new_sum}1', m) for m in s['merges']] + [f'{c0}2:{new_sum}2']
        s['cells'] = cells
        s['dim'] = [rows, nw]
        cw = {k: v for k, v in s['cw'].items() if int(k) < o}
        for cn in range(o, nw): cw[str(cn)] = dict(s['cw'][str(last_item)])
        cw[str(nw)] = dict(s['cw'][str(o)])
        for cn in range(nw + 1, 61): cw[str(cn)] = {'w': 9.0, 'h': 1}
        s['cw'] = cw
        for dv in s['dv']: dv['sq'] = f'C4:{n2col(nw - 1)}{rows}'
        s['flex'] = {'items': [3, nw - 1], 'sum': nw}
    # สูตรภายนอกที่อ้างช่องสรุป
    pat = re.compile(rf"('?{re.escape(prefix)} เทอม\d'?!)\$?{old_sum}\$?(\d+):\$?{old_sum}\$?(\d+)")
    for s in d['sheets']:
        for c in s['cells'].values():
            f = c.get('f')
            if f and prefix in f: c['f'] = pat.sub(lambda m: f'{m[1]}${new_sum}${m[2]}:${new_sum}${m[3]}', f)
flex_assess('คุณลักษณะ', 'K', 'O')            # หัวข้อ C-N (12)
flex_assess('กิจกรรมพัฒนาผู้เรียน', 'F', 'K')   # หัวข้อ C-J (8)

# ---------------------------------------------------------------- 3) ชื่อตัวชี้วัด (แถว 47)
for s in d['sheets']:
    if not re.match(r'^คะแนนรายวิชา \d+$', s['name']): continue
    for t, i0 in ((1, 3), (2, 16)):
        for i in range(10):
            col = n2col(i0 + i); c = s['cells'][col + '5']
            c['f'] = f'IF({col}$47="","ตัวชี้วัด {i + 1}",{col}$47)&CHAR(10)&"เทอม {t} (เต็ม "&{col}4&")"'
    s['flex'] = {'indName': 47}

# ---------------------------------------------------------------- 4) ความสามารถชั้นปี
summ = S['ปพ.6 ป.1รวม']
for i in range(8):
    r = 6 + 3 * i; k = f'A{r}'; c = summ['cells'][k]; v = c.pop('v', None)
    c['f'] = f'IF($I${6 + i}="","",{i + 1}&".  "&$I${6 + i})'
    if v is not None: c['c'] = v
    for t in ('ปพ.6 ป.1 เทอม1', 'ปพ.6 ป.1 เทอม2'):
        tc = S[t]['cells'][k]; tv = tc.pop('v', None)
        tc['f'] = f"'ปพ.6 ป.1รวม'!{k}"
        if tv is not None: tc['c'] = tv
summ['flex'] = {'abilities': [6, 13]}

json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', path)
