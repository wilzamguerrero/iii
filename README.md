# IntenciÃ³n

Una pÃ¡gina en blanco. Entra un aviÃ³n de papel en origami, deja la frase escrita
a su paso, se va de cuadro y vuelve a entrar por donde saliÃ³ para barrerla. Otro
viene del fondo hasta la cÃ¡mara y el golpe deja el menÃº.

Three.js va copiado en `vendor/` y se resuelve con un alias de Vite, asÃ­ que la
intro funciona igual sin red y contra la revisiÃ³n exacta con la que se calibrÃ³.

Esta pÃ¡gina es la pantalla de entrada de la **Plataforma 3i**. El plan de lo que
se construye encima estÃ¡ en [`plan.md`](plan.md).

## CÃ³mo verla

```bash
npm install
npm run dev        # http://localhost:5173
```

Otros comandos: `npm run build` (produce `dist/`), `npm run preview` (sirve ese
`dist/`), `npm run typecheck` y `npm run smoke` â€”180 comprobaciones sobre la
plataforma de verdad en un Chrome sin ventana; lo cuenta [`smoke/README.md`](smoke/README.md)â€”.

Los mÃ³dulos ES no cargan por `file://`: abrir `index.html` a mano sÃ³lo muestra el
aviso. Hasta la Fase 0 el proyecto no tenÃ­a build; ahora lo necesita, porque el
intercambio OAuth de Notion exige un secreto que no puede vivir en el navegador.

## Los cinco actos

| acto     | quÃ© pasa                                                             |
|----------|----------------------------------------------------------------------|
| `enter`  | llega desde el fondo en un viraje largo, descendiendo y acelerando   |
| `pass`   | sigue de largo rozando la frase, que sube en su estela, y sale      |
| `gone`   | fuera de cuadro; la frase se queda sola y legible                   |
| `attack` | vuelve a entrar por el lado por donde saliÃ³ y barre las palabras    |
| `charge` | el relevo: otro aviÃ³n viene del fondo al frente y entrega el menÃº   |

Nunca se detiene ni gira en seco. Cada acto arranca con la posiciÃ³n y el rumbo
con que terminÃ³ el anterior, y ninguna curva frena a cero por el camino: los
*easings* son perfiles de velocidad, no de posiciÃ³n.

Los actos tambiÃ©n se encadenan *dentro* del fotograma: lo que sobra del tiempo
de uno es lo que lleva andado el siguiente. Descartarlo dejaba un fotograma
repetido en cada empalme, y de ahÃ­ salÃ­a un latigazo del morro al reanudar.

## Nada va por reloj

Los tres hitos visibles los dispara un suceso, no un cronÃ³metro:

- **La frase aparece** cuando el aviÃ³n entra de verdad en la banda del texto
  (`phrase.cued`), y cada palabra sube cuando la estela le pasa por encima:
  el retardo se calcula con la x de la palabra y la velocidad media de la
  pasada, no con su nÃºmero de orden.
- **El barrido** se agenda desde lo que la frase tardÃ³ de verdad en revelarse
  (`phrase.revealDuration + holdAfterReveal`), que depende de cuÃ¡ntas palabras
  hay y de cÃ³mo se envolvieron en esa pantalla.
- **El fundido a blanco** salta cuando el aviÃ³n del relevo entra en el objetivo
  (a 1,25 unidades de la cÃ¡mara), no a los *n* segundos.

En un equipo lento la coreografÃ­a se alarga sola en vez de descuadrarse. Por si
el aviÃ³n no llega a dispararlo â€”una pestaÃ±a dormida, un `dt` raroâ€” la frase sale
igual medio segundo despuÃ©s de la pasada.

## Mapa de archivos

| archivo                 | de quÃ© se ocupa                                              |
|-------------------------|--------------------------------------------------------------|
| `index.html`            | estructura, capas (`z-index`) y el SVG del botÃ³n             |
| `src/styles/tokens.css` | color, tipografÃ­a, curvas, reset y la tabla del tema oscuro  |
| `src/styles/intro.css`  | cortinas de revelado, menÃº, grano, *responsive*              |
| `src/styles/dock.css`   | la franja, sus pestaÃ±as, las baldosas y los primitivos del panel |
| `src/styles/writer.css` | la hoja, sus dos columnas y la vista de lectura               |
| `src/styles/begin.css`  | el arranque de un proyecto desde la intenciÃ³n                 |
| `src/styles/voice.css`  | el botÃ³n de dictar, en los tres sitios donde aparece          |
| `src/styles/assistant.css` | el tirador de papel y la ventana flotante del asistente    |
| `src/app.ts`            | entrada; orden de arranque y cierre del viaje de OAuth        |
| `src/boot/`             | lo que tiene que pasar antes de la intro (la URL de OAuth)    |
| `src/core/store.ts`     | estado compartido: `get`, `set`, `subscribe`                  |
| `src/core/notion/`      | oauth, cliente, tipos, el árbol de páginas y la traducción Markdown ⇄ bloques nativos con su diff |
| `src/core/notion/blocks.ts` | Markdown ⇄ bloques nativos de Notion: el documento como prosa, títulos, listas e imágenes |
| `src/core/notion/diff.ts` | el guardado por diferencia: LCS del orden, updates, creates con ancla, deletes |
| `src/core/ai/`          | proveedores (los tres y los propios), claves, modelos, alta por dispositivo, el hilo, la revisiÃ³n y el arranque de un proyecto |
| `src/core/state/`       | la intenciÃ³n, la pÃ¡gina abierta y el tema (claro/oscuro/auto) |
| `src/core/persist/`     | la sesiÃ³n de Notion y los borradores en IndexedDB             |
| `src/core/project/`     | crear la carpeta con Indagar, Idear e Implementar dentro       |
| `src/core/method/`      | las tres estructuras del Reglamento del CESMAG                |
| `src/core/voice/`       | el reconocedor del navegador: encender, apagar, recoger frases |
| `src/ui/dom.ts`         | `el()`, `render()`, `debounce` â€” nunca `innerHTML`            |
| `src/ui/origami.ts`     | la figura de papel, una sola fuente para los dos botones      |
| `src/ui/icons.ts`       | los trazos de la interfaz, todos en la rejilla de 24          |
| `src/ui/drag.ts`        | arrastrar, recordar dÃ³nde se dejÃ³ y no salirse de la pantalla |
| `src/ui/dock/`          | la franja: `dock` (el filo), `tabs`, `tray`, `workspace`, `folders`, `tree`, `menu` |
| `src/ui/start/`         | de la intenciÃ³n al proyecto: `entry`, `begin`, `open`          |
| `src/ui/writer/`        | la hoja: `writer`, `visual` (el editor de un solo modo), `slash` (el menú «/»), `markdown`, `outline`, `panel`, `save`, `structure`, `contextai` (el menú de la IA al clic derecho) |
| `src/ui/voice/`         | el botÃ³n de dictar y dÃ³nde cae lo dicho                       |
| `src/ui/assistant/`     | el tirador y la ventana de conversaciÃ³n                       |
| `src/main.js`           | ajustes, lÃ­nea de tiempo, paso a menÃº, eventos               |
| `src/scene.js`          | render, cÃ¡mara, luces de estudio, niebla blanca              |
| `src/origami.js`        | pliegue del aviÃ³n (8 triÃ¡ngulos), papel, materiales          |
| `src/choreography.js`   | trayectorias, alabeo por curvatura, estelas, acompaÃ±antes    |
| `src/phrase.js`         | maquetaciÃ³n por palabras y su fÃ­sica al ser empujadas        |
| `src/utils.js`          | *easings*, ruido, amortiguaciÃ³n, aleatorio con semilla       |
| `vite.config.ts`        | alias de `three`, plugin de API, objetivo del build          |
| `tools/vite-api-plugin.ts` | sirve `api/*.ts` en desarrollo con la firma de Vercel      |
| `api/`                  | servidor: `health`, Notion (`notion-oauth`, `notion`) e IA (`ai-chat`, `ai-models`, `ai-registry`, `github-device`) |
| `api/_ai.ts`            | a quiÃ©n se llama y con quÃ© cabeceras; la tabla fija de los tres proveedores |
| `api/_anthropic.ts`     | traduce ida y vuelta el formato Anthropic, sÃ³lo en el servidor  |
| `api/_registry.ts`      | el registro de models.dev: metadatos y respaldo, con cachÃ© de seis horas |
| `functions/api/[[route]].ts` | el mismo `api/` sobre Cloudflare Pages: un adaptador, no once copias |
| `smoke/`                | las 180 comprobaciones en un Chrome sin ventana ([su README](smoke/README.md)) |

Dos decisiones que no se ven en el cÃ³digo y conviene no deshacer sin querer:

- **El canvas va por encima de la frase** (`z-index` 2 contra 1). Es lo que
  permite que el aviÃ³n pase por delante de las palabras. Invertirlo lo esconde
  detrÃ¡s del texto.
- **El canvas es transparente y el blanco lo pone el CSS.** No hay *tone
  mapping*: el papel se lee por su sombreado, no por su brillo. Subir la
  exposiciÃ³n lo vuelve invisible.
- **La llegada y la pasada comparten un punto y un rumbo**, no sÃ³lo el punto.
  La tangente de una `CatmullRomCurve3` abierta en su extremo es exactamente su
  Ãºltimo tramo, asÃ­ que el penÃºltimo punto de la llegada va sobre la recta del
  rumbo (`onRay(-1.6)`) y el segundo de la pasada tambiÃ©n (`onRay(0.36)`). Mover
  cualquiera de los dos fuera de esa recta devuelve el giro brusco en el
  empalme: cada trazo llegarÃ­a al punto comÃºn con su propio rumbo.

## La franja de abajo

Cuando termina la intro aparece un filo en el borde inferior. Se abre y trae el
**espacio de trabajo**: los proyectos, y la conexiÃ³n con Notion mientras no la haya.
Es lo que se construye encima; la pantalla de inicio sigue siendo una pregunta y nada
mÃ¡s.

Es **un panel, no una barra**: el mismo borde de 1 px, las mismas esquinas redondeadas
y la misma sombra que la ventana del asistente â€”los tres salen de `--r-panel` y
`--shadow`, declarados una vez en los tokensâ€” y **no llega a los lados de la pantalla**.
Ese hueco a izquierda y derecha es lo que la hace leerse como una pestaÃ±a que sube desde
abajo en vez de como el pie de la pÃ¡gina. Por abajo sÃ­ llega al filo, que es de donde
sale. Plegada, lo Ãºnico que queda a la vista es la tira de arriba con sus esquinas ya
redondeadas.

EmpezÃ³ con tres pestaÃ±as â€”Proyectos, Notion e IAâ€” y se quedÃ³ en una sola pantalla.
Notion se disolviÃ³ dentro de Proyectos: conectar es el primer paso de esa pantalla, y
una vez conectada queda en la bandeja del extremo derecho, con los ajustes de IA y los
del sistema.

Abierta empuja el formulario hacia arriba en vez de taparlo, y sÃ³lo mueve la capa
del menÃº: mover `.stage` arrastrarÃ­a el lienzo y con Ã©l el punto de vista de la
escena. Recuerda si quedÃ³ abierta. Se cierra con `Esc`.

### PestaÃ±as

La tira lleva **pestaÃ±as de navegaciÃ³n**: cada una es un recorrido propio por las
carpetas. En el menÃº de una carpeta estÃ¡ Â«Abrir en otra pestaÃ±aÂ», y asÃ­ se puede tener
la tesis en una y las fuentes en otra sin perder el sitio en ninguna. Cada pestaÃ±a se
llama como la carpeta en la que estÃ¡ y cambia de nombre al entrar y salir; se cierra con
su Â«Ã—Â» â€”la Ãºltima noâ€” y se pasa de una a otra con las flechas cuando tienen el foco.

Cambiar de pestaÃ±a **no vuelve a pedir nada**. Cada una guarda su propio espacio de
trabajo montado y vivo, con lo que ya habÃ­a leÃ­do: Notion admite unas tres peticiones
por segundo y cambiar de pestaÃ±a es un gesto que se repite. Lo que sÃ­ es comÃºn a todas
â€”de quiÃ©n es la sesiÃ³n, cuÃ¡l es la pÃ¡gina raÃ­z, el aviso de un errorâ€” vive una sola vez
y se repinta en todas a la vez.

No son las pestaÃ±as que hubo al principio. AquÃ©llas eran secciones â€”Proyectos, Notion e
IAâ€” y se quitaron a propÃ³sito (`plan.md` Â§12 D6): partÃ­an una sola pantalla en tres.
Ã‰stas abren varias veces la misma.

### Notion

La conexiÃ³n con Notion pide un `.env` con las credenciales de una integraciÃ³n
pÃºblica (ver `.env.example`). El `client_secret` vive sÃ³lo en `api/`: el navegador
nunca lo ve, y `/api/health` dice si estÃ¡ configurado sin revelar ningÃºn valor.

**Cada proyecto, carpeta y documento es una pÃ¡gina de Notion** â€”con bloques
nativos dentro: prosa, tÃ­tulos, listas, citas, imÃ¡genesâ€”, asÃ­ que en Notion el
documento se lee como una pÃ¡gina de verdad y lo que se pegue allÃ­ se ve. El
editor de la plataforma sigue siendo Markdown: `blocks.ts` traduce en los dos
sentidos y el guardado no reescribe la pÃ¡gina entera â€”`diff.ts` compara contra
el Ãºltimo estado confirmado (LCS del orden, igual que la referencia) y manda sÃ³lo
lo que cambiÃ³, con el tope de tres peticiones por segundo de Notion respetado.

Volver de autorizar salta la intro a propÃ³sito â€”quien ya la vio no quiere verla
otra vezâ€” y el `code` se borra de la barra de direcciones en el mismo turno en que
se lee. De eso se ocupa `src/boot/oauth-callback.ts`, que se importa antes que
`main.js` porque `main.js` lee `?intro=0` al evaluarse.

### Las carpetas

Cada **carpeta** es una pÃ¡gina de Notion y cada **documento** una pÃ¡gina hija:
en Notion no existe la distinciÃ³n â€”todo es pÃ¡ginaâ€”, asÃ­ que la plataforma la
decide al entrar: si dentro hay pÃ¡ginas, es una carpeta que se recorre; si hay
texto, es un documento que se abre en la hoja. Pulsar una baldosa hace esa
pregunta, que es la misma lectura que la retÃ­cula necesitaba de todos modos.

Las carpetas **se recorren en horizontal** y se ven como **baldosas**: un icono grande y
el nombre debajo, en una rejilla que se acomoda al ancho. La fila fija de cada pestaÃ±a
dice dÃ³nde estÃ¡s â€”`PROYECTOS / TESIS DE GRADO`â€” y debajo va sÃ³lo el contenido de esa
carpeta. Se entra pulsando la baldosa y se vuelve pulsando una miga del camino; crear
ocurre donde estÃ¡s, asÃ­ que los botones de crear viven en esa misma fila y cambian con
ella. Una carpeta puede contener otras. El contenido se pide **al entrar**, no de golpe:
Notion admite unas tres peticiones por segundo y no vale gastarlas en listas que nadie
va a mirar.

Cada baldosa tiene su menÃº â€”el Â«â‹¯Â» de la esquina o el botÃ³n derechoâ€” con abrir, Â«Abrir
en otra pestaÃ±aÂ», renombrar y eliminar; eliminar pregunta en su propia etiqueta en vez
de abrir un diÃ¡logo del navegador. Un documento abierto en otra pestaÃ±a abre la carpeta
donde vive y se queda seleccionado: una pestaÃ±a es un sitio, no un archivo.

A la izquierda va el **Ã¡rbol desde la raÃ­z**. Las baldosas dicen quÃ© hay *aquÃ­*; el Ã¡rbol
dice dÃ³nde estÃ¡ *aquÃ­*, y con Ã©l se vuelve arriba de un salto en vez de deshacer el camino
miga a miga. No navega por su cuenta: lo pide. Quien lleva el camino y lee las carpetas
sigue siendo la retÃ­cula â€”si el Ã¡rbol leyera aparte habrÃ­a dos verdades sobre lo mismoâ€”, y
tampoco gasta peticiones de mÃ¡s: cada carpeta que la retÃ­cula lee se la pasa, y el Ã¡rbol
sÃ³lo pregunta a Notion por las ramas que alguien abre a mano.

### El extremo derecho

En el extremo de la tira hay tres botones que no son el espacio de trabajo pero se
gobiernan desde el mismo borde, porque son de la aplicaciÃ³n entera y no de la carpeta que
se estÃ© mirando:

- **La cuenta de Notion** â€”el icono del espacio, o una silueta mientras no haya sesiÃ³nâ€”:
  de quÃ© espacio es, cambiar la pÃ¡gina raÃ­z y desconectar. Sin sesiÃ³n, la misma
  invitaciÃ³n a conectar que la franja, en pequeÃ±o.
- **Los ajustes de IA**, con la forma del aviÃ³n de papel. No son una copia de los de la
  ventana del asistente: los dos leen y escriben la misma configuraciÃ³n, asÃ­ que lo que
  se cambie aquÃ­ ya estÃ¡ cambiado allÃ­.
- **Los ajustes del sistema**: por ahora el tema, y sitio para lo que vaya haciendo
  falta.

Los tres se abren **con la franja plegada**, y es la razÃ³n de que estÃ©n aquÃ­ y no dentro:
la tira es lo Ãºnico que queda a la vista al plegarse, asÃ­ que se llega a los ajustes sin
abrirla. Sus ventanitas cuelgan del `<body>` y no del panel â€”el panel recorta lo que se
sale de Ã©l, que es lo que le da las esquinas, y Ã©stas crecen hacia arriba por encima de
Ã©lâ€”, se anclan por abajo y por la derecha para que cambiar de alto no las mueva, y al
plegar o desplegar la franja se cierran en vez de perseguir al botÃ³n que las abriÃ³.

### Los ajustes de IA

EstÃ¡n en dos sitios que son el mismo: Â«AjustesÂ» en la ventana del asistente y el botÃ³n de
papel de la franja. No guardan ninguna clave en el servidor. Se elige proveedor
â€”OpenRouter, NVIDIA o GitHubâ€”, se pega la clave (o se conecta la cuenta de GitHub
escribiendo un cÃ³digo corto en
`github.com/login/device`, como en las herramientas de consola) y se elige modelo del
catÃ¡logo real, que se guarda una hora. Si el servidor tiene su propia clave en el
entorno, lo dice y no hace falta pegar nada.

DetrÃ¡s de los tres, **Â«ï¼‹ OtroÂ» aÃ±ade cualquier API que hable el formato de OpenAI**:
un nombre, la URL base y su clave si la pide. El nombre se autocompleta con el
directorio de [models.dev](https://models.dev) â€”171 proveedores compatiblesâ€” y al
elegir uno la URL viene ya puesta. La URL la comprueba el servidor antes de llamarla:
sÃ³lo `https`, sin usuario ni contraseÃ±a, y nunca a una red interna. En desarrollo
tambiÃ©n valen las direcciones de la propia mÃ¡quina, que es como se usa Ollama o LM
Studio; `AI_CUSTOM_PROVIDERS` decide hasta dÃ³nde llega en un despliegue.

No todas las APIs leen la clave igual, asÃ­ que en un proveedor propio **la cabecera de la
clave se elige** â€”`Authorization: Bearer` por omisiÃ³n, `api-key` para Azure, `x-api-key`
para quien copie el estilo de Anthropic, o el nombre que seaâ€” y se pueden aÃ±adir **hasta
ocho cabeceras propias** (`Nombre: valor`, una por lÃ­nea) para las pasarelas que piden una
versiÃ³n, un proyecto o una ruta. Las revisa el servidor antes de reenviarlas: nombre vÃ¡lido,
valor ASCII imprimible y nada que gobierne la conexiÃ³n o el cuerpo â€”`Host`,
`Content-Length`, `Content-Type`, `Cookie`â€”. Van al final del bloque, y por eso una cabecera
`Authorization` escrita a mano gana: es lo que deja usar un esquema que este servidor no
conoce. Los tres proveedores de casa **ignoran** todo esto; su direcciÃ³n y su forma de
autenticar estÃ¡n en una tabla fija.

Cuando una API no publica `/models`, **el modelo se escribe a mano** y ya estÃ¡: no hay que
esperar a que su catÃ¡logo exista. Y **Â«Probar conexiÃ³nÂ»** manda una pregunta mÃ­nima de
verdad por el mismo camino que una real y enseÃ±a lo que contestÃ³. Existe por un caso
concreto: una pasarela cuyo `GET /v1/models` funcionaba â€”cuatro modelos en la lista, todo
con aspecto de estar bienâ€” y cuyo `POST /v1/chat/completions` devolvÃ­a 403 desde el
cortafuegos de Cloudflare. Antes eso se descubrÃ­a al preguntar lo primero; ahora, al
configurar. El catÃ¡logo espera quince segundos por destino y una respuesta sin flujo dos
minutos; el flujo no lleva tope, para no cortar una respuesta larga.

Y una Ãºltima pieza para las APIs que **no** hablan el formato de OpenAI: un desplegable elige
entre Â«Formato OpenAI Â· /chat/completionsÂ» y Â«Formato Anthropic Â· /messagesÂ». Existe por un
caso real: una pasarela cuya lista de modelos se lee sin problema, cuyo `/chat/completions`
devuelve 403 desde Cloudflare â€”con clave y sin ella, con `Bearer` y con `x-api-key`, con
`User-Agent` de navegador y sin ningunoâ€” y cuyo `/messages` contesta con la respuesta entera.
La traducciÃ³n vive **sÃ³lo en el servidor** (`api/_anthropic.ts`): saca el `system` a su campo,
junta los mensajes seguidos del mismo papel, pone el `max_tokens` que Anthropic exige y
convierte los eventos del flujo en trozos de OpenAI, descartando los bloques de razonamiento.
El cliente sigue hablando un solo formato y no sabe que esto pasa. La clave viaja en
`x-api-key` sin que haya que configurar nada.

**Los modelos no estÃ¡n escritos en ningÃºn archivo.** Cada consulta se le hace al
proveedor â€”`/models` de OpenRouter, de NVIDIA o de Copilotâ€” y el registro pÃºblico de
models.dev sÃ³lo completa lo que la respuesta no traiga: nombre legible, contexto, si
razona y si es gratis. Cuando una API no tiene `/models` â€”o lo tiene detrÃ¡s de una
claveâ€” la lista sale del registro y se dice ahÃ­ mismo, en vez de fingir que la dio el
proveedor. `gratis` sÃ³lo se marca donde el proveedor publica precios: NVIDIA declara
todo a coste cero y eso no significa nada.

### El tema

Claro, oscuro o automÃ¡tico, y se elige en los ajustes del sistema. Todo el color de la
plataforma sale de `src/styles/tokens.css`, asÃ­ que el tema oscuro es una segunda tabla
de variables en ese mismo archivo (`:root[data-theme="dark"]`) y no una hoja aparte.
Â«AutomÃ¡ticoÂ» sigue al del sistema y cambia con Ã©l sin recargar.

**La intro no cambia de color.** El lienzo es transparente y el blanco lo pone el CSS, y
la coreografÃ­a estÃ¡ calibrada contra ese blanco, asÃ­ que la escena sigue siendo blanca en
los dos temas: el tema es de la plataforma que se construye encima.

La elecciÃ³n se aplica en un `<script>` clÃ¡sico dentro de `index.html`, antes que
cualquier otra cosa: un mÃ³dulo diferido pintarÃ­a el blanco primero y se verÃ­a el salto.
De ahÃ­ en adelante gobierna `src/core/state/theme.ts`, que es tambiÃ©n quien escucha al
sistema.

## De la intenciÃ³n al proyecto

La frase que se escribe en la entrada no se queda en una nota. Al enviarla â€”cuando el
aviÃ³n termina de irse, 820 ms despuÃ©sâ€” se abre el arranque: un nombre para el proyecto y
las preguntas con las que nace cada fase.

Es el Ãºnico sitio donde la IA **hace** algo en vez de preguntar, y estÃ¡ acotado a
propÃ³sito: propone el nombre y las preguntas, y no redacta el proyecto. Las preguntas
**no estÃ¡n escritas en ningÃºn archivo de este repositorio**; salen de esa intenciÃ³n y de
ninguna otra. Un cuestionario igual para todos es justo lo que el mÃ©todo niega: la
naturaleza de la situaciÃ³n se identifica, no se rellena.

En Notion se crean cuatro cosas, una detrÃ¡s de otra y en este orden: la carpeta del
proyecto y dentro **Indagar**, **Idear** e **Implementar**. Ninguno nace vacÃ­o: llevan la
intenciÃ³n citada arriba, quÃ© decide esa fase, las preguntas para empezar y sus apartados de
trabajo. En serie y no en paralelo porque hasta que el desplegable no existe no hay dÃ³nde
poner nada, y porque cuatro peticiones a la vez son el borde donde Notion empieza a
devolver 429. Si falla a mitad **no se deshace lo hecho**: lo escrito ya estÃ¡ en el Notion
de la persona, y borrar bloques suyos para dejar limpio un fallo nuestro es peor que
dejarle un proyecto con dos documentos y decÃ­rselo.

Las estructuras de la universidad no se crean aquÃ­. Se insertan despuÃ©s, dentro del
documento, cuando la persona sabe quÃ© estÃ¡ entregando.

Se puede crear **sin IA y sin esperarla**. Si no hay modelo conectado, o contesta algo que
no se puede comprobar, el proyecto se crea igual con el nombre que se escriba y los
documentos quedan enmarcados pero sin preguntas â€”y lo dicen, en vez de disimularloâ€”. El
nombre se rellena solo con la primera oraciÃ³n de la intenciÃ³n mientras el modelo piensa, y
en cuanto se toca el campo el modelo ya no lo pisa.

TambiÃ©n se llega aquÃ­ desde el explorador: Â«Crear desde la intenciÃ³nÂ», cuando hay una
intenciÃ³n anotada y se estÃ¡ en la raÃ­z.

## La hoja

Abrir un documento abre la hoja, y ocupa la pantalla entera porque escribir es lo Ãºnico
que se estÃ¡ haciendo cuando se estÃ¡ haciendo. Va **por debajo de la franja y del
asistente**: la franja se abre encima para ir a otro documento y el aviÃ³n se puede dejar
sobre el papel, que es para lo que se hizo movible.

**Un solo modo: escribir y leer a la vez.** La hoja es el documento compuesto
—títulos, listas, citas, imágenes tal como se leen— y se escribe directamente
sobre él, como en Notion. El Markdown sigue siendo cómo viaja el texto —al
guardado, a Notion, al asistente— pero ya no es un modo en el que estar: el
botón «Leer/Escribir» desapareció. La tecla **«/»** en un bloque vacío abre el
menú de bloques —título, apartado, subapartado, texto, lista, lista numerada,
cita, separador, código, imagen— con las flechas y Enter. El texto se arma a
nodos y nunca con `innerHTML`: el texto viene de Notion, de un modelo y de la
persona, y los tres son entrada.

A la izquierda, los **apartados**, sacados de los propios tÃ­tulos de Markdown â€”asÃ­ no hay
nada que mantener en paralelo ni que se pueda desincronizarâ€” y pulsar uno lleva hasta Ã©l
en el modo en que se estÃ©. Esto es el Â«espacio para leer las estructuras de los archivosÂ»:
la estructura de un proyecto no se entiende leyendo veinte pÃ¡ginas seguidas, se entiende
viendo sus apartados y quÃ© falta entre ellos.

Arriba, la barra dice dÃ³nde estÃ¡s â€”proyecto Â· documentoâ€”, cuÃ¡ntas **palabras** hay (el
reglamento cuenta pÃ¡ginas y nadie escribe pÃ¡ginas en un campo de texto) y siempre **en quÃ©
punto va el guardado**: Â«Guardado en NotionÂ», Â«Sin guardarÂ», Â«Guardandoâ€¦Â», Â«No se pudo
guardarÂ», o Â«Guardado sÃ³lo aquÃ­Â» mientras no haya sesiÃ³n. Un editor que guarda solo y no
dice cuÃ¡ndo obliga a desconfiar de Ã©l, y quien desconfÃ­a copia el texto a otro sitio por
si acaso: entonces el editor ya no sirve de nada.

**Se guarda dos veces y a dos ritmos.** El borrador local a los 500 ms, que es gratis y es
la red de seguridad; Notion a los 1400 ms, que cuesta una peticiÃ³n con el documento entero
dentro. Entre los dos hay un segundo en el que lo escrito ya estÃ¡ a salvo en el navegador
aunque todavÃ­a no estÃ© en Notion. `Ctrl+S` lo manda ya, y cerrar la pestaÃ±a tambiÃ©n. El
borrador vive en IndexedDB y no en `localStorage` â€”un informe final son cientos de miles
de caracteres, y `localStorage` son unos cinco megas para toda la plataforma y ademÃ¡s
escribe bloqueando el hilo mientras se tecleaâ€” y sÃ³lo se borra cuando Notion confirma que
lo tiene. Que exista uno al abrir un documento significa algo: hay trabajo sin guardar, y
se ofrece recuperarlo.

**Las estructuras del reglamento se insertan, no se imponen.** Â«EstructuraÂ» pone de una vez
los apartados de la idea, del anteproyecto o del informe final de la Universidad CESMAG
(artÃ­culos 13, 16 y 21 del Reglamento de Trabajo de Grado). Lo que entra es **texto del
documento**, no una plantilla que la plataforma gobierne: desde ese momento cada apartado
se renombra, se mueve y se borra como cualquier otro. SÃ³lo entra una vez â€”si el documento
ya sigue una estructura, se diceâ€”, y otra universidad sÃ³lo tendrÃ¡ que traer su tabla a
`src/core/method/structures.ts`.

Y **lo que se marca se puede preguntar**. Con un fragmento seleccionado aparecen tres
acciones que no son tres maneras de decir lo mismo: **Cuestionar** (quÃ© doy por supuesto
en este fragmento), **Explicar** (quÃ© papel cumple en la fase) y **Precisar** (dÃ³nde se
puede leer de dos maneras). Van al asistente con el fragmento dentro, porque conversar se
conversa en un solo sitio. Y con el **clic derecho** sobre lo marcado estÃ¡ la versiÃ³n
completa: las tres del mÃ©todo mÃ¡s las de investigaciÃ³n â€”**Resumir**, **Buscar respaldo**
(dice quÃ© evidencia harÃ­a falta y dÃ³nde, sin inventar referencias) y **Parafrasear**
â€”, como en las plataformas de escritura con IA.

### La revisiÃ³n

La columna de la derecha es la parte del encargo que pedÃ­a que la IA tambiÃ©n revisara lo
que se estÃ¡ haciendo, y la forma en que se cumple tiene un lÃ­mite deliberado:
**observaciones, nunca reemplazos**. Ninguna tarjeta trae un botÃ³n que arregle el pÃ¡rrafo,
porque el documento se defiende delante de un jurado y sÃ³lo se puede defender lo que uno
escribiÃ³.

Cada observaciÃ³n viene marcada â€”**Falta**, **Flojo**, **Impreciso**, **Sobra**, **Sin
respaldo**â€”, anclada a un fragmento literal del documento (pulsarla lleva hasta ahÃ­) y se
puede llevar al asistente. No se contesta en la columna: si el modelo hablara aquÃ­
tambiÃ©n habrÃ­a dos sitios donde habla y sobrarÃ­a uno.

**No se revisa sola.** Revisar cuesta una peticiÃ³n con el documento entero dentro, y
hacerlo cada vez que se abre la columna serÃ­a gastarle a la persona su cuota sin que la
pida; se revisa cuando se pulsa Â«RevisarÂ», y si el texto cambiÃ³ desde la Ãºltima vez se
dice, para que nadie confunda una revisiÃ³n vieja con lo que hay ahora. Sin credencial no
gasta nada: lo dice y ofrece los ajustes de IA. Y se revisa contra dos cosas a la vez â€”lo
que la fase tiene que decidir segÃºn el mÃ©todo y, si se insertÃ³ una, los apartados del
reglamentoâ€”, porque a un Indagar sin la naturaleza de la situaciÃ³n le falta algo aunque
tenga veinte pÃ¡ginas, y eso no lo dice un corrector de estilo. No inventa fuentes: cuando
hace falta respaldo, la observaciÃ³n dice quÃ© habrÃ­a que buscar; buscarlo con DOI es la
Fase 7.

## El asistente

Cuando la intro termina aparece, ademÃ¡s del filo de la franja, un **tirador con la
forma del aviÃ³n de papel** del botÃ³n de enviar la intenciÃ³n. Es la misma figura
(`src/ui/origami.ts` para los dos, y un comentario en `index.html` lo recuerda), asÃ­
que cambiarla la cambia en los dos sitios a la vez. La forma irÃ¡ creciendo con lo que
haga falta.

Ni el tirador ni la ventana estÃ¡n anclados a un borde: **se arrastran y se quedan
donde se los deje**, cada uno con su sitio recordado (`3i.pos.*`). Con el foco en el
tirador o en la cabecera de la ventana, las flechas la mueven de 8 en 8 pÃ­xeles y con
`Shift` de 24 en 24. Al cambiar el tamaÃ±o de la ventana del navegador nada se queda
fuera de la pantalla, pero tampoco se olvida dÃ³nde estaba.

Arrastrar y pulsar comparten el mismo botÃ³n: sÃ³lo se considera arrastre a partir de 4
pÃ­xeles, y el clic que cierra un arrastre se ignora durante un cuarto de segundo. Sin
ese margen, soltar el tirador abrirÃ­a la ventana en cada movimiento.

El asistente **pregunta, no redacta**. Ve la intenciÃ³n que se escribiÃ³ al entrar y, si
hay una pÃ¡gina abierta en Proyectos, su nombre y su contenido recortado a 12 000
caracteres; el contexto se rearma en cada envÃ­o, asÃ­ que abrir otra pÃ¡gina a media
conversaciÃ³n se nota en la respuesta siguiente. Lo que sabe de la metodologÃ­a estÃ¡ en
`src/core/ai/prompt.ts`, y el hilo vive en `src/core/ai/conversation.ts` â€”fuera de la
interfazâ€” para que mover o cerrar la ventana no lo pierda.

Las respuestas llegan **compuestas como el modo lectura** â€”tÃ­tulos, listas, citasâ€”
y cada una trae sus acciones: **Copiar** al portapapeles y, con un documento
abierto, **AÃ±adir al documento**, que la pega donde estÃ© el cursor. AÃ±adir no
reemplaza nada: lo que queda es siempre decisiÃ³n de quien escribe.

Con la hoja abierta, lo que ve es **lo que se acaba de escribir** y no lo que hay en
Notion. La diferencia es de un segundo y medio, y es exactamente la que importa: sin esto,
preguntar por el pÃ¡rrafo que se acaba de teclear le llegarÃ­a al modelo como un documento
donde ese pÃ¡rrafo todavÃ­a no estÃ¡. La hoja deja puesta una funciÃ³n que lee su texto por id
de pÃ¡gina â€”no un `import` cruzado, para que el hilo no dependa de la interfazâ€” y asÃ­ no se
le vuelve a pedir nada a Notion para preguntar.

## Dictar

El mismo botÃ³n en los tres sitios donde se escribe â€”la intenciÃ³n de la entrada, la
pregunta al asistente y el documentoâ€” porque es el mismo gesto. Va contra el
`SpeechRecognition` del navegador y no contra un servicio nuestro: no hay clave que
guardar ni audio que suba a ningÃºn sitio de la plataforma. Si el navegador no sabe dictar,
el botÃ³n **no se pinta**: uno que al pulsarlo explica que no puede es peor que no tenerlo.

Lo dictado entra **donde estÃ¡ el cursor**, no al final â€”un pÃ¡rrafo se dicta en medio de un
documento tanto como el primeroâ€”, y el espacio de antes y el de despuÃ©s se ponen solos;
los signos que no lo llevan delante (`, . ; : ! ? ) ] } Â» â€¦`) se pegan a la palabra. Nadie
dice Â«comaÂ» ni Â«espacioÂ». Donde el campo tiene tope, dictar lo respeta: `maxlength` no
gobierna lo que se escribe por programa y esto no es una vÃ­a para saltarlo.

SÃ³lo se escribe lo **terminado**. Lo provisional cambia de palabra mientras se habla, y
verlo bailar dentro del documento distrae mÃ¡s de lo que informa. El reconocedor se cierra
solo en cada pausa larga, asÃ­ que se vuelve a encender mientras la persona no diga que no
â€”con tope de seis reencendidos en tres segundos: a partir de ahÃ­ no es una pausa, es un
bucleâ€”. El idioma es el del navegador cuando es espaÃ±ol, para que un `es-CO` reconozca el
habla de aquÃ­ mejor que un `es-ES` genÃ©rico.

Y cuando se apaga, **se dice por quÃ©**: sin permiso, que hay que habilitarlo en la barra de
direcciones; y si no, que falta el micrÃ³fono, que falta la red o que no reconoce ese
idioma. Un apagÃ³n deja dos avisos â€”el de quien lo apagÃ³ y el del navegador cerrando la
sesiÃ³nâ€” y el segundo pisaba al primero, asÃ­ que el motivo se cuenta una sola vez por
encendido. Ese fallo lo sacÃ³ el humo, y es el motivo lo que hace Ãºtil un apagÃ³n.

## QuÃ© se puede tocar

En `src/main.js`, arriba:

```js
const CONFIG = {
  lines: [
    { text: "NingÃºn proyecto nace de un problema." },
    { text: "Nace de una {intenciÃ³n}." },
  ],
  ambientAfterIntro: true,   // un aviÃ³n lejano sigue derivando tras el menÃº
  holdAfterReveal: 4,        // segundos de frase quieta antes del barrido
};
```

Lo que va entre llaves sale en serif itÃ¡lica. Cualquier nÃºmero de lÃ­neas vale;
los retardos y la fÃ­sica del barrido se remiden solos.

En `src/choreography.js`:

- `TIME` marca la duraciÃ³n de cada acto en segundos (`enter`, `pass`,
  `attackDur`, `chargeDur`).
- `SWEEP` es el sentido del barrido en x. Negarlo invierte tres actos de golpe
  â€”por dÃ³nde sale el aviÃ³n, por dÃ³nde vuelve a entrar y hacia dÃ³nde vuelan las
  palabrasâ€” porque los tres se derivan de Ã©l.
- `RELAY` dice cuÃ¡l de los acompaÃ±antes rompe la formaciÃ³n y da el relevo. El
  espectador ya lo ha visto derivar por el fondo durante toda la intro.
- `AMBIENT` y `COMPANIONS` gobiernan las Ã³rbitas del fondo.

## ParÃ¡metros de URL

| parÃ¡metro  | para quÃ©                                                       |
|------------|----------------------------------------------------------------|
| `?intro=0` | directo al menÃº, sin intro                                     |
| `?seek=8.4`| adelanta la coreografÃ­a a ese segundo en pasos fijos de 1/60    |

`?seek` es para revisar un instante concreto sin esperarlo: avanza la
simulaciÃ³n con `dt` constante antes de arrancar el bucle real, asÃ­ que el
mismo valor da siempre el mismo fotograma. Ãštil para capturas â€” con la salvedad
de que los retardos CSS del revelado ya han vencido cuando se toma la captura,
asÃ­ que la estela de palabras no se ve en un fotograma congelado.

## Desplegar

Sirve en Vercel y en Cloudflare Pages sin cambiar un solo handler. Los archivos de
`api/` estÃ¡n escritos contra la firma de `api/_types.ts` â€”`query`, `body`,
`status()`, `json()`, `send()`â€” y no contra la de un proveedor, asÃ­ que cada
entorno sÃ³lo aporta el adaptador que la rellena:

| entorno            | quiÃ©n adapta                    | build                  |
|--------------------|---------------------------------|------------------------|
| desarrollo         | `tools/vite-api-plugin.ts`      | `npm run dev`          |
| Vercel             | nadie: es su convenciÃ³n (`vercel.json`) | `npm run build`, salida `dist` |
| Cloudflare Pages   | `functions/api/[[route]].ts`    | `npm run build`, salida `dist` |

En Cloudflare, `functions/api/[[route]].ts` recoge todo `/api/*` con una ruta
comodÃ­n y busca el handler en una tabla. Es **un** archivo y no once â€”lo que harÃ­a
la convenciÃ³n de `functions/`â€” porque once copias de la misma lÃ³gica se separan con
el primer arreglo. Lo que ese adaptador pone y el entorno no da: `process.env`
desde `context.env`, y un `res.write()` sobre un `TransformStream`, que es lo que
mantiene el flujo del asistente saliendo trozo a trozo en vez de de golpe al
final. `public/_routes.json` deja el resto de las rutas en el CDN: sin Ã©l, cada
imagen despertarÃ­a al aislado.

Las variables van tal cual en el panel de cada plataforma (ver `.env.example`).
Ninguna lleva prefijo `VITE_` a propÃ³sito: eso las meterÃ­a en el paquete que
descarga el navegador.

Una advertencia sobre `NOTION_OAUTH_REDIRECT_URI`: es la misma URL que autoriza y
la que canjea el cÃ³digo â€”`api/notion-oauth.ts` la lee del entorno en los dos
pasos, no del cuerpo de la peticiÃ³nâ€”, y Notion exige que coincidan carÃ¡cter por
carÃ¡cter. AsÃ­ que **el valor desplegado es la URL desplegada**, no la de
desarrollo, y las dos tienen que estar registradas en la integraciÃ³n. Con
`http://localhost:5173` en producciÃ³n, Notion rechaza el canje.

`AI_CUSTOM_PROVIDERS` decide hasta dÃ³nde llegan las URLs que escribe cada persona
en los ajustes de IA. Sin configurarla: `local` en desarrollo â€”para Ollama y LM
Studioâ€” y `public` desplegado, que cierra las direcciones internas. Desplegado se
reconoce por `VERCEL`, `CF_PAGES` o `NODE_ENV=production`; un entorno que no se
reconozca cuenta como desplegado, porque equivocarse hacia `local` abrirÃ­a la red
interna del servidor a una URL de los ajustes.

Para probar Cloudflare en casa antes de publicar:

```bash
npm run build
npx wrangler pages dev dist
```

## El humo

`npm run smoke` abre la plataforma de verdad en un Chrome sin ventana, la maneja como la
manejarÃ­a una persona y comprueba lo que queda en la pantalla: **180 comprobaciones** en
siete partes â€”la entrada, la hoja, la revisiÃ³n, el arranque de un proyecto, la franja, el
asistente y el dictadoâ€”. Arranca lo que falte, y lo que arranca lo apaga; con un solo
fallo sale con cÃ³digo 1, asÃ­ que vale para un gancho de git.

Sin marco de pruebas y sin dependencias nuevas: el cliente del protocolo de depuraciÃ³n son
sesenta lÃ­neas sobre el `WebSocket` y el `fetch` que ya trae Node, y no hay jsdom en medio,
asÃ­ que lo que se prueba es la plataforma en un navegador y no una imitaciÃ³n de uno. SÃ³lo
se finge lo que estÃ¡ fuera â€”Notion, el modelo y el reconocedor de vozâ€”, y por una razÃ³n
cada uno. Lo cuenta [`smoke/README.md`](smoke/README.md), incluido lo que esto **no**
puede probar.

## Degradaciones

- **`prefers-reduced-motion`**: el aviÃ³n llega, deja la frase y se va. No hay
  barrido ni relevo contra la cÃ¡mara; la frase se desvanece y entra el menÃº.
- **Sin WebGL**: no se monta la escena. Queda la frase y el menÃº, sÃ³lo
  tipografÃ­a.
- **Sin `SpeechRecognition`** (Firefox, hoy): el botÃ³n de dictar no se pinta. Se escribe
  a mano, que es lo que se hacÃ­a antes de tenerlo.
- **Sin IndexedDB** (alguna navegaciÃ³n privada): se escribe y se guarda en Notion igual,
  sÃ³lo sin la red de seguridad del borrador local. Falla en silencio a propÃ³sito.
- **Sin sesiÃ³n de Notion**: la hoja escribe y lo dice â€”Â«Guardado sÃ³lo aquÃ­Â»â€”; el borrador
  local queda esperando a que haya dÃ³nde mandarlo.
- **Sin JavaScript**: la pÃ¡gina se queda en blanco. Es una intro, no un
  documento.
