"""
Alinea las fotos de la obra (misma calle, misma cámara) para que el fundido del hero no salte.

Las imágenes generadas por IA cambian un poco el encuadre de una a otra. Este script busca
puntos comunes (las casas vecinas, la calle, las montañas) contra una foto de referencia,
calcula una similitud (escala + giro + traslado) con RANSAC, deforma cada foto a la
referencia y recorta todas al área que comparten, en 16:9.

Uso (desde frontend/):  python scripts/align_hero.py
Lee design/imagenes/<nombre>.png y escribe design/imagenes/hero-NN-<nombre>.png.
"""
from pathlib import Path

import cv2
import numpy as np

SRC = Path(__file__).resolve().parent.parent / "design" / "imagenes"
REF = "etapa-2-cimentacion"
# orden del recorrido; la primera (el plano sobre la mesa) es otra escena y no se alinea
SEQ = [
    "obra-01-replanteo",
    "etapa-2-cimentacion",
    "obra-02-cimiento-fundido",
    "etapa-3-muros",
    "obra-03-losa",
    "obra-04-segundo-piso",
    "etapa-4-estructura",
    "obra-05-panete",
    "obra-06-pintura",
    "etapa-5-acabados",
    "obra-07-hora-dorada",
    "etapa-6-hogar",
]
# variantes del mismo cuadro (luces apagadas) que se alinean y recortan igual: nombre fuente -> salida
VARIANTS = {"obra-08-hogar-apagado": "hero-13-hogar-apagado"}
# pares interiores: la variante se alinea sobre su foto base y conserva su tamaño
PAIRS = [
    ("interior-umbral", "interior-umbral-cerrada-fuente", "interior-umbral-cerrada"),
    ("interior-terraza", "interior-terraza-apagada-fuente", "interior-terraza-apagada"),
]
OUT_W, OUT_H = 1920, 1080


def load(name: str) -> np.ndarray:
    img = cv2.imread(str(SRC / f"{name}.png"), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"falta {name}.png")
    return img


def match(ref: np.ndarray, img: np.ndarray) -> np.ndarray:
    """Matriz 2x3 que lleva `img` sobre `ref` (similitud)."""
    sift = cv2.SIFT_create(6000)
    g1 = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    k1, d1 = sift.detectAndCompute(g1, None)
    k2, d2 = sift.detectAndCompute(g2, None)
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(d2, d1, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.72 * n.distance]
    src = np.float32([k2[m.queryIdx].pt for m in good])
    dst = np.float32([k1[m.trainIdx].pt for m in good])
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4, maxIters=8000, confidence=0.999)
    if M is None:
        raise SystemExit("sin coincidencias suficientes")
    s = float(np.hypot(M[0, 0], M[1, 0]))
    print(f"  {len(good):5d} pares, {int(inl.sum()):5d} inliers, escala {s:.3f}, dx {M[0, 2]:7.1f}, dy {M[1, 2]:7.1f}")
    return M


def main() -> None:
    ref = load(REF)
    h, w = ref.shape[:2]
    warped: dict[str, np.ndarray] = {}
    valid = np.ones((h, w), np.uint8)
    for name in [*SEQ, *VARIANTS]:
        img = load(name)
        print(name)
        if name == REF:
            out = ref
            mask = np.full((h, w), 255, np.uint8)
        else:
            M = match(ref, img)
            out = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
            mask = cv2.warpAffine(np.full(img.shape[:2], 255, np.uint8), M, (w, h), flags=cv2.INTER_NEAREST)
        warped[name] = out
        valid &= (mask > 0).astype(np.uint8)

    # rectángulo común: recorta filas y columnas con huecos, luego a 16:9 centrado
    rows = np.where(valid.mean(axis=1) > 0.98)[0]
    cols = np.where(valid.mean(axis=0) > 0.98)[0]
    # margen de seguridad para los bordes interpolados
    y0, y1, x0, x1 = rows[0] + 4, rows[-1] - 3, cols[0] + 4, cols[-1] - 3
    cw, ch = x1 - x0, y1 - y0
    if cw / ch > 16 / 9:
        nw = int(ch * 16 / 9)
        x0 += (cw - nw) // 2
        x1 = x0 + nw
    else:
        nh = int(cw * 9 / 16)
        y0 += (ch - nh) // 2
        y1 = y0 + nh
    print(f"recorte común: x {x0}-{x1}, y {y0}-{y1} ({x1 - x0}x{y1 - y0})")

    for i, name in enumerate(SEQ, start=2):
        crop = warped[name][y0:y1, x0:x1]
        crop = cv2.resize(crop, (OUT_W, OUT_H), interpolation=cv2.INTER_LANCZOS4)
        cv2.imwrite(str(SRC / f"hero-{i:02d}-{name}.png"), crop)
    for name, out_name in VARIANTS.items():
        crop = cv2.resize(warped[name][y0:y1, x0:x1], (OUT_W, OUT_H), interpolation=cv2.INTER_LANCZOS4)
        cv2.imwrite(str(SRC / f"{out_name}.png"), crop)
    for base, src, out_name in PAIRS:
        b, v = load(base), load(src)
        print(src)
        M = match(b, v)
        out = cv2.warpAffine(v, M, (b.shape[1], b.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
        cv2.imwrite(str(SRC / f"{out_name}.png"), out)
    # el plano sobre la mesa: solo recorte 16:9 al mismo tamaño
    plano = load("etapa-1-plano")
    ph, pw = plano.shape[:2]
    nh = int(pw * 9 / 16)
    top = (ph - nh) // 2
    cv2.imwrite(str(SRC / "hero-01-etapa-1-plano.png"), cv2.resize(plano[top : top + nh], (OUT_W, OUT_H), interpolation=cv2.INTER_LANCZOS4))
    print("listo")


if __name__ == "__main__":
    main()
