"""Lectura de los textos de un plano arquitectónico colombiano (funciones puras).

Convenciones cubiertas (NTC 1960 y la práctica local):
- cotas en metros con coma decimal ``3,45`` o punto ``3.45``; enteros en centímetros
  ``345``; superíndice para los centímetros ``3⁴⁵`` (o ``3^45`` tras un OCR);
  con unidad explícita ``3,45 m`` / ``345 cm`` / ``3450 mm``;
- áreas ``A= 12,50 m²`` / ``AREA: 12.5 M2``;
- niveles ``N+0,00``, ``N -0.45``, ``NPT +2,80``, ``N.P.T. 5,60``;
- escala ``ESC 1:50``, ``ESCALA 1/100``;
- nombres de ambientes → ``RoomType`` (sin importar tildes ni mayúsculas).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from plano3d.domain.elements import LabelKind, RoomType

LengthUnit = Literal["m", "cm", "mm"]

_SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
_SUP_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹"


def strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _number(text: str) -> float | None:
    """'3,45' | '3.45' | '1.234,5' | '1,234.5' → float."""
    t = text.strip().replace(" ", "")
    if not t or not re.fullmatch(r"[\d.,]+", t) or not any(c.isdigit() for c in t):
        return None
    if "," in t and "." in t:
        # el separador que aparece último es el decimal
        if t.rfind(",") > t.rfind("."):
            t = t.replace(".", "").replace(",", ".")
        else:
            t = t.replace(",", "")
    elif t.count(",") == 1:
        t = t.replace(",", ".")
    elif t.count(",") > 1 or t.count(".") > 1:
        return None
    try:
        return float(t)
    except ValueError:
        return None


@dataclass(frozen=True, slots=True)
class ParsedLength:
    meters: float
    unit: LengthUnit
    #: True si la unidad se dedujo (un entero sin unidad podría ser cm o m)
    ambiguous: bool = False


_UNIT_RE = re.compile(r"^(?P<num>[\d.,\s]+?)\s*(?P<unit>mm|cm|mts?|m)\.?$", re.IGNORECASE)
_SUP_RE = re.compile(rf"^(?P<m>\d+)\s*(?:\^|(?=[{_SUP_CHARS}]))(?P<cm>[\d{_SUP_CHARS}]{{1,2}})$")


def parse_length(text: str, default_integer_unit: LengthUnit = "cm") -> ParsedLength | None:
    """Interpreta el texto de una cota. ``None`` si no es una longitud.

    Un entero sin unidad se toma en ``default_integer_unit`` (cm por defecto, lo usual en
    planos que acotan sin decimales) y se marca como ambiguo.
    """
    t = text.strip().replace("\u2212", "-").replace("\u2013", "-")  # signo menos y raya
    t = t.rstrip(".").strip()
    if not t or t.startswith("-"):
        return None
    sup = _SUP_RE.match(t)
    if sup:
        cm = sup.group("cm").translate(_SUPERSCRIPT)
        if len(cm) == 1:
            cm += "0"
        return ParsedLength(int(sup.group("m")) + int(cm) / 100, "m")
    unit_m = _UNIT_RE.match(t)
    if unit_m:
        value = _number(unit_m.group("num"))
        if value is None or value <= 0:
            return None
        unit = unit_m.group("unit").lower()
        if unit.startswith("m") and unit != "mm":
            return ParsedLength(value, "m")
        if unit == "cm":
            return ParsedLength(value / 100, "cm")
        return ParsedLength(value / 1000, "mm")
    value = _number(t)
    if value is None or value <= 0:
        return None
    if re.fullmatch(r"\d+", t):
        if default_integer_unit == "m":
            return ParsedLength(value, "m", ambiguous=True)
        if default_integer_unit == "mm":
            return ParsedLength(value / 1000, "mm", ambiguous=True)
        return ParsedLength(value / 100, "cm", ambiguous=True)
    return ParsedLength(value, "m")


def format_length(meters: float) -> str:
    """Escritura colombiana en metros: 3.45 → '3,45'."""
    return f"{meters:.2f}".replace(".", ",")


_AREA_RE = re.compile(r"(?:A(?:REA)?\s*[=:]?\s*)?(?P<num>\d[\d.,]*)\s*M\s*(?:2|²)\b", re.IGNORECASE)
_LEVEL_RE = re.compile(
    r"^\s*(?:N\.?\s*P\.?\s*T\.?|NPT|NIVEL|N)\s*\.?\s*:?\s*(?P<sign>[+-]?)\s*(?P<num>\d[\d.,]*)\s*$",
    re.IGNORECASE,
)
_SCALE_RE = re.compile(r"ESC(?:ALA)?\.?\s*:?\s*1\s*[:/]\s*(?P<den>\d+)", re.IGNORECASE)


def parse_area(text: str) -> float | None:
    """'A= 12,50 m²' → 12.5 (m²)."""
    m = _AREA_RE.search(strip_accents(text).replace("²", "2"))
    if not m:
        return None
    value = _number(m.group("num"))
    return value if value and value > 0 else None


def parse_level(text: str) -> float | None:
    """'N+2,80' → 2.8; 'NPT -0,45' → -0.45 (metros)."""
    m = _LEVEL_RE.match(strip_accents(text))
    if not m:
        return None
    value = _number(m.group("num"))
    if value is None:
        return None
    return -value if m.group("sign") == "-" else value


def parse_scale(text: str) -> int | None:
    """'ESC 1:50' → 50."""
    m = _SCALE_RE.search(strip_accents(text))
    if not m:
        return None
    den = int(m.group("den"))
    return den if den > 0 else None


_ROOM_WORDS: tuple[tuple[RoomType, tuple[str, ...]], ...] = (
    (RoomType.BATHROOM, ("BANO", "WC", "SANITARIO", "AASS", "SERVICIO SANITARIO")),
    (RoomType.KITCHEN, ("COCINA", "COCINETA", "KITCHENETTE")),
    (RoomType.LAUNDRY, ("ROPAS", "LAVANDERIA", "ZONA DE ROPAS", "LAVADO")),
    (RoomType.BEDROOM, ("ALCOBA", "HABITACION", "DORMITORIO", "CUARTO", "RECAMARA")),
    (RoomType.LIVING, ("SALA", "COMEDOR", "ESTAR", "LIVING")),
    (RoomType.STUDY, ("ESTUDIO", "OFICINA", "BIBLIOTECA")),
    (
        RoomType.CIRCULATION,
        ("CORREDOR", "HALL", "PASILLO", "CIRCULACION", "ACCESO", "RECIBIDOR", "VESTIBULO"),
    ),
    (RoomType.PATIO, ("PATIO", "TERRAZA", "BALCON", "JARDIN", "ANTEJARDIN")),
    (RoomType.STORAGE, ("DEPOSITO", "CLOSET", "ALACENA", "BODEGA", "VESTIER", "CUARTO UTIL")),
    (RoomType.GARAGE, ("GARAJE", "PARQUEADERO", "COCHERA", "ESTACIONAMIENTO")),
    (RoomType.STAIRS, ("ESCALERA", "PUNTO FIJO")),
)


def room_type_from_name(name: str) -> RoomType:
    upper = strip_accents(name).upper()
    for kind, words in _ROOM_WORDS:
        if any(re.search(rf"\b{re.escape(w)}", upper) for w in words):
            return kind
    return RoomType.OTHER


_AXIS_RE = re.compile(r"^(?:EJE\s*)?(?:[A-Z]|\d{1,2})'?$")


def classify_label(text: str) -> LabelKind:
    """Qué es un texto suelto del plano."""
    t = text.strip()
    if parse_scale(t) is not None:
        return LabelKind.SCALE
    if parse_level(t) is not None:
        return LabelKind.LEVEL
    if parse_area(t) is not None:
        return LabelKind.AREA
    if _AXIS_RE.match(strip_accents(t).upper()):
        return LabelKind.AXIS
    if room_type_from_name(t) is not RoomType.OTHER:
        return LabelKind.ROOM_NAME
    if re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}", t) and parse_length(t) is None:
        return LabelKind.ROOM_NAME
    return LabelKind.OTHER


# Los planos bilingües repiten cada nombre en inglés ("BAÑO / BATHROOM"): el inglés
# confirma el tipo pero no se muestra si ya hay nombre en español.
_ENGLISH_WORDS: tuple[tuple[RoomType, tuple[str, ...]], ...] = (
    (RoomType.BATHROOM, ("BATHROOM", "BATH", "TOILET", "RESTROOM")),
    (RoomType.KITCHEN, ("KITCHEN",)),
    (RoomType.LAUNDRY, ("LAUNDRY",)),
    (RoomType.BEDROOM, ("BEDROOM",)),
    (RoomType.LIVING, ("LIVING", "DINING", "FAMILY ROOM", "LOUNGE")),
    (RoomType.STUDY, ("STUDY", "OFFICE", "LIBRARY")),
    (RoomType.CIRCULATION, ("CORRIDOR", "HALLWAY", "ENTRANCE", "ACCESS", "LOBBY", "FOYER")),
    (RoomType.PATIO, ("TERRACE", "BALCONY", "GARDEN", "PORCH", "DECK")),
    (RoomType.STORAGE, ("STORAGE", "PANTRY", "WARDROBE")),
    (RoomType.GARAGE, ("GARAGE", "CARPORT", "PARKING")),
    (RoomType.STAIRS, ("STAIRS", "STAIRCASE")),
)

#: forma de mostrar las palabras que el OCR suele leer sin tilde ni eñe
_DISPLAY = {
    "BANO": "Baño",
    "HABITACION": "Habitación",
    "RECAMARA": "Recámara",
    "LAVANDERIA": "Lavandería",
    "CIRCULACION": "Circulación",
    "VESTIBULO": "Vestíbulo",
    "DEPOSITO": "Depósito",
    "BALCON": "Balcón",
    "JARDIN": "Jardín",
    "CUARTO UTIL": "Cuarto útil",
}


def _match(
    upper: str, table: tuple[tuple[RoomType, tuple[str, ...]], ...]
) -> tuple[RoomType, str] | None:
    best: tuple[int, RoomType, str] | None = None
    for kind, words in table:
        for w in words:
            m = re.search(rf"\b{re.escape(w)}", upper)
            if m and (best is None or m.start() < best[0]):
                best = (m.start(), kind, w)
    return (best[1], best[2]) if best else None


@dataclass(frozen=True)
class RoomName:
    label: str
    room_type: RoomType


def room_name_from_texts(texts: list[str]) -> RoomName | None:
    """Nombre de un ambiente a partir de los textos que caen dentro (en orden de lectura).

    ``["BAÑO", "BATHROOM"]`` → Baño; ``["DORMITORIO-BEDROOM"]`` → Dormitorio;
    ``["COCINA", "KITCHEN", "SALA", "LIVINGROOM"]`` → Cocina / Sala (espacio abierto).
    Las cotas, ejes y letras sueltas se ignoran. Sin palabra conocida devuelve ``None``.
    """
    spanish: list[tuple[RoomType, str, str]] = []
    english: list[tuple[RoomType, str, str]] = []
    for text in texts:
        upper = strip_accents(text).upper()
        # "DORMITORIO-BEDROOM", "SALA/LIVING": cada parte puede ser un idioma
        for part in re.split(r"\s*[-/|]\s*", upper):
            # el OCR a veces pega palabras ("LIVINGROOM")
            es = _match(part, _ROOM_WORDS)
            # "LIVING" vale en ambos idiomas: si ya hay un nombre de ese tipo, es la traducción
            bilingual = es is not None and _match(es[1], _ENGLISH_WORDS) is not None
            if es and bilingual and any(es[0] == k for k, _, _ in spanish):
                continue
            if es and all(es[1] != w for _, w, _ in spanish):
                spanish.append((*es, _qualifier(part, es[1])))
                continue
            en = _match(part, _ENGLISH_WORDS)
            if en and not es and all(en[1] != w for _, w, _ in english):
                english.append((*en, ""))
    names = spanish or english
    if not names:
        return None
    label = " / ".join(
        (_DISPLAY.get(w, w.capitalize()) + (f" {q}" if q else "")) for _, w, q in names
    )
    return RoomName(label, names[0][0])


def _qualifier(part: str, word: str) -> str:
    """Lo que sigue al nombre: "RECAMARA 3" → "3", "BANO MASTER" → "master"."""
    rest = part[part.find(word) + len(word) :].split()
    keep = [
        t.lower()
        for t in rest[:2]
        if re.fullmatch(r"[A-Z0-9]{1,10}", t) and _match(t, _ENGLISH_WORDS) is None
    ]
    return " ".join(keep)
