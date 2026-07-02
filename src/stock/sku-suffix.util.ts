/**
 * Derive the karat/metal suffix for category-karat SKUs from a metal type name.
 * Pure function — no DB reads.
 */
export function deriveKaratSuffix(metalTypeName: string): string {
  const kMatch = metalTypeName.match(/(\d+)K/i);
  if (kMatch) {
    return `${kMatch[1]}K`.toUpperCase();
  }
  if (/silver/i.test(metalTypeName)) {
    return 'SLV';
  }
  const letters = metalTypeName.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'MTL').padEnd(3, 'X').slice(0, 3);
}

/**
 * Auto-derive a category shortCode from name (first 3 uppercase letters).
 * Caller must deduplicate against existing codes.
 */
export function deriveCategoryShortCode(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'CAT').padEnd(3, 'X').slice(0, 3);
}

export function formatCategoryKaratSku(
  shortCode: string,
  sequence: number,
  karatSuffix: string,
): string {
  return `${shortCode}-${String(sequence).padStart(4, '0')}-${karatSuffix}`;
}
