export type Cell = string | number | null;

/**
 * Spreadsheet applications run cells that start with = + - @ as formulas.
 * Text from the database (titles, names) is prefixed so it is always shown as text.
 */
export function neutraliseFormula(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: Cell) {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = neutraliseFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a UTF-8 byte-order mark so Excel reads non-ASCII text (₹, names) correctly. */
export function toCsv(headers: string[], rows: Cell[][]) {
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
