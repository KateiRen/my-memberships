export function brandName(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function brandColors(name: string, brands: Record<string, [string, string] | null>): [string, string] | null {
  const exact = brandName(name);
  if (Object.hasOwn(brands, exact)) return brands[exact] ?? null;
  const base = name.trim().replace(/\s+(?:rewards|card|club|loyalty|membership|kundenkarte|bonus|redcard)$/i, '');
  return brands[brandName(base)] ?? null;
}
