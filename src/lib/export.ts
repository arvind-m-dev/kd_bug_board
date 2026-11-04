/** Client-side report exports: CSV text that opens cleanly in Excel and Sheets, and a download trigger. */

/**
 * Spreadsheet apps run a cell that starts with = + - @ (or tab/CR) as a formula, so user text such as a bug titled
 * `=HYPERLINK(...)` gets a leading apostrophe. Real numbers (including negatives) are left alone.
 */
export function neutralizeFormula(s: string) {
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s))) return `'${s}`;
  return s;
}
const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : typeof v === "number" ? String(v) : neutralizeFormula(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** RFC 4180 CSV with CRLF rows; a header row first. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/**
 * Saves text as a file from the browser; the BOM makes Excel read UTF-8 (names with accents) correctly. Pass
 * `bom: false` for files meant for importers (Jira) that would read the BOM into the first column name.
 */
export function downloadText(
  filename: string,
  text: string,
  type = "text/csv;charset=utf-8",
  { bom = type.startsWith("text/csv") }: { bom?: boolean } = {},
) {
  const url = URL.createObjectURL(new Blob([bom ? `\uFEFF${text}` : text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "team-report-last-30-days-2026-10-22.csv" */
export const exportName = (base: string, ext = "csv") =>
  `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`;
