"""Decodificación de imágenes/PDF y medición de calidad (adaptador ImageInspector)."""

from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image as PILImage
from PIL import ImageOps

from plano3d.application.ports import ImageQuality, PaperDetector
from plano3d.application.use_cases.analyze import ImageInspector
from plano3d.infrastructure.cv.context import Img, as_u8

MAX_SIDE = 2400
PDF_DPI = 200
#: lado mayor del render de un PDF: un pliego A0 a 200 ppp pasaría de 60 Mpx (cientos de MB)
PDF_MAX_SIDE = 6000


class ImageDecodeError(ValueError):
    pass


def decode(data: bytes, content_type: str, max_side: int = MAX_SIDE) -> Img:
    """Bytes → imagen BGR, respetando la orientación EXIF de las fotos del celular."""
    return decode_scaled(data, content_type, max_side)[0]


def decode_scaled(data: bytes, content_type: str, max_side: int = MAX_SIDE) -> tuple[Img, float]:
    """Como ``decode`` pero devuelve también el factor de reducción aplicado (1.0 = ninguno)."""
    if content_type == "application/pdf":
        img = _decode_pdf(data)
    else:
        try:
            opened = PILImage.open(io.BytesIO(data))
            pil = ImageOps.exif_transpose(opened) or opened
            rgb = np.asarray(pil.convert("RGB"))
        except Exception as exc:  # PIL lanza varios tipos distintos
            raise ImageDecodeError(f"No se pudo leer la imagen: {exc}") from exc
        img = as_u8(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    h, w = img.shape[:2]
    if max(h, w) <= max_side:
        return img, 1.0
    f = max_side / max(h, w)
    nw, nh = round(w * f), round(h * f)
    img = as_u8(cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA))
    return img, nw / w


def pdf_render_scale(width_pt: float, height_pt: float) -> float:
    """Escala de render (px por punto): 200 ppp, salvo que el lado mayor pase de PDF_MAX_SIDE."""
    return min(PDF_DPI / 72, PDF_MAX_SIDE / max(width_pt, height_pt))


def _decode_pdf(data: bytes) -> Img:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
        page = pdf[0]
        width_pt, height_pt = page.get_size()
        if min(width_pt, height_pt) <= 0:
            raise ImageDecodeError("La página del PDF no tiene tamaño")
        pil = page.render(scale=pdf_render_scale(width_pt, height_pt)).to_pil()
    except ImageDecodeError:
        raise
    except Exception as exc:
        raise ImageDecodeError(f"No se pudo leer el PDF: {exc}") from exc
    return as_u8(cv2.cvtColor(np.asarray(pil.convert("RGB")), cv2.COLOR_RGB2BGR))


def encode_png(img: Img) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("No se pudo codificar PNG")
    return bytes(buf.tobytes())


class OpenCVPaperDetector(PaperDetector):
    """Sugiere las esquinas de la hoja para el editor manual (misma lógica que RectifyStage)."""

    def detect(self, data: bytes, content_type: str) -> list[tuple[float, float]] | None:
        from plano3d.infrastructure.cv.stages.rectify import find_paper_quad

        img = decode(data, content_type, max_side=1600)
        quad = find_paper_quad(img)
        if quad is None:
            return None
        h, w = img.shape[:2]
        return [(round(float(x) / w, 4), round(float(y) / h, 4)) for x, y in quad]


class OpenCVImageInspector(ImageInspector):
    def inspect(self, data: bytes, content_type: str) -> ImageQuality:
        img = decode(data, content_type, max_side=1200)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return ImageQuality(
            width=img.shape[1],
            height=img.shape[0],
            sharpness=float(cv2.Laplacian(gray, cv2.CV_64F).var()),
            contrast=float(gray.std()),
        )
