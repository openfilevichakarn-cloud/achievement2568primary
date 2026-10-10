/* engine.js — ตัวคำนวณสูตรแบบ Excel (เฉพาะฟังก์ชันที่ไฟล์ ปพ.5/ปพ.6 ใช้) ไม่พึ่งไลบรารีภายนอก
 * ใช้ได้ทั้งเบราว์เซอร์ (window.PPEngine) และ Node (module.exports) */
(function (root) {
  'use strict';

  // ---------- errors ----------
  class XErr { constructor(code) { this.code = code; } toString() { return this.code; } }
  const E = { NA: new XErr('#N/A'), VALUE: new XErr('#VALUE!'), REF: new XErr('#REF!'), DIV0: new XErr('#DIV/0!'), NAME: new XErr('#NAME?'), NUM: new XErr('#NUM!') };
  const isErr = (v) => v instanceof XErr;

  // ---------- A1 helpers ----------
  function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  const KEY = (r, c) => r * 1024 + c;
  function parseA1(ref) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
    if (!m) return null;
    return { r: parseInt(m[2], 10), c: colToNum(m[1].toUpperCase()) };
  }

  // ---------- tokenizer ----------
  const IDCH = /[A-Za-z0-9_.\$฀-๿]/;
  function tokenize(src) {
    const t = []; let i = 0; const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (ch === '"') {
        let j = i + 1, s = '';
        for (; j < n; j++) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j++; } else break; } else s += src[j]; }
        t.push({ k: 'str', v: s }); i = j + 1; continue;
      }
      if (ch === "'") { // quoted sheet name
        let j = i + 1, s = '';
        for (; j < n; j++) { if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j++; } else break; } else s += src[j]; }
        if (src[j + 1] !== '!') throw new Error('bad sheet ref');
        t.push({ k: 'sheet', v: s }); i = j + 2; continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        // ตัวเลขล้วนที่ตามด้วย ":" คืออ้างอิงแถว (1:3) — ไม่พบในไฟล์นี้ จึงไม่รองรับ
        t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (IDCH.test(ch)) {
        let j = i; while (j < n && IDCH.test(src[j])) j++;
        const id = src.slice(i, j);
        if (src[j] === '!') { t.push({ k: 'sheet', v: id }); i = j + 1; continue; }
        if (src[j] === '(') { t.push({ k: 'fn', v: id.toUpperCase() }); i = j + 1; continue; }
        t.push({ k: 'id', v: id }); i = j; continue;
      }
      const two = src.substr(i, 2);
      if (two === '<>' || two === '<=' || two === '>=') { t.push({ k: 'op', v: two }); i += 2; continue; }
      if ('+-*/^&=<>(),:%{};'.includes(ch)) { t.push({ k: 'op', v: ch }); i++; continue; }
      throw new Error('bad char ' + ch);
    }
    return t;
  }

  // ---------- parser (precedence climbing) ----------
  function parse(src) {
    const toks = tokenize(src); let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
    function parseRefAfterSheet(sheet) {
      // อ่าน id [: id]
      const a = next();
      if (!a || a.k !== 'id') throw new Error('ref expected');
      let b = null;
      if (isOp(':')) { next(); const bb = next(); if (!bb || bb.k !== 'id') throw new Error('ref expected'); b = bb.v; }
      return { t: 'ref', sheet, a: a.v, b };
    }
    function primary() {
      const tk = next();
      if (!tk) throw new Error('unexpected end');
      if (tk.k === 'num') return { t: 'num', v: tk.v };
      if (tk.k === 'str') return { t: 'str', v: tk.v };
      if (tk.k === 'sheet') {
        const a = next();
        if (!a || a.k !== 'id') throw new Error('ref expected');
        let b = null;
        if (isOp(':')) { next(); b = next().v; }
        return { t: 'ref', sheet: tk.v, a: a.v, b };
      }
      if (tk.k === 'id') {
        const up = tk.v.toUpperCase();
        if (up === 'TRUE') return { t: 'bool', v: true };
        if (up === 'FALSE') return { t: 'bool', v: false };
        let b = null;
        if (isOp(':')) { next(); b = next().v; }
        return { t: 'ref', sheet: null, a: tk.v, b };
      }
      if (tk.k === 'fn') {
        const args = [];
        if (isOp(')')) { next(); return { t: 'fn', name: tk.v, args }; }
        for (;;) {
          if (isOp(',') || isOp(')')) args.push({ t: 'blank' }); else args.push(expr(0));
          if (isOp(',')) { next(); continue; }
          if (isOp(')')) { next(); break; }
          throw new Error('bad args');
        }
        return { t: 'fn', name: tk.v, args };
      }
      if (tk.k === 'op' && tk.v === '{') {
        const rows = [[]];
        for (;;) {
          rows[rows.length - 1].push(expr(0));
          if (isOp(',')) { next(); continue; }
          if (isOp(';')) { next(); rows.push([]); continue; }
          if (isOp('}')) { next(); break; }
          throw new Error('bad array');
        }
        return { t: 'arr', rows };
      }
      if (tk.k === 'op' && tk.v === '(') { const e = expr(0); if (!isOp(')')) throw new Error(') expected'); next(); return { t: 'paren', e }; }
      if (tk.k === 'op' && tk.v === '-') return { t: 'neg', e: expr(7) };
      if (tk.k === 'op' && tk.v === '+') return expr(7);
      throw new Error('unexpected ' + tk.v);
    }
    const PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
    function expr(minp) {
      let left = primary();
      for (;;) {
        let tk = peek();
        if (tk && tk.k === 'op' && tk.v === '%') { next(); left = { t: 'pct', e: left }; continue; }
        if (!tk || tk.k !== 'op' || !(tk.v in PREC)) break;
        const pr = PREC[tk.v];
        if (pr < minp) break;
        next();
        const right = expr(pr + 1);
        left = { t: 'bin', op: tk.v, l: left, r: right };
      }
      return left;
    }
    const ast = expr(0);
    if (p < toks.length) throw new Error('trailing tokens');
    return ast;
  }

  // ---------- value helpers ----------
  const isRange = (v) => v && v.isRange === true;
  function numStr(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    let s = Number(n.toPrecision(15)).toString();
    if (s.includes('e')) { s = Number(n).toString(); }
    return s;
  }
  function toText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return numStr(v);
    return String(v);
  }
  function parseNumText(s) {
    const t = s.trim();
    if (t === '') return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
    if (/^[+-]?(\d+\.?\d*|\.\d+)%$/.test(t)) return parseFloat(t) / 100;
    return null;
  }
  function toNum(v) {
    if (isErr(v)) return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = parseNumText(String(v));
    return n === null ? E.VALUE : n;
  }
  function typeRank(v) { return typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0; }
  function compareVals(a, b) { // -1,0,1 ; blank แปลงตามอีกฝั่ง
    if (a === null || a === undefined) a = (typeof b === 'string') ? '' : (typeof b === 'boolean' ? false : 0);
    if (b === null || b === undefined) b = (typeof a === 'string') ? '' : (typeof a === 'boolean' ? false : 0);
    const ra = typeRank(a), rb = typeRank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra === 2) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function wildcardRe(pat) {
    let s = '^';
    for (let i = 0; i < pat.length; i++) {
      const ch = pat[i];
      if (ch === '~' && i + 1 < pat.length) { s += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      else if (ch === '*') s += '[\\s\\S]*'; else if (ch === '?') s += '[\\s\\S]';
      else s += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(s + '$', 'i');
  }
  function roundHalfAway(x, d) {
    const f = Math.pow(10, d);
    const y = Math.abs(x) * f;
    const r = Math.round(Number((y).toPrecision(15)));
    return Math.sign(x) * r / f;
  }

  // ---------- workbook model ----------
  class Workbook {
    constructor(data) {
      this.sheets = []; this.byName = new Map();
      for (const sd of data.sheets) {
        const sh = { name: sd.name, def: sd, cells: new Map(), maxR: sd.dim[0], maxC: sd.dim[1] };
        for (const [ref, c] of Object.entries(sd.cells)) {
          const a = parseA1(ref);
          const cell = { r: a.r, c: a.c, v: c.v === undefined ? null : c.v, f: c.f || null, ast: null, u: !!c.u, s: c.s || 0, cached: c.c };
          sh.cells.set(KEY(a.r, a.c), cell);
        }
        this.sheets.push(sh); this.byName.set(sd.name.toLowerCase(), sh);
      }
      this.over = new Map(); // sheetName -> Map(key -> value)
      this.cache = new Map(); this.stack = new Set();
      this.version = 0;
    }
    sheet(name) { return this.byName.get(String(name).toLowerCase()); }
    invalidate() { this.cache.clear(); this.version++; }
    // ค่าตั้งต้น/ที่ผู้ใช้พิมพ์ทับ
    setValue(sheetName, ref, value) { // value: null=ว่าง
      const sh = this.sheet(sheetName); const a = typeof ref === 'string' ? parseA1(ref) : ref;
      let m = this.over.get(sh.name); if (!m) { m = new Map(); this.over.set(sh.name, m); }
      m.set(KEY(a.r, a.c), value === undefined ? null : value);
      this.invalidate();
    }
    clearOverride(sheetName, ref) {
      const sh = this.sheet(sheetName); const a = parseA1(ref); const m = this.over.get(sh.name);
      if (m) m.delete(KEY(a.r, a.c)); this.invalidate();
    }
    hasOverride(sheetName, r, c) { const m = this.over.get(this.sheet(sheetName).name); return !!m && m.has(KEY(r, c)); }
    // ค่าเซลล์ (คำนวณถ้ามีสูตร)
    get(sheet, r, c) {
      const key = KEY(r, c);
      const om = this.over.get(sheet.name);
      if (om && om.has(key)) return om.get(key);
      const cell = sheet.cells.get(key);
      if (!cell) return null;
      if (!cell.f) return cell.v;
      const ck = sheet.name + '|' + key;
      if (this.cache.has(ck)) return this.cache.get(ck);
      if (this.stack.has(ck)) return E.REF; // วงวน
      this.stack.add(ck);
      let val;
      try {
        if (!cell.ast) cell.ast = parse(cell.f);
        val = this.evalNode(cell.ast, sheet);
        if (isRange(val)) val = this.rangeFirst(val);
        if (val === undefined) val = null;
      } catch (e) { val = E.NAME; if (typeof console !== 'undefined' && this.debug) console.warn('formula error', sheet.name, r, c, cell.f, e.message); }
      this.stack.delete(ck);
      this.cache.set(ck, val);
      return val;
    }
    formulaOf(sheet, r, c) { const x = sheet.cells.get(KEY(r, c)); return x ? x.f : null; }
    rv(rg, r, c) { return rg.arr ? rg.arr[r - 1][c - 1] : this.get(rg.sheet, r, c); }
    rangeFirst(rg) { return this.rv(rg, rg.r1, rg.c1); }
    cellsOf(rg) { // iterator ค่าในช่วง (เฉพาะช่วงที่ถูกจำกัดขนาดแล้ว)
      const out = [];
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) out.push(this.rv(rg, r, c));
      return out;
    }
    scalar(v) { // ช่วง -> ค่าเดี่ยว (implicit intersection แบบง่าย)
      if (isRange(v)) {
        if (v.r1 === v.r2 && v.c1 === v.c2) return this.rv(v, v.r1, v.c1);
        return E.VALUE;
      }
      return v;
    }
    makeRange(sheetName, a, b, ctxSheet) {
      const sh = sheetName ? this.sheet(sheetName) : ctxSheet;
      if (!sh) return E.REF;
      const A = parseA1(a);
      if (!A) {
        const cm = /^\$?([A-Za-z]{1,3})$/.exec(a); // คอลัมน์ล้วน A:A
        if (cm && b) { const cb = /^\$?([A-Za-z]{1,3})$/.exec(b); if (cb) return { isRange: true, sheet: sh, r1: 1, c1: colToNum(cm[1].toUpperCase()), r2: sh.maxR, c2: colToNum(cb[1].toUpperCase()) }; }
        return E.NAME;
      }
      let B = A;
      if (b) { B = parseA1(b); if (!B) return E.REF; }
      return { isRange: true, sheet: sh, r1: Math.min(A.r, B.r), c1: Math.min(A.c, B.c), r2: Math.max(A.r, B.r), c2: Math.max(A.c, B.c) };
    }

    evalNode(n, sh) {
      switch (n.t) {
        case 'num': case 'str': case 'bool': return n.v;
        case 'blank': return null;
        case 'paren': return this.evalNode(n.e, sh);
        case 'ref': return this.makeRange(n.sheet, n.a, n.b, sh);
        case 'arr': {
          const arr = n.rows.map(r => r.map(e => this.scalar(this.evalNode(e, sh))));
          return { isRange: true, sheet: null, arr, r1: 1, c1: 1, r2: arr.length, c2: arr[0].length };
        }
        case 'neg': { const v = this.scalar(this.evalNode(n.e, sh)); const x = toNum(v); return isErr(x) ? x : -x; }
        case 'pct': { const v = this.scalar(this.evalNode(n.e, sh)); const x = toNum(v); return isErr(x) ? x : x / 100; }
        case 'bin': return this.evalBin(n, sh);
        case 'fn': return this.evalFn(n, sh);
      }
      return E.VALUE;
    }
    evalBin(n, sh) {
      const a = this.scalar(this.evalNode(n.l, sh)); if (isErr(a)) return a;
      const b = this.scalar(this.evalNode(n.r, sh)); if (isErr(b)) return b;
      switch (n.op) {
        case '&': return toText(a) + toText(b);
        case '=': return compareVals(a, b) === 0;
        case '<>': return compareVals(a, b) !== 0;
        case '<': return compareVals(a, b) < 0;
        case '>': return compareVals(a, b) > 0;
        case '<=': return compareVals(a, b) <= 0;
        case '>=': return compareVals(a, b) >= 0;
      }
      const x = toNum(a); if (isErr(x)) return x;
      const y = toNum(b); if (isErr(y)) return y;
      switch (n.op) {
        case '+': return x + y; case '-': return x - y; case '*': return x * y;
        case '/': return y === 0 ? E.DIV0 : x / y;
        case '^': { const r = Math.pow(x, y); return Number.isFinite(r) ? r : E.NUM; }
      }
      return E.VALUE;
    }
    truthy(v) {
      if (isErr(v)) return v;
      if (v === null) return false;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = String(v).toUpperCase();
      if (s === 'TRUE') return true; if (s === 'FALSE') return false;
      return E.VALUE;
    }
    evalFn(n, sh) {
      const A = n.args; const name = n.name;
      const sc = (i) => this.scalar(this.evalNode(A[i], sh));
      switch (name) {
        case 'IF': {
          const c = this.truthy(sc(0)); if (isErr(c)) return c;
          if (c) return A.length > 1 ? this.scalarOrRange(A[1], sh) : true;
          return A.length > 2 ? this.scalarOrRange(A[2], sh) : false;
        }
        case 'IFERROR': {
          let v; try { v = this.evalNode(A[0], sh); if (isRange(v)) v = this.scalar(v); } catch (e) { v = E.NAME; }
          return isErr(v) ? this.scalarOrRange(A[1], sh) : v;
        }
        case 'SUM': case 'COUNT': case 'COUNTBLANK': return this.aggregate(name, A, sh);
        case 'COUNTIF': {
          const rg = this.evalNode(A[0], sh); if (!isRange(rg)) return isErr(rg) ? rg : E.VALUE;
          const crit = sc(1); if (isErr(crit)) return crit;
          const test = this.critTest(crit);
          let cnt = 0; for (const v of this.cellsOf(rg)) if (test(v)) cnt++;
          return cnt;
        }
        case 'MATCH': return this.fnMatch(A, sh);
        case 'INDEX': return this.fnIndex(A, sh);
        case 'VLOOKUP': return this.fnVlookup(A, sh);
        case 'LOOKUP': return this.fnLookup(A, sh);
        case 'INDIRECT': {
          const t = sc(0); if (isErr(t)) return t;
          const s = toText(t).trim();
          const m = /^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$/.exec(s);
          let shn = null, ref = s;
          if (m) { shn = (m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]); ref = m[3]; }
          const parts = ref.split(':');
          if (parts.length > 2 || !parts[0]) return E.REF;
          const rg = this.makeRange(shn, parts[0], parts[1] || null, sh);
          return (rg instanceof XErr) ? E.REF : rg;
        }
        case 'CHAR': { const x = toNum(sc(0)); if (isErr(x)) return x; return charFromCode(Math.trunc(x)); }
        case 'VALUE': {
          const v = sc(0); if (isErr(v)) return v;
          if (typeof v === 'number') return v; if (v === null) return 0; if (typeof v === 'boolean') return E.VALUE;
          const x = parseNumText(String(v)); return x === null ? E.VALUE : x;
        }
        case 'ROUND': {
          const x = toNum(sc(0)); if (isErr(x)) return x; const d = toNum(sc(1)); if (isErr(d)) return d;
          return roundHalfAway(x, Math.trunc(d));
        }
        case 'AND': case 'OR': {
          let res = name === 'AND';
          for (let i = 0; i < A.length; i++) { const t = this.truthy(sc(i)); if (isErr(t)) return t; res = name === 'AND' ? (res && t) : (res || t); }
          return res;
        }
        case 'LEN': return toText(sc(0)).length;
        case 'TRIM': return toText(sc(0)).replace(/ +/g, ' ').trim();
        case 'ISBLANK': return sc(0) === null;
        case 'ISNUMBER': return typeof sc(0) === 'number';
        case 'ISERROR': return isErr(sc(0));
        case 'MAX': case 'MIN': {
          const nums = []; for (const a of A) { const v = this.evalNode(a, sh); const vs = isRange(v) ? this.cellsOf(v) : [v]; for (const x of vs) { if (isErr(x)) return x; if (typeof x === 'number') nums.push(x); } }
          return nums.length ? (name === 'MAX' ? Math.max(...nums) : Math.min(...nums)) : 0;
        }
      }
      return E.NAME;
    }
    scalarOrRange(node, sh) { const v = this.evalNode(node, sh); return isRange(v) ? this.scalar(v) : v; }
    aggregate(name, A, sh) {
      let sum = 0, cnt = 0, blanks = 0;
      for (const a of A) {
        const v = this.evalNode(a, sh);
        if (isRange(v)) {
          for (const x of this.cellsOf(v)) {
            if (name === 'COUNTBLANK') { if (x === null || x === '') blanks++; continue; }
            if (isErr(x)) { if (name === 'SUM') return x; continue; }
            if (typeof x === 'number') { sum += x; cnt++; }
          }
        } else {
          if (isErr(v)) { if (name === 'COUNT') continue; return v; }
          if (name === 'COUNTBLANK') continue;
          if (name === 'SUM') { const x = toNum(v); if (isErr(x)) return x; sum += x; }
          else if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && parseNumText(v) !== null)) cnt++;
        }
      }
      return name === 'SUM' ? sum : name === 'COUNT' ? cnt : blanks;
    }
    critTest(crit) {
      let op = '=', rhs = crit;
      if (typeof crit === 'string') {
        const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(crit);
        op = m[1] || '='; rhs = m[2];
        const num = parseNumText(rhs);
        if (num !== null && rhs.trim() !== '') rhs = num;
        else if (/^(TRUE|FALSE)$/i.test(rhs)) rhs = rhs.toUpperCase() === 'TRUE';
      }
      if (crit === null) rhs = 0;
      return (v) => {
        if (isErr(v)) return false;
        if (typeof rhs === 'string') {
          if (op === '=' || op === '<>') {
            let hit;
            if (rhs === '') hit = (v === null || v === '');
            else if (/[*?~]/.test(rhs)) hit = typeof v === 'string' && wildcardRe(rhs).test(v);
            else hit = typeof v === 'string' && v.toLowerCase() === rhs.toLowerCase();
            if (rhs === '' && op === '<>') return !(v === null || v === '') ;
            return op === '=' ? hit : !hit;
          }
          if (typeof v !== 'string') return false;
          const c = compareVals(v, rhs);
          return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
        }
        // rhs ตัวเลข/boolean
        if (v === null) return op === '<>' ? true : false;
        if (typeof rhs === 'number') {
          if (typeof v !== 'number') return op === '<>';
          return op === '=' ? v === rhs : op === '<>' ? v !== rhs : op === '<' ? v < rhs : op === '>' ? v > rhs : op === '<=' ? v <= rhs : v >= rhs;
        }
        if (typeof v !== 'boolean') return op === '<>';
        return op === '=' ? v === rhs : op === '<>' ? v !== rhs : false;
      };
    }
    flatVec(rg) { // เวกเตอร์ค่า + ทิศทาง
      return this.cellsOf(rg);
    }
    fnMatch(A, sh) {
      let lv = this.scalar(this.evalNode(A[0], sh)); if (isErr(lv)) return lv; if (lv === null) lv = 0;
      const rg = this.evalNode(A[1], sh); if (!isRange(rg)) return isErr(rg) ? rg : E.NA;
      const typ = A.length > 2 ? toNum(this.scalar(this.evalNode(A[2], sh))) : 1; if (isErr(typ)) return typ;
      const vec = this.cellsOf(rg);
      if (typ === 0) {
        let re = null;
        if (typeof lv === 'string' && /[*?~]/.test(lv)) re = wildcardRe(lv);
        for (let i = 0; i < vec.length; i++) {
          const x = vec[i];
          if (re) { if (typeof x === 'string' && re.test(x)) return i + 1; continue; }
          if (x === null || isErr(x)) { if (lv === null) return i + 1; continue; }
          if (typeRank(x) === typeRank(lv) && compareVals(x, lv) === 0) return i + 1;
        }
        return E.NA;
      }
      let pos = -1;
      if (typ > 0) { for (let i = 0; i < vec.length; i++) { const x = vec[i]; if (x === null || isErr(x) || typeRank(x) !== typeRank(lv)) continue; if (compareVals(x, lv) <= 0) pos = i; else break; } }
      else { for (let i = 0; i < vec.length; i++) { const x = vec[i]; if (x === null || isErr(x) || typeRank(x) !== typeRank(lv)) continue; if (compareVals(x, lv) >= 0) pos = i; else break; } }
      return pos < 0 ? E.NA : pos + 1;
    }
    fnIndex(A, sh) {
      const rg = this.evalNode(A[0], sh); if (!isRange(rg)) return isErr(rg) ? rg : E.REF;
      const rows = rg.r2 - rg.r1 + 1, cols = rg.c2 - rg.c1 + 1;
      let r = A.length > 1 ? toNum(this.scalar(this.evalNode(A[1], sh))) : 1; if (isErr(r)) return r;
      let c = A.length > 2 ? toNum(this.scalar(this.evalNode(A[2], sh))) : null; if (isErr(c)) return c;
      r = Math.trunc(r);
      if (c === null) { if (rows === 1 && cols > 1) { c = r; r = 1; } else c = 1; }
      c = Math.trunc(c);
      if (r < 1 || c < 1 || r > rows || c > cols) return E.REF;
      return this.rv(rg, rg.r1 + r - 1, rg.c1 + c - 1);
    }
    fnVlookup(A, sh) {
      let lv = this.scalar(this.evalNode(A[0], sh)); if (isErr(lv)) return lv; if (lv === null) lv = 0;
      const rg = this.evalNode(A[1], sh); if (!isRange(rg)) return isErr(rg) ? rg : E.REF;
      const ci = toNum(this.scalar(this.evalNode(A[2], sh))); if (isErr(ci)) return ci;
      let approx = true;
      if (A.length > 3) { const t = this.scalar(this.evalNode(A[3], sh)); const b = this.truthy(t); if (isErr(b)) return b; approx = b; }
      const cols = rg.c2 - rg.c1 + 1; if (ci < 1) return E.VALUE; if (ci > cols) return E.REF;
      let hit = -1;
      for (let r = rg.r1; r <= rg.r2; r++) {
        const x = this.rv(rg, r, rg.c1);
        if (approx) { if (x === null || isErr(x) || typeRank(x) !== typeRank(lv)) continue; if (compareVals(x, lv) <= 0) hit = r; else break; }
        else {
          if (x === null || isErr(x)) { continue; }
          if (typeRank(x) === typeRank(lv) && (typeof lv === 'string' && /[*?~]/.test(lv) ? wildcardRe(lv).test(x) : compareVals(x, lv) === 0)) { hit = r; break; }
        }
      }
      if (hit < 0) return E.NA;
      return this.rv(rg, hit, rg.c1 + Math.trunc(ci) - 1);
    }
    fnLookup(A, sh) {
      let lv = this.scalar(this.evalNode(A[0], sh)); if (isErr(lv)) return lv; if (lv === null) lv = 0;
      const lvec = this.evalNode(A[1], sh); if (!isRange(lvec)) return E.NA;
      const rvec = A.length > 2 ? this.evalNode(A[2], sh) : lvec; if (!isRange(rvec)) return E.NA;
      const L = this.cellsOf(lvec); const R = this.cellsOf(rvec);
      let pos = -1;
      for (let i = 0; i < L.length; i++) { const x = L[i]; if (x === null || isErr(x) || typeRank(x) !== typeRank(lv)) continue; if (compareVals(x, lv) <= 0) pos = i; else break; }
      if (pos < 0) return E.NA;
      return R[pos] === undefined ? E.NA : R[pos];
    }
  }

  // CHAR(): Windows-874 สำหรับ 161-251, อื่น ๆ ใช้ latin1
  function charFromCode(n) {
    if (n < 1 || n > 255) return E.VALUE;
    if (n >= 161 && n <= 251) {
      const m = { 161: 0x0E01 };
      return String.fromCharCode(0x0E01 + (n - 161));
    }
    return String.fromCharCode(n);
  }

  const api = { Workbook, XErr, E, isErr, isRange, parse, parseA1, colToNum, numToCol, KEY, toText, compareVals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PPEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
