/**
 * Imágenes propias de la marca (generadas para el proyecto, en public/images). Cada una existe
 * en WebP a 640, 1280 y 1920 px (`npm run images`); el navegador elige según `sizes`.
 * Si una falta, el hueco conserva el color de fondo en vez de mostrar el ícono roto.
 */
import clsx from 'clsx'
import { useState, type CSSProperties } from 'react'

import { PHOTOS, photoSrc, WIDTHS, type PhotoName } from './photos'

export type { PhotoName } from './photos'

interface Props {
  name: PhotoName
  /** ancho que ocupa en pantalla, para que el navegador elija el archivo (atributo `sizes`) */
  sizes?: string
  /** `true` = decorativa (alt vacío y oculta para lectores de pantalla) */
  decorative?: boolean
  alt?: string
  priority?: boolean
  className?: string
  style?: CSSProperties
}

export function Photo({ name, sizes = '100vw', decorative, alt, priority, className, style }: Props) {
  const meta = PHOTOS[name]
  const [missing, setMissing] = useState(false)
  return (
    <img
      src={photoSrc(name)}
      srcSet={WIDTHS.map((w) => `${photoSrc(name, w)} ${w}w`).join(', ')}
      sizes={sizes}
      width={meta.w}
      height={meta.h}
      alt={decorative ? '' : (alt ?? meta.alt)}
      aria-hidden={decorative || undefined}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onError={() => setMissing(true)}
      className={clsx(className, missing && 'invisible')}
      style={style}
    />
  )
}
