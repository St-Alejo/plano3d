# Guion visual de los tutoriales

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
| 0 | Hoja en blanco | Sin foto: el plano lo **dibujas** tú | Analogía literal: una hoja de papel vacía cae sobre la tarjeta «¿No tienes el plano?» y se asienta | Tarjeta de empezar desde cero |
| 1 | Ponle nombre | Escribe «Mi casa» y **empieza** | Foco en el campo; al pulsar, el botón se "estampa" como sello | Estudio abierto, chat a la vista |
| 2 | Escribe la sala | «sala de **5 × 4**, cocina de 3 × 4 al este» | Se cierra el chat y aparecen la regla de 1 m y las cotas animadas de 5 m y 4 m; una brújula marca el este sobre la cocina | Sala y cocina con sus cotas y la brújula |
| 3 | Puertas y ventanas | Puerta a la cocina, puerta al sur, **ventana** al norte | Al cerrar el chat, cada abertura late en ladrillo en ese orden | Plano con 3 aberturas resaltadas |
| 4 | Ctrl+Z deshace | Todo el chat **se deshace** | Analogía literal: flecha de rebobinado que gira y el último cambio retrocede un paso, luego se rehace | Plano completo otra vez |
| 5 | O con el ratón | Arrastra un **rectángulo** (H) | Foco en el arrastre; la cota 3 × 2,5 m crece con el rectángulo; el muro compartido brilla una vez ("no se duplica") | Baño dibujado y nombrado |
| 6 | Míralo en 3D | Clic en 3D: los muros **se levantan** | Foco en el botón 3D; las paredes se levantan del mismo contorno (los atajos ahora son 1 plano, 2 dividido, 3 3D) | Maqueta 3D |
| 7 | Guarda | **Ctrl+S** y sigue cuando quieras | Foco en el indicador «guardado»; riel de pasos completo | Maqueta 3D limpia |

## 2. editar.webm — «Editar un plano»

Se graba ya dentro del estudio, en vista Plano, con la regla de 1 m fija.

| # | Rótulo (≤4) | Subtítulo (palabra clave) | Acción visual | Imagen final |
|---|---|---|---|---|
| 0 | Todo se mueve | Muros, puertas y ventanas se **mueven** | Cada pieza editable (puerta, ventana, puerta interior, ventana este) late por turno | Plano quieto |
| 1 | A escala | Sala de **5 m** por 4 m, alcoba de 3 m | Cotas animadas de 5 m, 4 m y 3 m | Plano acotado |
| 2 | Arrastra la puerta | Llévala a **otro muro**; las cotas te guían | Trayecto punteado con flecha del muro sur al oeste; el arrastre sigue la flecha | Puerta en el muro oeste |
| 3 | Bórrala | Selecciónala y pulsa **Supr** | Analogía literal: un lápiz con goma pasa sobre la ventana y la deja en blanco | Muro norte sin ventana |
| 4 | Agrega ventana | Herramienta Ventana (N) y **clic** en un muro | Foco en la herramienta; la ventana nueva late en el punto del clic | Ventana nueva en la alcoba |
| 5 | Afina el panel | **Centrar** la puerta o invertir su giro | Foco en Centrar; la puerta pasa de 2,35 a 1,55 m y aparecen cotas de 2 m a cada lado | Puerta centrada, cotas simétricas |
| 6 | Deshacer y rehacer | Ctrl+Z **deshace**, Ctrl+Shift+Z rehace | La misma flecha de rebobinado del video 1 (elemento que se repite entre videos) | Estado final |
| 7 | Revisa en 3D | Mira el cambio en 3D y **guarda** | Vista 3D + foco en «guardado» | 3D con el cambio |

## 3. recorrer.webm — «Recorrer en 3D» (con la casa real de 3 pisos)

Usa la casa «Opción 3» (3 pisos de 2,60 m, escalera en U de 15 peldaños de 17 cm, portón, muebles),
armada antes de grabar con los PDF de `backend/tests/real`. El visor se calienta antes para que no
cargue en el video, y la ayuda «Cómo recorrer» se da por vista porque las escenas explican lo mismo.

| # | Rótulo (≤4) | Subtítulo (palabra clave) | Acción visual | Imagen final |
|---|---|---|---|---|
| 0 | Entra a casa | Camina como si **estuvieras adentro** | Analogía literal: una persona de 1,70 m (acotada) cae junto a la entrada de la maqueta | Maqueta con la persona |
| 1 | Elige Recorrer | Pulsa **Recorrer** y entra | Foco en el selector; la cámara baja a la altura de los ojos | Vista desde adentro |
| 2 | Sube la escalera | Por la escalera o con **Q** | Corte de la escalera: 15 peldaños de 17 cm = 2,60 m; un punto sube por el perfil y se pasa al piso 2 | Piso 2 |
| 3 | Tres pisos | Q sube, **Z baja** un piso | Losas apiladas a 0,0 / 2,6 / 5,2 m; la actual en ladrillo cambia con cada Q y Z | Piso 1, frente a la puerta |
| 4 | Camina | W A S D o el **joystick** en el celular | Teclas W A S D dibujadas; la W se hunde mientras se avanza | Frente a la puerta |
| 5 | Abre la puerta | Apunta (alcance 2,4 m) y pulsa **E** | Rayo de mira acotado; la puerta gira | Puerta abierta |
| 6 | Mira el minimapa | **Tócalo** para ir a otro punto | Foco en el minimapa; la posición late | Minimapa con posición |
| 7 | Puertas automáticas | Actívalas y se abren **solas** | Se cierra la puerta, se activa el botón y al caminar se abre sola; se vuelve a Orbitar | La maqueta entera, como al comienzo |

---

## Videos que la app no tiene todavía

Se decidió rehacer solo los 3 actuales. Quedan fuera, por ahora: un `foto.webm` para «Cómo
funciona» de la landing (que habla de foto/PDF → 3D pero reproduce `crear.webm`), y uno de
simulación «tipo Sims», export a Blender y «Fotos con IA» (este último gasta crédito de OpenAI).
