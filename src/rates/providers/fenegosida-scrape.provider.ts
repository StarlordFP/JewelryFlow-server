import {
  FetchedTodayRates,
  IRateSourceProvider,
  RATE_SOURCE_FENEGOSIDA,
} from './rate-source.provider';

const FENEGOSIDA_URL = 'https://www.fenegosida.org/';
const USER_AGENT =
  'JewelryFlow-ERP/1.0 (+https://jewelryflow.local; daily-rate-fetch)';

/** Shared numeric capture — optional commas, optional decimal, no fixed digit count. */
const NRS_VALUE = String.raw`([\d,]+(?:\.\d+)?)`;

/**
 * Rate patterns tried in order after a label anchor.
 * Live FENEGOSIDA layout: "LABEL per 10 grm Nrs 3583.50/-"
 * Legacy/alternate layout: "LABEL ... Nrs 185,000 per 10 grm"
 */
const RATE_AFTER_LABEL_PATTERNS = [
  new RegExp(String.raw`per\s*10\s*grm\s*Nrs\.?\s*${NRS_VALUE}\s*\/?\s*-?`, 'i'),
  new RegExp(String.raw`Nrs\.?\s*${NRS_VALUE}\s*(?:\/|\s*per\s*)?\s*10\s*grm`, 'i'),
  new RegExp(String.raw`Nrs\.?\s*${NRS_VALUE}\s*\/?\s*-?`, 'i'),
];

export const FENEGOSIDA_LABELS = {
  fineGold: /FINE\s+GOLD\s*\(?\s*9999\s*\)?/i,
  tejabiGold: /TEJABI\s+GOLD/i,
  /** Require "per 10 grm" so "Silver Dealers Association" is not matched first. */
  silver: /\bSILVER\s+per\s+10\s+grm/i,
} as const;

/**
 * Parse FENEGOSIDA homepage HTML using tolerant label-anchored regexes.
 * Returns null per field on parse failure — never throws, never fakes a number.
 */
export function parseFenegosidaHtml(html: string): FetchedTodayRates {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const snippetStart = Math.max(0, text.search(/FINE GOLD/i));
  const rawSnippet = text.slice(snippetStart, snippetStart + 800).trim();

  const nepaliDateLabel = parseNepaliDateLabel(text);
  const fineGoldPer10g = parseRateForLabel(text, FENEGOSIDA_LABELS.fineGold);
  const tejabiGoldPer10g = parseRateForLabel(text, FENEGOSIDA_LABELS.tejabiGold);
  const silverPer10g = parseRateForLabel(text, FENEGOSIDA_LABELS.silver);

  return { fineGoldPer10g, tejabiGoldPer10g, silverPer10g, nepaliDateLabel, rawSnippet };
}

function parseNepaliDateLabel(text: string): string | null {
  const patterns = [
    /(?:Date|Dated?)\s*[:\-]?\s*(\d{4}\s*[\/\-]\s*\d{1,2}\s*[\/\-]\s*\d{1,2})/i,
    /(\d{4}\s*[\/\-]\s*\d{1,2}\s*[\/\-]\s*\d{1,2})\s*(?:B\.?S\.?|Bikram)/i,
    /(\d{1,2}\s+\w+\s+\d{4}\s*(?:B\.?S\.?)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/**
 * Find a label in full page text, then extract the Nrs value in the segment
 * before the next rate label (avoids bleeding into adjacent metal rows).
 */
export function parseRateForLabel(text: string, labelPattern: RegExp): number | null {
  const labelMatch = labelPattern.exec(text);
  if (!labelMatch) return null;

  const window = sliceLabelWindow(text, labelMatch.index, labelMatch[0].length);

  for (const pattern of RATE_AFTER_LABEL_PATTERNS) {
    const match = window.match(pattern);
    if (match?.[1]) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!Number.isNaN(value) && value >= 0) return value;
    }
  }

  return null;
}

const NEXT_RATE_LABEL =
  /\b(?:TEJABI\s+GOLD|SILVER\s+per\s+10\s+grm|FINE\s+GOLD\s*\(?\s*9999)\b/i;

function sliceLabelWindow(text: string, labelStart: number, labelLength: number): string {
  const afterLabel = labelStart + labelLength;
  const rest = text.slice(afterLabel);
  const nextBoundary = rest.search(NEXT_RATE_LABEL);
  const end = nextBoundary === -1 ? afterLabel + 80 : afterLabel + nextBoundary;
  return text.slice(labelStart, end);
}

export class FenegosidaScrapeProvider implements IRateSourceProvider {
  readonly sourceName = RATE_SOURCE_FENEGOSIDA;

  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async fetchTodayRates(): Promise<FetchedTodayRates> {
    try {
      const response = await this.fetchFn(FENEGOSIDA_URL, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return {
          fineGoldPer10g: null,
          tejabiGoldPer10g: null,
          silverPer10g: null,
          nepaliDateLabel: null,
          rawSnippet: `HTTP ${response.status}`,
        };
      }

      const html = await response.text();
      return parseFenegosidaHtml(html);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        fineGoldPer10g: null,
        tejabiGoldPer10g: null,
        silverPer10g: null,
        nepaliDateLabel: null,
        rawSnippet: `Fetch error: ${message}`,
      };
    }
  }
}
