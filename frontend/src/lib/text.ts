/** Sin tildes ni mayúsculas: "Alcoba" encuentra "alcóba" y viceversa. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/**
 * Nombres escritos todo en mayúsculas (como vienen de muchos planos: "ALCOBA 1") pasan a
 * "Alcoba 1"; los que ya traen minúsculas se dejan como están.
 */
export function titleCase(s: string): string {
  if (!s || s !== s.toUpperCase() || s === s.toLowerCase()) return s
  const lower = s.toLocaleLowerCase('es')
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1)
}
