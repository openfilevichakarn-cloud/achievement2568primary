#!/usr/bin/env python3
"""เพิ่มช่อง 'คะแนนรายตัวชี้วัด' ก่อนช่องคะแนนเก็บ (เทอม 1 และเทอม 2) ในชีท คะแนนรายวิชา 1-20
  python3 tools/add_indicator_cols.py data/p1.json      (รันหลัง extract_xlsx.py / layout_patch.py)

ผังคอลัมน์ใหม่ของชีทคะแนนรายวิชา
  A เลขที่  B ชื่อ
  C ตัวชี้วัด ท.1  D เก็บ ท.1  E สอบ ท.1  F รวม ท.1
  G ตัวชี้วัด ท.2  H เก็บ ท.2  I สอบ ท.2  J รวม ท.2
  K รวมทั้งปี  L ระดับ ท.1  M ระดับ ท.2  N ระดับทั้งปี  O หมายเหตุ
คะแนนรายตัวชี้วัดนับรวมในคะแนนรวมของเทอม ค่าเริ่มต้นคะแนนเต็ม ตัวชี้วัด 20 / เก็บ 15 / สอบ 15 (รวม 50 ต่อเทอม)
สูตรในชีทอื่นที่อ้างคอลัมน์ของชีทคะแนนรายวิชา (ข้อมูลป.1 / ปก ปพ.5 / ปพ.6) ถูกเลื่อนตามให้ด้วย
"""
import json, re, sys, copy
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8'))

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
def mapc(c):            # คอลัมน์เดิม -> คอลัมน์ใหม่
    return c if c <= 2 else c + 1 if c <= 5 else c + 2
def mapref(ref):        # 'C4' / '$C$4' / 'C6:C45'
    def one(m): return m[1] + n2col(mapc(col2n(m[2]))) + m[3]
    return re.sub(r'(\$?)([A-Z]+)(\$?\d*)', one, ref)

SC = re.compile(r'^คะแนนรายวิชา \d+$')
sheets = [s for s in d['sheets'] if SC.match(s['name'])]
if any(s.get('indicator') for s in sheets):
    sys.exit('already patched')

ROWS = range(6, 46)
LV = lambda x, mx: (f'IFERROR(IF({x}="","",IF({x}/{mx}>=0.75,"เชี่ยวชาญ",IF({x}/{mx}>=0.65,"ชำนาญ",'
                    f'IF({x}/{mx}>=0.55,"พัฒนา","เริ่มต้น")))),"")')
for s in sheets:
    old = s['cells']; cells = {}
    for k, c in old.items():
        cn, r = split(k)
        cells[n2col(mapc(cn)) + str(r)] = c
    # คอลัมน์ใหม่ C และ G: ใช้รูปแบบเดียวกับคอลัมน์คะแนนเก็บเดิมของแถวนั้น
    for r in range(1, s['dim'][0] + 1):
        for new, src in (('C', 'C'), ('G', 'F')):
            o = old.get(src + str(r))
            if o is not None: cells[new + str(r)] = {'s': o['s'], **({'u': 1} if o.get('u') else {})}
    # แถว 4: คะแนนเต็ม
    for k, v in (('C4', 20), ('D4', 15), ('E4', 15), ('G4', 20), ('H4', 15), ('I4', 15)):
        cells[k] = {**cells[k], 'v': v, 'u': 1}
    cells['F4'] = {'s': cells['F4']['s'], 'f': 'C4+D4+E4'}
    cells['J4'] = {'s': cells['J4']['s'], 'f': 'G4+H4+I4'}
    cells['K4'] = {'s': cells['K4']['s'], 'f': 'F4+J4'}
    # แถว 5: หัวตาราง
    hd = lambda t, term, mx: f'"{t}"&CHAR(10)&"เทอม {term} (เต็ม "&{mx}&")"'
    heads = {'C5': hd('คะแนนรายตัวชี้วัด', 1, 'C4'), 'D5': hd('คะแนนเก็บ', 1, 'D4'), 'E5': hd('คะแนนสอบ', 1, 'E4'),
             'F5': '"รวมเทอม 1"&CHAR(10)&"(เต็ม "&F4&")"',
             'G5': hd('คะแนนรายตัวชี้วัด', 2, 'G4'), 'H5': hd('คะแนนเก็บ', 2, 'H4'), 'I5': hd('คะแนนสอบ', 2, 'I4'),
             'J5': '"รวมเทอม 2"&CHAR(10)&"(เต็ม "&J4&")"', 'K5': '"รวมทั้งปี"&CHAR(10)&"(เต็ม "&K4&")"'}
    for k, f in heads.items(): cells[k] = {'s': cells['D5']['s'], 'f': f}
    # ค่าแคช (ใช้ตรวจเทียบใน verify_engine.js)
    mx = {k: cells[k]['v'] for k in ('C4', 'D4', 'E4', 'G4', 'H4', 'I4')}
    t1, t2 = mx['C4'] + mx['D4'] + mx['E4'], mx['G4'] + mx['H4'] + mx['I4']
    cache = {'F4': t1, 'J4': t2, 'K4': t1 + t2, 'F5': f'รวมเทอม 1\n(เต็ม {t1})', 'J5': f'รวมเทอม 2\n(เต็ม {t2})',
             'K5': f'รวมทั้งปี\n(เต็ม {t1 + t2})'}
    for k, lab in (('C', 'คะแนนรายตัวชี้วัด'), ('D', 'คะแนนเก็บ'), ('E', 'คะแนนสอบ'), ('G', 'คะแนนรายตัวชี้วัด'), ('H', 'คะแนนเก็บ'), ('I', 'คะแนนสอบ')):
        cache[k + '5'] = f'{lab}\nเทอม {1 if k < "F" else 2} (เต็ม {mx[k + "4"]})'
    for k, v in cache.items(): cells[k]['c'] = v
    # แถวนักเรียน
    for r in ROWS:
        g = lambda k: cells.get(k + str(r), {})
        put = lambda k, f: cells.__setitem__(k + str(r), {'s': g(k).get('s'), 'f': f,
                                                       **({'c': g(k)['c']} if 'c' in g(k) else {})})
        put('F', f'IF(COUNT(C{r}:E{r})=0,"",SUM(C{r}:E{r}))')
        put('J', f'IF(COUNT(G{r}:I{r})=0,"",SUM(G{r}:I{r}))')
        put('K', f'IF(COUNT(F{r},J{r})=0,"",SUM(F{r},J{r}))')
        put('L', LV(f'F{r}', '$F$4')); put('M', LV(f'J{r}', '$J$4')); put('N', LV(f'K{r}', '$K$4'))
    s['cells'] = cells
    s['dim'] = [s['dim'][0], s['dim'][1] + 2]
    s['merges'] = [mapref(m) for m in s['merges']]
    cw = {str(mapc(int(k))): v for k, v in s['cw'].items()}
    cw['3'] = dict(s['cw']['3']); cw['7'] = dict(s['cw']['6'])
    s['cw'] = cw
    dv0 = s['dv'][0]
    s['dv'] = [{**copy.deepcopy(dv0), 'f2': f'${c}$4', 'sq': f'{c}6:{c}45', 'e': f'กรุณากรอกระหว่าง 0-${c}$4'}
               for c in 'CDEGHI']
    s['indicator'] = 1

# สูตรในชีทอื่นที่อ้างชีทคะแนนรายวิชา
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
        if f2 != f: c['f'] = f2; n += 1      # ค่าแคชเดิมยังถูก เพราะชี้ไปคอลัมน์เดิมที่ย้ายตำแหน่ง
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', len(sheets), 'score sheets,', n, 'external formulas')
