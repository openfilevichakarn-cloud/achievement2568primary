/* macros.js — พอร์ตมาโคร VBA ของไฟล์ Excel มาเป็น JavaScript (ทำงานเหมือนเดิม)
 *  Update1_Full  : จัดชื่อวิชาตามหัวข้อ (ความสามารถ 1-8) ลงชีท ปพ.6 รวม แล้วคัดลอกไป ข้อมูลป.N
 *  HideReportRows: ซ่อนแถวว่างและแถวลายเซ็นรอง ผอ. ในชีท ปพ.6
 *  Worksheet_Change ของชีทต่าง ๆ (เลือกนักเรียน, ข้อมูลวิชา A:C, รอง ผอ. B7)
 *  ปริ้นทีละคน / ปริ้นทั้งหมด (รวม/เทอม1/เทอม2) */
(function (root) {
  'use strict';
  const P = root.PPEngine;

  function detectNames(wb) {
    const all = wb.sheets.map(s => s.name);
    const find = (re) => all.find(n => re.test(n));
    const sum = find(/^ปพ\.6 .*รวม$/);
    const term = (k) => find(new RegExp('^ปพ\\.6 .* เทอม' + k + '$'));
    const beh = (k) => find(new RegExp('^ป\\.\\d-\\d+ เทอม' + k + '$'));
    return {
      info: 'ข้อมูลพื้นฐาน', subj: 'ข้อมูลวิชา',
      sum, sumBeh: find(/^ป\.\d-\d+$/),
      p1: find(/^ข้อมูลป\.\d+$/),
      term: [null, term(1), term(2)], termBeh: [null, beh(1), beh(2)],
      // ป.3 / ป.6: หน้าสรุปประถมศึกษาตอนต้น / ตอนปลาย และหน้าคำอธิบายพฤติกรรมของหน้านั้น
      stage: find(/^ปพ\.6 ประถมตอน/), stageBeh: find(/^ป\.\d-\d+ ประถมตอน/),
    };
  }

  function lastNonEmptyRow(wb, sh, col) {
    let last = 1;
    for (let r = 1; r <= sh.maxR + 5; r++) { const v = wb.get(sh, r, col); if (v !== null && v !== '') last = r; }
    return last;
  }

  function hideReportRows(ctx) {
    const { wb, view, names } = ctx;
    const src = wb.sheet(names.sum);
    // ว่าง = ไม่ได้กรอก หรือยังเป็นข้อความตัวอย่างในแบบฟอร์ม ("กรุณากรอก...")
    const blank = (r) => { const v = String(wb.get(wb.sheet(names.info), r, 2) ?? '').trim(); return !v || /^กรุณากรอก/.test(v); };
    const noAcad = blank(6), noDeputy = blank(7);   // ข้อมูลพื้นฐาน B6 หัวหน้างานวิชาการ, B7 รอง ผอ.
    const rowMap = (nm) => { let m = view.rowHidden[nm]; if (!m) { m = new Map(); view.rowHidden[nm] = m; } return m; };
    view.mergeOv = view.mergeOv || {};
    for (const nm of [names.sum, names.term[1], names.term[2]]) {
      if (!nm) continue;
      const m = rowMap(nm);
      for (let r = 6; r <= 29; r++) { const v = wb.get(src, r, 5); m.set(r, String(v === null ? '' : v).trim().length === 0); }
      for (let r = 37; r <= 39; r++) m.set(r, noDeputy);
      // ไม่มีหัวหน้างานวิชาการ: ลายเซ็นครูประจำชั้น (A33:A35) ขยายเต็มแถว อยู่กึ่งกลางตรงกับผู้อำนวยการ
      const def = wb.sheet(nm).def;
      if (noAcad) {
        const keep = def.merges.filter(x => !/^[AC]3[345]:/.test(x));
        view.mergeOv[nm] = keep.concat(['A33:G33', 'A34:G34', 'A35:G35']);
      } else delete view.mergeOv[nm];
    }
    // หน้าสรุปประถมตอนต้น/ตอนปลาย: หาแถวลายเซ็นจากสูตร (ข้อมูลพื้นฐาน!B5 ครู / B6 วิชาการ / B7 รอง ผอ.)
    if (names.stage) {
      const sh = wb.sheet(names.stage), def = sh.def, m = rowMap(names.stage);
      let rT = 0, rD = 0, last = 'H';
      for (const cell of sh.cells.values()) {
        const f = cell.f || '';
        if (/ข้อมูลพื้นฐาน!B5/.test(f) && cell.c === 1) rT = cell.r;
        if (/ข้อมูลพื้นฐาน!B7/.test(f) && cell.c === 1) rD = cell.r;
      }
      if (rD) for (let r = rD - 1; r <= rD + 1; r++) m.set(r, noDeputy);
      if (rT && noAcad) {
        const rows = [rT - 1, rT, rT + 1];
        const keep = def.merges.filter(x => { const mm = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(x); return !(mm && rows.includes(+mm[1])); });
        view.mergeOv[names.stage] = keep.concat(rows.map(r => `A${r}:${last}${r}`));
      } else delete view.mergeOv[names.stage];
    }
    // ปก ปพ.5: ซ่อนแถวลายเซ็นรอง ผอ. / หัวหน้างานวิชาการ เมื่อไม่ได้ใส่ชื่อ
    for (const sh of wb.sheets) {
      if (!/^ปก ปพ\.5/.test(sh.name)) continue;
      const m = rowMap(sh.name);
      for (const cell of sh.cells.values()) {
        if (typeof cell.v === 'string' && cell.v.endsWith('รองผู้อำนวยการโรงเรียน')) m.set(cell.r, noDeputy);
        else if (typeof cell.v === 'string' && cell.v.endsWith('หัวหน้างานวิชาการโรงเรียน')) m.set(cell.r, noAcad);
      }
    }
    // หน้าคำอธิบายพฤติกรรม: ซ่อนแถวของความสามารถที่ไม่ใช้ (ชื่อว่างใน ปพ.6 รวม!I6:I13)
    for (const nm of [names.sumBeh, names.termBeh[1], names.termBeh[2]]) {
      if (!nm) continue;
      let m = view.rowHidden[nm]; if (!m) { m = new Map(); view.rowHidden[nm] = m; }
      for (let i = 0; i < 8; i++) { const v = wb.get(src, 6 + i, 9); m.set(4 + i, String(v === null ? '' : v).trim().length === 0); }
    }
  }

  function setBg(view, sheet, ref, color) { (view.bg[sheet] = view.bg[sheet] || {})[ref] = color; }

  function update1Full(ctx) {
    const { wb, view, names, toast } = ctx;
    const wsD = wb.sheet(names.subj), ws2 = names.sum, wsP = wb.sheet(names.p1);
    const lastRow = lastNonEmptyRow(wb, wsD, 1);
    const startRow = 6;
    // ล้างค่า + สี + แสดงแถว
    for (let r = startRow; r < startRow + 24; r++) {
      wb.setValue(ws2, { r, c: 5 }, null);
      setBg(view, ws2, 'A' + r, 'none');
      setBg(view, ws2, 'E' + r, 'none');
      for (const nm of [ws2]) { (view.rowHidden[nm] = view.rowHidden[nm] || new Map()).set(r, false); }
    }
    const count = new Array(9).fill(0); let overflow = '';
    for (let r = 2; r <= lastRow; r++) {
      const subject = wb.get(wsD, r, 1); let cat = wb.get(wsD, r, 3);
      if (cat === null || cat === '' || typeof cat === 'boolean') continue;
      if (typeof cat === 'string') { const n = Number(cat.trim()); if (!isFinite(n) || cat.trim() === '') continue; cat = n; }
      if (typeof cat !== 'number') continue;
      cat = Math.trunc(cat);
      const sName = subject === null ? '' : String(subject);
      if (sName !== '' && cat >= 1 && cat <= 8) {
        const baseRow = startRow + (cat - 1) * 3;
        if (count[cat] < 3) {
          wb.setValue(ws2, { r: baseRow + count[cat], c: 5 }, sName);
          setBg(view, ws2, 'E' + (baseRow + count[cat]), 'none');
          count[cat]++;
        } else {
          overflow += 'หัวข้อ ' + cat + ' เกิน 3 วิชา\n';
          for (let k = 0; k < 3; k++) setBg(view, ws2, 'A' + (baseRow + k), '#FFC7CE');
        }
      }
    }
    hideReportRows(ctx);
    if (overflow && toast) toast('วิชาเกินกำหนด\n' + overflow, 'warn');
    // คัดลอกชื่อวิชาไปยัง ข้อมูลป.N แถว 2 เริ่มคอลัมน์ E
    for (let c = 5; c <= wsP.maxC + 2; c++) wb.setValue(names.p1, { r: 2, c }, null);
    let c = 5;
    for (let r = startRow; r < startRow + 24; r++) {
      const v = wb.get(wb.sheet(ws2), r, 5);
      if (v !== null && String(v).trim() !== '') { wb.setValue(names.p1, { r: 2, c }, v); c++; }
    }
  }

  // คืน true ถ้ายอมรับค่า, false ถ้าต้องยกเลิกการแก้ (เหมือน Target.ClearContents)
  function onChange(ctx, sheetName, r, c) {
    const { wb, names, toast } = ctx;
    // ข้อมูลพื้นฐาน!B7 -> ซ่อน/แสดงลายเซ็นรอง ผอ.
    if (sheetName === names.info && (r === 6 || r === 7) && c === 2) hideReportRows(ctx);
    // ชื่อความสามารถ (ปพ.6 รวม!I6:I13) -> ซ่อน/แสดงแถวในหน้าคำอธิบายพฤติกรรม
    if (sheetName === names.sum && c === 9 && r >= 6 && r <= 13) hideReportRows(ctx);
    // ข้อมูลวิชา คอลัมน์ A:C
    if (sheetName === names.subj && c >= 1 && c <= 3) {
      if (c === 3) {
        const cat = wb.get(wb.sheet(names.subj), r, 3);
        if (cat !== null && cat !== '') {
          let n = 0; const sh = wb.sheet(names.subj);
          for (let rr = 1; rr <= sh.maxR + 5; rr++) { const x = wb.get(sh, rr, 3); if (x !== null && x !== '' && String(x) === String(cat)) n++; }
          if (n > 3) { if (toast) toast('หัวข้อนี้ใส่ได้ไม่เกิน 3 วิชา', 'warn'); wb.setValue(sheetName, { r, c }, null); return false; }
        }
      }
      update1Full(ctx);
    }
    return true;
  }

  // เลือกนักเรียนที่ B3 ของชีท ปพ.6 เทอม -> ส่งไปชีทรวม
  function redirectStudent(ctx, sheetName, r, c) {
    const { names } = ctx;
    if (r === 3 && (c === 2 || c === 3) && (sheetName === names.term[1] || sheetName === names.term[2])) return { sheet: names.sum, r: 3, c: 2 };
    return null;
  }

  function studentList(ctx) {
    const { wb, names } = ctx; const sh = wb.sheet(names.p1); const out = [];
    for (let r = 3; r <= 42; r++) { const v = wb.get(sh, r, 2); if (v !== null && v !== '') out.push(v); }
    return out;
  }

  // ปริ้นทีละคน / ทั้งหมด. printFn(listOfSheetNames) -> Promise ที่เสร็จเมื่อเตรียมหน้าพิมพ์แล้ว
  function sheetsFor(ctx, which) { // which: 'sum'|1|2
    const { names } = ctx;
    if (which === 'sum') return [names.sum, names.sumBeh];
    if (which === 'stage') return [names.stage, names.stageBeh];
    return [names.term[which], names.termBeh[which]];
  }

  root.PPMacros = { detectNames, update1Full, hideReportRows, onChange, redirectStudent, studentList, sheetsFor };
})(typeof window !== 'undefined' ? window : globalThis);
