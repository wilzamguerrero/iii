# Intención

Una página en blanco. Entra un avión de papel en origami, deja la frase escrita
a su paso, se va de cuadro y vuelve a entrar por donde salió para barrerla. Otro
viene del fondo hasta la cámara y el golpe deja el menú.

Sin build, sin dependencias que instalar: HTML, CSS y módulos ES. Three.js va
copiado en `vendor/` y se resuelve con un *import map* en `index.html`, así que
funciona igual sin red.

## Cómo verla

Hace falta un servidor: los módulos ES no cargan por `file://`.

```bash
npx serve .            # o
python -m http.server  # http://localhost:8000
```

En VS Code sirve *Live Server* (clic derecho sobre `index.html` → *Open with
Live Server*).

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
| `index.html`            | estructura, import map, capas (`z-index`) y el SVG del botón |
| `styles.css`            | tipografía, cortinas de revelado, menú, grano, *responsive*  |
| `src/main.js`           | ajustes, línea de tiempo, paso a menú, eventos               |
| `src/scene.js`          | render, cámara, luces de estudio, niebla blanca              |
| `src/origami.js`        | pliegue del avión (8 triángulos), papel, materiales          |
| `src/choreography.js`   | trayectorias, alabeo por curvatura, estelas, acompañantes    |
| `src/phrase.js`         | maquetación por palabras y su física al ser empujadas        |
| `src/utils.js`          | *easings*, ruido, amortiguación, aleatorio con semilla       |

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
