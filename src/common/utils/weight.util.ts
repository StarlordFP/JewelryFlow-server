// src/common/utils/weight.util.ts

/**
 * Weight conversion constants — Nepal standard
 * Master unit for calculations and billing: GRAM
 *
 * 1 Tola = 11.664g
 * 1 Tola = 100 Lal
 * 1 Lal  = 0.11664g
 * 1 gram = 8.5734 Lal
 * 1 gram = 0.08573 Tola
 */

import { GRAMS_PER_TOLA, GRAMS_PER_LAL } from '../constants/weight.constants';


export type WeightUnit = 'gram' | 'tola' | 'lal';

/**
 * WeightValue — the single weight object passed around internally.
 * gram is the master field used in all calculations.
 * lal and tola are derived display fields.
 *
 * Example: 1 tola input →
 * { gram: 11.664, tola: 1.000, lal: 100.00 }
 */
export interface WeightValue {
  gram: number;   // master — used in all price calculations
  tola: number;   // derived display
  lal: number;    // derived display
}

export const WeightUtil = {

  // ── Conversion to gram (master) ─────────────────────────────────────────

  toGram(value: number, unit: WeightUnit): number {
    switch (unit) {
      case 'gram': return value;
      case 'tola': return value * GRAMS_PER_TOLA;
      case 'lal':  return value * GRAMS_PER_LAL;
    }
  },

  // ── Build WeightValue from any input ────────────────────────────────────

  /**
   * The single function your pipe and services call.
   * Always returns { gram, tola, lal } — all three ready to use.
   */
  from(value: number, unit: WeightUnit): WeightValue {
    const gram = WeightUtil.toGram(value, unit);
    return WeightUtil.fromGram(gram);
  },

  /**
   * Build WeightValue from a gram value (e.g. when reading from DB).
   */
  fromGram(gram: number): WeightValue {
    return {
      gram: parseFloat(gram.toFixed(4)),
      tola: parseFloat((gram / GRAMS_PER_TOLA).toFixed(4)),
      lal:  parseFloat((gram / GRAMS_PER_LAL).toFixed(4)),
    };
  },

  // ── Bill display ─────────────────────────────────────────────────────────

  /**
   * Returns all three units formatted for a bill.
   * Primary display is gram; tola and lal are secondary.
   *
   * Example output:
   * {
   *   primary:   "11.6640 g",
   *   secondary: "1.0000 tola  |  100.00 lal"
   *   raw: { gram: 11.664, tola: 1.0, lal: 100.0 }
   * }
   */
  forBill(gram: number): {
    primary: string;
    secondary: string;
    raw: WeightValue;
  } {
    const w = WeightUtil.fromGram(gram);
    return {
      primary:   `${w.gram.toFixed(4)} g`,
      secondary: `${w.tola.toFixed(4)} tola  |  ${w.lal.toFixed(2)} lal`,
      raw: w,
    };
  },
};