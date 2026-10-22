import { FILLS, PLATFORMS, SHEET_COLUMNS, SHEET_CORE_COLUMNS, SHEET_STATUS, bandLabel, dayKey, priorityLabel, priorityTextIsLight, toSheetRow, type SheetKey } from './bug-sheet';
import { PRIORITIES, type ExportBug } from './bug-workflow';

/** Builds the .xlsx in the browser with exceljs (loaded only when exporting): the team's layout, colours, dropdowns, links, frozen header and day bands. */
export async function buildBugWorkbook(bugs: ExportBug[], lists: { categories: string[]; builds: string[]; people: string[] }, origin: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'BugFlow'; wb.created = new Date();
  const ws = wb.addWorksheet('Bugs', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = SHEET_COLUMNS.map(c => ({ key: c.key, width: c.width }));
  const last = SHEET_COLUMNS.length; const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }; const border = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${argb}` } });
  // Header: the team's lavender row, bold, centred, with the extra columns after M a shade lighter.
  const header = ws.addRow(SHEET_COLUMNS.map(c => c.header)); header.height = 30;
  header.eachCell((cell, col) => { cell.fill = fill(col <= SHEET_CORE_COLUMNS ? FILLS.header : 'EFEDF5'); cell.font = { bold: true, size: 10 }; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; cell.border = border; });
  const people = new Map<string, string>(); const personFill = (name: string) => { if (!people.has(name)) people.set(name, FILLS.people[people.size % FILLS.people.length]!); return people.get(name)!; };
  let day = '';
  for (const bug of bugs) {
    const row = toSheetRow(bug, origin);
    if (dayKey(row.createdAt) !== day) {
      day = dayKey(row.createdAt);
      const band = ws.addRow([bandLabel(row.createdAt)]); band.height = 22; ws.mergeCells(band.number, 1, band.number, last);
      const cell = band.getCell(1); cell.fill = fill(FILLS.band); cell.font = { bold: true, size: 11 }; cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    const values: Record<string, unknown> = { ...row, date: new Date(row.createdAt), updated: new Date(row.updated) };
    const r = ws.addRow(SHEET_COLUMNS.map(c => values[c.key]));
    r.alignment = { vertical: 'top', wrapText: true };
    r.eachCell({ includeEmpty: true }, cell => { cell.border = border; cell.font = { size: 10 }; });
    const at = (k: SheetKey) => r.getCell(SHEET_COLUMNS.findIndex(c => c.key === k) + 1);
    at('ticket').font = { size: 10, bold: true };
    at('date').numFmt = 'dd mmm yyyy'; at('updated').numFmt = 'dd mmm yyyy hh:mm';
    const chip = (k: SheetKey, argb: string | undefined, light = false) => { if (!argb) return; const c = at(k); c.fill = fill(argb); c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.font = { size: 10, bold: true, color: { argb: light ? 'FFFFFFFF' : 'FF222222' } }; };
    chip('platform', FILLS.platform[row.platform]); chip('status', FILLS.status[row.status]); chip('priority', FILLS.priority[bug.priority], priorityTextIsLight(bug.priority));
    if (row.category) chip('category', 'D0E0E3'); if (row.assignee) chip('assignee', personFill(row.assignee));
    if (row.mediaLinks.length) { const c = at('media'); c.value = { text: row.media, hyperlink: row.mediaLinks[0]!.url, tooltip: row.mediaLinks.length > 1 ? 'First link opens; the others are listed as text' : row.mediaLinks[0]!.url }; c.font = { size: 10, color: { argb: 'FF1155CC' }, underline: true }; }
    const link = at('link'); link.value = { text: 'Open bug', hyperlink: row.bugUrl, tooltip: row.bugUrl }; link.font = { size: 10, color: { argb: 'FF1155CC' }, underline: true };
  }
  // Dropdowns like the sheet's: the lists live on a hidden sheet so long lists work.
  const listSheet = wb.addWorksheet('Lists', { state: 'veryHidden' });
  let listCol = 0;
  const listRef = (name: string, items: string[]) => { const col = ++listCol; listSheet.getColumn(col).values = [name, ...items]; const letter = listSheet.getColumn(col).letter; return items.length ? `Lists!$${letter}$2:$${letter}$${items.length + 1}` : null; };
  const validations: [SheetKey, string | null][] = [
    ['platform', listRef('Platform', [...PLATFORMS])], ['category', listRef('Category', lists.categories)], ['build', listRef('Build', lists.builds)],
    ['status', listRef('Status', [...new Set(Object.values(SHEET_STATUS))])], ['priority', listRef('Priority', PRIORITIES.map(priorityLabel))], ['assignee', listRef('Assignee', lists.people)],
  ];
  const lastRow = Math.max(ws.rowCount, 2) + 200;
  for (const [key, ref] of validations) { if (!ref) continue; const letter = ws.getColumn(SHEET_COLUMNS.findIndex(c => c.key === key) + 1).letter; (ws as unknown as { dataValidations: { add: (range: string, rule: object) => void } }).dataValidations.add(`${letter}2:${letter}${lastRow}`, { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: false }); }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: last } };
  return wb;
}
/** The workbook as a downloadable file (browser). */
export async function buildBugSheet(...args: Parameters<typeof buildBugWorkbook>): Promise<Blob> { const wb = await buildBugWorkbook(...args); const buffer = await wb.xlsx.writeBuffer(); return new Blob([buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
/** The workbook as raw bytes (Node and tests). */
export async function buildBugSheetBuffer(...args: Parameters<typeof buildBugWorkbook>) { const wb = await buildBugWorkbook(...args); return Buffer.from(await wb.xlsx.writeBuffer()); }
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 2000); }
