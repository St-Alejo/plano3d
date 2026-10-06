export const MAX_MB = 25
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DXF_TYPES = ['application/dxf', 'image/vnd.dxf', 'image/x-dxf', 'application/x-dxf']
/** El navegador suele mandar un .dxf sin tipo: por eso también se acepta la extensión. */
export const ACCEPT = [...IMAGE_TYPES, 'application/pdf', '.dxf'].join(',')

export function isDxf(f: File): boolean {
  return /\.dxf$/i.test(f.name) || DXF_TYPES.includes(f.type)
}

/** Imagen que se puede previsualizar y rectificar (no PDF ni DXF). */
export function isImage(f: File): boolean {
  return IMAGE_TYPES.includes(f.type)
}

export function validateFile(f: File): string | null {
  if (!isImage(f) && f.type !== 'application/pdf' && !isDxf(f))
    return 'Formato no soportado. Usa JPG, PNG, WEBP, PDF o DXF.'
  if (f.size > MAX_MB * 1024 * 1024) return `El archivo supera ${MAX_MB} MB.`
  return null
}
