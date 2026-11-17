"""Muros leídos por Claude (cliente falso, nunca la API) y su ajuste a la tinta."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import cv2
import numpy as np
import pytest

from plano3d.infrastructure.cv.ai_walls import (
    AIOpening,
    AIPlan,
    AIRoom,
    AIWall,
    ClaudeWallReader,
    fit_to_ink,
    mpp_from_dimensions,
    mpp_from_doors,
    parse_plan,
    rooms_from_ai,
    to_candidates,
)
from plano3d.infrastructure.cv.imageio import encode_png
from plano3d.infrastructure.cv.raster_vector_detector import run_sync
from plano3d.infrastructure.ocr.budget import ClaudeBudget, ResponseCache

#: planta de prueba (px): marco de 600 x 400 con muros de 10 px y un tabique en x=400
#: cortado por una puerta entre y=250 y y=330
X0, Y0, X1, Y1, XM = 100, 100, 700, 500, 400


def drawing() -> np.ndarray:
    img = np.full((600, 800, 3), 255, np.uint8)
    cv2.rectangle(img, (X0 - 5, Y0 - 5), (X1 + 5, Y1 + 5), (0, 0, 0), -1)
    cv2.rectangle(img, (X0 + 5, Y0 + 5), (X1 - 5, Y1 - 5), (255, 255, 255), -1)
    cv2.rectangle(img, (XM - 5, Y0), (XM + 5, 250), (0, 0, 0), -1)
    cv2.rectangle(img, (XM - 5, 330), (XM + 5, Y1), (0, 0, 0), -1)
    # una línea de cota fuera del edificio: no es muro
    cv2.line(img, (X0, 560), (X1, 560), (0, 0, 0), 1)
    return img


def ink_of(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return np.where(gray < 128, 255, 0).astype(np.uint8)


def payload(shift: float = 4.0) -> dict[str, Any]:
    """Lo que "lee" Claude: ejes corridos unos px, el tabique partido en la puerta y un muro
    inventado sobre la cota."""
    s = shift

    def wall(x1: float, y1: float, x2: float, y2: float, ext: bool = False) -> dict[str, Any]:
        return {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "thickness": 12, "exterior": ext}

    return {
        "walls": [
            wall(X0, Y0 + s, X1, Y0 + s, True),
            wall(X1 - s, Y0, X1 - s, Y1, True),
            wall(X1, Y1 - s, X0, Y1 - s, True),
            wall(X0 + s, Y1, X0 + s, Y0, True),
            wall(XM + s, Y0, XM + s, 250),
            wall(XM + s, 330, XM + s, Y1),
            wall(X0, 560 + 40, X1, 560 + 40),  # sin tinta debajo
        ],
        "openings": [
            {"wall": 0, "kind": "window", "x1": 200, "y1": Y0, "x2": 300, "y2": Y0},
            {"wall": 2, "kind": "door", "x1": 600, "y1": Y1, "x2": 520, "y2": Y1},
            {"wall": 4, "kind": "door", "x1": XM, "y1": 250, "x2": XM, "y2": 330},
        ],
        "rooms": [
            {
                "name": "Sala",
                "x": 250,
                "y": 300,
                "outline": [
                    {"x": X0, "y": Y0},
                    {"x": XM + 3, "y": Y0},
                    {"x": XM + 3, "y": Y1},
                    {"x": X0, "y": Y1},
                ],
            },
            {
                "name": "Alcoba",
                "x": 550,
                "y": 300,
                "outline": [
                    {"x": XM, "y": Y0},
                    {"x": X1, "y": Y0},
                    {"x": X1, "y": Y1},
                    {"x": XM, "y": Y1},
                ],
            },
        ],
        "dimensions": [],
    }


class _FakeMessages:
    def __init__(self, data: dict[str, Any], stop: str = "end_turn") -> None:
        self.data = data
        self.stop = stop
        self.calls: list[dict[str, Any]] = []

    def create(self, **kw: Any) -> Any:
        self.calls.append(kw)
        block = SimpleNamespace(type="text", text=json.dumps(self.data))
        usage = SimpleNamespace(input_tokens=5000, output_tokens=1500)
        return SimpleNamespace(stop_reason=self.stop, content=[block], usage=usage)


@pytest.fixture
def make_reader(tmp_path: Any) -> Any:
    """Lectores con tope y caché aislados (nunca el gasto real)."""

    def make(data: dict[str, Any], stop: str = "end_turn", limit: float = 1.0) -> Any:
        msgs = _FakeMessages(data, stop)
        reader = ClaudeWallReader(
            SimpleNamespace(messages=msgs),
            budget=ClaudeBudget(tmp_path / "uso.json", limit),
            cache=ResponseCache(tmp_path / "cache"),
        )
        return reader, msgs

    return make


def test_lee_con_salida_estructurada_cachea_y_cobra(make_reader: Any, tmp_path: Any) -> None:
    reader, msgs = make_reader(payload())
    plan = reader.read(drawing())
    assert plan is not None
    assert len(plan.walls) == 7 and [r.name for r in plan.rooms] == ["Sala", "Alcoba"]
    kw = msgs.calls[0]
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["messages"][0]["content"][0]["type"] == "image"
    # la segunda vez sale de la caché: no se paga dos veces
    assert reader.read(drawing()) is not None
    assert len(msgs.calls) == 1
    spent = json.loads((tmp_path / "uso.json").read_text())["spent_usd"]
    assert spent == pytest.approx((5000 * 2 + 1500 * 10) / 1e6)


def test_rechazo_tope_o_basura_no_rompen(make_reader: Any) -> None:
    reader, _ = make_reader(payload(), stop="refusal")
    assert reader.read(drawing()) is None
    reader, msgs = make_reader(payload(), limit=0.0)
    assert reader.read(np.zeros((50, 50, 3), np.uint8)) is None
    assert msgs.calls == []  # sin presupuesto ni siquiera se llama
    bad = parse_plan({"walls": [{"x1": "a"}], "rooms": [{"name": " "}], "dimensions": []})
    assert bad.walls == [] and bad.rooms == []


def test_imagenes_grandes_se_envian_reducidas_y_vuelven_a_su_escala(make_reader: Any) -> None:
    big = cv2.resize(drawing(), None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)  # 3200 px
    reader, msgs = make_reader(payload())
    plan = reader.read(big)
    assert plan is not None
    sent = msgs.calls[0]["messages"][0]["content"][1]["text"]
    assert "2576 x 1932" in sent
    # las coordenadas que devolvió Claude (en la imagen enviada) pasan a la original
    assert plan.walls[1].x1 == pytest.approx((X1 - 4) * 3200 / 2576)


def test_cada_muro_se_ajusta_a_su_tinta_y_lo_inventado_se_descarta() -> None:
    plan = parse_plan(payload())
    walls = fit_to_ink(plan, ink_of(drawing()))
    assert len(walls) == 6  # el de la cota no tiene tinta debajo
    top = next(w for w in walls if w.source == 0)
    assert top.y1 == pytest.approx(Y0, abs=1.0) and top.y2 == top.y1
    assert top.thickness == pytest.approx(11, abs=2)
    # las esquinas quedan cerradas: el extremo del muro superior está sobre el eje derecho
    right = next(w for w in walls if w.source == 1)
    assert right.x1 == pytest.approx(X1, abs=1.0)
    assert max(top.x1, top.x2) == pytest.approx(right.x1, abs=1.5)


def test_el_hueco_de_una_puerta_se_cierra_y_queda_como_vano() -> None:
    plan = parse_plan(payload())
    mpp = 0.01
    walls = fit_to_ink(plan, ink_of(drawing()), mpp)
    # los dos tramos del tabique son uno solo, de muro a muro, con la puerta en medio
    middle = [w for w in walls if abs(w.x1 - XM) < 2 and abs(w.x2 - XM) < 2]
    assert len(middle) == 1
    m = middle[0]
    assert sorted((m.y1, m.y2)) == pytest.approx([Y0, Y1], abs=2)
    cands = to_candidates(walls, plan, mpp)
    wall = next(c for c in cands if abs(c.x1 - XM * mpp) < 0.03 and abs(c.x2 - XM * mpp) < 0.03)
    assert len(wall.openings) == 1
    op = wall.openings[0]
    assert op.kind == "door" and op.width == pytest.approx(0.8, abs=0.06)


def test_escala_por_cotas_o_por_puertas() -> None:
    plan = AIPlan(dimensions=[(0, 0, 500, 0, 5.0), (0, 0, 0, 300, 3.0), (0, 0, 100, 0, 9.0)])
    assert mpp_from_dimensions(plan) == pytest.approx(0.01)  # la que no concuerda se ignora
    assert mpp_from_dimensions(AIPlan(dimensions=[(0, 0, 500, 0, 5.0)])) is None
    doors = AIPlan(
        openings=[
            AIOpening(0, "door", 0, 0, 85, 0),
            AIOpening(0, "door", 0, 0, 0, 85),
            AIOpening(0, "window", 0, 0, 300, 0),
        ]
    )
    assert mpp_from_doors(doors) == pytest.approx(0.01)
    assert mpp_from_doors(AIPlan(openings=[AIOpening(0, "door", 0, 0, 85, 0)])) is None


def test_contornos_de_ambientes_van_a_los_ejes_y_no_se_pisan() -> None:
    mpp = 0.01
    plan = AIPlan(
        walls=[AIWall(0, 0, 1, 0, 1)],
        rooms=[
            AIRoom("Sala", 250, 300, [(X0, Y0), (XM + 20, Y0), (XM + 20, Y1), (X0, Y1)]),
            AIRoom("Alcoba", 550, 300, [(XM, Y0), (X1, Y0), (X1, Y1), (XM, Y1)]),
            AIRoom("Nada", 0, 0, [(0, 0), (1, 1)]),
        ],
    )
    fitted = fit_to_ink(parse_plan(payload()), ink_of(drawing()), mpp)
    cands = to_candidates(fitted, parse_plan(payload()), mpp)
    rooms = rooms_from_ai(plan, cands, mpp)
    assert len(rooms) == 2
    sala, alcoba = rooms
    # el lado de la sala que Claude dibujó 20 px corrido queda en la cara del tabique
    assert sala.bounds[2] == pytest.approx(XM * mpp - 0.05, abs=0.02)
    assert alcoba.bounds[0] == pytest.approx(XM * mpp + 0.05, abs=0.02)
    assert sala.intersection(alcoba).area == pytest.approx(0.0, abs=1e-6)


def test_en_el_pipeline_los_muros_y_ambientes_de_la_ia_mandan(make_reader: Any) -> None:
    reader, msgs = make_reader(payload())
    data = encode_png(drawing())
    ctx = run_sync("p", data, "image/png", None, walls=reader)
    assert len(msgs.calls) == 1
    assert ctx.metrics["ai_walls"] == 5
    model = ctx.require(ctx.model, "model")
    lv = model.levels[0]
    assert sorted(r.label for r in lv.rooms) == ["Alcoba", "Sala"]
    doors = [op for w in lv.walls for op in w.openings if op.kind.value == "door"]
    assert len(doors) == 2
    # sin cotas, la escala sale de las puertas (80 px ≈ 85 cm)
    assert model.scale.meters_per_pixel == pytest.approx(0.85 / 80, rel=0.05)


def test_sin_lector_el_pipeline_no_cambia() -> None:
    ctx = run_sync("p", encode_png(drawing()), "image/png", None)
    assert "ai_walls" not in ctx.metrics
