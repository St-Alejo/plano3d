/**
 * Una casa por pisos desde varios planos a la vez: en qué orden van y cómo se llama cada piso.
 *
 * El piso sale del nombre del archivo o del rótulo que escribe la persona ("piso-2.png",
 * "planta baja", "tercer piso", "azotea"). Así no se gasta en IA cuando los nombres son claros;
 * los que no dicen nada quedan en el orden en que se subieron, encima de los reconocidos.
 */

const ORDINALS: Record<string, number> = {
  primer: 1,
  primero: 1,
  segundo: 2,
  tercer: 3,
  tercero: 3,
  cuarto: 4,
  quinto: 5,
  sexto: 6,
}

const ROOF = 99

/** Número de piso que nombra un texto (null si no dice). Sótano = 0, azotea = arriba de todo. */
export function floorNumber(text: string): number | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]{2,4}$/, '')
  if (/\b(?:sotano|subsuelo)\b/.test(t)) return 0
  if (/\b(?:planta\s*baja|pb|primer\s*nivel)\b/.test(t)) return 1
  if (/\b(?:azotea|terraza|cubierta|roof)\b/.test(t)) return ROOF
  const num = /(?:piso|planta|nivel|level|floor|p)[\s_-]*(\d{1,2})\b/.exec(t)
  if (num) return Number(num[1])
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\s*(?:piso|nivel|planta)\\b`).test(t)) return n
  }
  const bare = /^(\d{1,2})$/.exec(t.trim())
  return bare ? Number(bare[1]) : null
}

export interface FloorPlan<F> {
  file: F
  /** nombre del piso en el proyecto */
  name: string
  /** número leído (null si se dedujo por el orden de subida) */
  number: number | null
}

/**
 * Ordena los planos de abajo hacia arriba. Los reconocidos van por número; los demás, en el
 * orden de subida, después de ellos. Los nombres siguen la posición final ("Piso 1"…), salvo
 * sótano y azotea, que se llaman así.
 */
export function orderFloors<F extends { name: string }>(files: readonly F[]): FloorPlan<F>[] {
  const read = files.map((file, i) => ({ file, i, number: floorNumber(file.name) }))
  const known = read.filter((r) => r.number !== null).sort((a, b) => a.number! - b.number! || a.i - b.i)
  const rest = read.filter((r) => r.number === null)
  const hasBasement = known.some((r) => r.number === 0)
  return [...known, ...rest].map((r, pos) => {
    const n = r.number
    const name = n === 0 ? 'Sótano' : n === ROOF ? 'Azotea' : `Piso ${hasBasement ? pos : pos + 1}`
    return { file: r.file, name, number: n }
  })
}

/** Nombre de la casa: lo que se escribió o uno por defecto con la cantidad de pisos. */
export function houseName(text: string, floors: number): string {
  const t = text.trim().slice(0, 80)
  if (t) return t
  return floors === 1 ? 'Casa de 1 piso' : `Casa de ${floors} pisos`
}
