export interface FetchedTodayRates {
  fineGoldPer10g: number | null;
  tejabiGoldPer10g: number | null;
  silverPer10g: number | null;
  nepaliDateLabel: string | null;
  rawSnippet: string;
}

export interface IRateSourceProvider {
  readonly sourceName: string;
  fetchTodayRates(): Promise<FetchedTodayRates>;
}

export const RATE_SOURCE_FENEGOSIDA = 'FENEGOSIDA';
