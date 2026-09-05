/**
 * La forma del papel.
 *
 * Es el mismo avión de cinco caras del botón de enviar. Vive aquí porque ya no
 * lo usa un solo botón: también es el asa del asistente, y la instrucción es que
 * la figura evolucione con lo que la plataforma vaya necesitando. Un solo sitio
 * donde cambiarla.
 *
 * La copia inline de `index.html` se queda: es el primer pintado de la intro y
 * no debe depender de que un módulo haya evaluado. Si se toca una, se toca la
 * otra —hay un comentario en el HTML que lo dice.
 *
 * Los grises los pone `intro.css` (`.ori__f1`…`.ori__f5`): cada cara es un
 * pliegue con otra incidencia de luz, y el color no se repite aquí para que el
 * papel no tenga dos fuentes de verdad.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Las cinco caras, en el orden en que se pliegan. */
export const ORIGAMI_FACES: readonly string[] = [
  "M22 3 L38.5 26 L22 20.5 Z",
  "M22 3 L22 20.5 L6.5 30 Z",
  "M22 20.5 L38.5 26 L27.5 41 Z",
  "M22 20.5 L27.5 41 L14 36 Z",
  "M22 20.5 L14 36 L6.5 30 Z",
];

/**
 * Devuelve el avión como SVG suelto. `className` va al `<svg>`; dentro, la
 * estructura es la que esperan las animaciones de `intro.css`: un `<g class="ori">`
 * con una cara por `path`.
 */
export function origamiSvg(className = "send__ori"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 44 44");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "ori");

  ORIGAMI_FACES.forEach((d, index) => {
    const face = document.createElementNS(SVG_NS, "path");
    face.setAttribute("class", `ori__f ori__f${index + 1}`);
    face.setAttribute("d", d);
    group.append(face);
  });

  svg.append(group);
  return svg;
}
