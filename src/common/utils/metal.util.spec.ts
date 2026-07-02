import { isGoldMetal } from './metal.util';

describe('isGoldMetal', () => {
  it('returns true for gold karat names', () => {
    expect(isGoldMetal({ name: 'Gold 24K' })).toBe(true);
    expect(isGoldMetal({ name: 'Gold 22K' })).toBe(true);
    expect(isGoldMetal({ name: 'Old Gold' })).toBe(true);
  });

  it('returns false for silver and null', () => {
    expect(isGoldMetal({ name: 'Silver' })).toBe(false);
    expect(isGoldMetal(null)).toBe(false);
    expect(isGoldMetal(undefined)).toBe(false);
  });
});
