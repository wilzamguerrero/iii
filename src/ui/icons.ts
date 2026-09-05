/**
 * Los trazos de la interfaz.
 *
 * Un solo sitio, por la misma razón que el avión tiene el suyo (`origami.ts`):
 * la carpeta que se ve en la franja y la que se vea mañana en el editor tienen
 * que ser la misma figura. Aquí no hay color ni grosor: los pone el CSS con
 * `currentColor` y `stroke-width`, para que un mismo trazo sirva a 16 px en la
 * bandeja y a 40 px en una baldosa.
 *
 * Sólo líneas rectas. Es lo que se puede dibujar con un pixel de trazo sin que
 * el navegador tenga que suavizar nada, y es la gramática del resto: la punta de
 * las migas y el hilo bajo las pestañas también son un borde de 1 px.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

interface Glyph {
  box: string;
  paths: readonly string[];
  /** Cerrado y relleno cuando la baldosa lo pida (una página abierta). */
  solid?: number;
}

const GLYPHS = {
  /** Una carpeta: cuerpo con la pestaña levantada a la izquierda. */
  folder: {
    box: "0 0 24 22",
    paths: ["M2.8 18.6 V5.4 H9.6 L11.5 7.8 H21.2 V18.6 Z"],
    solid: 0,
  },
  /** Un documento: hoja con la esquina doblada y dos renglones. */
  page: {
    box: "0 0 24 22",
    paths: [
      "M6.4 3.4 H14.6 L18.4 7.2 V19.8 H6.4 Z",
      "M14.6 3.4 V7.2 H18.4",
      "M9.2 11.4 H15.8",
      "M9.2 14.6 H13.6",
    ],
    solid: 0,
  },
  /** La cuenta: cabeza y hombros. Es el retrato de quien conectó su Notion. */
  person: {
    box: "0 0 24 24",
    paths: [
      "M12 4.6 A3.6 3.6 0 1 1 12 11.8 A3.6 3.6 0 1 1 12 4.6 Z",
      "M4.8 19.8 C4.8 15.9 8 14 12 14 C16 14 19.2 15.9 19.2 19.8",
    ],
  },
  /** Los ajustes del sistema: tres reguladores con su tirador. */
  sliders: {
    box: "0 0 24 24",
    paths: [
      "M3.4 7.6 H20.6", "M9.2 5.6 V9.6",
      "M3.4 12 H20.6", "M15 10 V14",
      "M3.4 16.4 H20.6", "M7 14.4 V18.4",
    ],
  },
  /** Otra pestaña. */
  plus: { box: "0 0 24 24", paths: ["M12 6.4 V17.6", "M6.4 12 H17.6"] },
  /** Cerrar: la pestaña, la ventanita. */
  cross: { box: "0 0 24 24", paths: ["M7.2 7.2 L16.8 16.8", "M16.8 7.2 L7.2 16.8"] },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

export function icon(name: IconName, className = "ico"): SVGSVGElement {
  const glyph: Glyph = GLYPHS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", glyph.box);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  glyph.paths.forEach((d, index) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    // El primer trazo de carpeta y página es el contorno: es el que se rellena
    // cuando la baldosa está abierta, y por eso se marca.
    if (glyph.solid === index) path.setAttribute("class", "ico__body");
    svg.append(path);
  });

  return svg;
}
