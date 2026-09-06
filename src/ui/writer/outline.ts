import { el, render } from "../dom.ts";
import { headingsOf } from "./markdown.ts";

/**
 * El índice del documento, a la izquierda.
 *
 * Esto es «el espacio para leer las estructuras de los archivos» que se pidió: la
 * estructura de un proyecto no se entiende leyendo veinte páginas seguidas, se
 * entiende de un vistazo viendo sus apartados y qué falta entre ellos. Aquí están,
 * sacados del propio documento: los títulos de Markdown *son* la estructura, así
 * que no hay nada que mantener en paralelo ni que se pueda desincronizar.
 *
 * Se pinta igual en los dos modos —escribiendo y leyendo— porque la pregunta que
 * responde es la misma, y pulsar un apartado lleva hasta él en el que esté activo.
 * El nivel se ve por la sangría y por el tamaño; no se numera, porque la
 * numeración de los reglamentos ya viene escrita en el título.
 */

export interface OutlineOptions {
  /** Llevar al documento hasta esa línea. */
  onPick: (line: number) => void;
}

export interface Outline {
  root: HTMLElement;
  /** Vuelve a leer los títulos del texto. */
  set(text: string): void;
  /** Marca el apartado donde se está, por la línea que se esté mirando. */
  mark(line: number): void;
}

export function mountOutline(options: OutlineOptions): Outline {
  const list = el("div", { class: "out__list" });
  const root = el("nav", {
    class: "out",
    attrs: { "aria-label": "Apartados del documento" },
  }, [
    el("p", { class: "out__title", text: "Apartados" }),
    list,
  ]);

  /** Las líneas de cada título, en el mismo orden que los botones. */
  let lines: number[] = [];

  function set(text: string): void {
    const headings = headingsOf(text);
    lines = headings.map((heading) => heading.line);

    if (headings.length === 0) {
      render(list, el("p", {
        class: "out__none",
        text: "Todavía sin apartados. Un título de Markdown —«## Antecedentes»— es un " +
          "apartado, y «Estructura» pone los del reglamento de una vez.",
      }));
      return;
    }

    render(list, ...headings.map((heading) => el("button", {
      class: `out__h out__h${heading.level}`,
      text: heading.text,
      attrs: { type: "button", "data-line": String(heading.line), "aria-current": "false" },
      on: { click: () => { options.onPick(heading.line); } },
    })));
  }

  /**
   * El apartado donde se está es el último título que quedó por encima de la línea
   * que se mira. Se compara por posición y no por texto porque dos apartados pueden
   * llamarse igual —«Antecedentes» en dos capítulos— y el que se está mirando es
   * uno de los dos.
   */
  function mark(line: number): void {
    let best = -1;
    for (const [index, at] of lines.entries()) {
      if (at <= line) best = index;
      else break;
    }

    for (const [index, button] of [...list.querySelectorAll<HTMLElement>(".out__h")].entries()) {
      const on = index === best;
      button.setAttribute("aria-current", on ? "true" : "false");
      if (on) button.scrollIntoView({ block: "nearest" });
    }
  }

  return { root, set, mark };
}
