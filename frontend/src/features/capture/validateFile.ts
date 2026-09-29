export const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'
export const MAX_MB = 25

export function validateFile(f: File): string | null {
  if (!ACCEPT.split(',').includes(f.type)) return 'Formato no soportado. Usa JPG, PNG, WEBP o PDF.'
  if (f.size > MAX_MB * 1024 * 1024) return `El archivo supera ${MAX_MB} MB.`
  return null
}
