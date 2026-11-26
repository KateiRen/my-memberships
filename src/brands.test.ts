import { describe, expect, it } from 'vitest';
import { brandColors, brandName } from './brands';

const brands: Record<string, [string, string] | null> = {
  target: ['#cc0000', '#eb9d9d'],
  hm: ['#cc1f25', '#cc1f25'],
  amazon: null,
};

describe('brand-color matching', () => {
  it('matches complete names regardless of case, accents, spacing, and punctuation', () => {
    expect(brandColors('  TARGET  ', brands)).toEqual(brands.target);
    expect(brandColors('H & M', brands)).toEqual(brands.hm);
    expect(brandName('Café')).toBe(brandName('Cafe'));
  });
  it('recognizes common membership suffixes without matching partial or unrelated names', () => {
    expect(brandColors('Target Rewards', brands)).toEqual(brands.target);
    expect(brandColors('Target Kundenkarte', brands)).toEqual(brands.target);
    expect(brandColors('Targ', brands)).toBeNull();
    expect(brandColors('Target Market', brands)).toBeNull();
    expect(brandColors('Retarget', brands)).toBeNull();
    expect(brandColors('', brands)).toBeNull();
  });
  it('leaves conflicting brands unresolved and prioritizes complete brand names over suffix removal', () => {
    expect(brandColors('Amazon', brands)).toBeNull();
    expect(brandColors('Amazon Card', brands)).toBeNull();
    expect(brandColors('Target Card', { ...brands, targetcard: ['#112233', '#445566'] })).toEqual(['#112233', '#445566']);
    expect(brandColors('Target Card', { ...brands, targetcard: null })).toBeNull();
  });
});
