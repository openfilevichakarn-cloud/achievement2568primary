#!/usr/bin/env python3
"""ชีท คะแนนรายวิชา 1-20: คะแนนเก็บ = ผลรวมคะแนนรายตัวชี้วัด (เพิ่ม-ลดจำนวนตัวชี้วัดได้ สูงสุด 10 ต่อเทอม)
  python3 tools/add_indicator_cols.py data/p1.json      (รันหลัง extract_xlsx.py / layout_patch.py)

ผังคอลัมน์ใหม่ของชีทคะแนนรายวิชา
  A เลขที่  B ชื่อ
  C-L  ตัวชี้วัด 1-10 ท.1   M คะแนนเก็บ ท.1 (=รวมตัวชี้วัด)  N สอบ ท.1  O รวม ท.1
  P-Y  ตัวชี้วัด 1-10 ท.2   Z คะแนนเก็บ ท.2 (=รวมตัวชี้วัด)  AA สอบ ท.2  AB รวม ท.2
  AC รวมทั้งปี  AD ระดับ ท.1  AE ระดับ ท.2  AF ระดับทั้งปี  AG หมายเหตุ
ตัวชี้วัดที่ "ใช้งาน" คือช่องที่กำหนดคะแนนเต็มในแถว 4 ไว้ (ช่องว่าง = ซ่อน) — ปุ่มเพิ่ม/ลดในหน้าเว็บแค่ตั้ง/ล้างคะแนนเต็ม
ค่าเริ่มต้น: ตัวชี้วัด 1 ตัวต่อเทอม เต็ม 35 + สอบ 15 (เท่ากับคะแนนเก็บ/สอบของไฟล์เดิม)
สูตรในชีทอื่นที่อ้างคอลัมน์ของชีทคะแนนรายวิชา (ข้อมูลป.1 / ปก ปพ.5 / ปพ.6) ถูกเลื่อนตามให้ด้วย
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))
NIND = 10

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
def mapc(c):            # คอลัมน์เดิม (A-M) -> คอลัมน์ใหม่: เก็บ/สอบ/รวม ท.1 -> M/N/O, ท.2 ขึ้นไป -> Z...
    return c if c <= 2 else c + NIND if c <= 5 else c + 2 * NIND
def mapref(ref):        # 'C4' / '$C$4' / 'C6:C45'
    def one(m): return m[1] + n2col(mapc(col2n(m[2]))) + m[3]
    return re.sub(r'(\$?)([A-Z]+)(\$?\d*)', one, ref)

T = {1: dict(i0=3, keep='M', exam='N', tot='O', lvl='AD'),
     2: dict(i0=16, keep='Z', exam='AA', tot='AB', lvl='AE')}
for t in T.values():
    t['inds'] = [n2col(t['i0'] + i) for i in range(NIND)]
    t['i1'], t['iN'] = t['inds'][0], t['inds'][-1]

SC = re.compile(r'^คะแนนรายวิชา \d+$')
sheets = [s for s in d['sheets'] if SC.match(s['name'])]
if any(s.get('indicator') for s in sheets):
    sys.exit('already patched')

LV = lambda x, mx: (f'IFERROR(IF({x}="","",IF({x}/{mx}>=0.75,"เชี่ยวชาญ",IF({x}/{mx}>=0.65,"ชำนาญ",'
                    f'IF({x}/{mx}>=0.55,"พัฒนา","เริ่มต้น")))),"")')
for s in sheets:
    old = s['cells']; cells = {}
    for k, c in old.items():
        cn, r = split(k)
        cells[n2col(mapc(cn)) + str(r)] = c
    nrow = s['dim'][0]
    for n, t in T.items():
        src = 'C' if n == 1 else 'F'           # คอลัมน์คะแนนเก็บเดิม
        for r in range(1, nrow + 1):
            o = old.get(src + str(r))
            if o is None: continue
            for i, col in enumerate(t['inds']):
                c = {'s': o['s'], **({'u': 1} if o.get('u') else {})}
                if i == 0 and r >= 4 and 'v' in o: c['v'] = o['v']   # ค่าเดิมของคะแนนเก็บ -> ตัวชี้วัด 1
                cells[col + str(r)] = c
            kp = cells[t['keep'] + str(r)]
            kp.pop('u', None)
            if 'v' in kp: kp['c'] = kp.pop('v')
        # คะแนนเต็ม
        i1, iN = t['i1'], t['iN']
        cells[t['keep'] + '4']['f'] = f'SUM({i1}4:{iN}4)'
        cells[t['tot'] + '4']['f'] = f'{t["keep"]}4+{t["exam"]}4'
        # หัวตาราง
        hs = cells[t['exam'] + '5']['s']
        for i, col in enumerate(t['inds']):
            cells[col + '5'] = {'s': hs, 'f': f'"ตัวชี้วัด {i + 1}"&CHAR(10)&"เทอม {n} (เต็ม "&{col}4&")"'}
        cells[t['keep'] + '5'] = {'s': hs, 'f': f'"คะแนนเก็บ"&CHAR(10)&"เทอม {n} (เต็ม "&{t["keep"]}4&")"'}
        cells[t['exam'] + '5'] = {'s': hs, 'f': f'"คะแนนสอบ"&CHAR(10)&"เทอม {n} (เต็ม "&{t["exam"]}4&")"'}
        cells[t['tot'] + '5'] = {'s': hs, 'f': f'"รวมเทอม {n}"&CHAR(10)&"(เต็ม "&{t["tot"]}4&")"'}
    cells['AC4']['f'] = 'O4+AB4'
    cells['AC5'] = {'s': cells['N5']['s'], 'f': '"รวมทั้งปี"&CHAR(10)&"(เต็ม "&AC4&")"'}
    # แถวนักเรียน (เก็บค่าแคชเดิมไว้ ใช้ตรวจเทียบใน verify_engine.js)
    for r in range(6, 46):
        def put(k, f):
            o = cells.get(k + str(r), {})
            cells[k + str(r)] = {'s': o.get('s'), 'f': f, **({'c': o['c']} if 'c' in o else {})}
        for t in T.values():
            rng = f'{t["i1"]}{r}:{t["iN"]}{r}'
            put(t['keep'], f'IF(COUNT({rng})=0,"",SUM({rng}))')
            put(t['tot'], f'IF(COUNT({rng},{t["exam"]}{r})=0,"",SUM({rng},{t["exam"]}{r}))')
        put('AC', f'IF(COUNT(O{r},AB{r})=0,"",SUM(O{r},AB{r}))')
        put('AD', LV(f'O{r}', '$O$4')); put('AE', LV(f'AB{r}', '$AB$4')); put('AF', LV(f'AC{r}', '$AC$4'))
    # ค่าแคชของแถว 4-5
    mx = {n: (cells[T[n]['i1'] + '4'].get('v', 0), cells[T[n]['exam'] + '4'].get('v', 0)) for n in T}
    for n, t in T.items():
        k, e = mx[n]
        cells[t['keep'] + '4']['c'] = k; cells[t['tot'] + '4']['c'] = k + e
        for i, col in enumerate(t['inds']):
            cells[col + '5']['c'] = f'ตัวชี้วัด {i + 1}\nเทอม {n} (เต็ม {k if i == 0 else ""})'
        cells[t['keep'] + '5']['c'] = f'คะแนนเก็บ\nเทอม {n} (เต็ม {k})'
        cells[t['exam'] + '5']['c'] = f'คะแนนสอบ\nเทอม {n} (เต็ม {e})'
        cells[t['tot'] + '5']['c'] = f'รวมเทอม {n}\n(เต็ม {k + e})'
    cells['AC4']['c'] = sum(a + b for a, b in mx.values())
    cells['AC5']['c'] = f'รวมทั้งปี\n(เต็ม {cells["AC4"]["c"]})'
    s['cells'] = cells
    s['dim'] = [nrow, mapc(s['dim'][1])]
    s['merges'] = [mapref(m) for m in s['merges']]
    cw = {str(mapc(int(k))): v for k, v in s['cw'].items() if int(k) <= 13}
    for t in T.values():
        for i in range(NIND): cw[str(t['i0'] + i)] = {'w': 10.0, 'h': 0}
    for c in range(34, 61): cw[str(c)] = {'w': 9.0, 'h': 1}
    s['cw'] = cw
    dv0 = s['dv'][0]
    cols = T[1]['inds'] + [T[1]['exam']] + T[2]['inds'] + [T[2]['exam']]
    s['dv'] = [{**copy.deepcopy(dv0), 'f2': f'${c}$4', 'sq': f'{c}6:{c}45', 'e': f'กรุณากรอกระหว่าง 0-${c}$4'}
               for c in cols]
    s['indicator'] = NIND

# สูตรในชีทอื่นที่อ้างชีทคะแนนรายวิชา (ค่าแคชเดิมยังถูก เพราะชี้ไปคอลัมน์เดิมที่ย้ายตำแหน่ง)
ref_direct = re.compile(r"('คะแนนรายวิชา \d+'!)([$A-Z0-9:]+)")
ref_indirect = re.compile(r"(คะแนนรายวิชา \"&[^\"]*?&\"'!)([$A-Z0-9:]*)(\")")
n = 0
for s in d['sheets']:
    if SC.match(s['name']): continue
    for c in s['cells'].values():
        f = c.get('f')
        if not f or 'คะแนนรายวิชา' not in f: continue
        f2 = ref_direct.sub(lambda m: m[1] + mapref(m[2]), f)
        f2 = ref_indirect.sub(lambda m: m[1] + mapref(m[2]) + m[3], f2)
        if f2 != f: c['f'] = f2; n += 1
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', len(sheets), 'score sheets,', n, 'external formulas')
