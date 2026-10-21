/**
 * CSV para Excel en español: punto y coma, coma decimal y BOM para que respete las tildes.
 */

/** marca de orden de bytes: Excel la necesita para leer el UTF-8 (tildes, m²) */
export const BOM = String.fromCharCode(0xfeff)

/** Número con coma decimal (Excel en español la interpreta como número). */
export const csvNum = (v: number, digits = 2) => v.toFixed(digits).replace('.', ',')
export const csvCell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Encabezado y filas ya formateadas, con fin de línea de Windows. */
export function csv(head: string[], rows: string[][]): string {
  const EOL = '\r\n'
  return BOM + [head, ...rows].map((r) => r.join(';')).join(EOL) + EOL
}
