import { el, render } from "../dom.ts";
import { STRUCTURES, structureMarkdown } from "../../core/method/structures.ts";

/**
 * Las formas del reglamento, para poner los apartados de una vez.
 *
 * Un trabajo de grado no se entrega como uno quiera: la Universidad CESMAG dice qué
 * apartados lleva la idea, cuáles el anteproyecto y cuáles el informe final, y en
 * qué orden. Escribir esos títulos a mano es trabajo de copista y además se olvida
 * uno, así que se insertan; lo que va dentro lo escribe la persona, que es lo único
 * que no puede hacer nadie más.
 *
 * Se inserta **texto en el documento**, no una plantilla que la plataforma controle:
 * en cuanto está dentro es un apartado como cualquier otro, se renombra, se mueve y
 * se borra. Eso es también lo que permite que la revisión sepa contra qué revisar
 * sin guardar nada en ningún sitio —lo lee de la primera línea— y lo que hará que
 * otra universidad sólo tenga que traer su tabla a `structures.ts`.
 */

export interface StructuresOptions {
  /** El id de la estructura que el documento ya sigue, si sigue alguna. */
  already: () => string | null;
  onInsert: (markdown: string, name: string) => void;
}

export interface Structures {
  root: HTMLElement;
  button: HTMLButtonElement;
  toggle: () => void;
  close: () => void;
}

export function mountStructures(options: StructuresOptions): Structures {
  const body = el("div", { class: "pick__body" });

  const root = el("div", {
    class: "pick",
    attrs: { role: "dialog", "aria-label": "Estructuras", hidden: true },
  }, [
    el("div", { class: "pick__head" }, [
      el("span", { class: "pick__title", text: "Estructura del documento" }),
    ]),
    body,
  ]);

  const button = el("button", {
    class: "wr__act",
    text: "Estructura",
    attrs: { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" },
    on: { click: () => { toggle(); } },
  });

  function fill(): void {
    const has = options.already();

    render(body,
      el("p", { class: "pick__note", text:
        "Los apartados del Reglamento de Trabajo de Grado de la Universidad CESMAG. " +
        "Se escriben vacíos en el documento: lo que va dentro lo decides tú." }),
      ...STRUCTURES.map((one) => {
        const mine = has === one.id;
        return el("div", { class: `pick__one${mine ? " is-in" : ""}` }, [
          el("p", { class: "pick__name", text: one.name }),
          el("p", { class: "pick__when", text: one.when }),
          el("p", { class: "pick__src", text: one.source }),
          el("button", {
            class: "btn btn--quiet",
            text: mine ? "Ya está en el documento" : "Insertar apartados",
            attrs: { type: "button", ...(mine ? { disabled: true } : {}) },
            on: { click: () => {
              close();
              options.onInsert(structureMarkdown(one.id), one.name);
            } },
          }),
        ]);
      }),
    );
  }

  /**
   * Pulsar fuera la cierra. Lo hacen igual las ventanitas de la bandeja: una
   * ventanita que sólo se cierra con Escape se queda abierta tapando el texto,
   * porque nadie prueba Escape antes de volver a escribir.
   */
  function onDown(event: Event): void {
    const target = event.target;
    if (root.hidden || !(target instanceof Node)) return;
    if (root.contains(target) || button.contains(target)) return;
    close();
  }

  function toggle(): void {
    if (!root.hidden) { close(); return; }
    fill();
    root.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onDown, true);
    root.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDown, true);
  }

  return { root, button, toggle, close };
}
