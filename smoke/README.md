# El humo

Siete guiones que abren la plataforma de verdad en un Chrome sin ventana, la
manejan como la manejaría una persona y comprueban lo que queda en la pantalla.
**180 comprobaciones.**

```
npm run smoke
```

Arranca lo que falte (el servidor de desarrollo y el Chrome), corre las siete
partes en orden, y al final dice cuántas comprobaciones pasaron. Si ya tienes
`npm run dev` a mano, se cuelga de él y no lo apaga; lo que arranca, lo apaga.
Con un solo fallo sale con código 1, así que vale para un gancho de git.

Una parte sola, con el servidor y el Chrome ya en pie:

```
node smoke/parts/7-dictado.mjs
```

## Cómo está armado

Sin marco de pruebas y sin dependencias nuevas: `cdp.mjs` son sesenta líneas de
protocolo de depuración sobre el `WebSocket` y el `fetch` que ya trae Node. No
hay jsdom en medio, así que lo que se prueba es la plataforma en un navegador,
no una imitación de uno.

| | |
|---|---|
| `run.mjs` | Levanta el servidor y el Chrome, corre las partes, cuenta. |
| `part.mjs` | Lo que toda parte necesita: abrir la página, anotar, informar al salir. |
| `cdp.mjs` | El cliente del protocolo de depuración. |
| `parts/` | Las siete partes, una por lo que hace la plataforma. |
| `doubles/` | Lo de fuera, fingido. |

Cada parte recarga la página al empezar y cada doble pone —o borra— lo que su
premisa necesita del `localStorage`. El Chrome que arranca `run.mjs` usa un
perfil nuevo, así que el tema, la intención o dónde se dejó el asistente no
pasan de una corrida a otra.

## Las siete partes

1. **Entrada** — el documento se monta cerrado, se abre al elegir una página,
   trae el texto de Notion, cuenta palabras, saca los apartados y se guarda solo.
2. **Lectura** — leer cambia de hoja, los apartados llevan hasta su sitio, las
   tres estructuras del reglamento se insertan una sola vez, lo marcado ofrece
   Cuestionar / Explicar / Precisar, el clic derecho abre el menú de la IA con
   las acciones de investigación, y una imagen del documento se ve en la
   vista de lectura.
3. **Revisión** — la columna de la derecha: sin credencial lo dice y no gasta una
   petición; con ella marca faltas, respaldos y flojos sobre el texto.
4. **Arranque** — de la intención al proyecto: la IA propone nombre y preguntas,
   se crean la carpeta y los tres documentos, y ninguna pregunta viene hecha de
   antemano.
5. **Franja** — arranca en claro, esquinas casi rectas, el árbol desde la raíz a
   la izquierda del explorador, iconos de la misma rejilla de 24, y ningún botón
   más redondo que un panel.
6. **Asistente** — se abre, dice qué ve, manda método + contexto + pregunta, ve
   **lo que se acaba de escribir** sin volver a leer Notion, se mueve con las
   flechas y recuerda dónde se dejó. La respuesta llega compuesta y con sus
   acciones —Copiar, Añadir al documento—, y añadir entra de verdad en el
   documento. Y su ventana se pliega: ocho hojas de papel
   en blanco que se despliegan, con la ventana montada y anunciada en el primer
   fotograma —el adorno nunca va delante del estado—, sin quedarse a medias al
   pulsar dos veces seguidas, y sin construir nada con movimiento reducido.
7. **Dictado** — el mismo botón en los tres sitios donde se escribe; lo
   provisional no se escribe, lo terminado cae en el cursor con su espacio, la
   pausa no lo apaga, el bucle tiene tope, y sin permiso se apaga diciendo por qué.

## Lo que se finge

Sólo lo que está fuera de la plataforma, y por una razón cada uno:

- **Notion** (`doubles/notion.js`) — un `fetch` falso sobre `/api/notion` con un
  documento y sus bloques nativos, que aplica el diff —updates, creates con su
  ancla, deletes— igual que haría Notion y devuelve los bloques con
  `plain_text`, como los devuelve la API de verdad. Guardar contra Notion real
  en cada corrida ensuciaría un espacio real.
- **El modelo** (`arranque.js`, `asistente.js`, `revision.js`) — un `/api/ai-chat`
  que devuelve un SSE en trozos, como el de verdad. Se prueba nuestro lado: qué
  se le manda, qué se hace con lo que contesta. Un modelo real daría una
  respuesta distinta cada vez y cobraría por ella.
- **El reconocedor de voz** (`dictado.js`) — un `SpeechRecognition` de mentira,
  fiel en lo que importa: encender dos veces la misma sesión lanza, y `abort()`
  acaba también en `onend`. Esa fidelidad es la que sacó el fallo de que el
  micrófono se apagaba sin decir que había sido por falta de permiso.

## Lo que esto no puede probar

Y hay que probarlo a mano:

- Que Notion de verdad acepte lo que le mandamos, con una integración y un token.
- Que un modelo de verdad conteste algo útil a las preguntas del método.
- Que el micrófono de verdad oiga, y en el español de aquí.
- Que la pantalla se vea bien: tipografía, aire, el origami de la entrada, y
  cómo queda todo en una pantalla pequeña.
- El camino de OAuth con Notion, que necesita el navegador de una persona.
