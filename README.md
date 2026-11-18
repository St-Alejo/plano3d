# Plano 3D

Aplicación web que convierte el plano de una vivienda (una foto, una imagen, un PDF o un DXF) en un
modelo 3D por pisos que se puede orbitar, recorrer a pie, corregir en un editor 2D y exportar. Incluye
un asistente con inteligencia artificial, modos de obra con cantidades y acero, y una app de escritorio
para Windows que edita los mismos proyectos en vivo.

Proyecto final de Programación Orientada a la Web (semestre 7).

## Enlaces

| Qué | URL |
|---|---|
| Aplicación en línea (demo en Azure) | https://lively-island-09e124b1e.5.azurestaticapps.net |
| API en línea | https://ca-plano3d-api.bravefield-201b313a.brazilsouth.azurecontainerapps.io |
| Salud de la API | https://ca-plano3d-api.bravefield-201b313a.brazilsouth.azurecontainerapps.io/api/health |
| Repositorio principal (código completo) | https://github.com/St-Alejo/plano3d |
| Repositorio de despliegue del frontend | https://github.com/St-Alejo/plano3d-frontend |
| Repositorio de despliegue del backend | https://github.com/St-Alejo/plano3d-backend |
| Instalador de la app de escritorio | https://github.com/St-Alejo/plano3d-frontend/releases/latest |
| Interiores IA (proyecto hermano que recibe las casas) | https://ca-interiores-web.bravecoast-df66f28f.brazilsouth.azurecontainerapps.io |

La API en Azure se apaga cuando nadie la usa: la primera visita puede tardar unos 20 segundos.
Para entrar sin registrarse, usar el botón **Entrar con la cuenta demo**.

Una vez corriendo en local (ver [Correr el proyecto en local](#correr-el-proyecto-en-local)):

| Qué | URL local |
|---|---|
| Aplicación (Docker) | http://localhost:8080 |
| Aplicación (modo desarrollo) | http://localhost:5173 |
| Documentación de la API (Swagger) | http://localhost:8000/docs |

## Contenido

- [Qué hace](#qué-hace)
- [Tecnologías](#tecnologías)
- [Arquitectura](#arquitectura)
- [Correr el proyecto en local](#correr-el-proyecto-en-local)
- [Guía rápida de uso](#guía-rápida-de-uso)
- [Configuración opcional (IA)](#configuración-opcional-ia)
- [App de escritorio](#app-de-escritorio)
- [Pruebas](#pruebas)
- [Patrones de diseño](#patrones-de-diseño)
- [Despliegue](#despliegue)
- [Documentación adicional](#documentación-adicional)

## Qué hace

### Páginas de la aplicación

| Ruta | Página |
|---|---|
| `/` | Portada: cómo funciona, formatos aceptados, recorrido de ejemplo, cantidades de obra y proyectos destacados |
| `/entrar`, `/registro` | Inicio de sesión, registro y botón de cuenta demo |
| `/proyectos` | Lista de proyectos del usuario, con búsqueda y proyectos destacados |
| `/nuevo` | Crear un proyecto: tomar foto con el celular, subir imagen, PDF o DXF, o empezar desde cero |
| `/p/:id` | Editor del plano (2D, 3D y propiedades) |
| `/p/:id/3d` | Visor 3D: presentación, recorrido, fachada, obra, simulación y renders |
| `/p/:id/estudio` | Estudio: editor y visor juntos con el chat de IA |
| `/destacados/:id` | Proyecto destacado público (por ejemplo, la casa moderna de 4 pisos) |
| `/escritorio` | Descarga de la app de escritorio para Windows |

### Leer el plano

- **Formatos:** foto o escaneo (JPG, PNG), PDF de CAD, DXF (AutoCAD, BricsCAD, LibreCAD) y planos
  grandes en varias fotos, que se unen antes de analizar.
- **Foto desde el celular:** detecta la hoja, corrige la perspectiva y deja ajustar las esquinas a mano.
- **Pipeline de 10 etapas** con OpenCV, visible en vivo mientras procesa: el edificio aparece a medida
  que se detecta.
- **Muros con visión de Claude (opcional):** con una clave de Anthropic, Claude lee los muros, los
  ambientes y sus nombres directamente de la imagen, y el resultado se ajusta a la tinta del plano.
  Sin clave, todo lo hace la visión por computadora local.
- **Cotas:** se leen con OCR y el plano se ajusta a ellas. Cada cota queda en verde (exacta), gris (por
  verificar) o rojo (en conflicto).
- **Reconoce** muros en doble línea, achurados, curvos y oblicuos, columnas, escaleras, puertas con su
  sentido de giro, ventanas y varios pisos en una misma lámina.

### Editar

- **Editor 2D, 3D y propiedades** lado a lado. Se seleccionan y corrigen muros, puertas, ventanas y
  ambientes.
- Arrastrar una esquina mueve todos los muros unidos; largo y ángulo exactos por teclado; rejilla de
  imán de 1, 5 o 10 cm.
- Los **ambientes y sus áreas se recalculan solos** desde los muros.
- **Revisión del modelo:** lista de problemas (muros sueltos, aberturas en esquinas, escala sin
  calibrar) que lleva al elemento con un clic.
- **Pisos:** agregar un piso desde otra imagen, duplicar un piso y cambiar entre niveles.
- **Calibrar la escala** trazando una línea sobre una medida conocida.
- **Muebles y acabados** con catálogo, y amoblado automático de los ambientes.
- **Deshacer y rehacer**, paleta de comandos, menú contextual, capas y cuadro de áreas.
- **Historial de versiones:** cada guardado queda registrado y se puede restaurar.
- **Atajos:** `V` seleccionar, `W` muro, `D` puerta, `N` ventana, `M` medir, `C` calibrar, `Supr`
  borrar, `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+S` guardar.

### Ver y recorrer en 3D

- **Orbitar o caminar** con W, A, S, D y el mouse, o con un joystick en el celular.
- **Comparar con el plano original** con un deslizador.
- **Fachada:** estilos de fachada que se cambian con un botón sin tocar el interior.
- **Modos de obra:**
  - mampostería con el tipo de ladrillo;
  - acero con despiece por diámetro, según NSR-10;
  - secuencia de obra paso a paso;
  - ficha de cada elemento.
- **Cantidades de obra:** cómputo de materiales del proyecto.
- **Simulación:** personas y carros que se mueven por la casa, con hora del día (día y noche).
- **Fotos y renders:** estudio de fotos de la casa y galería de renders. Con clave de OpenAI se generan
  fotos realistas.
- **Exportar a GLB** para abrir en Blender o en cualquier visor glTF.

### Asistente con IA

- Un **chat** en el estudio y en el visor entiende órdenes como «agrega una ventana en la sala» o «pon
  un televisor en la alcoba». Recuerda la conversación reciente.
- **Cargar planos por el chat:** se adjuntan de 1 a 4 imágenes (una por piso) y el asistente arma el
  proyecto con todos los pisos.
- El gasto en Claude tiene un tope configurable.

### Cuentas, colaboración y conexión

- **Cuentas con JWT:** cada proyecto tiene dueño. La cuenta demo trae proyectos de ejemplo y la casa
  destacada de 4 pisos.
- **Edición en vivo:** la web y la app de escritorio editan el mismo proyecto al mismo tiempo por
  WebSocket, y los cambios se ven en menos de un segundo.
- **Compartir con Interiores IA:** el botón «Continuar en Interiores 3D» genera un código. Al pegarlo en
  Interiores IA, la casa llega con todos sus pisos y cuartos para amueblarla allí.

## Tecnologías

| Capa | Tecnologías |
|---|---|
| Frontend | React 19, TypeScript 5.9, Vite 8, Three.js 0.186 con React Three Fiber y Drei, Zustand (estado), Tailwind CSS 4, Radix UI, Lucide |
| Backend | Python 3.12, FastAPI, Pydantic 2, Uvicorn, WebSocket, arquitectura hexagonal |
| Visión por computadora | OpenCV, NumPy, Shapely, Pillow, OCR con RapidOCR, lectura de PDF (pypdfium2, pdfplumber) y DXF (ezdxf) |
| Inteligencia artificial (opcional) | Claude de Anthropic (visión para muros y cotas, y asistente), OpenAI (fotos realistas) |
| Datos | PostgreSQL con SQLAlchemy y Alembic, Redis con arq (colas de trabajo), almacenamiento S3 (SeaweedFS en local) |
| Seguridad | JWT (PyJWT), contraseñas con argon2 |
| App de escritorio | Godot 4 .NET con C# (.NET 8), Blender (render Cycles), instalador con Inno Setup |
| Infraestructura | Docker y Docker Compose, nginx, Azure Static Web Apps, Azure Container Apps, Azure Blob Storage, GitHub Container Registry |
| Pruebas | pytest con Hypothesis, Vitest con Testing Library y MSW, Playwright con axe (accesibilidad), xUnit (escritorio) |
| Calidad | Ruff, mypy estricto, ESLint, GitHub Actions con OSV-Scanner y Lighthouse CI |

## Arquitectura

```
Navegador (React + Three.js)          App de escritorio (Godot + C#)
        |  REST /api  +  WebSocket /api/ws          |
        +---------------------+---------------------+
                              |
                     API FastAPI (hexagonal)
                     dominio -> casos de uso -> adaptadores
                              |
        +----------+----------+-----------+-------------+
        |          |          |           |             |
   PostgreSQL    Redis     S3/Blob     worker arq    Claude / OpenAI
   (proyectos) (colas)   (imágenes)  (pipeline CV)    (opcional)
```

```
backend/src/plano3d/
  domain/          BuildingModel, Wall, Opening, Room, Level, Scale, Project; sin dependencias
  application/     casos de uso, puertos (interfaces), Pipeline genérico y DTOs (el contrato)
  infrastructure/  cv/ (etapas OpenCV), ocr/, vector/, assistant/, persistencia, S3, Blob, arq, demo
  api/             FastAPI REST y WebSocket
  container.py     composition root: el único lugar que elige implementaciones
frontend/src/
  domain/          geometría 3D pura, colisión, imán, estructura de obra, comandos de deshacer
  store/           Zustand: única fuente de verdad del editor
  features/        landing, auth, capture, processing, editor2d, viewer3d, studio, workspace,
                   projects, featured, share, desktop
  api/             cliente, progreso en vivo y tipos generados desde OpenAPI
  collab/          sala en vivo: cliente WebSocket, presencia y cambios remotos
desktop/
  src/Plano3D.Core            dominio en C# (mismas pruebas que el frontend)
  src/Plano3D.Infrastructure  cliente de la API, sesión, sala en vivo, Blender
  app/                        proyecto Godot 4
```

| Carpeta | Contenido |
|---|---|
| `backend` | API, pipeline de visión, pruebas y scripts de evaluación |
| `frontend` | Aplicación web, pruebas unitarias y de punta a punta |
| `desktop` | App de escritorio para Windows |
| `docs` | Decisiones de arquitectura (ADR), diagramas UML, guion de la demo |
| `calidad` | Banco de planos reales y medición de la detección |
| `pruebas` | Planos de ejemplo para probar: fotos, reales, sintéticos y de varios pisos |
| `presentacion` | Planos de las casas de la demo |
| `scripts` | Script para encender o apagar la demo en Azure |

## Correr el proyecto en local

### Opción A: Docker (recomendada)

**Requisitos:** Docker Desktop (o Docker Engine con Compose v2) y Git. No hace falta instalar Python
ni Node.

```bash
# 1. Clonar el repositorio
git clone https://github.com/St-Alejo/plano3d.git
cd plano3d

# 2. Crear el archivo de configuración
cp .env.example .env

# 3. Construir y levantar todo
docker compose up --build
```

Después abrir **http://localhost:8080** y usar **Entrar con la cuenta demo**.

- Servicios que se levantan: `frontend` (nginx con la web y proxy de `/api`), `api` (FastAPI),
  `worker` (procesa los planos), `postgres`, `redis` y `storage` (SeaweedFS, compatible con S3).
- Desde el celular en la misma red Wi-Fi: abrir `http://<IP-del-PC>:8080` y usar **Tomar foto**.
- Si el puerto 8080 está ocupado, cambiar `WEB_PORT` en `.env`.
- Para apagar: `docker compose down`. Para borrar también los datos: `docker compose down -v`.

Modo desarrollo con recarga en caliente:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
# Web (Vite): http://localhost:5173    API y Swagger: http://localhost:8000/docs
```

### Opción B: sin Docker

**Requisitos:** Python 3.12, Node 22 y Git. Este modo guarda todo en memoria: no necesita PostgreSQL,
Redis ni S3.

```bash
# Backend (terminal 1)
cd backend
python -m venv .venv
.venv/Scripts/pip install -e ".[dev,ocr]"          # Linux o macOS: .venv/bin/pip
.venv/Scripts/pip install --no-deps rapidocr-onnxruntime
PLANO3D_MODE=memory .venv/Scripts/uvicorn plano3d.main:app --reload --port 8000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev                                         # http://localhost:5173
```

En PowerShell, la variable se pone antes con `$env:PLANO3D_MODE="memory"`.

### Comprobar que funciona

```bash
curl http://localhost:8080/api/health        # con Docker
curl http://localhost:8000/api/health        # sin Docker
```

Para probar la lectura de planos hay imágenes listas en la carpeta `pruebas/`.

## Guía rápida de uso

1. **Entrar.** «Entrar con la cuenta demo» abre una cuenta con proyectos de ejemplo, entre ellos la
   casa moderna de 4 pisos. También se puede crear una cuenta propia.
2. **Nuevo plano.** En **Nuevo**, tomar una foto o subir una imagen, un PDF o un DXF (por ejemplo,
   de `pruebas/`). Si la foto está torcida, **Ajustar esquinas** corrige la hoja.
3. **Procesando.** Se ven las etapas del análisis en vivo, y en segundos aparece el modelo.
4. **Corregir.** En el editor se ajustan muros, puertas, ventanas y ambientes. Con **Calibrar** se
   traza una línea sobre una cota conocida y se escribe su medida real.
5. **Recorrer.** En el visor 3D se orbita, se camina por la casa, se cambia la fachada y se ven los
   modos de obra, las cantidades y la simulación.
6. **Pedir cambios al chat.** En el estudio, por ejemplo: «agrega una puerta entre la cocina y la sala».
7. **Exportar o compartir.** Exportar a GLB, abrir en la app de escritorio o usar «Continuar en
   Interiores 3D» para amueblar la casa en Interiores IA.

## Configuración opcional (IA)

Todo funciona **sin claves**: la lectura de planos usa visión por computadora local. Estas variables
en `.env` (Docker) o en `backend/.env` (sin Docker) activan los servicios externos:

| Variable | Efecto |
|---|---|
| `ANTHROPIC_API_KEY` | Activa Claude: lectura de muros y cotas con visión, y el asistente del chat |
| `PLANO3D_AI` | `claude` para usar Claude; `none` para apagar la IA aunque haya clave |
| `PLANO3D_AI_WALLS` | `0` desactiva solo la lectura de muros con Claude |
| `PLANO3D_CLAUDE_BUDGET_USD` | Tope total de gasto en Claude (por ejemplo `1.0`) |
| `OPENAI_API_KEY` | Fotos realistas de la casa en el estudio de fotos |
| `PLANO3D_OPENAI_BUDGET_USD` | Tope de gasto en OpenAI |
| `PLANO3D_DEMO_PASSWORD` | Contraseña para entrar a la demo por el formulario (el botón no la necesita) |

## App de escritorio

Un segundo cliente para Windows, hecho con **Godot 4 .NET y C#** (`desktop/`), que edita los mismos
proyectos que la web en vivo. Suma iluminación global en tiempo real, día y noche, recorrido a pie con
personas, video del recorrido y render fotorrealista con Blender Cycles.

- **Instalar:** botón «Descargar para Windows» en `/escritorio`, o
  [el último release](https://github.com/St-Alejo/plano3d-frontend/releases/latest). El instalador no
  tiene firma de código: Windows SmartScreen avisa y hay que elegir «Más información» y «Ejecutar de
  todas formas».
- **Abrir un proyecto de la web:** «Abrir en escritorio» en el editor o el visor abre la app con la
  sesión y el proyecto.
- **Desarrollar:** .NET 8 SDK, Godot 4.7.2 .NET e Inno Setup 6.

```bash
dotnet test desktop/Plano3D.sln
powershell -File desktop/scripts/build-release.ps1 -Version 1.0.0
```

## Pruebas

| Suite | Comando | Qué cubre |
|---|---|---|
| Backend | `cd backend && pytest --cov` | Dominio (con Hypothesis), casos de uso, cada etapa del pipeline contra planos sintéticos, API REST y WebSocket, contrato OpenAPI |
| Frontend | `cd frontend && npm test` | Geometría, colisión, comandos, store, cliente de la API (MSW) y componentes |
| Punta a punta | `cd frontend && npx playwright test` (con la app corriendo) | Foto, pipeline, edición, guardado, recorrido y GLB; vista móvil |
| Accesibilidad | incluida en Playwright (`e2e/usability.spec.ts`) | WCAG 2.1 AA con axe en ambos temas, teclado y pantallas de 320 px |
| Calidad de detección | `cd backend && python scripts/eval.py` | Precisión de muros, puertas y ambientes por dificultad |
| Escritorio | `dotnet test desktop/Plano3D.sln` | Dominio en C#, cliente de la API, sala en vivo y Blender |
| Estático | `ruff check`, `mypy`, `npm run lint`, `npm run typecheck` | Estilo y tipos |

El generador de planos sintéticos (`backend/tests/synth/plan_generator.py`) dibuja un plano conocido y
simula una foto (perspectiva, sombra, ruido, desenfoque): así cada etapa se prueba contra la respuesta
exacta.

Si se cambia un DTO del backend, se regenera el contrato con
`cd backend && python scripts/export_openapi.py` y luego `cd frontend && npm run gen:api`.

## Patrones de diseño

| Patrón | Dónde está |
|---|---|
| Arquitectura hexagonal | `backend/src/plano3d`: dominio sin dependencias, puertos en `application`, adaptadores en `infrastructure` |
| Strategy | Detectores de muros (visión clásica o Claude) y modos del visor 3D (`viewer3d/modes`) |
| Pipeline / Chain of Responsibility | Etapas del análisis del plano |
| Repository y Adapter | Persistencia en memoria, SQL, S3 y Azure Blob |
| Observer | Progreso en vivo por WebSocket y store de Zustand |
| Command | Edición con deshacer y rehacer, en TypeScript y en C# |
| Builder | Construcción de la escena 3D (`SceneBuilder`, `ConstructionBuilder`) |
| Factory | Materiales (`MaterialFactory`) |
| Composition root | `container.py`: el único lugar que decide qué implementación se usa |

## Despliegue

- **Web:** Azure Static Web Apps (plan gratis), desde el repositorio `St-Alejo/plano3d-frontend`.
- **API:** Azure Container Apps con imagen `ghcr.io/st-alejo/plano3d-backend`, desde
  `St-Alejo/plano3d-backend`. Los datos viven en memoria con una copia en Azure Blob, así sobreviven a
  los reinicios sin pagar una base de datos.
- **Encender o apagar la demo para presentar:**

```powershell
powershell -File scripts\presentacion.ps1 estado
powershell -File scripts\presentacion.ps1 on -ReiniciarDemo
powershell -File scripts\presentacion.ps1 off
```

## Documentación adicional

| Documento | Contenido |
|---|---|
| [`docs/adr/`](docs/adr) | 22 registros de decisiones de arquitectura |
| [`docs/uml/diagramas.md`](docs/uml/diagramas.md) | Diagramas UML |
| [`docs/guion-demo.md`](docs/guion-demo.md) | Guion de la demostración |
| [`docs/usabilidad.md`](docs/usabilidad.md) | Pruebas de usabilidad y accesibilidad |
| [`docs/roadmap.md`](docs/roadmap.md) | Hoja de ruta |
| [`calidad/README.md`](calidad/README.md) | Resultados de la detección con planos reales |
