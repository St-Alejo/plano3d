# Planos de prueba para Plano 3D

Planos listos para subir (Proyectos → **Nuevo plano**, o adjuntos en el **chat de IA**) y ver
la casa en 3D. Solo están los que el detector convierte bien; cada uno se verificó con el mismo
detector de producción.

Para regenerar la carpeta y volver a verificar, desde `backend/`:

```
python scripts/generar_pruebas.py --verificar
```

## `reales/`: planos de casas reales

La tabla muestra la calidad medida contra la verdad anotada a mano (`calidad/<caso>/metrics.json`).

| Archivo | Qué es | Muros (F1) | Ambientes (IoU) |
|---|---|---|---|
| `casa-1-planta.jpg` | Casa pequeña de 3 ambientes, escaneada | 1,00 | 0,96 |
| `casa-2-planta.jpg` | Casa de 6 ambientes con cotas | 0,97 | 0,93 |
| `casa-4-planta-hd.jpg` | Foto en alta resolución de una planta de 7 ambientes | 0,95 | 0,91 |
| `casa-3-pisos-piso-1.pdf` | Primer piso de la casa demo (PDF de CAD) | — | — |
| `casa-3-pisos-planta-tipo.pdf` | Planta tipo (pisos 2 y 3) de la casa demo | 0,99 | 0,99 |

En `casa-3-pisos-piso-1.pdf` no hay verdad anotada, por eso no tiene métricas. Es el plano del
que sale el primer piso de la casa demo.

## `sinteticos/`: dibujados por el generador del banco de pruebas

| Archivo | Qué es | Detectado / esperado |
|---|---|---|
| `apartamento-3-ambientes.png` | Apartamento de 10 × 7 m: alcoba, sala y cocina | 6/6 muros · 6/6 aberturas · 3/3 ambientes |
| `casa-en-L.png` | Casa en L de 12 × 9 m con 4 ambientes | 8/9 muros · 6/6 · 4/4 |
| `casa-compleja.pdf` | PDF vectorial con muro curvo y oblicuo, columnas, escalera, cotas y rótulo `ESC 1:50` | 10/11 · 12/12 · 5/5 |
| `casa-compleja-achurada.png` | La misma casa, con muros achurados | 11/11 · 12/12 · 4/5 |
| `edificio-6-apartamentos.pdf` | Planta de 6 apartamentos, 28 muros | 28/28 · 50/50 · 25/25 |

Cuando faltan muros es porque el detector unió dos muros alineados en uno solo; eso no es un
error.

## `fotos/`: planos fotografiados con el celular

Papel en ángulo, con sombra, ruido y un doblez. El detector endereza la hoja antes de leerla.

| Archivo | Detectado / esperado |
|---|---|
| `apartamento-3-ambientes-foto.jpg` | 6/6 muros · 6/6 aberturas · 3/3 ambientes |
| `casa-compleja-foto.jpg` | 10/11 · 13/12 · 4/5 |

## `varios-pisos/`: casas de varios pisos

Hay un PDF por piso. Se suben **juntos** por el chat de IA («arma la casa con estos planos»),
o se crea el proyecto con el piso 1 y luego se usa **Agregar piso** con los demás.

- `casa-3-pisos/`: la casa demo (`prj_demo_casa3`).
- `casa-4-pisos/`: la casa moderna destacada de 4 pisos.

## Lo que todavía no sale bien (por eso no está)

- Bocetos a mano alzada: detecta 1 de 5 ambientes.
- Plantas renderizadas en imagen con muros huecos (doble línea sin relleno): detecta 3 de 5
  ambientes. En PDF salen bien.
- Edificios grandes en imagen o foto: duplica muros. En PDF salen bien.
- Varias plantas en una sola imagen (por ejemplo `tests/real/casa3`): mejor subir un archivo
  por piso.
