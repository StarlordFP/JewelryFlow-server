import { parseFenegosidaHtml } from './fenegosida-scrape.provider';

/** Genuine live FENEGOSIDA layout (Jun 2026) — label per 10 grm Nrs value/- */
const LIVE_SNIPPET_JUN_2026 =
  'FINE GOLD (9999) per 10 grm Nrs 239285/- TEJABI GOLD per 10 grm Nrs 0/- SILVER per 10 grm Nrs 3583.50/-';

/** Swapped numeric shapes — decimal on gold, whole number on silver */
const SWAPPED_SHAPES_SNIPPET =
  'FINE GOLD (9999) per 10 grm Nrs 185000.75/- TEJABI GOLD per 10 grm Nrs 0/- SILVER per 10 grm Nrs 1450/-';

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
});
