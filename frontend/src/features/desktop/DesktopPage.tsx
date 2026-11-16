/**
 * /escritorio: la página de descarga de la app de Windows. Muestra la app de verdad (capturas
 * de la prueba de humo y un render de Blender hecho con ella), los requisitos, la versión con
 * su tamaño y SHA-256, y cómo pasar el aviso de SmartScreen (el instalador no tiene firma).
 */
import { Check, Copy, Download, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { DOWNLOAD_URL, RELEASES_URL, formatSize } from './release'
import { useLatestRelease } from './useLatestRelease'

const SHOTS = {
  editor: { src: '/escritorio/editor-3d.webp', alt: 'La app de escritorio con la casa de tres pisos en 3D, la barra de herramientas y el inspector del piso' },
  night: { src: '/escritorio/noche.webp', alt: 'La misma casa de noche: solo las luces de cada ambiente iluminan el interior' },
  live: { src: '/escritorio/planta-en-vivo.webp', alt: 'Planta y 3D lado a lado; un aviso dice «Cambios de Cuenta demo en la web»' },
  render: { src: '/escritorio/render-blender.webp', alt: 'Render de Blender de la fachada: casa blanca de tres pisos, garaje con dos puertas de madera, árboles y calle' },
} as const

const FEATURES = [
  {
    shot: SHOTS.night,
    title: 'Luz de verdad, de día y de noche',
    text: 'Iluminación global en tiempo real, reflejos y sombras suaves. El sol sale a la hora y en la fecha que elijas; de noche se prenden las lámparas de cada ambiente.',
  },
  {
    shot: SHOTS.live,
    title: 'Edita junto a la web, en vivo',
    text: 'Planta y 3D lado a lado. Un muro que dibujas en la app aparece en la web en menos de una décima de segundo, y al revés. Deshacer también viaja.',
  },
  {
    shot: SHOTS.render,
    title: 'Render fotorrealista con Blender',
    text: 'Un clic y Blender pinta la fachada, la calle o cada ambiente con Cycles en tu tarjeta de video: unos 15 segundos en borrador. La imagen llega sola a la galería del proyecto.',
  },
] as const

const REQUIREMENTS = [
  ['Sistema', 'Windows 10 u 11 de 64 bits'],
  ['Tarjeta de video', 'Con Vulkan (casi todas desde 2016); integrada sirve en calidad Media'],
  ['Memoria', '8 GB de RAM'],
  ['Disco', 'Unos 250 MB'],
  ['Render', 'Blender 4 o 5 (gratis); la app lo encuentra sola'],
  ['Cuenta', 'La misma de la web; también entra con la demo'],
] as const

function useCopy(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => setDone(false), 1800)
    return () => window.clearTimeout(t)
  }, [done])
  return [
    done,
    (text) => {
      void navigator.clipboard?.writeText(text).then(() => setDone(true))
    },
  ]
}

function Shot({ src, alt, className = '', priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  return (
    <img
      src={src}
      alt={alt}
      width={1440}
      height={900}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={`w-full rounded-xl border border-line object-cover shadow-lift ${className}`}
    />
  )
}

export function DesktopPage() {
  const latest = useLatestRelease()
  const [copied, copy] = useCopy()
  useEffect(() => {
    document.title = 'Plano 3D para Windows'
    return () => {
      document.title = 'Plano 3D'
    }
  }, [])

  const release = latest.status === 'ready' ? latest.release : null
  const meta = release
    ? [`Versión ${release.version}`, formatSize(release.size), 'Windows 10/11 · 64 bits'].filter(Boolean).join(' · ')
    : latest.status === 'loading'
      ? 'Buscando la última versión…'
      : 'Windows 10/11 · 64 bits'

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6">
      {/* ---------------------------------------------------------------- portada */}
      <section aria-labelledby="titulo" className="grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div className="flex flex-col items-start">
          <p className="flex items-center gap-3 font-mono text-xs font-medium tracking-[0.14em] text-accent uppercase">
            <span aria-hidden className="h-px w-8 bg-accent" />
            App de escritorio
          </p>
          <h1 id="titulo" className="mt-5 text-5xl leading-[0.95] font-[380] tracking-[-0.04em] sm:text-6xl">
            Plano 3D para Windows
          </h1>
          <p className="mt-6 max-w-lg text-lg text-fg/85">
            El mismo editor que usas en la web, con gráficos de videojuego, recorrido a pie y render fotorrealista con Blender en tu tarjeta de video.
          </p>
          <a
            href={DOWNLOAD_URL}
            className="mt-8 inline-flex h-14 items-center gap-3 rounded-full bg-brand pr-7 pl-6 text-lg font-medium text-brand-ink shadow-card transition-[filter,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lift hover:brightness-110"
          >
            <Download className="size-5" aria-hidden /> Descargar para Windows
          </a>
          <p className="mt-3 font-mono text-xs text-subtle" aria-live="polite">
            {meta}
          </p>
          {latest.status === 'none' && (
            <p className="mt-2 max-w-md text-sm text-muted">
              Si el botón no descarga nada, el instalador aún no está publicado: revisa los{' '}
              <a href={RELEASES_URL} className="underline">
                releases del proyecto
              </a>
              .
            </p>
          )}
        </div>
        <Shot {...SHOTS.editor} priority />
      </section>

      {/* ---------------------------------------------------------------- qué suma */}
      <section aria-labelledby="suma" className="border-t border-line pt-14">
        <h2 id="suma" className="max-w-2xl font-display text-3xl leading-tight sm:text-4xl">
          Lo que la app suma al editor web
        </h2>
        <div className="mt-10 grid gap-14">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-12">
              <div className={i % 2 ? 'lg:order-2' : ''}>
                <Shot {...f.shot} className="aspect-[16/10]" />
              </div>
              <div className={i % 2 ? 'lg:order-1' : ''}>
                <h3 className="font-display text-2xl leading-tight">{f.title}</h3>
                <p className="mt-3 max-w-md text-fg/85">{f.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- instalar */}
      <section aria-labelledby="instalar" className="mt-20 grid gap-10 border-t border-line pt-14 lg:grid-cols-2 lg:gap-14">
        <div>
          <h2 id="instalar" className="font-display text-3xl leading-tight">
            Instalar
          </h2>
          <ol className="mt-6 grid gap-4">
            {[
              'Descarga Plano3D-Setup.exe y ábrelo.',
              'Si Windows dice «Windows protegió su PC», pulsa «Más información» y luego «Ejecutar de todas formas».',
              'Sigue el instalador: no pide permisos de administrador y deja un acceso en el menú Inicio.',
              'Entra con tu cuenta, con la demo o con un código de la web.',
            ].map((step, i) => (
              <li key={step} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-raised font-mono text-sm">{i + 1}</span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex gap-3 rounded-lg border border-line bg-raised/60 p-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <p className="text-sm text-fg/85">
              El aviso aparece porque el instalador no tiene firma de código (un certificado pagado que este proyecto no tiene). Para comprobar que el archivo es el
              publicado, compara su SHA-256 con el de abajo: en PowerShell, <code className="font-mono">Get-FileHash .\Plano3D-Setup.exe</code>.
            </p>
          </div>
          {release?.sha256 && (
            <div className="mt-4">
              <p className="text-sm text-muted">SHA-256 de la versión {release.version}</p>
              <div className="mt-1 flex items-center gap-2 rounded-md border border-line bg-surface p-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs" title={release.sha256}>
                  {release.sha256}
                </code>
                <button
                  type="button"
                  onClick={() => copy(release.sha256 ?? '')}
                  className="grid size-11 shrink-0 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg"
                  aria-label={copied ? 'Copiado' : 'Copiar el SHA-256'}
                >
                  {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <h2 className="font-display text-3xl leading-tight">Requisitos</h2>
          <dl className="mt-6 divide-y divide-line border-y border-line">
            {REQUIREMENTS.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[9rem_1fr] gap-4 py-3">
                <dt className="text-sm text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h2 className="mt-12 font-display text-3xl leading-tight">Abrir un proyecto de la web</h2>
          <p className="mt-4 max-w-md text-fg/85">
            En el editor o en el visor 3D, «Abrir en escritorio» abre la app ya con tu sesión y en ese proyecto. Si la app no se abre, te da un código de seis letras para escribirlo en ella.
          </p>
          <Link to="/proyectos" className="mt-5 inline-flex min-h-11 items-center font-medium underline">
            Ir a mis proyectos
          </Link>
        </div>
      </section>
    </div>
  )
}
