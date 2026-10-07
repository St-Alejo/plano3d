# Bitácora de calidad: planos reales

Cada entrada: cambio y métricas resultantes (scripts/eval_real.py).

### 2026-10-06 23:43 — Línea base: detector actual (raster-vector + clásico)

## casa1  (raster-vector)  escala dimensions error +0.4%  niveles 1/1
- Planta 1: muros F1 0.96 (P 1.00 R 0.92, extremos 0.53, 7/8) · aberturas P 1.00 R 0.71 (5/7) · ambientes 1/3 IoU 0.33 nombres 0/3
- falta: Planta 1: aberturas, Planta 1: ambientes, Planta 1: nombres

### 2026-10-06 23:56 — Puertas entre extremo de tabique y muro transversal (con evidencia de arco/hoja/línea) y escala de cotas para la CV clásica

## casa1  (raster-vector)  escala dimensions error +0.4%  niveles 1/1
- Planta 1: muros F1 1.00 (P 1.00 R 1.00, extremos 0.80, 7/8) · aberturas P 0.86 R 0.86 (7/7) · ambientes 3/3 IoU 0.95 nombres 0/3
- falta: Planta 1: aberturas, Planta 1: nombres

### 2026-10-07 00:11 — Puerta corrediza (dos hojas desfasadas en el espesor, sin alféizar) se clasifica como puerta también en bridge_end_gaps; reporte lista cada abertura detectada.

## casa1  (raster-vector)  escala dimensions error +0.4%  niveles 1/1
- Planta 1: muros F1 1.00 (P 1.00 R 1.00, extremos 0.80, 7/8) · aberturas P 1.00 R 1.00 (7/7) · ambientes 3/3 IoU 0.95 nombres 0/3
- falta: Planta 1: nombres

### 2026-10-07 00:24 — Nombres de ambientes con OCR de hoja completa (RapidOCR det+rec, puerto TextSpotter) y RoomNamesStage; bilingüe (BAÑO/BATHROOM → Baño). Puertas corredizas marcadas operation=sliding y dibujadas como dos hojas en 3D. casa1 CUMPLE todo; revisión visual 2D/3D ok.

## casa1  (raster-vector)  escala dimensions error +0.4%  niveles 1/1
- Planta 1: muros F1 1.00 (P 1.00 R 1.00, extremos 0.80, 7/8) · aberturas P 1.00 R 1.00 (7/7) · ambientes 3/3 IoU 0.95 nombres 3/3
- **CUMPLE**

### 2026-10-07 08:03 — Verdad de casa2 anotada (make_truth.py, 40 px/m ±15 %). Nueva SheetLayoutStage: cortes XY por franjas vacías y descarte de bloques fotográficos (muchos colores, poca superficie plana). Muros F1 0.50 → 0.88.

## casa2  (raster-vector)  escala estimated error -10.0%  niveles 1/1
- Planta 1: muros F1 0.88 (P 0.85 R 0.92, extremos 0.34, 27/20) · aberturas P 0.29 R 0.27 (21/22) · ambientes 4/6 IoU 0.50 nombres 3/6
- falta: Planta 1: muros, Planta 1: aberturas, Planta 1: ambientes, Planta 1: nombres
