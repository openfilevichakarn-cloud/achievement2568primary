/* xlsx.js — สร้างไฟล์ Excel (.xlsx) อย่างง่ายในเบราว์เซอร์ (ไม่ใช้ไลบรารีภายนอก) สำหรับแบบฟอร์มให้ครูกรอกแล้วคัดลอกมาวาง
 * PPXlsx.download(filename, { name, title, cols:[ความกว้าง], head:[...], rows:[[...]], ref:จำนวนคอลัมน์อ้างอิง(สีเทา),
 *                              valid:[{ col, type:'list'|'decimal', list:[...], min, max, msg }], note })   */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (n) => { let s = ''; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; } return s; };

  // ---- zip (stored, ไม่บีบอัด)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const parts = [], dir = []; let off = 0;
    for (const [name, text] of files) {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const d = new DataView(new ArrayBuffer(46));
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true);
      d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, nb.length, true); d.setUint32(42, off, true);
      dir.push(new Uint8Array(d.buffer), nb);
      off += 30 + nb.length + data.length;
    }
    const size = dir.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...dir, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // สไตล์: 0 ปกติ · 1 หัวข้อเอกสาร · 2 หัวตาราง · 3 ช่องอ้างอิง (เทา) · 4 ช่องกรอก · 5 หมายเหตุ
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="13"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font><font><sz val="10"/><color rgb="FF667085"/><name val="Tahoma"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBE7FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFB8C0CC"/></left><right style="thin"><color rgb="FFB8C0CC"/></right><top style="thin"><color rgb="FFB8C0CC"/></top><bottom style="thin"><color rgb="FFB8C0CC"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function cell(r, c, v, s) {
    const ref = colName(c) + r;
    if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
    if (typeof v === 'number') return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }
  function sheetXml(o) {
    const nc = o.head.length, ref = o.ref || 0, r0 = 3, rN = r0 + o.rows.length - 1;
    const rows = [];
    rows.push(`<row r="1" ht="24" customHeight="1">${cell(1, 1, o.title, 1)}</row>`);
    rows.push(`<row r="2" ht="42" customHeight="1">${o.head.map((h, i) => cell(2, i + 1, h, 2)).join('')}</row>`);
    o.rows.forEach((row, i) => rows.push(`<row r="${r0 + i}">${row.map((v, j) => cell(r0 + i, j + 1, v, j < ref ? 3 : 4)).join('')}</row>`));
    if (o.note) rows.push(`<row r="${rN + 2}" ht="60" customHeight="1">${cell(rN + 2, 1, o.note, 5)}</row>`);
    const dv = (o.valid || []).map(v => {
      const sq = `${colName(v.col)}${r0}:${colName(v.col)}${Math.max(rN, r0)}`;
      const msg = v.msg ? ` showErrorMessage="1" errorTitle="ค่าไม่ถูกต้อง" error="${xesc(v.msg)}"` : '';
      if (v.type === 'list') return `<dataValidation type="list" allowBlank="1"${msg} sqref="${sq}"><formula1>"${xesc(v.list.join(','))}"</formula1></dataValidation>`;
      return `<dataValidation type="decimal" operator="between" allowBlank="1"${msg} sqref="${sq}"><formula1>${v.min}</formula1><formula2>${v.max}</formula2></dataValidation>`;
    });
    const merges = [`A1:${colName(nc)}1`].concat(o.note ? [`A${rN + 2}:${colName(nc)}${rN + 2}`] : []);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" zoomScale="110"><pane xSplit="${ref}" ySplit="2" topLeftCell="${colName(ref + 1)}3" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${colName(ref + 1)}3" sqref="${colName(ref + 1)}3"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${o.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>
${dv.length ? `<dataValidations count="${dv.length}">${dv.join('')}</dataValidations>` : ''}
<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
</worksheet>`;
  }
  function build(o) {
    const name = xesc(String(o.name || 'Sheet1').replace(/[\\/?*[\]:]/g, '').slice(0, 31));
    return zip([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', STYLES],
      ['xl/worksheets/sheet1.xml', sheetXml(o)],
    ]);
  }
  function download(filename, o) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(build(o)); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  root.PPXlsx = { build, download };
})(typeof window !== 'undefined' ? window : globalThis);
