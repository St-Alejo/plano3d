/** Sin tildes ni mayúsculas: "Alcoba" encuentra "alcóba" y viceversa. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}
