import { describe, expect, it } from 'vitest';
import { TRASH_DAYS, daysLeft, daysLeftLabel, trashItemSchema } from '@/lib/trash';

describe('trash rules', () => {
  const day = 86_400_000; const now = Date.parse('2026-10-23T12:00:00Z');
  it('counts whole days left before an item is deleted forever', () => {
    expect(daysLeft(new Date(now).toISOString(), now)).toBe(TRASH_DAYS);
    expect(daysLeft(new Date(now - 29.5 * day).toISOString(), now)).toBe(1);
    expect(daysLeft(new Date(now - 31 * day).toISOString(), now)).toBe(0);
    expect(daysLeft('not a date', now)).toBe(TRASH_DAYS);
    expect(daysLeftLabel(0)).toBe('Deleted forever today'); expect(daysLeftLabel(1)).toBe('Deleted forever tomorrow'); expect(daysLeftLabel(12)).toBe('Deleted forever in 12 days');
  });
  it('accepts canonical bug ids and member uuids only', () => {
    expect(trashItemSchema.safeParse({ kind: 'bug', id: '51' }).success).toBe(true);
    expect(trashItemSchema.safeParse({ kind: 'bug', id: '051' }).success).toBe(false);
    expect(trashItemSchema.safeParse({ kind: 'member', id: '6f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f' }).success).toBe(true);
    expect(trashItemSchema.safeParse({ kind: 'member', id: '51' }).success).toBe(false);
    expect(trashItemSchema.safeParse({ kind: 'file', id: '51' }).success).toBe(false);
    expect(trashItemSchema.safeParse({ kind: 'bug', id: '51', extra: 1 }).success).toBe(false);
  });
});
