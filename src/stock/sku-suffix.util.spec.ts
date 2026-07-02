import { deriveKaratSuffix, formatCategoryKaratSku } from './sku-suffix.util';

describe('deriveKaratSuffix', () => {
  it('"Gold 22K" → "22K"', () => {
    expect(deriveKaratSuffix('Gold 22K')).toBe('22K');
  });

  it('"Silver" → "SLV"', () => {
    expect(deriveKaratSuffix('Silver')).toBe('SLV');
  });

  it('"Platinum 950" → "PLA" (fallback, first 3 letters)', () => {
    expect(deriveKaratSuffix('Platinum 950')).toBe('PLA');
  });
});

describe('formatCategoryKaratSku', () => {
  it('formats CHN-0001-22K', () => {
    expect(formatCategoryKaratSku('CHN', 1, '22K')).toBe('CHN-0001-22K');
  });
});
