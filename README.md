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
| `src/styles/tokens.css` | color, tipografía, curvas y reset — la única fuente          |
| `src/styles/intro.css`  | cortinas de revelado, menú, grano, *responsive*              |
| `src/styles/dock.css`   | la franja de abajo, el árbol y los primitivos del panel       |
| `src/styles/assistant.css` | el tirador de papel y la ventana flotante del asistente    |
| `src/app.ts`            | entrada; orden de arranque y cierre del viaje de OAuth        |
| `src/boot/`             | lo que tiene que pasar antes de la intro (la URL de OAuth)    |
| `src/core/store.ts`     | estado compartido: `get`, `set`, `subscribe`                  |
| `src/core/notion/`      | oauth, cliente, tipos y el árbol de proyectos y páginas       |
| `src/core/ai/`          | proveedores, claves, modelos, alta por dispositivo, el hilo   |
| `src/core/state/`       | lo que el asistente ve: la intención y la página abierta      |
| `src/core/persist/`     | la sesión de Notion, guardada entre visitas                   |
| `src/ui/dom.ts`         | `el()`, `render()`, `debounce` — nunca `innerHTML`            |
| `src/ui/origami.ts`     | la figura de papel, una sola fuente para los dos botones      |
| `src/ui/drag.ts`        | arrastrar, recordar dónde se dejó y no salirse de la pantalla |
| `src/ui/dock/`          | la franja y sus tres pestañas                                |
| `src/ui/assistant/`     | el tirador y la ventana de conversación                       |
| `src/main.js`           | ajustes, línea de tiempo, paso a menú, eventos               |
| `src/scene.js`          | render, cámara, luces de estudio, niebla blanca              |
| `src/origami.js`        | pliegue del avión (8 triángulos), papel, materiales          |
| `src/choreography.js`   | trayectorias, alabeo por curvatura, estelas, acompañantes    |
| `src/phrase.js`         | maquetación por palabras y su física al ser empujadas        |
| `src/utils.js`          | *easings*, ruido, amortiguación, aleatorio con semilla       |
| `vite.config.ts`        | alias de `three`, plugin de API, objetivo del build          |
| `tools/vite-api-plugin.ts` | sirve `api/*.ts` en desarrollo con la firma de Vercel      |
| `api/`                  | servidor: `health`, Notion (`notion-oauth`, `notion`) e IA (`ai-chat`, `ai-models`, `github-device`) |

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

Cuando termina la intro aparece un filo en el borde inferior. Se abre y trae tres
pestañas: **Proyectos**, **Notion** e **IA**. Es lo que se construye encima; la
pantalla de inicio sigue siendo una pregunta y nada más.

Abierta empuja el formulario hacia arriba en vez de taparlo, y sólo mueve la capa
del menú: mover `.stage` arrastraría el lienzo y con él el punto de vista de la
escena. Recuerda si quedó abierta y en qué pestaña. Se cierra con `Esc`.

La conexión con Notion pide un `.env` con las credenciales de una integración
pública (ver `.env.example`). El `client_secret` vive sólo en `api/`: el navegador
nunca lo ve, y `/api/health` dice si está configurado sin revelar ningún valor.

Volver de autorizar salta la intro a propósito —quien ya la vio no quiere verla
otra vez— y el `code` se borra de la barra de direcciones en el mismo turno en que
se lee. De eso se ocupa `src/boot/oauth-callback.ts`, que se importa antes que
`main.js` porque `main.js` lee `?intro=0` al evaluarse.

Cada **proyecto** es una lista desplegable de Notion y cada **página** un bloque de
código en markdown dentro, con el nombre en el pie del bloque. Así el documento se
lee y se guarda de una vez, sin rearmar un árbol de bloques en cada guardado. Los
hijos de un proyecto se piden al desplegarlo, no al abrir la pestaña: Notion admite
unas tres peticiones por segundo y no vale gastarlas en listas que nadie va a mirar.

La pestaña **IA** no guarda ninguna clave en el servidor. Se elige proveedor
—OpenRouter, NVIDIA o GitHub—, se pega la clave (o se conecta la cuenta de GitHub
escribiendo un código corto en `github.com/login/device`, como en las herramientas de
consola) y se elige modelo del catálogo real, que se guarda una hora. Si el servidor
tiene su propia clave en el entorno, la pestaña lo dice y no hace falta pegar nada.

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
