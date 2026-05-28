// src/common/pipes/parse-weight-to-gram.pipe.ts

import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { WeightUnit, WeightValue, WeightUtil } from '../utils/weight.util';

export interface WeightInput {
  value: number;
  unit: WeightUnit;
}

/**
 * ParseWeightToGramPipe
 *
 * Accepts { value, unit } in any unit and returns a WeightValue.
 * The service always receives { gram, tola, lal } — all three ready.
 * Calculations use .gram; bill display uses whichever unit is needed.
 *
 * Usage in controller:
 *   @Body('weight', ParseWeightToGramPipe) weight: WeightValue
 */
@Injectable()
export class ParseWeightToGramPipe implements PipeTransform<WeightInput, WeightValue> {
  transform(input: WeightInput, metadata: ArgumentMetadata): WeightValue {
    const field = metadata.data ?? 'weight';

    // ── Shape check ─────────────────────────────────────────────────────────
    if (!input || typeof input !== 'object') {
      throw new BadRequestException(
        `${field} must be { "value": number, "unit": "gram"|"tola"|"lal" }`,
      );
    }

    const { value, unit } = input;

    // ── Value check ─────────────────────────────────────────────────────────
    if (value === undefined || value === null) {
      throw new BadRequestException(`${field}.value is required`);
    }

    const num = Number(value);

    if (isNaN(num) || !isFinite(num)) {
      throw new BadRequestException(
        `${field}.value must be a valid number. Received: ${value}`,
      );
    }

    if (num <= 0) {
      throw new BadRequestException(
        `${field}.value must be greater than 0. Received: ${value}`,
      );
    }

    // ── Unit check ──────────────────────────────────────────────────────────
    const validUnits: WeightUnit[] = ['gram', 'tola', 'lal'];
    if (!validUnits.includes(unit)) {
      throw new BadRequestException(
        `${field}.unit must be "gram", "tola", or "lal". Received: "${unit}"`,
      );
    }

    // ── Convert → WeightValue ────────────────────────────────────────────────
    const result = WeightUtil.from(num, unit);

    if (result.gram < 0.0001) {
      throw new BadRequestException(
        `${field} is too small (< 0.0001g). Check value and unit.`,
      );
    }

    return result;
  }
}