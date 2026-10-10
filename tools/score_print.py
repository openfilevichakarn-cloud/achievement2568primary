#!/usr/bin/env python3
"""ชีทคะแนนรายวิชา: ปรับหัวกระดาษให้พิมพ์แยก 3 หน้า (เทอม 1 / เทอม 2 / ทั้งปี) ได้สวย  (รันหลัง year_assess.py)
  python3 tools/score_print.py data/p1.json && node tools/fill_cache.js data/p1.json
- แถว 3: ชั้น/ปีการศึกษา + ครูผู้สอน + โรงเรียน รวมเป็นข้อความเดียว ผสาน A3:AG3 (ไม่ขาดเมื่อซ่อนคอลัมน์)
- AD4 (รหัส/กลุ่มสาระ/เวลาเรียน): ตัดบรรทัดได้ และแถว 4 สูง 36pt
- คุณลักษณะ/กิจกรรม: แถว 2 (โรงเรียน + ครูประจำชั้น) ตัดบรรทัดได้ (พิมพ์แนวตั้ง)
"""
import json, copy, re, sys
path = sys.argv[1] if len(sys.argv) > 1 else 'data/p1.json'
d = json.load(open(path, encoding='utf-8')); st = d['styles']; cache = {}
def wrap(i):
    if i not in cache:
        s = copy.deepcopy(st[i]); s['a'][2] = 1; s['a'][1] = 'center'; st.append(s); cache[i] = len(st) - 1
    return cache[i]
for s in d['sheets']:
    if not re.match(r'^คะแนนรายวิชา \d+$', s['name']): continue
    c = s['cells']
    if 'A3:AG3' in s['merges']: sys.exit('already patched')
    fa, fo, fd = c['A3']['f'], c['O3']['f'], c['AD3']['f']
    c['A3'] = {'s': c['A3']['s'], 'f': f'{fa}&"          "&{fo}&"          "&{fd}'}
    for k in ('O3', 'AD3'): c[k] = {'s': c[k]['s']}
    s['merges'] = [m for m in s['merges'] if not re.match(r'^(A3|O3|AD3):', m)] + ['A3:AG3']
    c['AD4']['s'] = wrap(c['AD4']['s'])
    s['rh']['4'] = {'h': 36.0, 'x': 0}
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('patched', path)

# คุณลักษณะ / กิจกรรม: แถว 2 (โรงเรียน + ครูประจำชั้น) ตัดบรรทัดได้เมื่อพิมพ์แนวตั้ง
d = json.load(open(path, encoding='utf-8')); st = d['styles']; cache = {}
for s in d['sheets']:
    if not (s.get('flex') or {}).get('items'): continue
    for k, c in s['cells'].items():
        if k.endswith('2') and re.fullmatch(r'[B-Z]2', k) and 'ครูประจำชั้น' in (c.get('f') or ''):
            c['s'] = wrap(c['s']); s['rh']['2'] = {'h': 36.0, 'x': 0}
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ชีทคะแนนรายวิชา: หัวกระดาษ 3 แถวแรก (ชื่อแบบ / วิชา / ชั้น-ครู-โรงเรียน) ไม่มีเส้นตาราง ตารางเริ่มเส้นบนที่แถว 4
d = json.load(open(path, encoding='utf-8')); st = d['styles']; nob = {}; top = {}
def no_border(i):
    if i not in nob:
        s = copy.deepcopy(st[i]); s['b'] = [None, None, None, None]; st.append(s); nob[i] = len(st) - 1
    return nob[i]
def colnum(s):
    n = 0
    for ch in s: n = n * 26 + ord(ch) - 64
    return n
def top_border(i):
    if i not in top:
        s = copy.deepcopy(st[i]); s['b'][2] = ['thin', '#000000']; st.append(s); top[i] = len(st) - 1
    return top[i]
for s in d['sheets']:
    if not re.match(r'^คะแนนรายวิชา \d+$', s['name']): continue
    for k, c in s['cells'].items():
        m = re.fullmatch(r'([A-Z]+)(\d+)', k); r = int(m[2])
        if r <= 3: c['s'] = no_border(c['s'])
        elif r == 4 and colnum(m[1]) <= 33: c['s'] = top_border(c['s'])   # A-AG
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
