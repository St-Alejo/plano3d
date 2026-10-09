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

### 2026-10-07 08:23 — Reglas de render: tramos cortos alineados/en T, ventana en vano de fachada sin trazos, paso interior ancho sin hoja (no divide), ventanal por parantes, ancho mínimo de ambiente 0,6 m, OCR temprano para excluir letras de la evidencia, bisagra sobre muro transversal solo por arco. Ambientes 6/6 IoU 0.93 nombres 6/6. Sintéticos difícil: ventanas R 0.22→0.17 (pendiente revisar).

## casa2  (raster-vector)  escala estimated error -10.0%  niveles 1/1
- Planta 1: muros F1 0.90 (P 0.81 R 1.00, extremos 0.46, 32/20) · aberturas P 0.39 R 0.46 (26/22) · ambientes 6/6 IoU 0.93 nombres 6/6
- falta: Planta 1: muros, Planta 1: aberturas

### 2026-10-07 09:20 — casa2 CUMPLE: tono de muros en renders a color, vano < 0,55 m = ventana, vano vacío: ventana si da al exterior (relleno desde el borde) o vano de puerta interior, pasos solo con escala confiable, evidencia de puerta anulada sobre texturas, ventanal solo con parantes equiespaciados (corrediza de vidrio), escala por ancho de puertas (≥3 concordantes), islas dentro de ambientes ya no tumban todos, nombres con calificativo. Verdad corregida: ventanitas dobles de baños, vano vestíbulo, ventana 479-502. Suite compleja vs base: escala 46%→34%, ambientes OK 0%→17%; caídas pendientes en multi_unit cad/relleno escaneo.

## casa2  (raster-vector)  escala estimated error -6.9%  niveles 1/1
- Planta 1: muros F1 0.96 (P 0.93 R 0.99, extremos 0.51, 27/20) · aberturas P 0.92 R 0.92 (25/25) · ambientes 6/6 IoU 0.93 nombres 6/6
- **CUMPLE**

### 2026-10-07 09:39 — casa3 primera pasada: lámina CAD oscura normalizada por capas de color (blanco/azul → tinta; rojo/verde fuera), marco eliminado, 3 plantas separadas y alineadas por solape de trazos, apiladas como niveles (0/2,8/5,6 m). Ampliación ×4 con cierre previo de las líneas dobles de muro; tope de grosor de muro (4 % del lado). Verdad parcial anotada (16 px/m).

## casa3  (raster-vector)  escala estimated error -45.4%  niveles 3/3
- Planta baja: muros F1 0.42 (P 0.27 R 0.94, extremos 0.07, 45/9) · aberturas P 0.03 R 0.14 (31/7) · ambientes 4/3 IoU 0.25 nombres 0/3
- Planta alta: muros F1 0.54 (P 0.51 R 0.57, extremos 0.14, 35/20) · aberturas P 0.08 R 0.18 (25/11) · ambientes 7/4 IoU 0.73 nombres 0/4
- Azotea: muros F1 0.59 (P 0.49 R 0.74, extremos 0.12, 22/10) · aberturas P 0.00 R 1.00 (8/0) · ambientes 1/0 IoU 0.00 nombres 0/0
- falta: scale, Planta baja: muros, Planta baja: aberturas, Planta baja: ambientes, Planta baja: nombres, Planta alta: muros, Planta alta: aberturas, Planta alta: ambientes, Planta alta: nombres, Azotea: muros, Azotea: aberturas, Azotea: ambientes

### 2026-10-07 09:56 — Niveles nombrados por convención (Planta baja / Planta alta / Azotea: última planta con menos de la mitad de tabiques o muy pocos ambientes); azotea con antepechos de 1,1 m en el casco. Escala común por mediana de métodos: -28% (los métodos por grosor y puertas se sesgan con los muebles de esta lámina; el de la azotea daba 16,7 px/m ≈ verdad). Pendiente: muebles (autos, mesas) como muros en planta baja.

## casa3  (raster-vector)  escala estimated error -28.0%  niveles 3/3
- Planta baja: muros F1 0.42 (P 0.27 R 0.94, extremos 0.07, 45/9) · aberturas P 0.03 R 0.14 (31/7) · ambientes 4/3 IoU 0.25 nombres 0/3
- Planta alta: muros F1 0.54 (P 0.51 R 0.57, extremos 0.14, 35/20) · aberturas P 0.08 R 0.18 (25/11) · ambientes 7/4 IoU 0.73 nombres 0/4
- Azotea: muros F1 0.59 (P 0.49 R 0.74, extremos 0.12, 22/10) · aberturas P 0.00 R 1.00 (3/0) · ambientes 1/0 IoU 0.00 nombres 0/0
- falta: scale, Planta baja: muros, Planta baja: aberturas, Planta baja: ambientes, Planta baja: nombres, Planta alta: muros, Planta alta: aberturas, Planta alta: ambientes, Planta alta: nombres, Azotea: muros, Azotea: aberturas, Azotea: ambientes

### 2026-10-07 11:12 — Red de muros v1 (U-Net 1,3M, 3000 sintéticos, val IoU 0,917) a escala canónica (muro≈5 px) y filtro por píxel: casa3 F1 muros 0,48/0,60/0,64 (antes 0,44/0,56/0,63); casa1/casa2 siguen cumpliendo; sintéticos mixtos (básica difícil ventanas 0,17→0,67; compleja peor en achurado/boceto/relleno foto). Se deja apagada por defecto; v2 con más estilos.

## casa3  (raster-vector)  escala estimated error -28.0%  niveles 3/3
- Planta baja: muros F1 0.42 (P 0.27 R 0.94, extremos 0.07, 45/9) · aberturas P 0.03 R 0.14 (31/7) · ambientes 4/3 IoU 0.25 nombres 0/3
- Planta alta: muros F1 0.54 (P 0.51 R 0.57, extremos 0.14, 35/20) · aberturas P 0.08 R 0.18 (25/11) · ambientes 7/4 IoU 0.73 nombres 0/4
- Azotea: muros F1 0.59 (P 0.49 R 0.74, extremos 0.12, 22/10) · aberturas P 0.00 R 1.00 (3/0) · ambientes 1/0 IoU 0.00 nombres 0/0
- falta: scale, Planta baja: muros, Planta baja: aberturas, Planta baja: ambientes, Planta baja: nombres, Planta alta: muros, Planta alta: aberturas, Planta alta: ambientes, Planta alta: nombres, Azotea: muros, Azotea: aberturas, Azotea: ambientes

### 2026-10-09 00:21 — Red de muros v2 (U-Net 1,3M, 4800 sintéticos de 6 estilos, val IoU 0,900; entrenador con datos uint8 por lote, ya no se queda sin RAM). Con red: casa3 F1 muros 0,68/0,72/0,73 (sin red 0,42/0,54/0,59; v1 0,48/0,60/0,64), básica difícil ventanas 0,17→0,73; pero casa2 deja de cumplir (ambientes 5/6, IoU 0,79, recall aberturas 0,88) y compleja clásica empeora (F1@15 0,09→0,07, escala 34%→39%, ambientes OK 17%→8%). La ruta raster no usa la red. Queda apagada por defecto.

### 2026-10-09 01:13 — La red de muros v2 solo actúa en láminas CAD oscuras (dark_sheet, que MultiLevelDetector ahora conserva al separar plantas). Con red: casa1 y casa2 CUMPLEN igual que sin red; casa3 muros 0,68/0,72/0,73; básica y compleja clásica idénticas a sin red (F1@15 0,09, escala 34%, ambientes OK 17%). Queda activa por defecto.

### 2026-10-09 04:44 — Revisión visual 2D/3D de las 3 casas en la app. casa3: 24 columnas falsas en la azotea (marcas de cota y achurado) salían como barras altas sobre el techo → plausible_columns (en imagen, una columna toca un muro o es exenta dentro del edificio y lejos de otras) y en la azotea solo las que tocan un muro. casa2 y casa3: grupos de muros sueltos (marca en L del estacionamiento, trozos de autos) → drop_stray_groups en el detector clásico, mismo criterio que connected_only. casa2 muros P 0,93→0,95; casa3 planta baja F1 0,68→0,71; básica y complejas sin cambios.

### 2026-10-09 09:30 — casa3 escala −27% → −8% (CUMPLE). Los muros de la lámina son huecos (dos líneas de cara de 1 px) y _upscale los rellena: el ancho macizo lleva una línea de más (33% a esta resolución). _upscale detecta muros huecos (el cierre agrega 35-52% de tinta; macizos 6%) y entonces la escala combina la medida entre ejes de caras (ruta raster, mpp_faces que el híbrido conserva) y las puertas, sin el ancho macizo. Descontar la línea dentro del clásico se probó y se descartó: cambia sus umbrales en metros y la planta baja perdía ambientes (F1 0,71→0,38). Resto sin cambios.

### 2026-10-09 10:30 — PDF vectorial real (planta 2 opción 4, `backend/tests/real/planta2/plano.pdf`). Antes: 102 "muros" (peldaños, sanitarios, mesas), 0 ambientes. Causas y arreglos en el lector de PDF y el importador vectorial: (1) muros = pluma más gruesa (1,44 pt) cuando el PDF distingue plumas; el resto es evidencia de aberturas; (2) fachadas dibujadas con UNA línea → se agrega la cara exterior con el espesor típico del plano; (3) caras de muro que la cota mide justo se borraban como líneas de cota → siguen dando escala pero no se borran; (4) puertas en un solo trazo (hoja + arco) → el arco se ajusta por tramos; (5) columnas que cortan los muros → el muro se prolonga a su centro; (6) puertas al final de un muro o que ocupan todo el tramo → se reconocen por el arco; (7) cierre morfológico de 8 cm al buscar ambientes con columnas. Ahora: 29 muros, 7 puertas, 10 ventanas, 15 columnas, 8 ambientes (ALCOBA 1/2/3, SALA-COMEDOR, hall, 2 baños, ducto), escala exacta con 26 cotas y medidas al cm (ALCOBA 2: 2,84+0,55 × 3,40). casa1/casa2/casa3: métricas idénticas.
