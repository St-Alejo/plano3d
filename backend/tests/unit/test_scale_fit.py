"""Escala por consenso de cotas (RANSAC)."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from plano3d.domain.scale_fit import ScalePair, fit_scale


def test_ignora_lecturas_erroneas() -> None:
    mpp = 0.0125
    good = [ScalePair(v / mpp, v, f"t{i}", f"l{i}") for i, v in enumerate((3.45, 5.0, 14.0, 2.5))]
    bad = [ScalePair(300, 3.15, "x", "y"), ScalePair(100, 45.0, "z", "w")]  # "3,45" leído "3,15"
    fit = fit_scale(good + bad)
    assert fit is not None
    assert fit.meters_per_unit == pytest.approx(mpp)
    assert fit.support == 4


def test_un_texto_no_cuenta_dos_veces() -> None:
    pairs = [
        ScalePair(100, 1.0, "t", "a"),
        ScalePair(100, 1.0, "t", "b"),
        ScalePair(200, 2.0, "u", "c"),
    ]
    fit = fit_scale(pairs)
    assert fit is not None and fit.support == 2


def test_sin_pares() -> None:
    assert fit_scale([]) is None


@given(
    st.floats(0.001, 0.1),
    st.lists(st.floats(0.5, 30), min_size=3, max_size=12, unique=True),
)
def test_recupera_la_escala(mpp: float, values: list[float]) -> None:
    fit = fit_scale([ScalePair(v / mpp, v, i, i) for i, v in enumerate(values)])
    assert fit is not None
    assert fit.meters_per_unit == pytest.approx(mpp, rel=1e-6)
    assert fit.support == len(values)
