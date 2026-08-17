import {
  parseFenegosidaHtml,
  parseFenegosidaApiToday,
  pairTolaAndPer10g,
} from './fenegosida-scrape.provider';

/** Genuine live FENEGOSIDA layout (Jun 2026) — label per 10 grm Nrs value/- */
const LIVE_SNIPPET_JUN_2026 =
  'FINE GOLD (9999) per 10 grm Nrs 239285/- TEJABI GOLD per 10 grm Nrs 0/- SILVER per 10 grm Nrs 3583.50/-';

/** Swapped numeric shapes — decimal on gold, whole number on silver */
const SWAPPED_SHAPES_SNIPPET =
  'FINE GOLD (9999) per 10 grm Nrs 185000.75/- TEJABI GOLD per 10 grm Nrs 0/- SILVER per 10 grm Nrs 1450/-';

/** Live API shape Aug 2026 — tola + per-10g pairs (field name is misleading). */
const LIVE_API_TODAY_AUG_2026 = [
  { id: 152, todayDate: '2026-08-17T05:44:55.651+00:00', todayBaseRatePerGram: 4770.0 },
  { id: 153, todayDate: '2026-08-17T05:44:55.651+00:00', todayBaseRatePerGram: 4089.5 },
  { id: 154, todayDate: '2026-08-17T05:44:55.651+00:00', todayBaseRatePerGram: 306800.0 },
  { id: 155, todayDate: '2026-08-17T05:44:55.651+00:00', todayBaseRatePerGram: 263030.0 },
];

describe('FenegosidaScrapeProvider parseFenegosidaHtml', () => {
  const legacyHtml = `
    <html><body>
      <div>Date: 2082/09/15 B.S.</div>
      <div>FINE GOLD (9999)</div>
      <div>Nrs. 185,000 per 10 grm</div>
      <div>SILVER per 10 grm</div>
      <div>Nrs 1,450 /-</div>
    </body></html>
  `;

  it('parses gold and silver successfully (legacy Nrs-before-per-10grm layout)', () => {
    const result = parseFenegosidaHtml(legacyHtml);
    expect(result.fineGoldPer10g).toBe(185000);
    expect(result.silverPer10g).toBe(1450);
    expect(result.nepaliDateLabel).toBeTruthy();
    expect(result.rawSnippet).toContain('FINE GOLD');
  });

  it('parses live layout: fine gold, tejabi, and decimal silver', () => {
    const result = parseFenegosidaHtml(LIVE_SNIPPET_JUN_2026);
    expect(result.fineGoldPer10g).toBe(239285);
    expect(result.tejabiGoldPer10g).toBe(0);
    expect(result.silverPer10g).toBe(3583.5);
  });

  it('handles swapped numeric shapes (decimal gold, whole silver)', () => {
    const result = parseFenegosidaHtml(SWAPPED_SHAPES_SNIPPET);
    expect(result.fineGoldPer10g).toBe(185000.75);
    expect(result.tejabiGoldPer10g).toBe(0);
    expect(result.silverPer10g).toBe(1450);
  });

  it('does not match "Silver Dealers Association" instead of the rate line', () => {
    const html =
      'Silver Dealers Association - Naxal, Kathmandu FINE GOLD (9999) per 10 grm Nrs 242115 /- SILVER per 10 grm Nrs 3695 /-';
    const result = parseFenegosidaHtml(html);
    expect(result.fineGoldPer10g).toBe(242115);
    expect(result.silverPer10g).toBe(3695);
  });

  it('returns null for missing field without throwing (partial failure)', () => {
    const html = `
      <div>FINE GOLD (9999) per 10 grm Nrs 185,000/-</div>
    `;
    const result = parseFenegosidaHtml(html);
    expect(result.fineGoldPer10g).toBe(185000);
    expect(result.silverPer10g).toBeNull();
  });

  it('returns all nulls on total parse failure without throwing', () => {
    const result = parseFenegosidaHtml('<html><body>No rates here</body></html>');
    expect(result.fineGoldPer10g).toBeNull();
    expect(result.silverPer10g).toBeNull();
    expect(result.nepaliDateLabel).toBeNull();
  });

  it('returns nulls on SPA shell HTML (no rate text)', () => {
    const spa =
      '<!doctype html><html><body><div id="root"></div><script src="/assets/index.js"></script></body></html>';
    const result = parseFenegosidaHtml(spa);
    expect(result.fineGoldPer10g).toBeNull();
    expect(result.silverPer10g).toBeNull();
  });
});

describe('FenegosidaScrapeProvider parseFenegosidaApiToday', () => {
  it('pairs tola + per-10g rows into fine gold and silver per 10g', () => {
    const result = parseFenegosidaApiToday(LIVE_API_TODAY_AUG_2026);
    expect(result.fineGoldPer10g).toBe(263030);
    expect(result.silverPer10g).toBe(4089.5);
    expect(result.nepaliDateLabel).toBe('2026-08-17');
  });

  it('prefers Nepali rateType labels for per-10g rows', () => {
    const result = parseFenegosidaApiToday([
      {
        id: 1,
        todayDate: '2026-08-17T00:00:00.000Z',
        rateType: 'असली चाँदी दर (१० ग्राम)',
        todayBaseRatePerGram: 4089.5,
      },
      {
        id: 2,
        todayDate: '2026-08-17T00:00:00.000Z',
        rateType: 'छापावाल सुन (१० ग्राम)',
        todayBaseRatePerGram: 263030,
      },
    ]);
    expect(result.fineGoldPer10g).toBe(263030);
    expect(result.silverPer10g).toBe(4089.5);
  });

  it('pairTolaAndPer10g matches 306800 tola → 263030 per 10g', () => {
    const paired = pairTolaAndPer10g([306800, 263030, 4770, 4089.5]);
    expect(paired.goldPer10g).toBe(263030);
    expect(paired.silverPer10g).toBe(4089.5);
  });
});
