# Fidelidad del modelado 3D: proceso, resultados y cómo continuar

Este documento resume el trabajo para que el sistema pase **cualquier plano arquitectónico**
a 3D con alta fidelidad. Se usaron como banco de prueba los tres planos de
`docs/ejemplos/` (de casa1, el más fácil, a casa3, el más difícil). También explica cómo
retomar el trabajo en otra sesión.

- Bitácora detallada de cada iteración (fecha, cambio, métricas): [`bitacora.md`](bitacora.md)
- Métricas y superposición 2D de cada casa: `casaN/metrics.json`, `casaN/overlay.png`
- Plan aprobado: `~/.claude/plans/replicated-tickling-snail.md`

---

## 1. Objetivo y decisiones

**Pedido:** mejorar el modelado 3D para que diagrame cualquier tipo de plano. Evaluar
si conviene usar *machine learning* entrenado con estos planos para que aprenda y
mejore con el uso. Supervisar cada prueba hasta quedar conforme con cada casa, en orden
casa1 → casa2 → casa3.

**Decisiones tomadas con el usuario:**

| Tema | Decisión |
|---|---|
| Estrategia de ML | **Híbrida**: red propia entrenada con miles de planos sintéticos. Los 3 planos reales son el *examen* (nunca se entrena con ellos). Las correcciones del editor alimentan reentrenamientos. |
| Claude (API) | Permitido con **gasto mínimo** (la cuenta tenía ~4 USD): modelo Haiku, caché y tope de gasto. |
| casa3 (varias plantas) | **Niveles apilados** en 3D. |
| Criterio de aceptación | **Métricas + revisión visual** 2D/3D. |

> Nota honesta: con 3 planos no se entrena una red desde cero. Se entrena con datos
> sintéticos de estilos variados y los reales miden la calidad. "Cualquier plano al 100 %"
> no es alcanzable; el objetivo es pasar umbrales medibles y dejar el ciclo de aprendizaje
> funcionando.

## 2. Criterio de aceptación (por plano y por nivel)

Se compara contra una **verdad anotada a mano**:

- **Muros:** F1 del eje ≥ 0,95 (tolerancia 15 cm).
- **Ambientes:** IoU medio ≥ 0,90, cantidad exacta y **nombres correctos**.
- **Puertas y ventanas:** precisión y recall ≥ 0,90 (posición ±30 cm y tipo correcto).
- **Escala:** error ≤ 2 % con cotas (casa1). Sin cotas, la tolerancia es la incertidumbre de la propia verdad: 15 % (casa2, casa3).
- **Niveles:** cantidad correcta.
- **Revisión visual:** superposición 2D y captura 3D sin errores evidentes.

## 3. Banco de prueba real

| Archivo | Para qué |
|---|---|
| `backend/tests/real/casaN/plano.*` | Copia del plano de `docs/ejemplos/` (`/docs` no se versiona). |
| `backend/tests/real/casaN/truth.json` | Verdad: muros (ejes en metros), aberturas, ambientes con nombres válidos, escala, niveles. |
| `backend/tests/real/casa{2,3}/make_truth.py` | La verdad se anota **en píxeles** (medidos sobre la tinta) y se convierte a metros. Así queda trazable. |
| `backend/scripts/eval_real.py` | Corre el detector **de producción** completo, puntúa cada nivel y dibuja la superposición (verde = verdad; rojo = muros; azul = ventanas; naranja = puertas; morado = ambientes). |

```bash
cd backend
PYTHONIOENCODING=utf-8 .venv/Scripts/python scripts/eval_real.py casa1 casa2 casa3
# con --log "texto" agrega la iteración a calidad/bitacora.md
```

Escalas de la verdad:
- **casa1:** sale de sus cotas (103,8 px/m).
- **casa2:** es un render sin cotas. Por objetos estándar (puertas, auto, camas) da ~40 px/m, con ±15 %.
- **casa3:** auto de 72 px = 4,5 m, cama de 32 px = 2 m, puertas de 14 px = 0,85 m → 16 px/m, con ±15 %.

La verdad de casa2 se corrigió tres veces tras revisarla contra la imagen: ventanitas
dobles de los baños, vano del vestíbulo y ventana de la recámara master. Las tres
correcciones están documentadas en la bitácora.

## 4. Resultados (estado al 2026-10-07)

| Plano | Qué es | Antes | Ahora |
|---|---|---|---|
| **casa1** | Planta técnica con cotas | 1 de 3 ambientes, sin nombres, puertas mal ubicadas | ✅ **CUMPLE**: muros 1,00 · aberturas P/R 1,00 · ambientes 3/3, IoU 0,95 · nombres 3/3 · escala 0,0 % |
| **casa2** | Render a color + foto de fachada, sin cotas | Muros inventados en la foto, 1 ambiente | ✅ **CUMPLE**: muros F1 0,96 · aberturas 0,92/0,92 · ambientes 6/6, IoU 0,93 · nombres 6/6 · escala −6,9 % |
| **casa3** | Lámina CAD oscura de 720×480 con planta baja, alta y azotea, ejes rojos y cajetín | Falla total | 🟡 **3/3 niveles** separados, alineados y apilados (azotea con antepechos). No cumple umbrales: muros F1 0,42 / 0,54 / 0,59 por planta (0,48 / 0,60 / 0,64 con la red), ambientes de la planta alta IoU 0,74, escala −28 %. Con la red v2: muros 0,68 / 0,72 / 0,73 |

**Por qué casa3 no cumple todavía (causa medida):**
- A esa resolución, autos, mesas y sofás están dibujados con la misma línea blanca que los muros.
- Los textos son ilegibles para el OCR local, así que no hay nombres de ambientes ni de niveles.
- Las estimaciones de escala sin cotas (por grosor de muro y por puertas) se sesgan con esos muebles.

## 5. Qué se construyó (técnicas generales, nunca ajustes "para esa imagen")

### Detección (backend, visión por computadora)
- **Análisis de lámina** (`stages/layout.py`):
  - corta la hoja por franjas vacías y descarta bloques **fotográficos** (muchos colores y poca superficie plana);
  - normaliza **láminas CAD de fondo oscuro** por capas de color: blanco y azul pasan a tinta; rojo, verde y amarillo (ejes, cotas, vegetación) se descartan;
  - quita el marco y el cajetín, y detecta **varias plantas** en una misma lámina.
- **Varias plantas → niveles** (`cv/multilevel.py`, decorador de detector):
  - recorta y amplía cada planta, cerrando antes las líneas dobles de muro;
  - alinea las plantas por solape de trazos largos y unifica la escala con la mediana de métodos;
  - apila los niveles a 2,8 m y nombra Planta baja / Planta alta / Azotea (la azotea lleva antepechos de 1,1 m);
  - el editor tiene **selector de nivel**.
- **Aberturas** (`stages/openings.py`):
  - puertas entre la punta de un tabique y un muro transversal;
  - puertas corredizas reconocidas por sus hojas desfasadas (en 3D, dos hojas; si son anchas, de vidrio);
  - un vano vacío es ventana si da al exterior y vano de puerta si une dos interiores;
  - ninguna puerta mide menos de 0,55 m;
  - ventanales detectados por parantes equiespaciados;
  - la evidencia de puerta se anula sobre texturas (adoquines) y sobre texto;
  - la escala sin cotas se estima por el ancho de 3 o más puertas concordantes.
- **Muros** (`stages/walls.py`):
  - se rescatan tramos cortos (jambas, montantes) solo si están alineados con un muro o lo tocan en T;
  - en renders a color se filtra por tono (los muebles gris oscuro dejan de ser muros);
  - el grosor del muro tiene un tope (las manchas macizas no lo fijan).
- **Ambientes** (`stages/rooms.py`, `assemble.py`):
  - los pasos anchos sin hoja no dividen ambientes;
  - se descartan ambientes de menos de 0,6 m de ancho;
  - una "isla" dentro de un ambiente ya no tumba todos los demás.
- **Nombres** (`stages/room_names.py`, `domain/plan_text.py`):
  - un solo OCR de la hoja (RapidOCR detección + reconocimiento);
  - nombres bilingües ("BAÑO / BATHROOM" → Baño) con calificativo ("Baño master"), espacios abiertos ("Comedor / Cocina / Sala").

### Machine learning (`backend/ml/`, inferencia en `infrastructure/ml/`)
- **Generador sintético v2** (`ml/synth.py`):
  - plantas aleatorias con puertas, ventanas, **muebles y autos**, textos, cotas y ejes;
  - 6 estilos: técnico, CAD oscuro, render a color, baja resolución, boceto y ampliado; además, efecto foto;
  - la etiqueta es la máscara exacta de muros.
- **Modelo:**
  - U-Net de 1,3 M parámetros, entrenada en CPU (`ml/train_seg.py`) y exportada a **ONNX** con su ficha `.json`;
  - en producción corre con onnxruntime, sin PyTorch;
  - la red ve el plano a escala canónica (muro ≈ 5 px) y filtra por píxel la máscara clásica.
- **v1** (`models/plan-seg-v1.onnx`, 3000 sintéticos, IoU de validación 0,917):
  - mejora los muros de casa3 y no cambia casa1/casa2;
  - en los sintéticos tuvo resultados mixtos;
  - por la regla "solo se publica si mejora en todo", **queda apagada**: se activa con `PLANO3D_SEG_MODEL=1`.
- **v2** (`models/plan-seg-v2.onnx`, 4800 sintéticos de los 6 estilos, IoU de validación 0,900
  sobre una validación más difícil que la de v1). Con la red activada se carga la versión más alta:
  - casa3: muros F1 0,42 / 0,54 / 0,59 → **0,68 / 0,72 / 0,73** (v1: 0,48 / 0,60 / 0,64); escala −28 % → −27 %;
  - básica difícil: recall de ventanas 0,17 → 0,73;
  - pero **casa2 deja de cumplir** (ambientes 6/6 → 5/6, IoU 0,93 → 0,79, recall de aberturas 0,92 → 0,88)
    y la suite compleja con detector clásico empeora (F1@15 0,09 → 0,07, escala 34 % → 39 %, ambientes OK 17 % → 8 %);
  - **por eso solo actúa en láminas CAD de fondo oscuro** (`dark_sheet`, como casa3): así casa3 conserva
    la mejora y casa1, casa2 y la suite compleja quedan idénticas a sin red (la ganancia de ventanas en la
    básica se pierde, porque esos planos son claros). Con esa condición **queda activa por defecto**
    (`PLANO3D_SEG_MODEL=0` la apaga; en la imagen Docker el modelo está en `PLANO3D_MODELS_DIR`);
  - la ruta raster-vector (`--detector raster`) no usa la red: solo filtra la máscara del detector clásico.
- **Aprendizaje con el uso:**
  - `scripts/export_dataset.py` convierte cada proyecto corregido en el editor en un par imagen/máscara;
  - `ml/train_seg.py --real-dir` los mezcla en el reentrenamiento.

### Claude con gasto mínimo (`infrastructure/ocr/`)
- Usa **Haiku 4.5** con **tope de gasto persistente** (`PLANO3D_CLAUDE_BUDGET_USD`, 1 USD): al llegar al tope se apaga solo.
- Tiene **caché en disco** por contenido, así que re-analizar no vuelve a pagar.
- La clave vive solo en `backend/.env` (ignorado por git) y las pruebas nunca llaman a la API.
- Con consenso OCR + Claude, la escala de casa1 pasó de +0,4 % a 0,0 %.
- **Gasto total del desarrollo: ~0,0034 USD.**

### Regresiones vigiladas
- `pytest`: 395 en verde · `npm test`: 246 en verde · ruff, mypy y tsc limpios.
- `scripts/eval.py --suite basic` sin pérdidas.
- `--suite complex` (ya era baja: F1@15 0,09) frente a su línea base: escala 46 % → 34 %, ambientes OK 0 % → 17 %, con caídas puntuales anotadas en la bitácora (p. ej. multi_unit CAD escaneado).

## 6. Cómo verificar

```bash
cd backend
.venv/Scripts/python -m pytest -q                                  # pruebas
PYTHONIOENCODING=utf-8 .venv/Scripts/python scripts/eval_real.py casa1 casa2 casa3
PYTHONIOENCODING=utf-8 .venv/Scripts/python scripts/eval.py --suite basic
PLANO3D_SEG_MODEL=0 ... (mismos comandos)                          # sin la red de muros
# servidores locales para ver 2D/3D:
PLANO3D_MODE=memory .venv/Scripts/uvicorn plano3d.main:app --port 8000
cd ../frontend && npx vite --port 5173
```

Para entrenar se necesita el extra `[train]`:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install onnx
python -m ml.train_seg --samples 4800 --val 300 --epochs 8 --out models/plan-seg-v3.onnx
```

En CPU tarda ~10 min por época con 4800 muestras. Los datos se quedan en uint8 y solo cada
lote pasa a float, así que bastan ~2 GB de RAM. La caché `ml/data/synth_v2_*.npz` no lleva la
versión del generador: **si cambia `ml/synth.py`, hay que borrarla**.

## 7. Dónde quedó y cómo continuar en otra sesión

**Lo último que pasó (2026-10-09):** la **red v2** se entrenó completa, después de corregir
el consumo de RAM del entrenador. Aplicada a todo rompía casa2 y empeoraba la suite compleja.
Ahora solo actúa en láminas CAD oscuras y **queda activa por defecto** (sección 5).

**Siguientes pasos sugeridos, en orden:**
1. Recuperar la ganancia de ventanas de la básica (0,17 → 0,73 con la red) sin romper casa2:
   reentrenar (v3) con más renders a color o abrir la condición a planos de baja resolución, y
   activar solo lo que mejore en todo.
2. casa3:
   - escala por arcos de puerta (radio de los cuartos de círculo) o por objetos;
   - nombres de niveles y ambientes con Claude solo si el OCR local no alcanza, siempre dentro del tope.
3. Recuperar las caídas puntuales de la suite compleja que registra la bitácora.
4. Revisión visual final 2D/3D de las tres casas y despliegue en Railway (ver README principal).
