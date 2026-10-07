"""Parser de textos de planos colombianos."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from plano3d.domain import LabelKind, RoomType
from plano3d.domain.plan_text import (
    RoomName,
    classify_label,
    format_length,
    parse_area,
    parse_length,
    parse_level,
    parse_scale,
    room_name_from_texts,
    room_type_from_name,
)


@pytest.mark.parametrize(
    ("text", "meters", "unit", "ambiguous"),
    [
        ("3,45", 3.45, "m", False),
        ("3.45", 3.45, "m", False),
        ("14,00", 14.0, "m", False),
        ("0,90", 0.9, "m", False),
        ("345", 3.45, "cm", True),
        ("3⁴⁵", 3.45, "m", False),
        ("3^45", 3.45, "m", False),
        ("3^5", 3.5, "m", False),
        ("12⁰⁵", 12.05, "m", False),
        ("3,45 m", 3.45, "m", False),
        ("3.45mts", 3.45, "m", False),
        ("345 cm", 3.45, "cm", False),
        ("3450 mm", 3.45, "mm", False),
        ("1.234,5", 1234.5, "m", False),
    ],
)
def test_parse_length(text: str, meters: float, unit: str, ambiguous: bool) -> None:
    p = parse_length(text)
    assert p is not None
    assert p.meters == pytest.approx(meters)
    assert p.unit == unit
    assert p.ambiguous is ambiguous


@pytest.mark.parametrize("text", ["", "ALCOBA", "-3,45", "3,4,5", "N+2,80", "A= 12 m²", "0"])
def test_parse_length_rejects(text: str) -> None:
    assert parse_length(text) is None


def test_integer_unit_hint() -> None:
    p = parse_length("4", default_integer_unit="m")
    assert p is not None and p.meters == 4 and p.ambiguous


@given(st.integers(1, 9999))
def test_roundtrip_colombian_format(cm: int) -> None:
    meters = cm / 100
    p = parse_length(format_length(meters))
    assert p is not None
    assert p.meters == pytest.approx(meters)


@given(st.integers(0, 99), st.integers(0, 99))
def test_superscript_cm(m: int, cm: int) -> None:
    sup = str(cm).zfill(2).translate(str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹"))
    p = parse_length(f"{m}{sup}")
    assert p is not None
    assert p.meters == pytest.approx(m + cm / 100)


@pytest.mark.parametrize(
    ("text", "area"),
    [("A= 12,50 m²", 12.5), ("AREA: 12.5 M2", 12.5), ("Área 7,8m2", 7.8), ("22,63 m²", 22.63)],
)
def test_parse_area(text: str, area: float) -> None:
    assert parse_area(text) == pytest.approx(area)


@pytest.mark.parametrize(
    ("text", "level"),
    [
        ("N+0,00", 0.0),
        ("N+2,80", 2.8),
        ("N -0.45", -0.45),
        ("NPT +2,80", 2.8),
        ("N.P.T. 5,60", 5.6),
        ("NIVEL +3,15", 3.15),
    ],
)
def test_parse_level(text: str, level: float) -> None:
    assert parse_level(text) == pytest.approx(level)


@pytest.mark.parametrize(
    ("text", "den"),
    [("ESC 1:50", 50), ("ESCALA 1/100", 100), ("PLANTA ARQUITECTÓNICA  ESC 1:75", 75)],
)
def test_parse_scale(text: str, den: int) -> None:
    assert parse_scale(text) == den


@pytest.mark.parametrize(
    ("name", "kind"),
    [
        ("ALCOBA PPAL", RoomType.BEDROOM),
        ("Baño 2", RoomType.BATHROOM),
        ("SALA-COMEDOR 101", RoomType.LIVING),
        ("COCINA", RoomType.KITCHEN),
        ("Zona de ropas", RoomType.LAUNDRY),
        ("CORREDOR", RoomType.CIRCULATION),
        ("Circulación", RoomType.CIRCULATION),
        ("BALCÓN", RoomType.PATIO),
        ("Estudio", RoomType.STUDY),
        ("PUNTO FIJO", RoomType.STAIRS),
        ("Depósito", RoomType.STORAGE),
        ("XYZ", RoomType.OTHER),
    ],
)
def test_room_type(name: str, kind: RoomType) -> None:
    assert room_type_from_name(name) is kind


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("ESC 1:50", LabelKind.SCALE),
        ("N+2,80", LabelKind.LEVEL),
        ("A= 12,50 m²", LabelKind.AREA),
        ("ALCOBA 2", LabelKind.ROOM_NAME),
        ("B", LabelKind.AXIS),
        ("12", LabelKind.AXIS),
        ("3,45", LabelKind.OTHER),
    ],
)
def test_classify(text: str, kind: LabelKind) -> None:
    assert classify_label(text) is kind


def test_nombre_de_ambiente_bilingue() -> None:
    assert room_name_from_texts(["BANO", "BATHROOM"]) == RoomName("Baño", RoomType.BATHROOM)
    assert room_name_from_texts(["DORMITORIO-BEDROOM"]).label == "Dormitorio"  # type: ignore[union-attr]
    open_plan = room_name_from_texts(["COCINA", "KITCHEN", "O", "SALA", "LIVINGROOM"])
    assert open_plan == RoomName("Cocina / Sala", RoomType.KITCHEN)
    assert room_name_from_texts(["BEDROOM"]) == RoomName("Bedroom", RoomType.BEDROOM)
    assert room_name_from_texts(["2.40", "S6", ".10"]) is None
    assert room_name_from_texts(["BAÑO MASTER"]) == RoomName("Baño master", RoomType.BATHROOM)
    assert room_name_from_texts(["RECAMARA 3"]).label == "Recámara 3"  # type: ignore[union-attr]
    social = room_name_from_texts(["COMEDOR", "COCINA", "SALA"])
    assert social is not None and social.label == "Comedor / Cocina / Sala"
