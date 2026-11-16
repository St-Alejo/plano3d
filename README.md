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

**Fidelidad con planos reales y machine learning:** el proceso completo es el banco de 3
casas reales con verdad anotada, láminas con varias plantas → niveles, render a color,
red de muros entrenada con sintéticos y Claude con tope de gasto. Sus resultados y cómo
continuar están en [`calidad/README.md`](calidad/README.md); cada iteración, en
[`calidad/bitacora.md`](calidad/bitacora.md).

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

## App de escritorio (Windows)

Un segundo cliente, hecho con **Godot 4 .NET + C#** (`desktop/`), que edita los mismos proyectos que la
web **en vivo**: lo que dibujas en uno aparece en el otro en menos de 200 ms. Suma iluminación global en
tiempo real, día y noche, recorrido a pie con personas, video del recorrido y **render fotorrealista con
Blender** (Cycles en la GPU local, que llega solo a la galería del proyecto).

- **Descargar:** botón «Descargar para Windows» de la web (`/escritorio`) o
  [el último release](https://github.com/St-Alejo/plano3d-frontend/releases/latest). El instalador no
  tiene firma de código: Windows SmartScreen avisa y la página explica cómo seguir y publica el SHA-256.
- **Abrir un proyecto de la web:** «Abrir en escritorio» en el editor o el visor 3D abre la app ya con
  la sesión y en ese proyecto (`plano3d://`, código de un solo uso de 2 min).
- **Desarrollar:** .NET 8 SDK, Godot 4.7.2 .NET e Inno Setup 6.

```bash
dotnet test desktop/Plano3D.sln                       # dominio, ops compartidas, API, Blender
cd desktop/app && godot --path . -- --smoke salida.png --api http://127.0.0.1:8010   # prueba de humo
powershell -File desktop/scripts/build-release.ps1 -Version 1.0.0 [-Publish]        # instalador / release
```

Arquitectura: `Plano3D.Core` (sin Godot: modelo, ops, comandos, geometría, sol, recorrido),
`Plano3D.Infrastructure` (API, sesión con DPAPI, sala en vivo, Blender, actualizaciones) y `app/`
(pantallas y escena). Decisiones en ADR-019 a ADR-023.

## Cuentas, demo y edición en vivo

- Registro e inicio de sesión con JWT (`/api/auth/*`); cada proyecto tiene dueño.
- **Cuenta demo:** el botón «Entrar con la cuenta demo» abre la casa de 3 pisos (`prj_demo_casa3`).
- **Edición en vivo:** sala WebSocket por proyecto (`/api/ws/collab/{id}`) que reparte cambios por
  entidad («ops», con la misma semántica en Python, TypeScript y C#), presencia y renders nuevos.

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
  collab/          sala en vivo: cliente WS, presencia, ops remotas
desktop/
  src/Plano3D.Core            dominio en C# (port de frontend/src/domain, mismas pruebas)
  src/Plano3D.Infrastructure  ApiClient, sesión DPAPI, CollabClient, BlenderRunner, UpdateChecker
  app/                        proyecto Godot 4 (pantallas, SceneSync, planta, render, recorrido)
  installer/ · scripts/       Inno Setup y build-release.ps1
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
| Escritorio | `dotnet test desktop/Plano3D.sln` (con `PLANO3D_TEST_API=http://127.0.0.1:8010` también contra una API real) + prueba de humo de Godot | ops con los mismos casos JSON que pytest y vitest, comandos, geometría, cliente de API, sala en vivo, Blender |
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

## Despliegue (demo en Azure)

- **Web:** Azure Static Web Apps (plan gratis) desde el repo `St-Alejo/plano3d-frontend`.
- **API:** Azure Container Apps de consumo (`ca-plano3d-api`, 1 réplica como máximo), imagen
  `ghcr.io/st-alejo/plano3d-backend` desde `St-Alejo/plano3d-backend`. Los datos viven en memoria con
  una copia `state.json.gz` en Azure Blob (ADR-022): sobreviven a reinicios sin pagar una base de datos.
- **Encender o apagar para presentar:**

```powershell
powershell -File scripts\presentacion.ps1 estado
powershell -File scripts\presentacion.ps1 on -ReiniciarDemo   # siempre lista (~US$0,8/día en reposo)
powershell -File scripts\presentacion.ps1 off                 # se apaga sola sin uso (arranque ~20 s)
```

Fuera de Azure todo se configura con variables `PLANO3D_*`: `PLANO3D_DATABASE_URL` a un Postgres
gestionado, `PLANO3D_S3_*` a S3 o R2 y `PLANO3D_REDIS_URL` a un Redis gestionado. Las imágenes de
producción corren sin privilegios y el frontend se sirve por nginx con la API en el mismo origen.
