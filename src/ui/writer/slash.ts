import { el } from "../dom.ts";
import { icon } from "../icons.ts";

/**
 * El menú «/»: qué bloque poner, como en Notion.
 *
 * En un editor visual, la tecla «/» al empezar un bloque vacío es el gesto
 * que ya conoce cualquiera que haya escrito en Notion: aparecen los bloques
 * que se pueden poner y se elige uno. Aquí está, con lo que un documento de
 * la plataforma usa de verdad —títulos, listas, cita, separador, código e
 * imagen— y nada más: un menú con veinte opciones no se lee, se escanea, y
 * escanear es lo que se hace cuando no se encuentra lo que se busca.
 *
 * Se elige con Enter o clic, se recorre con las flechas, se cierra con
 * Escape o escribiendo otro carácter. No busca por texto: con ocho opciones
 * las flechas son más rápidas que escribir el nombre.
 *
 * El bloque elegido entra donde estaba el cursor —el bloque vacío que
 * tenía puesta la «/»— y el cursor queda dentro, listo para escribir el
 * título o la cita que se acababa de decidir.
 */

/** Lo que se puede poner, y cómo se llama en el editor. */
export interface SlashOption {
  id: string;
  label: string;
  hint: string;
  /** Dibuja la figura del bloque en el menú. */
  draw: () => Node[];
}

export const OPTIONS: readonly SlashOption[] = [
  {
    id: "h1",
    label: "Título",
    hint: "El del documento, uno por página",
    draw: () => glyph("T", true),
  },
  {
    id: "h2",
    label: "Apartado",
    hint: "Un apartado del documento",
    draw: () => glyph("H2", true),
  },
  {
    id: "h3",
    label: "Subapartado",
    hint: "Dentro de un apartado",
    draw: () => glyph("H3", false),
  },
  {
    id: "p",
    label: "Texto",
    hint: "Un párrafo normal",
    draw: () => glyph("¶", false),
  },
  {
    id: "bullet",
    label: "Lista",
    hint: "Puntos, uno por línea",
    draw: () => [icon("page", "ico ico--small")],
  },
  {
    id: "number",
    label: "Lista numerada",
    hint: "Pasos que van en orden",
    draw: () => glyph("1.", false),
  },
  {
    id: "quote",
    label: "Cita",
    hint: "Palabra de otro, o la línea de la estructura",
    draw: () => glyph("❝", false),
  },
  {
    id: "divider",
    label: "Separador",
    hint: "Una línea que corta el documento",
    draw: () => glyph("—", false),
  },
  {
    id: "code",
    label: "Código",
    hint: "Un trozo tal cual, sin componer",
    draw: () => glyph("</>", false),
  },
  {
    id: "image",
    label: "Imagen",
    hint: "Por su dirección https",
    draw: () => [icon("page", "ico ico--small")],
  },
  {
    id: "attachment",
    label: "Archivo",
    hint: "De tu equipo; pesados, hasta 5 GB",
    draw: () => [icon("page", "ico ico--small")],
  },
];

/** Una figura del menú: texto corto, tamaño según jerarquía. */
function glyph(text: string, big: boolean): Node[] {
  return [el("span", { class: `sl__glyph${big ? " sl__glyph--big" : ""}`, text })];
}

export interface Slash {
  root: HTMLElement;
  /** Abre donde se pidió. El teclado pasa a ser suyo. */
  open(at: { x: number; y: number }): void;
  close(): void;
  /** Se eligió un bloque. Devuelve su id. */
  onPick(run: (id: string) => void): void;
  /** El editor se entera del cierre: el teclado vuelve a ser del documento. */
  onClose(run: () => void): void;
}

export function mountSlash(): Slash {
  const items = OPTIONS.map((option) => el("button", {
    class: "sl__one",
    attrs: { type: "button", role: "menuitem", "data-id": option.id },
  }, [
    el("span", { class: "sl__figure" }, option.draw()),
    el("span", { class: "sl__txt" }, [
      el("span", { class: "sl__label", text: option.label }),
      el("span", { class: "sl__hint", text: option.hint }),
    ]),
  ]));

  const root = el("div", {
    class: "sl",
    attrs: { role: "menu", "aria-label": "Insertar un bloque", hidden: true },
  }, items);

  document.body.append(root);

  let picked: ((id: string) => void) | null = null;

  function move(step: number): void {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".sl__one")];
    const at = buttons.findIndex((b) => b === document.activeElement);
    const next = (at + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function close(): void {
    root.hidden = true;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
    closeSlash?.();
  }

  let closeSlash: (() => void) | null = null;

  /** El editor se entera de que el menú ya no está: le devuelve el teclado. */
  function onClose(run: () => void): void {
    closeSlash = run;
  }

  const outside = (event: Event): void => {
    if (event.target instanceof Node && root.contains(event.target)) return;
    close();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (root.hidden) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      move(-1);
      return;
    }
  };

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const button = event.target instanceof HTMLButtonElement ? event.target : null;
    const id = button?.dataset.id ?? "";
    close();
    if (id && picked) picked(id);
  });

  for (const button of items) {
    button.addEventListener("click", () => {
      const id = button.dataset.id ?? "";
      close();
      if (id && picked) picked(id);
    });
  }

  function open(at: { x: number; y: number }): void {
    root.hidden = false;

    const box = root.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8));
    let top = at.y;
    if (top + box.height > window.innerHeight - 8) {
      top = Math.max(8, at.y - box.height - 30);
    }
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;

    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey, true);
    items[0]?.focus();
  }

  return { root, open, close, onPick: (run) => { picked = run; }, onClose };
}
