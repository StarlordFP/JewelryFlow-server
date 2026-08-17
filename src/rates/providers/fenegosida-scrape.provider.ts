import {
  FetchedTodayRates,
  IRateSourceProvider,
  RATE_SOURCE_FENEGOSIDA,
} from './rate-source.provider';

/** Public site is a Vite SPA — rates are not in HTML. Use the JSON API. */
const FENEGOSIDA_API_TODAY =
  'https://api.fenegosida.org/api/website/v1/Dashboard/today';
/** Legacy HTML homepage (kept as fallback if API shape changes). */
const FENEGOSIDA_HTML_URL = 'https://www.fenegosida.org/';
const USER_AGENT =
  'JewelryFlow-ERP/1.0 (+https://jewelryflow.local; daily-rate-fetch)';

/** 1 tola = 11.664 g — FENEGOSIDA often publishes both per-tola and per-10g. */
const GRAMS_PER_TOLA = 11.664;
const TOLA_TO_PER_10G = 10 / GRAMS_PER_TOLA;

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

type DashboardTodayRow = {
  id?: number;
  todayDate?: string;
  rateType?: string;
  todayBaseRatePerGram?: number | string;
};

/**
 * Parse FENEGOSIDA Dashboard/today JSON.
 * Rows come in tola + per-10g pairs (field name is misleading — large values are per tola).
 * We always store fine gold + silver as **per 10 grams** for confirm/derive.
 */
export function parseFenegosidaApiToday(rows: unknown): FetchedTodayRates {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      fineGoldPer10g: null,
      tejabiGoldPer10g: null,
      silverPer10g: null,
      nepaliDateLabel: null,
      rawSnippet: 'Empty Dashboard/today response',
    };
  }

  const values = (rows as DashboardTodayRow[])
    .map((r) => Number(r.todayBaseRatePerGram))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);

  const { goldPer10g, silverPer10g } = pairTolaAndPer10g(values);
  const dateRaw = (rows as DashboardTodayRow[]).find((r) => r.todayDate)?.todayDate;
  const nepaliDateLabel = dateRaw ? String(dateRaw).slice(0, 10) : null;

  return {
    fineGoldPer10g: goldPer10g,
    tejabiGoldPer10g: null,
    silverPer10g,
    nepaliDateLabel,
    rawSnippet: JSON.stringify(rows).slice(0, 2000),
  };
}

/**
 * Among sorted descending numbers, find pairs linked by tola↔per-10g (×10/11.664).
 * Largest pair → fine gold; next → silver.
 */
export function pairTolaAndPer10g(sortedDesc: number[]): {
  goldPer10g: number | null;
  silverPer10g: number | null;
} {
  const used = new Set<number>();
  const per10gList: number[] = [];

  for (let i = 0; i < sortedDesc.length; i++) {
    if (used.has(i)) continue;
    const a = sortedDesc[i];
    let paired = false;
    for (let j = i + 1; j < sortedDesc.length; j++) {
      if (used.has(j)) continue;
      const b = sortedDesc[j];
      const expected = a * TOLA_TO_PER_10G;
      if (Math.abs(expected - b) / Math.max(b, 1) < 0.02) {
        // a = per tola, b = per 10g
        per10gList.push(b);
        used.add(i);
        used.add(j);
        paired = true;
        break;
      }
      const expectedRev = b * TOLA_TO_PER_10G;
      if (Math.abs(expectedRev - a) / Math.max(a, 1) < 0.02) {
        per10gList.push(a);
        used.add(i);
        used.add(j);
        paired = true;
        break;
      }
    }
    if (!paired && a >= 50_000) {
      // Unpaired large value — treat as per-tola gold
      per10gList.push(Number((a * TOLA_TO_PER_10G).toFixed(2)));
      used.add(i);
    }
  }

  return {
    goldPer10g: per10gList[0] ?? null,
    silverPer10g: per10gList[1] ?? null,
  };
}

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
    const fromApi = await this.fetchFromApi();
    if (fromApi.fineGoldPer10g != null || fromApi.silverPer10g != null) {
      return fromApi;
    }
    return this.fetchFromHtml(fromApi.rawSnippet);
  }

  private async fetchFromApi(): Promise<FetchedTodayRates> {
    try {
      const response = await this.fetchFn(FENEGOSIDA_API_TODAY, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return {
          fineGoldPer10g: null,
          tejabiGoldPer10g: null,
          silverPer10g: null,
          nepaliDateLabel: null,
          rawSnippet: `API HTTP ${response.status}`,
        };
      }

      const json = await response.json();
      return parseFenegosidaApiToday(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        fineGoldPer10g: null,
        tejabiGoldPer10g: null,
        silverPer10g: null,
        nepaliDateLabel: null,
        rawSnippet: `API fetch error: ${message}`,
      };
    }
  }

  private async fetchFromHtml(apiSnippet: string): Promise<FetchedTodayRates> {
    try {
      const response = await this.fetchFn(FENEGOSIDA_HTML_URL, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return {
          fineGoldPer10g: null,
          tejabiGoldPer10g: null,
          silverPer10g: null,
          nepaliDateLabel: null,
          rawSnippet: `${apiSnippet} | HTML HTTP ${response.status}`,
        };
      }

      const html = await response.text();
      const parsed = parseFenegosidaHtml(html);
      if (parsed.fineGoldPer10g == null && parsed.silverPer10g == null) {
        return {
          ...parsed,
          rawSnippet:
            `${apiSnippet} | HTML has no rate text (SPA shell). ` +
            (parsed.rawSnippet || ''),
        };
      }
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        fineGoldPer10g: null,
        tejabiGoldPer10g: null,
        silverPer10g: null,
        nepaliDateLabel: null,
        rawSnippet: `${apiSnippet} | HTML fetch error: ${message}`,
      };
    }
  }
}
