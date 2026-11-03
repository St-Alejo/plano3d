/** Controles de la simulación (pestaña Vista) y el reloj que se ve mientras corre. */
import * as Slider from '@radix-ui/react-slider'
import { Car, Minus, Moon, Pause, Play, Plus, Sun } from 'lucide-react'
import { clockLabel } from '@/domain/simulation/clock'
import { MAX_PEOPLE, useSim } from './simStore'

const ROW = 'flex items-center justify-between gap-2 text-xs pointer-coarse:min-h-11'
const SMALL_BTN = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-line hover:border-accent hover:bg-raised disabled:opacity-40 pointer-fine:min-h-8 pointer-fine:min-w-8'
const SPEEDS = [0.5, 1, 2, 4]

export function SimControls() {
  const s = useSim()
  return (
    <section aria-label="Simulación" className="flex flex-col gap-2 border-t border-line pt-2">
      <label className={ROW}>
        <span className="font-medium">Simulación (personas y carro)</span>
        <input type="checkbox" checked={s.on} onChange={(e) => s.setOn(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
      </label>
      {s.on && (
        <>
          <div className={ROW}>
            <span id="sim-people">Personas</span>
            <div className="flex items-center gap-1" role="group" aria-labelledby="sim-people">
              <button type="button" className={SMALL_BTN} onClick={() => s.setPeople(s.people - 1)} disabled={s.people <= 0} aria-label="Una persona menos">
                <Minus className="size-3.5" aria-hidden />
              </button>
              <output className="w-6 text-center font-mono" aria-live="polite">
                {s.people}
              </output>
              <button type="button" className={SMALL_BTN} onClick={() => s.setPeople(s.people + 1)} disabled={s.people >= MAX_PEOPLE} aria-label="Una persona más">
                <Plus className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
          <div className={ROW}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.car} onChange={(e) => s.setCar(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
              <span>Carro al garaje</span>
            </label>
            <button type="button" className={`${SMALL_BTN} gap-1 px-2`} onClick={s.callCar} title="Que llegue (o salga) ya">
              <Car className="size-3.5" aria-hidden /> Llamar al carro
            </button>
          </div>
          <label className={ROW}>
            <span>Día y noche</span>
            <input type="checkbox" checked={s.dayNight} onChange={(e) => s.setDayNight(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
          </label>
          {s.dayNight && (
            <>
              <div>
                <label id="sim-hour" className="flex justify-between text-xs text-muted">
                  <span>Hora</span>
                  <span className="font-mono">{clockLabel(s.hour)}</span>
                </label>
                <Slider.Root className="relative flex h-11 touch-none items-center" value={[s.hour]} min={0} max={23.9} step={0.25} onValueChange={([v]) => s.setHour(v ?? 8, s.night)} aria-labelledby="sim-hour">
                  <Slider.Track className="relative h-1 grow bg-raised">
                    <Slider.Range className="absolute h-full bg-accent" />
                  </Slider.Track>
                  <Slider.Thumb className="block size-7 rounded-full border-2 border-accent bg-canvas" aria-label="Hora del día" />
                </Slider.Root>
              </div>
              <label className={ROW}>
                <span>Velocidad del reloj</span>
                <select value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))} className="h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs pointer-coarse:h-11">
                  {SPEEDS.map((v) => (
                    <option key={v} value={v}>
                      {v === 1 ? '1 h cada 20 s' : `×${String(v).replace('.', ',')}`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** Reloj de la simulación con pausa (arriba al centro, bajo la barra). */
export function SimClock() {
  const on = useSim((s) => s.on)
  const dayNight = useSim((s) => s.dayNight)
  const hour = useSim((s) => s.hour)
  const night = useSim((s) => s.night)
  const paused = useSim((s) => s.paused)
  const setPaused = useSim((s) => s.setPaused)
  if (!on) return null
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-line bg-canvas/85 py-1 pr-1 pl-3 text-sm backdrop-blur" role="status" aria-label="Reloj de la simulación">
      {dayNight ? (
        <>
          {night ? <Moon className="size-4 text-accent" aria-hidden /> : <Sun className="size-4 text-accent" aria-hidden />}
          <span className="font-mono">{clockLabel(hour)}</span>
        </>
      ) : (
        <span>Simulación</span>
      )}
      <button
        type="button"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? 'Seguir la simulación' : 'Pausar la simulación'}
        className="ml-1 inline-flex size-9 items-center justify-center rounded-sm hover:bg-raised pointer-coarse:size-11"
      >
        {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
