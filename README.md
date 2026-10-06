# Plano 3D — de la foto de un plano a un modelo 3D navegable

Toma una foto de un plano arquitectónico (o sube una imagen/PDF) y en segundos obtienes un modelo 3D
que puedes **orbitar**, **recorrer en primera persona**, **corregir** en un editor 2D y **exportar a GLB**.

Implementa la **Fase 0** del documento de arquitectura (`docs/`): visión por computadora clásica,
arquitectura hexagonal lista para enchufar CNN/SAM/VLM, editor de corrección y visor 3D.

## Arranque rápido (Docker)

```bash
cp .env.example .env            # cambia las claves si vas a exponerlo
docker compose up --build       # → http://localhost:8080
```

Desde el **celular** (misma red Wi-Fi): abre `http://<IP-de-tu-PC>:8080` y usa **Tomar foto**.

Servicios: `frontend` (nginx + SPA, proxy de `/api`), `api` (FastAPI), `worker` (arq),
`postgres`, `redis`, `storage` (SeaweedFS, S3-compatible).

### Desarrollo con recarga en caliente

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
# Frontend (Vite + HMR): http://localhost:5173 · API y Swagger: http://localhost:8000/docs
```

Sin Docker (modo memoria, sin Postgres/Redis/S3):

```bash
cd backend && python -m venv .venv && .venv/Scripts/pip install -e ".[dev,ocr]"   # Linux/Mac: .venv/bin/pip
.venv/Scripts/pip install --no-deps rapidocr-onnxruntime   # OCR de cotas (sin su opencv con GUI)
PLANO3D_MODE=memory .venv/Scripts/uvicorn plano3d.main:app --reload
cd frontend && npm install && npm run dev                                      # http://localhost:5173
```

## Planos complejos y medidas exactas

| Entrada | Cómo se lee | Medidas |
|---|---|---|
| **DXF** (AutoCAD, BricsCAD, LibreCAD) | Capas, bloques de puertas/ventanas, arcos, **entidades de cota** (ADR-013) | Exactas (las del archivo) |
| **PDF de CAD** | Líneas y curvas vectoriales; escala por las cotas (RANSAC) o el rótulo `ESC 1:N` | Exactas |
| **Foto o escaneo** | Vectorización + lectura de cotas (OCR, y Claude visión si hay credenciales) + **ajuste a cotas** (ADR-014, ADR-015) | Exactas donde hay cotas; el resto, inferidas con su ± error |
| **Plano grande en varias fotos** | Se unen en una sola imagen antes de analizar | Igual que una foto |

Se reconocen muros en doble línea, achurados, de espesores mixtos, **curvos** y oblicuos;
**columnas**, **escaleras** y puertas con su sentido de giro. Cada cota del plano queda en
el modelo en verde (**exacta**), gris (**por verificar**) o rojo (**en conflicto**). En el editor
se corrige el número y **Ajustar el plano a las cotas** mueve los muros. Claude visión es
opcional: se activa con `ANTHROPIC_API_KEY` (o `ant auth login`); sin credenciales se usa
solo el OCR local. Medición: `python scripts/eval.py --suite complex --detector raster`.

## Cómo se usa

1. **Nuevo plano → Tomar foto** (o subir). La hoja se detecta y la perspectiva se corrige sola;
   con **Ajustar esquinas** puedes moverlas (arrastrando o con las flechas).
2. **Procesando**: se ven las 10 etapas del pipeline en vivo y el edificio aparece mientras se detecta.
3. **Editor** (2D | 3D | propiedades): selecciona y corrige muros, puertas, ventanas y ambientes.
   - Arrastrar una esquina mueve **todos** los muros unidos (Alt = despegar solo ese muro).
   - Largo y ángulo exactos por teclado, cotas sobre cada muro y rejilla de imán (1/5/10 cm).
   - Los **ambientes se recalculan solos** desde los muros, y las áreas siempre están al día.
   - **Revisión del modelo**: lista de problemas (muros sueltos o duplicados, aberturas en esquinas,
     escala sin calibrar…) que llevan al elemento con un clic.
   - Atajos: `V` seleccionar, `W` muro, `D` puerta, `N` ventana, `M` medir (distancia y área),
     `C` calibrar, flechas para mover el muro (Shift = 25 cm), `Supr` borrar, `Ctrl+Z` / `Ctrl+Shift+Z`,
     `Ctrl+S` guardar.
   - **Historial de versiones**: cada guardado queda registrado y se puede restaurar. Si otra
     persona guardó mientras editabas, se ofrece recargar o sobrescribir (nada se pierde).
4. **Calibrar**: traza una línea sobre una cota conocida (p. ej. "10.00") e ingresa los metros reales.
5. **Recorrer**: orbitar o caminar (WASD + mouse, o joystick en el celular), comparar con el plano
   original (deslizador) y **exportar GLB** (se abre en Blender o cualquier visor glTF).

## Arquitectura

```
backend/src/plano3d/
  domain/          BuildingModel, Wall, Opening, Room, Level, Scale, Project — sin dependencias
  application/     casos de uso, puertos (interfaces), Pipeline genérico, DTOs (contrato)
  infrastructure/  cv/ (10 etapas OpenCV + ClassicCVDetector), persistencia, S3, arq, Redis, memoria
  api/             FastAPI REST + WebSocket
  container.py     composition root: el único lugar que elige implementaciones
frontend/src/
  domain/          geometría 3D pura, colisión, snapping, Commands (deshacer/rehacer)
  store/           Zustand: única fuente de verdad del editor
  features/        capture · processing · editor2d · viewer3d · workspace · projects
  api/             cliente, progreso (WS + polling) y tipos generados desde OpenAPI
```

Patrones: **Strategy** (detectores), **Pipeline/Chain of Responsibility** (etapas), **Adapter**
y **Repository** (hexágono), **Observer** (progreso en vivo y store), **Command** (edición
reversible), **Builder** (escena 3D), **Factory** (materiales).

Documentación: [revisión de los docs](docs/revision-docs.md) · [usabilidad](docs/usabilidad.md) ·
[roadmap para arquitectos](docs/roadmap.md) · [decisiones (ADR)](docs/adr/) ·
[diagramas UML](docs/uml/diagramas.md).

## Pruebas

| Suite | Comando | Qué cubre |
|---|---|---|
| Backend | `cd backend && pytest --cov` | dominio (con Hypothesis), casos de uso, cada etapa del pipeline contra verdad de terreno sintética (IoU), API REST + WebSocket, repositorio SQL, adaptadores, contrato OpenAPI |
| Frontend | `cd frontend && npm test` | geometría, colisión, comandos, store, cliente/progreso (MSW), componentes (RTL) |
| E2E | `cd frontend && npx playwright test` (con el stack arriba) | foto → pipeline → edición → guardado → recorrido → GLB; error; vista móvil |
| Usabilidad | incluida en E2E (`e2e/usability.spec.ts`) + `node e2e/usability-audit.mjs <carpeta>` | accesibilidad WCAG 2.1 AA (axe) en ambos temas, objetivos táctiles, 320 px, teclado, cambios sin guardar — ver [docs/usabilidad.md](docs/usabilidad.md) |
| Calidad | `cd backend && python scripts/eval.py` | benchmark de detección por dificultad (IoU, precisión/exhaustividad) |
| Estático | `ruff check`, `mypy` (strict), `npm run lint`, `npm run typecheck` | |

En contenedores (imagen `dev`, con el stack arriba), incluida la prueba contra PostgreSQL real
sobre una base aparte:

```bash
docker compose exec postgres createdb -U plano3d plano3d_test
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps   -e PLANO3D_DATABASE_URL=postgresql+asyncpg://plano3d:<clave>@postgres:5432/plano3d_test   api pytest -m "integration or not integration"
```

El **generador de planos sintéticos** (`backend/tests/synth/plan_generator.py`) dibuja un plano
conocido y simula una foto (perspectiva, sombra, ruido, desenfoque, JPEG): así cada etapa se prueba
contra la respuesta exacta. Para medir con fotos reales, pon `foto.jpg` + `foto.json`
(`{"rooms": 4, "doors": 3, "windows": 2}`) en una carpeta y corre `python scripts/eval.py --real carpeta`.

## Contrato frontend ↔ backend

Los DTO Pydantic son la fuente del contrato. Si cambias uno:

```bash
cd backend && python scripts/export_openapi.py
cd ../frontend && npm run gen:api
```

`tests/integration/test_contract.py` falla si te olvidas.

## Desplegar después

Todo se configura con variables `PLANO3D_*`: apunta `PLANO3D_DATABASE_URL` a un Postgres gestionado,
`PLANO3D_S3_*` a AWS S3 o Cloudflare R2 y `PLANO3D_REDIS_URL` a un Redis gestionado. Las imágenes de
producción corren sin privilegios y el frontend se sirve por nginx con la API en el mismo origen.
