import { describe, expect, it } from 'vitest';
import { toCsv, exportName } from '@/lib/export';

describe('CSV export', () => {
  it('quotes commas, quotes and line breaks and keeps empty cells', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1, 'line\nbreak'], [null, undefined]]))
      .toBe('a,b\r\n"x,y","say ""hi"""\r\n1,"line\nbreak"\r\n,');
  });
  it('names files with the date', () => {
    expect(exportName('team-report')).toMatch(/^team-report-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
