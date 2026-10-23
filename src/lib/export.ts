/** Client-side report exports: CSV text that opens cleanly in Excel and Sheets, and a download trigger. */

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** RFC 4180 CSV with CRLF rows; a header row first. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Saves text as a file from the browser; the BOM makes Excel read UTF-8 (names with accents) correctly. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(
    new Blob([type.startsWith("text/csv") ? `\uFEFF${text}` : text], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "team-report-last-30-days-2026-10-22.csv" */
export const exportName = (base: string, ext = "csv") =>
  `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`;
