"use strict";

const travelWorkbook = (() => {
  const sheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const documentRels = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageRels = "http://schemas.openxmlformats.org/package/2006/relationships";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  const styles = { plain: 0, title: 1, header: 2, money: 3, date: 4, totalLabel: 5, total: 6, detail: 7 };

  function xml(value) {
    return value.toWellFormed()
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/_x[0-9a-f]{4}_/gi, (match) => "_x005F_" + match.slice(1))
      .replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
  }

  function cell(address, value, style = styles.plain) {
    const attributes = `r="${address}" s="${style}"`;
    if (typeof value === "number") return `<c ${attributes}><v>${value}</v></c>`;
    return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  function excelDate(value) {
    if (value < "1900-01-01") return value;
    const epoch = Date.UTC(1899, 11, 31);
    const day = (Date.parse(value + "T00:00:00Z") - epoch) / 86400000;
    return day + Number(value >= "1900-03-01");
  }

  function worksheet(trip, result, name, source) {
    const rows = [];
    function row(...entries) {
      const number = rows.length + 1;
      const nodes = entries.map((entry, index) =>
        entry ? cell("ABC"[index] + number, ...entry) : "").join("");
      const rowSize = entries[0]?.[1] === styles.title ? ' ht="25" customHeight="1"' : "";
      rows.push(`<row r="${number}"${rowSize}>${nodes}</row>`);
    }

    row();
    row(["국내 출장여비 계산 결과", styles.title]);
    row(["출장 건 이름"], null, [name, styles.detail]);
    row(["출장일"], [excelDate(trip.start), styles.date]);
    row(["복귀일"], [excelDate(trip.end), styles.date]);
    row(["출장 구분"], null, [result.period, styles.detail]);
    row(["예상 지급액 (원)", styles.totalLabel], [result.total, styles.total]);
    row();
    row(["지급 항목", styles.header], ["금액 (원)", styles.header], ["계산 근거", styles.header]);
    for (const { label, amount, detail } of result.rows) {
      row([label], [amount, styles.money], [detail, styles.detail]);
    }
    for (const [heading, items] of [["검토 사항", result.notes], ["정산 확인", result.settlement]]) {
      if (!items.length) continue;
      row();
      row([heading, styles.totalLabel]);
      for (const item of items) row(null, null, [item, styles.detail]);
    }
    row();
    row(["계산 기준"], null, [source, styles.detail]);

    return `<worksheet xmlns="${sheetNs}">
      <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
      <sheetFormatPr defaultRowHeight="17"/>
      <cols>
        <col min="1" max="1" width="25" customWidth="1"/>
        <col min="2" max="2" width="18" customWidth="1"/>
        <col min="3" max="3" width="76" customWidth="1"/>
      </cols>
      <sheetData>${rows.join("")}</sheetData>
    </worksheet>`;
  }

  const styleSheet = `<styleSheet xmlns="${sheetNs}">
    <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
    <fonts count="4">
      <font><sz val="11"/><name val="Malgun Gothic"/></font>
      <font><b/><sz val="16"/><color rgb="FF103C38"/><name val="Malgun Gothic"/></font>
      <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Malgun Gothic"/></font>
      <font><b/><sz val="11"/><color rgb="FF103C38"/><name val="Malgun Gothic"/></font>
    </fonts>
    <fills count="3">
      <fill><patternFill patternType="none"/></fill>
      <fill><patternFill patternType="gray125"/></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF126658"/><bgColor indexed="64"/></patternFill></fill>
    </fills>
    <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="8">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
      <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
      <xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
      <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
      <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
      <xf numFmtId="3" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    </cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  </styleSheet>`;

  function relationships(entries) {
    const children = entries.map(([type, target], index) =>
      `<Relationship Id="rId${index + 1}" Type="${documentRels}/${type}" Target="${target}"/>`).join("");
    return `<Relationships xmlns="${packageRels}">${children}</Relationships>`;
  }

  async function download(trip, result, name, source) {
    const zip = new JSZip();
    const parts = {
      "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      </Types>`,
      "_rels/.rels": relationships([["officeDocument", "xl/workbook.xml"]]),
      "xl/workbook.xml": `<workbook xmlns="${sheetNs}" xmlns:r="${documentRels}"><bookViews><workbookView/></bookViews><sheets>
        <sheet name="출장여비 결과" sheetId="1" r:id="rId1"/>
      </sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": relationships([["worksheet", "worksheets/sheet1.xml"], ["styles", "styles.xml"]]),
      "xl/styles.xml": styleSheet,
      "xl/worksheets/sheet1.xml": worksheet(trip, result, name, source),
    };
    for (const [path, contents] of Object.entries(parts)) zip.file(path, declaration + contents);

    const blob = await zip.generateAsync({ type: "blob", mimeType: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "출장여비_" + trip.start + ".xlsx";
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  return { download };
})();
