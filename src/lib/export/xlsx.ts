import "server-only";

import { crc32 } from "node:zlib";

import { neutraliseFormula, type Cell } from "@/lib/export/csv";

// A minimal XLSX writer: one worksheet, text and number cells, a bold header
// row. An .xlsx file is a ZIP of XML parts; they are stored uncompressed, which
// every spreadsheet application accepts and needs no third-party library.

const xml = (value: string) =>
  value
    // Characters XML 1.0 cannot carry.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function columnName(index: number) {
  let name = "";
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + ((i - 1) % 26)) + name;
  return name;
}

function cell(value: Cell, ref: string, style: number) {
  if (value === null || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(neutraliseFormula(value))}</t></is></c>`;
}

function sheetXml(headers: string[], rows: Cell[][]) {
  const all: { cells: Cell[]; style: number }[] = [{ cells: headers, style: 1 }, ...rows.map((cells) => ({ cells, style: 0 }))];
  const body = all
    .map((row, r) => `<row r="${r + 1}">${row.cells.map((value, c) => cell(value, `${columnName(c)}${r + 1}`, row.style)).join("")}</row>`)
    .join("");
  const widths = headers.map((header, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(40, Math.max(10, header.length + 4))}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${body}</sheetData></worksheet>`;
}

const PARTS = (sheetName: string, sheet: string): [string, string][] => [
  [
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  ],
  [
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ],
  [
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  ],
  [
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  ],
  [
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
  ],
  ["xl/worksheets/sheet1.xml", sheet],
];

/** ZIP container with stored (uncompressed) entries. */
function zip(files: [string, string][]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt32LE(0x00210000, 10); // fixed timestamp (1980-01-01)
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(0x00210000, 12);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function toXlsx(sheetName: string, headers: string[], rows: Cell[][]): Buffer {
  return zip(PARTS(sheetName, sheetXml(headers, rows)));
}
