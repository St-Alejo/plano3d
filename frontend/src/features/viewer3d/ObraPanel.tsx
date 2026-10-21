/**
 * Panel del modo obra: ficha del elemento tocado (medidas y hierro), leyenda de colores,
 * unidad de mampostería y el botón para ocultar el ladrillo y ver el esqueleto de concreto.
 */
import { HardHat, X } from "lucide-react";
import { useMemo } from "react";
import type { BuildingModel } from "@/api/types";
import { BRICKS, type BrickId } from "@/domain/structure/bricks";
import { describeElement } from "@/domain/structure/describe";
import { deriveStructure } from "@/domain/structure/derive";
import { masonryLayout } from "@/domain/structure/masonryLayout";
import { rebarSchedule } from "@/domain/structure/rebar";
import { RebarSchedulePanel } from "./RebarSchedulePanel";
import { CONCRETE_TINT } from "./scene/MaterialFactory";

const SELECT =
  "h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs pointer-coarse:h-11";

const LEGEND: { label: string; color: string }[] = [
  { label: "Viga de cimentación", color: CONCRETE_TINT.footing },
  { label: "Sobrecimiento", color: CONCRETE_TINT.plinth },
  { label: "Columneta", color: CONCRETE_TINT.column },
  { label: "Viga de amarre", color: CONCRETE_TINT.beam },
  { label: "Dintel", color: CONCRETE_TINT.lintel },
  { label: "Ladrillo", color: "#a4532f" },
];

export function ObraPanel({
  model,
  brick,
  onBrick,
  hideMasonry,
  onHideMasonry,
  elementId,
  onElement,
  onClose,
  steel = false,
  fileBase = "plano",
}: {
  model: BuildingModel;
  brick: BrickId;
  onBrick: (b: BrickId) => void;
  hideMasonry: boolean;
  onHideMasonry: (v: boolean) => void;
  elementId: string | null;
  onElement: (id: string) => void;
  onClose: () => void;
  /** despiece de acero: cartilla de barras en lugar de los controles de mampostería */
  steel?: boolean;
  fileBase?: string;
}) {
  const structure = useMemo(
    () => deriveStructure(model, { brick }),
    [model, brick],
  );
  const bars = useMemo(
    () => (steel ? rebarSchedule(structure) : []),
    [steel, structure],
  );
  // el despiece de ladrillo solo hace falta para la ficha de un paño
  const card = useMemo(() => {
    if (!elementId) return null;
    const bricks = structure.panels.some((p) => p.id === elementId)
      ? masonryLayout(model, structure)
      : [];
    return describeElement(structure, elementId, bricks);
  }, [model, structure, elementId]);

  return (
    <section
      aria-label="Obra"
      className="flex flex-col gap-2 border-b border-line pb-2"
    >
      {!steel && (
        <>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Unidad de mampostería</span>
            <select
              value={brick}
              onChange={(e) => onBrick(e.target.value as BrickId)}
              className={SELECT}
            >
              {(Object.keys(BRICKS) as BrickId[]).map((b) => (
                <option key={b} value={b}>
                  {BRICKS[b].name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs pointer-coarse:min-h-11">
            <span>Ocultar mampostería (ver el esqueleto)</span>
            <input
              type="checkbox"
              checked={hideMasonry}
              onChange={(e) => onHideMasonry(e.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
          </label>
          <ul
            aria-label="Leyenda"
            className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted"
          >
            {LEGEND.map((l) => (
              <li key={l.label} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-3 rounded-sm border border-line"
                  style={{ background: l.color }}
                  aria-hidden
                />
                {l.label}
              </li>
            ))}
          </ul>
        </>
      )}
      {card ? (
        <article
          aria-label="Ficha del elemento"
          className="relative rounded-md border border-accent/60 bg-raised p-2 text-xs"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ficha"
            className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-sm hover:bg-canvas"
          >
            <X className="size-3.5" aria-hidden />
          </button>
          <h3 className="pr-7 text-sm font-medium">{card.title}</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {card.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      ) : (
        <p className="text-xs text-subtle">
          Toque una columneta, una viga o un muro para ver sus medidas y su
          hierro.
        </p>
      )}
      {steel && (
        <RebarSchedulePanel
          bars={bars}
          selectedId={elementId}
          onSelect={onElement}
          fileBase={fileBase}
        />
      )}
      <p className="flex gap-1.5 text-[11px] leading-snug text-subtle">
        <HardHat className="size-3.5 shrink-0" aria-hidden />
        {structure.columns.length} columnetas, {structure.beams.length} vigas de
        amarre. Guía didáctica según NSR-10 Título E: no reemplaza el diseño
        firmado por un ingeniero.
      </p>
      {structure.warnings.length > 0 && (
        <ul
          aria-label="Avisos de obra"
          className="list-disc pl-4 text-[11px] text-warn"
        >
          {structure.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
