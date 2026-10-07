"""Los PDF se rasterizan con un tope de píxeles: un pliego gigante no agota la memoria."""

import io

import pypdfium2 as pdfium
import pytest

from plano3d.infrastructure.cv.imageio import (
    PDF_DPI,
    PDF_MAX_SIDE,
    ImageDecodeError,
    decode_scaled,
    pdf_render_scale,
)


def blank_pdf(width_pt: float, height_pt: float) -> bytes:
    doc = pdfium.PdfDocument.new()
    doc.new_page(width_pt, height_pt)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_carta_se_renderiza_a_200_ppp() -> None:
    assert pdf_render_scale(612, 792) == pytest.approx(PDF_DPI / 72)


def test_pagina_gigante_queda_limitada() -> None:
    # 5 m x 5 m: sin tope serían ~39 000 px de lado
    img, _ = decode_scaled(blank_pdf(14_000, 14_000), "application/pdf", max_side=100_000)
    assert max(img.shape[:2]) <= PDF_MAX_SIDE


def test_pdf_ilegible_da_error_claro() -> None:
    with pytest.raises(ImageDecodeError):
        decode_scaled(b"%PDF-roto", "application/pdf")
