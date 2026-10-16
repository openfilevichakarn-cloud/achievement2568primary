/* render.js — วาดชีทเป็นตาราง HTML (หน้าจอ/พิมพ์) จากข้อมูลที่แปลงจาก Excel */
(function (root) {
  'use strict';
  const P = root.PPEngine;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ความหนาเส้นอิง --bw (= 1px ÷ อัตราซูม) ให้เส้นบางเท่าเดิมไม่ว่าจะซูมดู/พิมพ์ขนาดใด
  const W1 = 'var(--bw,1px)', W2 = 'calc(var(--bw,1px)*2)', W3 = 'calc(var(--bw,1px)*3)';
  const BSTYLE = {
    thin: W1 + ' solid', hair: W1 + ' dotted', dotted: W1 + ' dotted', dashed: W1 + ' dashed', dashDot: W1 + ' dashed', dashDotDot: W1 + ' dashed',
    medium: W2 + ' solid', mediumDashed: W2 + ' dashed', mediumDashDot: W2 + ' dashed', mediumDashDotDot: W2 + ' dashed', slantDashDot: W2 + ' dashed',
    thick: W3 + ' solid', double: W3 + ' double'
  };
  const FONT_STACK = "'TH Sarabun New','Sarabun','Noto Sans Thai',sans-serif";

  function styleCss(styles) {
    const out = [];
    styles.forEach((s, i) => {
      const f = s.f, a = s.a; let css = '';
      css += `font-family:${FONT_STACK};font-size:calc(${(f[1] || 11) * 4 / 3}px * var(--fs,1));color:${f[5]};`;
      if (f[2]) css += 'font-weight:700;'; if (f[3]) css += 'font-style:italic;';
      if (f[4] && f[4] !== 'none') css += 'text-decoration:underline;';
      if (s.bg) css += `background:${s.bg};`;
      const [l, r, t, b] = s.b;
      const side = (x, n) => x ? `border-${n}:${BSTYLE[x[0]] || BSTYLE.thin} ${x[1]};` : '';
      css += side(l, 'left') + side(r, 'right') + side(t, 'top') + side(b, 'bottom');
      const h = a[0], v = a[1];
      if (h === 'center' || h === 'centerContinuous') css += 'text-align:center;'; else if (h === 'right') css += 'text-align:right;'; else if (h === 'left') css += 'text-align:left;'; else if (h === 'justify') css += 'text-align:justify;';
      css += 'vertical-align:' + (v === 'center' ? 'middle' : v === 'top' ? 'top' : 'bottom') + ';';
      css += a[2] ? 'white-space:pre-wrap;word-break:break-word;' : 'white-space:pre;';
      out.push(`.s${i}{${css}}`);
      if (a[3]) out.push(`table.xl td.s${i}{padding-left:${a[3] * 9 + 2}px}`);   // เยื้อง (ต้องชนะ table.xl td{padding})
      if (a[2]) out.push(`table.xl td.s${i}{line-height:1.2}table.xl.cmp td.s${i}{line-height:1.25;padding-top:.15em;padding-bottom:.08em}`);   // ข้อความหลายบรรทัด: ระยะบรรทัดชิดที่สุดที่สระบน/ล่างไม่ทับกัน (TH Sarabun New)
      if (a[4] === 90 || a[4] === 180) out.push(`.s${i} .rot{writing-mode:vertical-rl;transform:rotate(180deg);display:inline-block;}`);
      else if (a[4] === 255) out.push(`.s${i} .rot{writing-mode:vertical-rl;text-orientation:upright;display:inline-block;}`);
    });
    return out.join('\n');
  }

  function fmtValue(v, style) {
    if (v && v.isRange) return '';
    if (v === null || v === undefined) return '';
    if (P.isErr(v)) return v.code;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') {
      const nf = style ? style.n : 'General';
      if (nf === '0') return String(Math.sign(v) * Math.round(Math.abs(v)));
      if (nf === '0.0' || nf === '0.00' || nf === '0.000') { const d = nf.length - 2; return v.toFixed(d); }
      if (nf === '@') return P.toText(v);
      if (Number.isInteger(v)) return String(v);
      return String(Number(v.toPrecision(10)));
    }
    return String(v);
  }

  let _cv = null;
  function textW(txt, st) {
    const f = st ? st.f : null, px = ((f && f[1]) || 16) * 4 / 3;
    try {
      if (typeof document !== 'undefined') {
        _cv = _cv || document.createElement('canvas').getContext('2d');
        _cv.font = `${f && f[2] ? 'bold ' : ''}${px}px ${FONT_STACK}`;
        return _cv.measureText(txt).width;
      }
    } catch (e) { /* ใช้ค่าประมาณ */ }
    return String(txt).length * px * 0.5;
  }

  function parseRange(s) {
    const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(s.replace(/^.*!/, '').replace(/'/g, ''));
    if (!m) return null;
    const c1 = P.colToNum(m[1]), r1 = +m[2], c2 = m[3] ? P.colToNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
    return { r1, c1, r2, c2 };
  }

  /**
   * สร้าง HTML ของชีท
   * opts: { wb, sheetName, view, edit, area, logo }
   */
  function sheetHtml(opts) {
    const { wb, sheetName, view, edit } = opts;
    const sh = wb.sheet(sheetName); const d = sh.def;
    const styles = opts.styles;
    let r1 = 1, c1 = 1, r2 = d.dim[0], c2 = d.dim[1];
    if (opts.area) { const a = parseRange(opts.area); if (a) { r1 = a.r1; c1 = a.c1; r2 = a.r2; c2 = a.c2; } }
    // merges
    const anchors = new Map(), covered = new Set();
    const merges = (view && view.mergeOv && view.mergeOv[sheetName]) || d.merges;   // ผสานเซลล์แบบปรับตามข้อมูล (เช่น ลายเซ็น)
    const colHidden = (c) => {
      const ov = view && view.colHidden && view.colHidden(sheetName, c);   // true/false = บังคับ, undefined = ตามไฟล์
      return ov !== undefined ? ov : !!(d.cw[c] && d.cw[c].h);
    };
    for (const m of merges) {
      const a = parseRange(m); if (!a) continue;
      // ถ้าคอลัมน์ต้นของช่องผสานถูกซ่อน ให้แสดงเนื้อหาที่คอลัมน์แรกที่มองเห็นในช่วงนั้นแทน
      let ac = a.c1; while (ac < a.c2 && colHidden(ac)) ac++;
      anchors.set(P.KEY(a.r1, ac), { ...a, src: a.c1 });
      for (let r = a.r1; r <= a.r2; r++) for (let c = a.c1; c <= a.c2; c++) if (r !== a.r1 || c !== ac) covered.add(P.KEY(r, c));
    }
    const rowHidden = (r) => {
      const ov = view && view.rowHidden && view.rowHidden[sheetName];
      if (ov && ov.has(r)) return ov.get(r);
      const x = d.rh[r]; return !!(x && x.x);
    };
    // ขยายคอลัมน์ให้ข้อความที่ไม่ตัดบรรทัด (เช่น ชื่อวิชา) แสดงครบ
    const extraW = {};
    for (const ft of (d.fit || [])) {
      const a = parseRange(ft.ref); if (!a) continue;
      let need = 0;
      for (let r = a.r1; r <= a.r2; r++) for (let c = a.c1; c <= a.c2; c++) {
        let v = wb.get(sh, r, c); if (v && v.isRange) v = wb.scalar(v);
        if (typeof v !== 'string' || !v) continue;
        const cell = sh.cells.get(P.KEY(r, c));
        need = Math.max(need, textW(v.replace(/\s*\n\s*/g, ' '), cell ? styles[cell.s] : null) + 12);
      }
      let have = 0; for (const c of ft.cols) have += Math.round(((d.cw[c] && d.cw[c].w) || d.dcw) * 7 + 5);
      if (need > have) for (const c of ft.cols) extraW[c] = (extraW[c] || 0) + (need - have) / ft.cols.length;
    }
    const colW = (c) => { const w = (d.cw[c] && d.cw[c].w) || d.dcw; return Math.max(0, Math.round(w * 7 + 5 + (extraW[c] || 0))); };
    const rowH = (r) => { const x = d.rh[r]; const h = (x && x.h) || d.drh; return Math.round(h * 4 / 3); };
    // ตำแหน่งเริ่มของแต่ละคอลัมน์/แถว (พิกเซล) ใช้วางรูปทรงและตราโรงเรียนทับตาราง
    const colX = {}, rowY = {}; let accX = 0, accY = 0;
    for (let c = c1; c <= c2 + 1; c++) { colX[c] = accX; if (c <= c2 && !colHidden(c)) accX += colW(c); }
    for (let r = r1; r <= r2 + 1; r++) { rowY[r] = accY; if (r <= r2 && !rowHidden(r)) accY += rowH(r); }
    const X = (c) => c < c1 ? 0 : c > c2 + 1 ? accX : colX[c];
    const Y = (r) => r < r1 ? 0 : r > r2 + 1 ? accY : rowY[r];
    let html = `<table class="xl${d.grid && edit ? ' grid' : ''}" data-sheet="${esc(sheetName)}" style="width:${accX}px"><colgroup>`;
    let totalW = 0;
    for (let c = c1; c <= c2; c++) { if (colHidden(c)) continue; const w = colW(c); totalW += w; html += `<col style="width:${w}px">`; }
    html += '</colgroup><tbody>';
    let totalH = 0; const rowsOut = [];
    const bgOv = (view && view.bg && view.bg[sheetName]) || null;
    const breaks = new Set((d.print && d.print.breaks) || []);
    for (let r = r1; r <= r2; r++) {
      if (rowHidden(r)) continue;
      const h = rowH(r); totalH += h; rowsOut.push(r);
      html += `<tr data-r="${r}" style="height:${h}px"${(!edit && breaks.has(r - 1)) ? ' class="pbreak"' : ''}>`;
      for (let c = c1; c <= c2; c++) {
        if (colHidden(c)) continue;
        const key = P.KEY(r, c);
        if (covered.has(key)) continue;
        const a = anchors.get(key);
        const sc = a ? a.src : c;   // คอลัมน์ต้นทางของเนื้อหา (ต่างจาก c เมื่อช่องผสานถูกย้ายจุดแสดง)
        const cell = sh.cells.get(P.KEY(r, sc));
        const si = cell ? cell.s : -1; const st = cell ? styles[si] : null;
        let attrs = '', cls = cell ? 's' + si : 'sx';
        if (a) {
          let cs = 0, rs = 0;
          for (let cc = a.c1; cc <= a.c2; cc++) if (!colHidden(cc) && cc <= c2) cs++;
          for (let rr = a.r1; rr <= a.r2; rr++) if (!rowHidden(rr) && rr <= r2) rs++;
          if (cs > 1) attrs += ` colspan="${cs}"`; if (rs > 1) attrs += ` rowspan="${rs}"`;
        }
        let v = wb.get(sh, r, sc); if (v && v.isRange) v = wb.scalar(v);
        const editable = !!(cell && cell.u) && edit && !(view && view.locked && view.locked.has(sheetName + '!' + P.numToCol(c) + r));
        if (editable) cls += ' inp';
        const sp = [];
        const ov = bgOv && bgOv[P.numToCol(c) + r];
        if (ov) sp.push(`background:${ov === 'none' ? 'transparent' : ov}`);
        // เส้นขอบของเซลล์ผสาน: ใช้ขอบขวา/ล่างจากเซลล์มุมขวาล่าง
        if (a && (a.c2 > a.c1 || a.r2 > a.r1)) {
          const edge = (rr, cc) => { const x = sh.cells.get(P.KEY(rr, cc)); return x ? styles[x.s] : null; };
          const sr = edge(a.r1, a.c2), sb = edge(a.r2, a.c1);
          const mk = (x, n) => x ? `border-${n}:${BSTYLE[x[0]] || BSTYLE.thin} ${x[1]}` : null;
          if (sr && mk(sr.b[1], 'right')) sp.push(mk(sr.b[1], 'right'));
          if (sb && mk(sb.b[3], 'bottom')) sp.push(mk(sb.b[3], 'bottom'));
        }
        // ข้อความยาวที่ไม่ตัดบรรทัด ไหลทับช่องถัดไปที่ว่างได้ เหมือน Excel
        if (st && !st.a[2] && typeof v === 'string' && v !== '' && (!st.a[0] || st.a[0] === 'left')) {
          const nc = a ? a.c2 + 1 : c + 1;
          let nx = wb.get(sh, r, nc); if (nx && nx.isRange) nx = null;
          if ((nx === null || nx === '') && !covered.has(P.KEY(r, nc)) && !anchors.has(P.KEY(r, nc))) sp.push('overflow:visible');
        }
        const style = sp.length ? ` style="${sp.join(';')}"` : '';
        let txt = fmtValue(v, st);
        if (st && !st.a[2] && txt.indexOf('\n') >= 0) txt = txt.replace(/\s*\n\s*/g, ' ');   // Excel ไม่ตัดบรรทัดถ้าไม่ได้เปิด wrap
        const rot = st && (st.a[4] === 90 || st.a[4] === 180 || st.a[4] === 255);
        const body = rot ? `<span class="rot">${esc(txt)}</span>` : esc(txt);
        const num = typeof v === 'number';
        const align = (st && !st.a[0] && num) ? ' num' : '';
        const tip = cell && cell.cm ? ` title="${esc(cell.cm)}"` : '';
        const dvl = edit && editable && opts.hasList && opts.hasList(sheetName, r, c) ? ' dvl' : '';
        let logoHtml = '', lcls = '';
        const an = opts.logo && opts.logoAt ? opts.logoAt(sheetName) : null;
        if (an && an.fit && an.r === r && an.c === c) { lcls = ' hasLogo'; logoHtml = `<img class="logo fit" alt="ตราโรงเรียน" src="${opts.logo}">`; }
        html += `<td class="${cls}${align}${dvl}${lcls}" data-r="${r}" data-c="${c}"${attrs}${style}${tip}>${body}${logoHtml}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    let over = '';
    // รูปทรงที่วางทับเซลล์ (เช่น ช่องสี่เหลี่ยมติ๊กถูก)
    for (const g of (d.shapes || [])) {
      let l, t, w, h;
      if (g.rel) {   // วางชิดซ้ายของเซลล์ที่กำหนด กึ่งกลางแนวตั้งของแถว (เช่น ช่องติ๊ก อนุมัติ/ไม่อนุมัติ)
        const a = parseRange(g.rel.cell); if (!a || a.c1 < c1 || a.c1 > c2 || a.r1 < r1 || a.r1 > r2) continue;
        w = g.rel.w; h = g.rel.h;
        l = X(a.c1) + g.rel.dx - w; t = Y(a.r1) + (Y(a.r1 + 1) - Y(a.r1) - h) / 2;
      } else {
        const [fc, fco, fr, fro] = g.from, [tc, tco, tr, tro] = g.to;
        if (fc + 1 < c1 || tc + 1 > c2 + 1 || fr + 1 < r1 || tr + 1 > r2 + 1) continue;
        l = X(fc + 1) + fco / 9525; t = Y(fr + 1) + fro / 9525;
        w = X(tc + 1) + tco / 9525 - l; h = Y(tr + 1) + tro / 9525 - t;
      }
      if (w <= 0 || h <= 0) continue;
      over += `<div class="xlshape" style="position:absolute;box-sizing:border-box;pointer-events:none;left:${l.toFixed(1)}px;top:${t.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;${g.fill ? 'background:' + g.fill + ';' : ''}${g.line ? 'border:' + g.lw + 'px solid ' + g.line + ';' : ''}${g.g === 'ellipse' ? 'border-radius:50%;' : g.g === 'roundRect' ? 'border-radius:8px;' : ''}"></div>`;
    }
    // ตราโรงเรียน (ไม่ถูกตัดด้วยขอบช่อง): มุมซ้ายบนของช่อง ไม่เกิน 3x2 ซม. และไม่ล้ำแถว limitRow เหมือนมาโครใน Excel
    const lan = opts.logo && opts.logoAt ? opts.logoAt(sheetName) : null;
    if (lan && !lan.fit && lan.r >= r1 && lan.r <= r2 && lan.c >= c1 && lan.c <= c2) {
      const lim = Math.min(Math.max(lan.limitRow || lan.r + 1, lan.r + 1), r2 + 1);
      const maxH = Math.max(14, Math.min(76, Y(lim) - Y(lan.r) - 4));
      over += `<img class="logo ov" alt="ตราโรงเรียน" style="position:absolute;object-fit:contain;pointer-events:none;left:${(X(lan.c) + 3).toFixed(1)}px;top:${(Y(lan.r) + 3).toFixed(1)}px;max-height:${maxH}px;max-width:113px" src="${opts.logo}">`;
    }
    html = `<div class="xlbox" style="position:relative;width:${totalW}px">${html}${over}</div>`;
    return { html, width: totalW, height: totalH };
  }

  root.PPRender = { styleCss, sheetHtml, fmtValue, parseRange, esc };
})(typeof window !== 'undefined' ? window : globalThis);
