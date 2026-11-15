# Guion visual de los tutoriales (propuesta)

Reglas: una acción visual por bloque; máximo 4 palabras en pantalla por escena (aparte del
subtítulo); las analogías se dibujan literalmente; magnitudes con escala; foco en lo importante
(el resto se atenúa); elementos que persisten entre escenas; la acción clave cae en la palabra
**en negrita** del subtítulo; cada escena termina en una imagen quieta y clara (~0,8 s).

Técnica: se sigue grabando la app real con Playwright (`npm run tutorials`), pero la capa
inyectada (`helpers.ts`) pasa de "franja de texto" a capa animada: rótulo corto, subtítulo con
la palabra clave resaltada en el instante de la acción, foco (viñeta que oscurece todo menos el
objetivo), regla de escala en metros, y dibujos SVG de las analogías. Sin dependencias nuevas
(no hace falta ffmpeg: Playwright ya graba .webm). Mismas rutas `public/tutoriales/*.webm`.

Elementos persistentes: el cursor ladrillo, una **regla de escala** abajo a la izquierda que se
reescala con el zoom real del lienzo, y un **riel de pasos** (puntos 1…N) que avanza.

---

## 1. crear.webm — «Crear desde cero» (también se ve en la landing)

| # | Rótulo (≤4) | Subtítulo (palabra clave) | Acción visual | Imagen final |
|---|---|---|---|---|
| 0 | Hoja en blanco | Sin foto: lo **dibujas** tú | Analogía literal: una hoja de papel vacía cae sobre la pantalla y se encoge hasta volverse el lienzo del estudio | Lienzo vacío con la regla 0–5 m |
| 1 | Ponle nombre | Escribe «Mi casa» y **empieza** | Foco en el campo; al pulsar, el botón se "estampa" como sello | Estudio abierto, chat a la vista |
| 2 | Escribe la sala | «sala de **5×4**…» | Al escribir 5×4 aparecen dos cotas animadas (5 m y 4 m) que se tienden desde la regla hasta el rectángulo recién creado; la cocina 3×4 se pega "al este" con una flecha de brújula E | Sala y cocina con sus cotas y la brújula |
| 3 | Puertas y ventanas | puerta entre sala y cocina… **ventana** al norte | Cada abertura parpadea en ladrillo en el instante en que se nombra (puerta → sur → ventana) | Plano con 3 aberturas resaltadas |
| 4 | Ctrl+Z deshace | Todo el chat **se deshace** | Analogía literal: flecha de rebobinado que gira y el último cambio retrocede un paso, luego se rehace | Plano completo otra vez |
| 5 | O con el ratón | Arrastra un **rectángulo** (H) | Foco en el arrastre; la cota 3 × 2,5 m crece con el rectángulo; el muro compartido brilla una vez ("no se duplica") | Baño dibujado y nombrado |
| 6 | Míralo en 3D | Tecla 2: **3D** al instante | Las paredes se levantan del plano (se conserva el mismo contorno); regla vertical 0–2,6 m junto al muro | Maqueta 3D con altura acotada |
| 7 | Guarda | **Ctrl+S** y sigue luego | El indicador "guardado" se enciende; riel de pasos completo | Plano + 3D, "guardado" |

## 2. editar.webm — «Editar un plano»

| # | Rótulo (≤4) | Subtítulo (palabra clave) | Acción visual | Imagen final |
|---|---|---|---|---|
| 0 | Todo se mueve | Muros, puertas y medidas se **mueven** | El plano de la sala+alcoba aparece; cada pieza da un pequeño salto en orden | Plano quieto |
| 1 | Abre el Estudio | El editor a **pantalla completa** | Zoom: el recuadro del editor se expande hasta llenar el cuadro (mismo plano, ahora grande) | Estudio completo |
| 2 | Arrastra la puerta | Llévala a **otro muro** | Foco en la puerta; trayecto punteado del muro sur al oeste; cotas en vivo con la distancia en m; rojo si no cabe | Puerta en el muro oeste, cota fija |
| 3 | Bórrala | Selecciona y pulsa **Supr** | Analogía literal: un borrador de lápiz pasa sobre la ventana y la deja en blanco | Muro norte sin ventana |
| 4 | Agrega ventana | Herramienta N y **clic** | La ventana nueva "crece" desde el punto del clic hasta su ancho (1,2 m con regla) | Ventana nueva |
| 5 | Afina el panel | **Centrar** o **invertir** el giro | Foco en el panel; la puerta se desliza al centro (cotas iguales a ambos lados) y su arco gira | Puerta centrada, cotas simétricas |
| 6 | Deshacer y rehacer | Ctrl+Z **deshace**, Ctrl+Shift+Z **rehace** | Misma flecha de rebobinado del video 1 (elemento que se repite entre videos) | Estado final |
| 7 | Revisa en 3D | Tecla 2 y **guarda** | Muros que se levantan + "guardado" | 3D con el cambio |

## 3. recorrer.webm — «Recorrer en 3D» (ahora con la casa real de 3 pisos)

Usa la casa «Opción 3» (3 pisos, escalera en U, portón, muebles) en vez de la caja de ejemplo.

| # | Rótulo (≤4) | Subtítulo (palabra clave) | Acción visual | Imagen final |
|---|---|---|---|---|
| 0 | Entra a casa | Camina como si **estuvieras adentro** | Analogía literal: la maqueta vista desde fuera, una silueta de persona (1,70 m con regla) cae en la puerta y la cámara baja a sus ojos | Vista a la altura de los ojos |
| 1 | Elige Recorrer | Elige **Recorrer** | Foco en el selector de modo | Modo recorrer activo |
| 2 | Camina | W A S D o el **joystick** | Teclas WASD dibujadas que se hunden al ritmo; los muros "frenan" con un pequeño rebote | Frente a la puerta |
| 3 | Abre la puerta | Apunta y pulsa **E** | Rayo de mira de 2,4 m (con regla) hasta la puerta; la puerta gira | Puerta abierta |
| 4 | Sube la escalera | Se sube **caminando** o con Q | Corte lateral pequeño: escalón 18 cm × 15 = 2,7 m de piso a piso; un punto sube por el perfil al mismo tiempo que la cámara | Piso 2 |
| 5 | Tres pisos | **Piso 1, 2, 3** | Riel de niveles: tres losas apiladas con sus cotas de altura, la actual en ladrillo | Piso 3 marcado |
| 6 | Mira el minimapa | **Tócalo** para ir | Foco en el minimapa; el punto "usted está aquí" late | Minimapa con posición |
| 7 | Puertas automáticas | Se abren **solas** | Las puertas del pasillo se abren en cadena al pasar | Recorrido libre |

---

## Videos que la app hoy no tiene (para decidir)

La landing usa `crear.webm` en «Cómo funciona», pero esa sección habla de **foto/PDF → la app la
lee → 3D**, no de dibujar desde cero. Tampoco hay video de la simulación «tipo Sims», del export
a Blender ni de «Fotos con IA». Opciones: (a) solo rehacer los 3 actuales; (b) además un
`foto.webm` para la landing (foto → etapas → 3D) y uno corto de 3 pisos + simulación + Blender.
«Fotos con IA» gasta crédito de OpenAI (~US$0,075 por tanda de 5): no se graba sin permiso.
