import { describe, expect, it } from 'vitest';
import { memberFaviconSvg, memberHue, memberInitials } from '@/hooks/use-member-favicon';

describe('member favicon', () => {
  it('uses first and last initials', () => {
    expect(memberInitials('Priya Raman Iyer')).toBe('PI');
    expect(memberInitials('arvind')).toBe('AR');
    expect(memberInitials('  ')).toBe('?');
  });
  it('gives each member a stable colour', () => {
    expect(memberHue('1A2B3C4D')).toBe(memberHue('1A2B3C4D'));
    expect(memberHue('1A2B3C4D')).not.toBe(memberHue('9F8E7D6C'));
  });
  it('strips markup from names', () => {
    expect(memberFaviconSvg('<x> y', 'AB')).not.toContain('<x>');
  });
});
