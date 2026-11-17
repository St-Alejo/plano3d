"""Muros leídos por Claude con visión y ajustados a la tinta del dibujo.

La visión por computador clásica confunde líneas de cota, ejes, peldaños y achurados con
muros, y pierde los muros de doble línea fina. Claude mira la planta entera y entiende qué
es cada trazo: devuelve los ejes de los muros, sus vanos, los nombres de los ambientes y
algunas cotas (para la escala), en píxeles de la imagen.

Sus coordenadas son aproximadas (unos píxeles), así que cada muro se AJUSTA a la tinta:
se mide el perfil de tinta perpendicular al muro y se toma la banda dibujada más cercana
(maciza o de dos caras) como eje y espesor reales; luego los extremos se unen a los muros
que cruzan. Lo que no tiene tinta debajo se descarta (no se inventan muros).

Como el lector de cotas (``ocr/claude.py``), cada llamada pasa por el tope de gasto y una
caché en disco; sin credenciales, con el tope agotado o si la API falla, devuelve ``None``
y el pipeline sigue con la detección clásica.
"""

from __future__ import annotations

import base64
import json
import logging
import math
import os
import statistics
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

from plano3d.infrastructure.cv.context import Img
from plano3d.infrastructure.ocr.budget import PRICES, ClaudeBudget, ResponseCache
from plano3d.infrastructure.vector.walls import OpeningCand, WallCand

log = logging.getLogger(__name__)

MODEL = os.environ.get("PLANO3D_WALLS_MODEL", "claude-sonnet-5-5")
#: lado mayor con que se envía la imagen (los modelos de visión de alta resolución
#: aceptan hasta 2576 px y devuelven coordenadas 1:1 con los píxeles)
MAX_SIDE = 2576
MAX_TOKENS = 16000
#: estimación para el tope de gasto (imagen grande + respuesta con razonamiento)
EST_INPUT_TOKENS = 6000
EST_OUTPUT_TOKENS = 9000

_PROMPT = """\
Eres un arquitecto que digitaliza planos. La imagen es la planta de una edificación \
(puede ser un plano de CAD, un escaneo o una foto). Devuelve su geometría en PÍXELES de \
esta imagen (origen arriba a la izquierda, x a la derecha, y hacia abajo).

MUROS (walls): cada muro es el EJE (línea central) de un muro dibujado, de extremo a extremo.
- Incluye muros exteriores, divisiones interiores, muros de baños y fachadas de vidrio \
(estas como muro con una ventana a lo largo).
- Un muro sigue a través de sus puertas y ventanas: no lo cortes en los vanos. Un muro \
recto y continuo es un solo segmento; córtalo solo donde cambia de dirección o termina.
- Los extremos deben llegar al eje del muro con el que se encuentran (esquinas y T cerradas).
- thickness: espesor dibujado del muro en píxeles (de cara a cara).
- NO son muros: líneas de cota (finas, con marcas o flechas en los extremos y un número), \
ejes o retículas (líneas largas con círculos y letras/números), muebles, aparatos \
sanitarios, peldaños de escaleras, arcos de puertas, achurados, textos, el rótulo, la \
flecha del norte, columnas sueltas.

VANOS (openings): puertas (hueco en el muro, normalmente con el arco de giro) y ventanas \
(tramo de muro dibujado con líneas finas paralelas). wall = índice del muro en la lista \
walls (desde 0); (x1, y1) y (x2, y2) son los dos bordes del vano sobre el eje del muro.

AMBIENTES (rooms): nombre escrito en el plano (tal cual: "ALCOBA 1", "Baño", "Sala"); si \
no tiene nombre, pon el uso probable en español. (x, y) es un punto dentro del ambiente. \
outline: el contorno del ambiente como polígono cerrado por los ejes de los muros que lo \
rodean (en orden, sin repetir el primer punto); donde no hay muro (un vano, un espacio \
abierto a otro), cierra el contorno por la línea donde estaría el muro. Los ambientes no \
se superponen. Incluye circulaciones y escaleras; no incluyas el exterior.

COTAS (dimensions): hasta 6 cotas legibles, preferiblemente las más largas (totales): los \
dos extremos de la línea de cota (marca a marca) y su valor en METROS (345 cm → 3.45).

Sé exhaustivo con los muros: un muro que falte deja un ambiente abierto en el modelo 3D.\
"""

_NUM = {"type": "number"}
_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "walls": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "x1": _NUM,
                    "y1": _NUM,
                    "x2": _NUM,
                    "y2": _NUM,
                    "thickness": _NUM,
                    "exterior": {"type": "boolean"},
                },
                "required": ["x1", "y1", "x2", "y2", "thickness", "exterior"],
                "additionalProperties": False,
            },
        },
        "openings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "wall": {"type": "integer"},
                    "kind": {"type": "string", "enum": ["door", "window"]},
                    "x1": _NUM,
                    "y1": _NUM,
                    "x2": _NUM,
                    "y2": _NUM,
                },
                "required": ["wall", "kind", "x1", "y1", "x2", "y2"],
                "additionalProperties": False,
            },
        },
        "rooms": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "x": _NUM,
                    "y": _NUM,
                    "outline": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"x": _NUM, "y": _NUM},
                            "required": ["x", "y"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["name", "x", "y", "outline"],
                "additionalProperties": False,
            },
        },
        "dimensions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"x1": _NUM, "y1": _NUM, "x2": _NUM, "y2": _NUM, "meters": _NUM},
                "required": ["x1", "y1", "x2", "y2", "meters"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["walls", "openings", "rooms", "dimensions"],
    "additionalProperties": False,
}


# --------------------------------------------------------------------------- lectura


@dataclass
class AIWall:
    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float
    exterior: bool = False


@dataclass
class AIOpening:
    wall: int
    kind: str
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass
class AIRoom:
    name: str
    x: float
    y: float
    outline: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class AIPlan:
    """Lo que Claude leyó, en px de la imagen analizada."""

    walls: list[AIWall] = field(default_factory=list)
    openings: list[AIOpening] = field(default_factory=list)
    rooms: list[AIRoom] = field(default_factory=list)
    dimensions: list[tuple[float, float, float, float, float]] = field(default_factory=list)


def parse_plan(data: dict[str, Any], factor: float = 1.0) -> AIPlan:
    """De la respuesta JSON a un ``AIPlan`` (``factor``: px enviados → px de la imagen)."""
    f = 1.0 / factor if factor else 1.0
    plan = AIPlan()
    for w in data.get("walls", []):
        try:
            plan.walls.append(
                AIWall(
                    float(w["x1"]) * f,
                    float(w["y1"]) * f,
                    float(w["x2"]) * f,
                    float(w["y2"]) * f,
                    max(1.0, float(w["thickness"]) * f),
                    bool(w.get("exterior", False)),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    for o in data.get("openings", []):
        try:
            kind = "door" if str(o["kind"]) == "door" else "window"
            plan.openings.append(
                AIOpening(
                    int(o["wall"]),
                    kind,
                    float(o["x1"]) * f,
                    float(o["y1"]) * f,
                    float(o["x2"]) * f,
                    float(o["y2"]) * f,
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    for r in data.get("rooms", []):
        try:
            name = str(r["name"]).strip()
            outline = [(float(p["x"]) * f, float(p["y"]) * f) for p in r.get("outline", [])]
            if name:
                plan.rooms.append(AIRoom(name, float(r["x"]) * f, float(r["y"]) * f, outline))
        except (KeyError, TypeError, ValueError):
            continue
    for d in data.get("dimensions", []):
        try:
            m = float(d["meters"])
            if 0.1 <= m <= 300:
                plan.dimensions.append(
                    (
                        float(d["x1"]) * f,
                        float(d["y1"]) * f,
                        float(d["x2"]) * f,
                        float(d["y2"]) * f,
                        m,
                    )
                )
        except (KeyError, TypeError, ValueError):
            continue
    return plan


class ClaudeWallReader:
    """Envía la planta entera a Claude y devuelve su lectura (o ``None``)."""

    name = "claude-walls"

    def __init__(
        self,
        client: Any | None = None,
        model: str = MODEL,
        budget: ClaudeBudget | None = None,
        cache: ResponseCache | None = None,
    ) -> None:
        self._client = client
        self._model = model
        self._budget = budget or ClaudeBudget()
        self._cache = cache or ResponseCache()

    def _api(self) -> Any:
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(max_retries=2, timeout=300.0)
        return self._client

    def read(self, img: Img) -> AIPlan | None:
        h, w = img.shape[:2]
        factor = min(1.0, MAX_SIDE / max(h, w))
        sent = (
            img
            if factor == 1.0
            else cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
        )
        ok, buf = cv2.imencode(".png", sent)
        if not ok:
            return None
        png = base64.standard_b64encode(buf.tobytes()).decode("ascii")
        key = ResponseCache.key(self._model, _PROMPT, png)
        data = self._cache.get(key)
        if data is None:
            pin, pout = PRICES.get(self._model, PRICES["claude-opus-5"])
            estimate = (EST_INPUT_TOKENS * pin + EST_OUTPUT_TOKENS * pout) / 1e6
            if not self._budget.allows(estimate):
                log.warning("Tope de gasto de Claude alcanzado: muros con la detección clásica")
                return None
            data = self._call(png, sent.shape[1], sent.shape[0])
            if data is None:
                return None
            self._cache.put(key, data)
        return parse_plan(data, factor)

    def _call(self, png: str, width: int, height: int) -> dict[str, Any] | None:
        try:
            import anthropic

            response = self._api().messages.create(
                model=self._model,
                max_tokens=MAX_TOKENS,
                output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": png,
                                },
                            },
                            {
                                "type": "text",
                                "text": f"{_PROMPT}\n\nLa imagen mide {width} x {height} px.",
                            },
                        ],
                    }
                ],
            )
        except ImportError:
            log.warning("El SDK de Anthropic no está instalado: muros con la detección clásica")
            return None
        except anthropic.APIStatusError as exc:
            log.warning("Claude no leyó los muros (HTTP %s): %s", exc.status_code, exc.message)
            return None
        except anthropic.APIConnectionError as exc:
            log.warning("Claude no disponible para muros: %s", exc)
            return None
        usage = getattr(response, "usage", None)
        if usage is not None:
            cost = self._budget.record(
                self._model, int(usage.input_tokens), int(usage.output_tokens)
            )
            log.info(
                "Muros con Claude: %s in / %s out (US$ %.4f)",
                usage.input_tokens,
                usage.output_tokens,
                cost,
            )
        if response.stop_reason in ("refusal", "max_tokens"):
            log.warning("Claude no terminó la lectura de muros (%s)", response.stop_reason)
            return None
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            parsed: dict[str, Any] = json.loads(text)
        except json.JSONDecodeError:
            log.warning("La lectura de muros de Claude no es JSON válido")
            return None
        return parsed


# --------------------------------------------------------------------------- ajuste a la tinta

#: ángulo (grados) bajo el cual un muro casi horizontal/vertical se endereza
AXIS_SNAP_DEG = 4.0
#: fracción de tinta para considerar que un desplazamiento del perfil "tiene muro"
INK_ON = 0.45
#: un muro con menos tinta que esto a lo largo de su eje no está dibujado: se descarta
MIN_SUPPORT = 0.2


@dataclass
class FitWall:
    """Muro ajustado, en px."""

    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float
    support: float
    exterior: bool = False
    source: int = -1  # índice en la lectura de Claude
    #: tramos (px, sobre el eje) por donde se prolongó el muro para cerrar un vano de puerta
    gaps: list[tuple[tuple[float, float], tuple[float, float]]] = field(default_factory=list)

    @property
    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    @property
    def u(self) -> tuple[float, float]:
        n = self.length or 1.0
        return (self.x2 - self.x1) / n, (self.y2 - self.y1) / n


def _sample(ink: np.ndarray, x: float, y: float) -> float:
    h, w = ink.shape[:2]
    xi, yi = round(x), round(y)
    if 0 <= xi < w and 0 <= yi < h:
        return 1.0 if ink[yi, xi] else 0.0
    return 0.0


def _profile(
    ink: np.ndarray, w: AIWall, reach: int
) -> tuple[np.ndarray, tuple[float, float], tuple[float, float]]:
    """Fracción de tinta a cada desplazamiento perpendicular (de -reach a +reach)."""
    length = math.hypot(w.x2 - w.x1, w.y2 - w.y1) or 1.0
    ux, uy = (w.x2 - w.x1) / length, (w.y2 - w.y1) / length
    nx, ny = -uy, ux
    ts = np.linspace(0.15, 0.85, max(8, min(60, int(length // 6))))
    prof = np.zeros(2 * reach + 1)
    for k, o in enumerate(range(-reach, reach + 1)):
        acc = 0.0
        for t in ts:
            acc += _sample(
                ink, w.x1 + (w.x2 - w.x1) * t + nx * o, w.y1 + (w.y2 - w.y1) * t + ny * o
            )
        prof[k] = acc / len(ts)
    return prof, (ux, uy), (nx, ny)


def _band(prof: np.ndarray, reach: int, thickness: float) -> tuple[float, float, float] | None:
    """(desplazamiento del eje, espesor, soporte) de la banda dibujada más cercana al centro."""
    on = prof >= INK_ON
    runs: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        if not v and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(on) - 1))
    if not runs:
        return None
    # las corridas (caras o banda maciza) cerca del eje propuesto forman el muro
    near = max(4.0, 0.75 * thickness + 3)
    chosen = [
        r
        for r in runs
        if min(abs(r[0] - reach), abs(r[1] - reach), 0 if r[0] <= reach <= r[1] else 1e9) <= near
    ]
    if not chosen:
        best = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - reach))
        if abs((best[0] + best[1]) / 2 - reach) > max(near, thickness):
            return None
        chosen = [best]
    lo, hi = min(r[0] for r in chosen), max(r[1] for r in chosen)
    width = hi - lo + 1
    # una banda mucho más ancha que el muro propuesto es otra cosa (achurado, mueble lleno)
    if width > max(2.5 * thickness, thickness + 10):
        center = min(chosen, key=lambda r: abs((r[0] + r[1]) / 2 - reach))
        lo, hi = center
        width = hi - lo + 1
    support = float(prof[lo : hi + 1].max())
    off = (lo + hi) / 2 - reach
    # una sola línea fina: es la cara de un muro dibujado con una línea, se respeta el espesor leído
    thick = float(width) if width >= 0.6 * thickness or width >= 4 else thickness
    return off, thick, support


#: alcance (m) para unir el extremo de un muro al eje de otro
JOIN_M = 0.35
#: hueco máximo (m) entre el extremo de un muro y otro muro que se cierra como vano de puerta
DOOR_GAP_M = 1.3
#: ancho típico de una puerta (m): da la escala de un plano sin cotas
DOOR_M = 0.85


def fit_to_ink(plan: AIPlan, ink: np.ndarray, mpp: float | None = None) -> list[FitWall]:
    """Ajusta cada muro de Claude a la tinta (descarta los que no están dibujados), une
    esquinas y cierra los vanos de puerta que dejaron un muro cortado (con ``mpp``)."""
    mask = ink > 0
    out: list[FitWall] = []
    for i, w in enumerate(plan.walls):
        if math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 4:
            continue
        reach = int(max(8, 1.5 * w.thickness + 6))
        prof, _, (nx, ny) = _profile(mask, w, reach)
        band = _band(prof, reach, w.thickness)
        if band is None:
            continue
        off, thick, support = band
        if support < MIN_SUPPORT:
            continue
        x1, y1 = w.x1 + nx * off, w.y1 + ny * off
        x2, y2 = w.x2 + nx * off, w.y2 + ny * off
        out.append(FitWall(x1, y1, x2, y2, thick, support, w.exterior, i))
    out = [_straighten(w) for w in out]
    join = JOIN_M / mpp if mpp else 0.0
    _join(out, join)
    if mpp:
        out = _close_gaps(out, DOOR_GAP_M / mpp, join)
    return [w for w in out if w.length >= max(4.0, w.thickness)]


def _straighten(w: FitWall) -> FitWall:
    ang = math.degrees(math.atan2(w.y2 - w.y1, w.x2 - w.x1)) % 180
    if min(ang, 180 - ang) <= AXIS_SNAP_DEG:
        y = (w.y1 + w.y2) / 2
        return FitWall(w.x1, y, w.x2, y, w.thickness, w.support, w.exterior, w.source)
    if abs(ang - 90) <= AXIS_SNAP_DEG:
        x = (w.x1 + w.x2) / 2
        return FitWall(x, w.y1, x, w.y2, w.thickness, w.support, w.exterior, w.source)
    return w


def _intersect(a: FitWall, b: FitWall) -> tuple[float, float] | None:
    (ax, ay), (bx, by) = a.u, b.u
    den = ax * by - ay * bx
    if abs(den) < 0.2:  # casi paralelos
        return None
    t = ((b.x1 - a.x1) * by - (b.y1 - a.y1) * bx) / den
    return a.x1 + ax * t, a.y1 + ay * t


def _join(walls: list[FitWall], join: float = 0.0) -> None:
    """Lleva cada extremo al eje del muro que cruza cerca (esquinas, T y L cerradas)."""
    for a in walls:
        for end in (0, 1):
            px, py = (a.x1, a.y1) if end == 0 else (a.x2, a.y2)
            best: tuple[float, float, float] | None = None
            for b in walls:
                if b is a:
                    continue
                p = _intersect(a, b)
                if p is None:
                    continue
                d = math.hypot(p[0] - px, p[1] - py)
                reach = max(12.0, 1.5 * (a.thickness + b.thickness), join)
                if d > reach:
                    continue
                # el punto debe caer sobre b (o cerca de su extremo)
                bx, by = b.u
                t = (p[0] - b.x1) * bx + (p[1] - b.y1) * by
                if t < -reach or t > b.length + reach:
                    continue
                if best is None or d < best[2]:
                    best = (p[0], p[1], d)
            if best is not None:
                if end == 0:
                    a.x1, a.y1 = best[0], best[1]
                else:
                    a.x2, a.y2 = best[0], best[1]


def _seg_dist(px: float, py: float, w: FitWall) -> float:
    ux, uy = w.u
    t = min(max((px - w.x1) * ux + (py - w.y1) * uy, 0.0), w.length)
    return math.hypot(w.x1 + ux * t - px, w.y1 + uy * t - py)


def _end(w: FitWall, end: int) -> tuple[float, float]:
    return (w.x1, w.y1) if end == 0 else (w.x2, w.y2)


def _set_end(w: FitWall, end: int, p: tuple[float, float]) -> None:
    if end == 0:
        w.x1, w.y1 = p
    else:
        w.x2, w.y2 = p


def _close_gaps(walls: list[FitWall], gap: float, join: float) -> list[FitWall]:
    """Un muro que termina en el aire a menos de ``gap`` de otro (el hueco de una puerta)
    se prolonga hasta él; el tramo nuevo queda como vano. Si el otro sigue en la misma
    línea, los dos se vuelven uno solo."""
    gone: set[int] = set()
    for i, a in enumerate(walls):
        if i in gone:
            continue
        for end in (0, 1):
            px, py = _end(a, end)
            touch = max(join, a.thickness)
            if any(
                _seg_dist(px, py, b) <= touch + b.thickness / 2
                for j, b in enumerate(walls)
                if j != i and j not in gone
            ):
                continue  # ya se apoya en otro muro
            ux, uy = a.u
            sx, sy = (-ux, -uy) if end == 0 else (ux, uy)
            # (distancia, índice, punto, modo: 0 cruce, 1/2 sigue en línea por su extremo 0/1)
            best: tuple[float, int, tuple[float, float], int] | None = None
            for j, b in enumerate(walls):
                if j == i or j in gone:
                    continue
                bx, by = b.u
                if abs(ux * by - uy * bx) < 0.05:
                    # paralelo: solo si sigue en la misma línea (muro cortado por la puerta)
                    off = abs((b.x1 - px) * -uy + (b.y1 - py) * ux)
                    if off > max(a.thickness, b.thickness):
                        continue
                    for bend in (0, 1):
                        qx, qy = _end(b, bend)
                        d = (qx - px) * sx + (qy - py) * sy
                        if 0 < d <= gap and (best is None or d < best[0]):
                            best = (d, j, (qx, qy), 1 + bend)
                    continue
                p = _intersect(a, b)
                if p is None:
                    continue
                d = (p[0] - px) * sx + (p[1] - py) * sy
                if d <= 0 or d > gap:
                    continue
                t = (p[0] - b.x1) * bx + (p[1] - b.y1) * by
                if t < -b.thickness or t > b.length + b.thickness:
                    continue
                if best is None or d < best[0]:
                    best = (d, j, p, 0)
            if best is None:
                continue
            d, j, p, mode = best
            if mode == 0:
                _set_end(a, end, p)
                if d > max(1.5 * a.thickness, 0.3 * gap):
                    a.gaps.append(((px, py), p))
                continue
            # mismo eje: a absorbe a b (hasta su extremo lejano) y el hueco es la puerta
            b = walls[j]
            _set_end(a, end, _end(b, 2 - mode))
            a.gaps.append(((px, py), p))
            a.gaps.extend(b.gaps)
            a.support = min(a.support, b.support)
            gone.add(j)
    return [w for k, w in enumerate(walls) if k not in gone]


def mpp_from_doors(plan: AIPlan) -> float | None:
    """m/px por el ancho de las puertas (~85 cm): escala de un plano sin cotas."""
    widths = [math.hypot(o.x2 - o.x1, o.y2 - o.y1) for o in plan.openings if o.kind == "door"]
    widths = [w for w in widths if w > 8]
    if len(widths) < 2:
        return None
    return DOOR_M / statistics.median(widths)


def mpp_from_dimensions(plan: AIPlan) -> float | None:
    """m/px según las cotas que leyó Claude (mediana; ``None`` si no hay acuerdo)."""
    ratios = [
        m / math.hypot(x2 - x1, y2 - y1)
        for x1, y1, x2, y2, m in plan.dimensions
        if math.hypot(x2 - x1, y2 - y1) > 20
    ]
    if len(ratios) < 2:
        return None
    med = statistics.median(ratios)
    agree = [r for r in ratios if abs(r - med) / med <= 0.06]
    return statistics.median(agree) if len(agree) >= 2 else None


def to_candidates(walls: list[FitWall], plan: AIPlan, mpp: float) -> list[WallCand]:
    """Muros ajustados (px) → candidatos en metros, con sus vanos."""
    out: list[WallCand] = []
    for w in walls:
        cand = WallCand(
            w.x1 * mpp,
            w.y1 * mpp,
            w.x2 * mpp,
            w.y2 * mpp,
            max(0.05, w.thickness * mpp),
            confidence=min(0.95, 0.5 + w.support / 2),
        )
        ux, uy = w.u
        for o in plan.openings:
            if o.wall != w.source:
                continue
            t1 = (o.x1 - w.x1) * ux + (o.y1 - w.y1) * uy
            t2 = (o.x2 - w.x1) * ux + (o.y2 - w.y1) * uy
            lo, hi = max(0.0, min(t1, t2)), min(w.length, max(t1, t2))
            if hi - lo < 4:
                continue
            cand.openings.append(OpeningCand(lo * mpp, (hi - lo) * mpp, o.kind, confidence=0.8))
        for (x1, y1), (x2, y2) in w.gaps:
            t1 = (x1 - w.x1) * ux + (y1 - w.y1) * uy
            t2 = (x2 - w.x1) * ux + (y2 - w.y1) * uy
            lo, hi = max(0.0, min(t1, t2)) * mpp, min(w.length, max(t1, t2)) * mpp
            taken = any(op.offset < hi and lo < op.offset + op.width for op in cand.openings)
            if hi - lo >= 0.5 and not taken:
                cand.openings.append(OpeningCand(lo, hi - lo, "door", confidence=0.6))
        cand.openings.sort(key=lambda op: op.offset)
        out.append(cand)
    return out


#: un vértice del contorno de Claude se lleva al eje de un muro a menos de esto (m)
ROOM_SNAP_M = 0.45


def rooms_from_ai(plan: AIPlan, walls: list[WallCand], mpp: float) -> list[Polygon]:
    """Contornos de ambientes de Claude (px) → polígonos en metros, con sus lados llevados
    a los ejes de los muros y recortados por las huellas de los muros (como los de
    ``rooms_from_walls``). Los que se superponen ceden el área ya tomada."""
    xs = [(w.x1, min(w.y1, w.y2), max(w.y1, w.y2)) for w in walls if abs(w.x2 - w.x1) < 1e-6]
    ys = [(w.y1, min(w.x1, w.x2), max(w.x1, w.x2)) for w in walls if abs(w.y2 - w.y1) < 1e-6]

    def snap(v: float, w: float, axes: list[tuple[float, float, float]]) -> float:
        near = [
            (abs(a - v), a)
            for a, lo, hi in axes
            if abs(a - v) <= ROOM_SNAP_M and lo - ROOM_SNAP_M <= w <= hi + ROOM_SNAP_M
        ]
        return min(near)[1] if near else v

    solid = unary_union([w.footprint() for w in walls]) if walls else Polygon()
    taken = Polygon()
    out: list[Polygon] = []
    for r in plan.rooms:
        if len(r.outline) < 3:
            continue
        pts = [(snap(x * mpp, y * mpp, xs), snap(y * mpp, x * mpp, ys)) for x, y in r.outline]
        poly = Polygon(pts).buffer(0)
        if poly.is_empty:
            continue
        poly = poly.difference(solid).difference(taken)
        parts = [g for g in getattr(poly, "geoms", [poly]) if g.geom_type == "Polygon"]
        if not parts:
            continue
        best = max(parts, key=lambda g: g.area)
        if best.area < 0.8:
            continue
        best = Polygon(best.exterior).simplify(0.01)
        if best.is_valid:
            out.append(best)
            taken = taken.union(best)
    return out
