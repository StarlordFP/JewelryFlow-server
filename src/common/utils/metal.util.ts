/** True when metal type name indicates gold (24K, 22K, Old Gold, etc.). */
export function isGoldMetal(metal: { name: string } | null | undefined): boolean {
  return metal?.name?.toLowerCase().includes('gold') ?? false;
}
