# Intención

Una página en blanco. Entra un avión de papel en origami, deja la frase escrita
a su paso, se va de cuadro y vuelve a entrar por donde salió para barrerla. Otro
viene del fondo hasta la cámara y el golpe deja el menú.

Three.js va copiado en `vendor/` y se resuelve con un alias de Vite, así que la
intro funciona igual sin red y contra la revisión exacta con la que se calibró.

Esta página es la pantalla de entrada de la **Plataforma 3i**. El plan de lo que
se construye encima está en [`plan.md`](plan.md).

## Cómo verla

```bash
npm install
npm run dev        # http://localhost:5173
```

Otros comandos: `npm run build` (produce `dist/`), `npm run preview` (sirve ese
`dist/`) y `npm run typecheck`.

Los módulos ES no cargan por `file://`: abrir `index.html` a mano sólo muestra el
aviso. Hasta la Fase 0 el proyecto no tenía build; ahora lo necesita, porque el
intercambio OAuth de Notion exige un secreto que no puede vivir en el navegador.

## Los cinco actos

| acto     | qué pasa                                                             |
|----------|----------------------------------------------------------------------|
| `enter`  | llega desde el fondo en un viraje largo, descendiendo y acelerando   |
| `pass`   | sigue de largo rozando la frase, que sube en su estela, y sale      |
| `gone`   | fuera de cuadro; la frase se queda sola y legible                   |
| `attack` | vuelve a entrar por el lado por donde salió y barre las palabras    |
| `charge` | el relevo: otro avión viene del fondo al frente y entrega el menú   |

Nunca se detiene ni gira en seco. Cada acto arranca con la posición y el rumbo
con que terminó el anterior, y ninguna curva frena a cero por el camino: los
*easings* son perfiles de velocidad, no de posición.

Los actos también se encadenan *dentro* del fotograma: lo que sobra del tiempo
de uno es lo que lleva andado el siguiente. Descartarlo dejaba un fotograma
repetido en cada empalme, y de ahí salía un latigazo del morro al reanudar.

## Nada va por reloj

Los tres hitos visibles los dispara un suceso, no un cronómetro:

- **La frase aparece** cuando el avión entra de verdad en la banda del texto
  (`phrase.cued`), y cada palabra sube cuando la estela le pasa por encima:
  el retardo se calcula con la x de la palabra y la velocidad media de la
  pasada, no con su número de orden.
- **El barrido** se agenda desde lo que la frase tardó de verdad en revelarse
  (`phrase.revealDuration + holdAfterReveal`), que depende de cuántas palabras
  hay y de cómo se envolvieron en esa pantalla.
- **El fundido a blanco** salta cuando el avión del relevo entra en el objetivo
  (a 1,25 unidades de la cámara), no a los *n* segundos.

En un equipo lento la coreografía se alarga sola en vez de descuadrarse. Por si
el avión no llega a dispararlo —una pestaña dormida, un `dt` raro— la frase sale
igual medio segundo después de la pasada.

## Mapa de archivos

| archivo                 | de qué se ocupa                                              |
|-------------------------|--------------------------------------------------------------|
| `index.html`            | estructura, capas (`z-index`) y el SVG del botón             |
| `src/styles/tokens.css` | color, tipografía, curvas, reset y la tabla del tema oscuro  |
| `src/styles/intro.css`  | cortinas de revelado, menú, grano, *responsive*              |
| `src/styles/dock.css`   | la franja, sus pestañas, las baldosas y los primitivos del panel |
| `src/styles/assistant.css` | el tirador de papel y la ventana flotante del asistente    |
| `src/app.ts`            | entrada; orden de arranque y cierre del viaje de OAuth        |
| `src/boot/`             | lo que tiene que pasar antes de la intro (la URL de OAuth)    |
| `src/core/store.ts`     | estado compartido: `get`, `set`, `subscribe`                  |
| `src/core/notion/`      | oauth, cliente, tipos y las carpetas de proyectos y documentos |
| `src/core/ai/`          | proveedores (los tres y los propios), claves, modelos, alta por dispositivo, el hilo |
| `src/core/state/`       | la intención, la página abierta y el tema (claro/oscuro/auto) |
| `src/core/persist/`     | la sesión de Notion, guardada entre visitas                   |
| `src/ui/dom.ts`         | `el()`, `render()`, `debounce` — nunca `innerHTML`            |
| `src/ui/origami.ts`     | la figura de papel, una sola fuente para los dos botones      |
| `src/ui/icons.ts`       | los trazos de la interfaz: carpeta, página, silueta, mandos   |
| `src/ui/drag.ts`        | arrastrar, recordar dónde se dejó y no salirse de la pantalla |
| `src/ui/dock/`          | la franja: `dock` (el filo), `tabs`, `tray`, `workspace`, `folders`, `menu` |
| `src/ui/assistant/`     | el tirador y la ventana de conversación                       |
| `src/main.js`           | ajustes, línea de tiempo, paso a menú, eventos               |
| `src/scene.js`          | render, cámara, luces de estudio, niebla blanca              |
| `src/origami.js`        | pliegue del avión (8 triángulos), papel, materiales          |
| `src/choreography.js`   | trayectorias, alabeo por curvatura, estelas, acompañantes    |
| `src/phrase.js`         | maquetación por palabras y su física al ser empujadas        |
| `src/utils.js`          | *easings*, ruido, amortiguación, aleatorio con semilla       |
| `vite.config.ts`        | alias de `three`, plugin de API, objetivo del build          |
| `tools/vite-api-plugin.ts` | sirve `api/*.ts` en desarrollo con la firma de Vercel      |
| `api/`                  | servidor: `health`, Notion (`notion-oauth`, `notion`) e IA (`ai-chat`, `ai-models`, `ai-registry`, `github-device`) |
| `api/_registry.ts`      | el registro de models.dev: metadatos y respaldo, con caché de seis horas |

Dos decisiones que no se ven en el código y conviene no deshacer sin querer:

- **El canvas va por encima de la frase** (`z-index` 2 contra 1). Es lo que
  permite que el avión pase por delante de las palabras. Invertirlo lo esconde
  detrás del texto.
- **El canvas es transparente y el blanco lo pone el CSS.** No hay *tone
  mapping*: el papel se lee por su sombreado, no por su brillo. Subir la
  exposición lo vuelve invisible.
- **La llegada y la pasada comparten un punto y un rumbo**, no sólo el punto.
  La tangente de una `CatmullRomCurve3` abierta en su extremo es exactamente su
  último tramo, así que el penúltimo punto de la llegada va sobre la recta del
  rumbo (`onRay(-1.6)`) y el segundo de la pasada también (`onRay(0.36)`). Mover
  cualquiera de los dos fuera de esa recta devuelve el giro brusco en el
  empalme: cada trazo llegaría al punto común con su propio rumbo.

## La franja de abajo

Cuando termina la intro aparece un filo en el borde inferior. Se abre y trae el
**espacio de trabajo**: los proyectos, y la conexión con Notion mientras no la haya.
Es lo que se construye encima; la pantalla de inicio sigue siendo una pregunta y nada
más.

Es **un panel, no una barra**: el mismo borde de 1 px, las mismas esquinas redondeadas
y la misma sombra que la ventana del asistente —los tres salen de `--r-panel` y
`--shadow`, declarados una vez en los tokens— y **no llega a los lados de la pantalla**.
Ese hueco a izquierda y derecha es lo que la hace leerse como una pestaña que sube desde
abajo en vez de como el pie de la página. Por abajo sí llega al filo, que es de donde
sale. Plegada, lo único que queda a la vista es la tira de arriba con sus esquinas ya
redondeadas.

Empezó con tres pestañas —Proyectos, Notion e IA— y se quedó en una sola pantalla.
Notion se disolvió dentro de Proyectos: conectar es el primer paso de esa pantalla, y
una vez conectada queda en la bandeja del extremo derecho, con los ajustes de IA y los
del sistema.

Abierta empuja el formulario hacia arriba en vez de taparlo, y sólo mueve la capa
del menú: mover `.stage` arrastraría el lienzo y con él el punto de vista de la
escena. Recuerda si quedó abierta. Se cierra con `Esc`.

### Pestañas

La tira lleva **pestañas de navegación**: cada una es un recorrido propio por las
carpetas. En el menú de una carpeta está «Abrir en otra pestaña», y así se puede tener
la tesis en una y las fuentes en otra sin perder el sitio en ninguna. Cada pestaña se
llama como la carpeta en la que está y cambia de nombre al entrar y salir; se cierra con
su «×» —la última no— y se pasa de una a otra con las flechas cuando tienen el foco.

Cambiar de pestaña **no vuelve a pedir nada**. Cada una guarda su propio espacio de
trabajo montado y vivo, con lo que ya había leído: Notion admite unas tres peticiones
por segundo y cambiar de pestaña es un gesto que se repite. Lo que sí es común a todas
—de quién es la sesión, cuál es la página raíz, el aviso de un error— vive una sola vez
y se repinta en todas a la vez.

No son las pestañas que hubo al principio. Aquéllas eran secciones —Proyectos, Notion e
IA— y se quitaron a propósito (`plan.md` §12 D6): partían una sola pantalla en tres.
Éstas abren varias veces la misma.

### Notion

La conexión con Notion pide un `.env` con las credenciales de una integración
pública (ver `.env.example`). El `client_secret` vive sólo en `api/`: el navegador
nunca lo ve, y `/api/health` dice si está configurado sin revelar ningún valor.

Volver de autorizar salta la intro a propósito —quien ya la vio no quiere verla
otra vez— y el `code` se borra de la barra de direcciones en el mismo turno en que
se lee. De eso se ocupa `src/boot/oauth-callback.ts`, que se importa antes que
`main.js` porque `main.js` lee `?intro=0` al evaluarse.

### Las carpetas

Cada **carpeta** es una lista desplegable de Notion y cada **documento** un bloque de
código en markdown dentro, con el nombre en el pie del bloque. Así el documento se
lee y se guarda de una vez, sin rearmar un árbol de bloques en cada guardado.

Las carpetas **se recorren en horizontal** y se ven como **baldosas**: un icono grande y
el nombre debajo, en una rejilla que se acomoda al ancho. La fila fija de cada pestaña
dice dónde estás —`PROYECTOS / TESIS DE GRADO`— y debajo va sólo el contenido de esa
carpeta. Se entra pulsando la baldosa y se vuelve pulsando una miga del camino; crear
ocurre donde estás, así que los botones de crear viven en esa misma fila y cambian con
ella. Una carpeta puede contener otras. El contenido se pide **al entrar**, no de golpe:
Notion admite unas tres peticiones por segundo y no vale gastarlas en listas que nadie
va a mirar.

Cada baldosa tiene su menú —el «⋯» de la esquina o el botón derecho— con abrir, «Abrir
en otra pestaña», renombrar y eliminar; eliminar pregunta en su propia etiqueta en vez
de abrir un diálogo del navegador. Un documento abierto en otra pestaña abre la carpeta
donde vive y se queda seleccionado: una pestaña es un sitio, no un archivo.

### El extremo derecho

En el extremo de la tira hay tres botones que no son el espacio de trabajo pero se
gobiernan desde el mismo borde, porque son de la aplicación entera y no de la carpeta que
se esté mirando:

- **La cuenta de Notion** —el icono del espacio, o una silueta mientras no haya sesión—:
  de qué espacio es, cambiar la página raíz y desconectar. Sin sesión, la misma
  invitación a conectar que la franja, en pequeño.
- **Los ajustes de IA**, con la forma del avión de papel. No son una copia de los de la
  ventana del asistente: los dos leen y escriben la misma configuración, así que lo que
  se cambie aquí ya está cambiado allí.
- **Los ajustes del sistema**: por ahora el tema, y sitio para lo que vaya haciendo
  falta.

Los tres se abren **con la franja plegada**, y es la razón de que estén aquí y no dentro:
la tira es lo único que queda a la vista al plegarse, así que se llega a los ajustes sin
abrirla. Sus ventanitas cuelgan del `<body>` y no del panel —el panel recorta lo que se
sale de él, que es lo que le da las esquinas, y éstas crecen hacia arriba por encima de
él—, se anclan por abajo y por la derecha para que cambiar de alto no las mueva, y al
plegar o desplegar la franja se cierran en vez de perseguir al botón que las abrió.

### Los ajustes de IA

Están en dos sitios que son el mismo: «Ajustes» en la ventana del asistente y el botón de
papel de la franja. No guardan ninguna clave en el servidor. Se elige proveedor
—OpenRouter, NVIDIA o GitHub—, se pega la clave (o se conecta la cuenta de GitHub
escribiendo un código corto en
`github.com/login/device`, como en las herramientas de consola) y se elige modelo del
catálogo real, que se guarda una hora. Si el servidor tiene su propia clave en el
entorno, lo dice y no hace falta pegar nada.

Detrás de los tres, **«＋ Otro» añade cualquier API que hable el formato de OpenAI**:
un nombre, la URL base y su clave si la pide. El nombre se autocompleta con el
directorio de [models.dev](https://models.dev) —171 proveedores compatibles— y al
elegir uno la URL viene ya puesta. La URL la comprueba el servidor antes de llamarla:
sólo `https`, sin usuario ni contraseña, y nunca a una red interna. En desarrollo
también valen las direcciones de la propia máquina, que es como se usa Ollama o LM
Studio; `AI_CUSTOM_PROVIDERS` decide hasta dónde llega en un despliegue.

No todas las APIs leen la clave igual, así que en un proveedor propio **la cabecera de la
clave se elige** —`Authorization: Bearer` por omisión, `api-key` para Azure, `x-api-key`
para quien copie el estilo de Anthropic, o el nombre que sea— y se pueden añadir **hasta
ocho cabeceras propias** (`Nombre: valor`, una por línea) para las pasarelas que piden una
versión, un proyecto o una ruta. Las revisa el servidor antes de reenviarlas: nombre válido,
valor ASCII imprimible y nada que gobierne la conexión o el cuerpo —`Host`,
`Content-Length`, `Content-Type`, `Cookie`—. Van al final del bloque, y por eso una cabecera
`Authorization` escrita a mano gana: es lo que deja usar un esquema que este servidor no
conoce. Los tres proveedores de casa **ignoran** todo esto; su dirección y su forma de
autenticar están en una tabla fija.

Cuando una API no publica `/models`, **el modelo se escribe a mano** y ya está: no hay que
esperar a que su catálogo exista. Y **«Probar conexión»** manda una pregunta mínima de
verdad por el mismo camino que una real y enseña lo que contestó. Existe por un caso
concreto: una pasarela cuyo `GET /v1/models` funcionaba —cuatro modelos en la lista, todo
con aspecto de estar bien— y cuyo `POST /v1/chat/completions` devolvía 403 desde el
cortafuegos de Cloudflare. Antes eso se descubría al preguntar lo primero; ahora, al
configurar. El catálogo espera quince segundos por destino y una respuesta sin flujo dos
minutos; el flujo no lleva tope, para no cortar una respuesta larga.

Y una última pieza para las APIs que **no** hablan el formato de OpenAI: un desplegable elige
entre «Formato OpenAI · /chat/completions» y «Formato Anthropic · /messages». Existe por un
caso real: una pasarela cuya lista de modelos se lee sin problema, cuyo `/chat/completions`
devuelve 403 desde Cloudflare —con clave y sin ella, con `Bearer` y con `x-api-key`, con
`User-Agent` de navegador y sin ninguno— y cuyo `/messages` contesta con la respuesta entera.
La traducción vive **sólo en el servidor** (`api/_anthropic.ts`): saca el `system` a su campo,
junta los mensajes seguidos del mismo papel, pone el `max_tokens` que Anthropic exige y
convierte los eventos del flujo en trozos de OpenAI, descartando los bloques de razonamiento.
El cliente sigue hablando un solo formato y no sabe que esto pasa. La clave viaja en
`x-api-key` sin que haya que configurar nada.

**Los modelos no están escritos en ningún archivo.** Cada consulta se le hace al
proveedor —`/models` de OpenRouter, de NVIDIA o de Copilot— y el registro público de
models.dev sólo completa lo que la respuesta no traiga: nombre legible, contexto, si
razona y si es gratis. Cuando una API no tiene `/models` —o lo tiene detrás de una
clave— la lista sale del registro y se dice ahí mismo, en vez de fingir que la dio el
proveedor. `gratis` sólo se marca donde el proveedor publica precios: NVIDIA declara
todo a coste cero y eso no significa nada.

### El tema

Claro, oscuro o automático, y se elige en los ajustes del sistema. Todo el color de la
plataforma sale de `src/styles/tokens.css`, así que el tema oscuro es una segunda tabla
de variables en ese mismo archivo (`:root[data-theme="dark"]`) y no una hoja aparte.
«Automático» sigue al del sistema y cambia con él sin recargar.

**La intro no cambia de color.** El lienzo es transparente y el blanco lo pone el CSS, y
la coreografía está calibrada contra ese blanco, así que la escena sigue siendo blanca en
los dos temas: el tema es de la plataforma que se construye encima.

La elección se aplica en un `<script>` clásico dentro de `index.html`, antes que
cualquier otra cosa: un módulo diferido pintaría el blanco primero y se vería el salto.
De ahí en adelante gobierna `src/core/state/theme.ts`, que es también quien escucha al
sistema.

## El asistente

Cuando la intro termina aparece, además del filo de la franja, un **tirador con la
forma del avión de papel** del botón de enviar la intención. Es la misma figura
(`src/ui/origami.ts` para los dos, y un comentario en `index.html` lo recuerda), así
que cambiarla la cambia en los dos sitios a la vez. La forma irá creciendo con lo que
haga falta.

Ni el tirador ni la ventana están anclados a un borde: **se arrastran y se quedan
donde se los deje**, cada uno con su sitio recordado (`3i.pos.*`). Con el foco en el
tirador o en la cabecera de la ventana, las flechas la mueven de 8 en 8 píxeles y con
`Shift` de 24 en 24. Al cambiar el tamaño de la ventana del navegador nada se queda
fuera de la pantalla, pero tampoco se olvida dónde estaba.

Arrastrar y pulsar comparten el mismo botón: sólo se considera arrastre a partir de 4
píxeles, y el clic que cierra un arrastre se ignora durante un cuarto de segundo. Sin
ese margen, soltar el tirador abriría la ventana en cada movimiento.

El asistente **pregunta, no redacta**. Ve la intención que se escribió al entrar y, si
hay una página abierta en Proyectos, su nombre y su contenido recortado a 12 000
caracteres; el contexto se rearma en cada envío, así que abrir otra página a media
conversación se nota en la respuesta siguiente. Lo que sabe de la metodología está en
`src/core/ai/prompt.ts`, y el hilo vive en `src/core/ai/conversation.ts` —fuera de la
interfaz— para que mover o cerrar la ventana no lo pierda.

## Qué se puede tocar

En `src/main.js`, arriba:

```js
const CONFIG = {
  lines: [
    { text: "Ningún proyecto nace de un problema." },
    { text: "Nace de una {intención}." },
  ],
  ambientAfterIntro: true,   // un avión lejano sigue derivando tras el menú
  holdAfterReveal: 4,        // segundos de frase quieta antes del barrido
};
```

Lo que va entre llaves sale en serif itálica. Cualquier número de líneas vale;
los retardos y la física del barrido se remiden solos.

En `src/choreography.js`:

- `TIME` marca la duración de cada acto en segundos (`enter`, `pass`,
  `attackDur`, `chargeDur`).
- `SWEEP` es el sentido del barrido en x. Negarlo invierte tres actos de golpe
  —por dónde sale el avión, por dónde vuelve a entrar y hacia dónde vuelan las
  palabras— porque los tres se derivan de él.
- `RELAY` dice cuál de los acompañantes rompe la formación y da el relevo. El
  espectador ya lo ha visto derivar por el fondo durante toda la intro.
- `AMBIENT` y `COMPANIONS` gobiernan las órbitas del fondo.

## Parámetros de URL

| parámetro  | para qué                                                       |
|------------|----------------------------------------------------------------|
| `?intro=0` | directo al menú, sin intro                                     |
| `?seek=8.4`| adelanta la coreografía a ese segundo en pasos fijos de 1/60    |

`?seek` es para revisar un instante concreto sin esperarlo: avanza la
simulación con `dt` constante antes de arrancar el bucle real, así que el
mismo valor da siempre el mismo fotograma. Útil para capturas — con la salvedad
de que los retardos CSS del revelado ya han vencido cuando se toma la captura,
así que la estela de palabras no se ve en un fotograma congelado.

## Degradaciones

- **`prefers-reduced-motion`**: el avión llega, deja la frase y se va. No hay
  barrido ni relevo contra la cámara; la frase se desvanece y entra el menú.
- **Sin WebGL**: no se monta la escena. Queda la frase y el menú, sólo
  tipografía.
- **Sin JavaScript**: la página se queda en blanco. Es una intro, no un
  documento.
