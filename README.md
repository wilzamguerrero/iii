# Intención

Una página en blanco. Entra un avión de papel en origami, se revela una frase,
el avión la barre y se viene contra la cámara; el golpe deja el menú.

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

## Los cuatro actos

| acto     | qué pasa                                                              |
|----------|-----------------------------------------------------------------------|
| `enter`  | el avión llega del fondo en una S descendente y cruza de lado         |
| `hover`  | se eleva y orbita mientras la frase se revela debajo                  |
| `attack` | cae, encara la línea de texto y la barre de izquierda a derecha       |
| `dive`   | sube, gira y viene contra la cámara hasta llenar el cuadro            |

Los dos últimos hitos no van por reloj sino por suceso: el fundido a blanco
salta cuando el avión entra de verdad en el objetivo (a 1,25 unidades de la
cámara), no a los *n* segundos. En un equipo lento la coreografía se alarga
sola en vez de descuadrarse.

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
la física del barrido se remide sola.

En `src/choreography.js`, `TIME` marca los tiempos en segundos (`enter`,
`reveal`, `attack`, `attackDur`, `diveDur`) y `HOVER`, `AMBIENT` y `COMPANIONS`
las órbitas.

## Parámetros de URL

| parámetro  | para qué                                                       |
|------------|----------------------------------------------------------------|
| `?intro=0` | directo al menú, sin intro                                     |
| `?seek=8.4`| adelanta la coreografía a ese segundo en pasos fijos de 1/60    |

`?seek` es para revisar un instante concreto sin esperarlo: avanza la
simulación con `dt` constante antes de arrancar el bucle real, así que el
mismo valor da siempre el mismo fotograma. Útil para capturas.

## Degradaciones

- **`prefers-reduced-motion`**: el avión entra y orbita, la frase se revela y
  se va sola. No hay barrido ni picado contra la cámara.
- **Sin WebGL**: no se monta la escena. Queda la frase y el menú, sólo
  tipografía.
- **Sin JavaScript**: la página se queda en blanco. Es una intro, no un
  documento.
