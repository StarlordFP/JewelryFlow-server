// src/common/utils/weight.util.spec.ts

import { WeightUtil } from './weight.util';

describe('Weight conversions', () => {
  it('1 tola = 11.664 gram', () => {
    const res = WeightUtil.from(1, 'tola');
    expect(res.gram).toBe(11.664);
    expect(res.tola).toBe(1.0000);
    expect(res.lal).toBe(100.00);
  });

  it('1 tola = 100 lal', () => {
    const resTola = WeightUtil.from(1, 'tola');
    const resLal = WeightUtil.from(100, 'lal');
    expect(resTola.lal).toBe(100);
    expect(resLal.lal).toBe(100);
    expect(resLal.tola).toBe(1.0);
    expect(resLal.gram).toBe(11.664);
  });

  it('round trip: gram → tola → gram', () => {
    const initialGram = 50;
    const tola = WeightUtil.from(initialGram, 'gram').tola;
    const backToGram = WeightUtil.from(tola, 'tola').gram;
    expect(backToGram).toBeCloseTo(initialGram, 3);
  });

  it('round trip: lal → gram → lal', () => {
    const initialLal = 250;
    const gram = WeightUtil.from(initialLal, 'lal').gram;
    const backToLal = WeightUtil.from(gram, 'gram').lal;
    expect(backToLal).toBeCloseTo(initialLal, 3);
  });

  it('exact conversion verification', () => {
    // WeightUtil.from(1, 'tola') → { gram: 11.664, tola: 1.0000, lal: 100.00 }
    expect(WeightUtil.from(1, 'tola')).toEqual({ gram: 11.664, tola: 1.0000, lal: 100.00 });

    // WeightUtil.from(11.664, 'gram') → { gram: 11.664, tola: 1.0000, lal: 100.00 }
    expect(WeightUtil.from(11.664, 'gram')).toEqual({ gram: 11.664, tola: 1.0000, lal: 100.00 });

    // WeightUtil.from(100, 'lal') → { gram: 11.664, tola: 1.0000, lal: 100.00 }
    expect(WeightUtil.from(100, 'lal')).toEqual({ gram: 11.664, tola: 1.0000, lal: 100.00 });

    // WeightUtil.from(0.5, 'tola') → { gram: 5.832, tola: 0.5000, lal: 50.00 }
    expect(WeightUtil.from(0.5, 'tola')).toEqual({ gram: 5.832, tola: 0.5000, lal: 50.00 });

    // WeightUtil.from(1, 'gram') → { gram: 1.0000, tola: 0.0857, lal: 8.5734 }
    expect(WeightUtil.from(1, 'gram')).toEqual({ gram: 1.0000, tola: 0.0857, lal: 8.5734 });

    // WeightUtil.from(1, 'lal') → { gram: 0.1166, tola: 0.0100, lal: 1.00 }
    expect(WeightUtil.from(1, 'lal')).toEqual({ gram: 0.1166, tola: 0.0100, lal: 1.00 });
  });
});
