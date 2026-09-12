import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";

/**
 * El globo donde la IA propone algo para el documento.
 *
 * Es la costura por la que pasa todo lo que el modelo quiere meter dentro del
 * texto, y existe para que nada entre sin que alguien lo lea. Tiene tres
 * estados —pensando, propuesta, no se pudo— y una sola regla de fondo: lo que
 * se inserta es lo que hay en el campo cuando se pulsa el botón, y el campo es
 * editable. Así el borrador es un borrador de verdad: se corrige aquí, antes de
 * tocar el documento, y lo que queda escrito es lo que la persona aprobó.
 *
 * Se abre junto al bloque del que salió —la pregunta, el apartado— porque una
 * propuesta lejos de su sitio obliga a recordar de qué hablaba. Se recoloca al
 * desplazar la hoja en vez de cerrarse: leer una propuesta larga es mover el
 * texto de al lado para comparar.
 *
 * Sólo hay uno abierto a la vez, como el menú de la franja: dos propuestas a la
 * vez son dos textos compitiendo por el mismo hueco del documento.
 */

export interface ProposalAsk {
  /** El bloque del que salió: de ahí cuelga el globo. */
  near: Element;
  /** Qué se está proponiendo. */
  title: string;
  /** Lo que dirá el botón que lo mete en el documento. */
  verb?: string;
  /** Lo propuesto, en el Markdown con el que va a entrar. */
  body: string;
  /** Lo que el modelo dice que falta. Se lee; no entra en el documento. */
  notes?: readonly string[];
  /** Cómo se llama esa lista. */
  notesTitle?: string;
  /** Una línea de contexto encima del campo. */
  why?: string;
  /**
   * La propuesta se lee y no se edita.
   *
   * Es para lo que no entra por un solo sitio —la salida de Indagar reparte
   * siete respuestas debajo de sus siete preguntas—: dejar editar aquí sería
   * mentir, porque no habría manera de saber qué trozo del campo va a cada
   * hueco. Se corrige después, en el documento, que es donde vive cada una.
   */
  readOnly?: boolean;
  onInsert: (markdown: string) => void;
  onRedo?: () => void;
  /** Llevarlo al asistente, para discutirlo en vez de aceptarlo. */
  onAsk?: (question: string) => void;
}

interface Live {
  root: HTMLElement;
  near: Element;
  giveBack: HTMLElement | null;
  off: () => void;
}

const MARGIN = 10;
const WIDTH = 420;

let live: Live | null = null;

export function proposalOpen(): boolean {
  return live !== null;
}

export function closeProposal(giveFocus = true): void {
  if (!live) return;
  const { root, giveBack, off } = live;
  live = null;
  off();
  root.remove();
  if (giveFocus && giveBack?.isConnected) giveBack.focus();
}

/** El globo pensando: se abre al pedir y se reemplaza cuando llega la respuesta. */
export function busyProposal(near: Element, title: string, say = "Leyendo el documento…"): void {
  shell(near, title, [
    el("p", { class: "prop__busy" }, [el("span", { class: "prop__dot" }), say]),
  ]);
}

/** El globo con el fallo, y la manera de volver a intentarlo. */
export function failProposal(
  near: Element,
  title: string,
  why: string,
  onRedo?: () => void,
): void {
  shell(near, title, [
    el("p", { class: "prop__bad", text: why }),
    el("div", { class: "prop__acts" }, [
      ...(onRedo
        ? [el("button", {
            class: "btn btn--quiet",
            text: "Volver a intentarlo",
            attrs: { type: "button" },
            on: { click: () => { closeProposal(false); onRedo(); } },
          })]
        : []),
      el("button", {
        class: "lnkbtn",
        text: "Cerrar",
        attrs: { type: "button" },
        on: { click: () => { closeProposal(); } },
      }),
    ]),
  ]);
}

/** El globo con la propuesta dentro, editable. */
export function openProposal(one: ProposalAsk): void {
  const field = el("textarea", {
    class: "prop__field",
    attrs: {
      rows: Math.min(14, Math.max(3, one.body.split("\n").length + 1)),
      spellcheck: "true",
      "aria-label": one.title,
    },
  });
  field.value = one.body;
  if (one.readOnly) field.readOnly = true;

  const insert = el("button", {
    class: "btn",
    text: one.verb ?? "Insertar en el documento",
    attrs: { type: "button" },
    on: {
      click: () => {
        const clean = field.value.trim();
        if (!clean) return;
        closeProposal(false);
        one.onInsert(clean);
      },
    },
  });

  const acts: HTMLElement[] = [insert];
  if (one.onRedo) {
    acts.push(el("button", {
      class: "btn btn--quiet",
      text: "Rehacer",
      attrs: { type: "button", title: "Pedir otra versión" },
      on: { click: () => { closeProposal(false); one.onRedo?.(); } },
    }));
  }
  if (one.onAsk) {
    acts.push(el("button", {
      class: "lnkbtn",
      text: "Discutirlo",
      attrs: { type: "button", title: "Llevarlo al asistente en vez de aceptarlo" },
      on: {
        click: () => {
          const said = field.value.trim();
          closeProposal(false);
          one.onAsk?.(said);
        },
      },
    }));
  }
  acts.push(el("button", {
    class: "lnkbtn",
    text: "Descartar",
    attrs: { type: "button" },
    on: { click: () => { closeProposal(); } },
  }));

  const kids: HTMLElement[] = [];
  if (one.why) kids.push(el("p", { class: "prop__why", text: one.why }));
  kids.push(field);
  kids.push(el("p", { class: "prop__mine", text: one.readOnly
    ? "Cada respuesta se pone debajo de su pregunta; ahí las corriges."
    : "Corrige lo que quieras antes de insertarlo: entra tal como quede aquí." }));

  const notes = (one.notes ?? []).filter((note) => note.trim());
  if (notes.length > 0) {
    kids.push(el("div", { class: "prop__gaps" }, [
      el("span", { class: "prop__gaps__title", text: one.notesTitle ?? "Falta averiguar" }),
      el("ul", { class: "prop__gaps__list" }, notes.map(
        (note) => el("li", { text: note }),
      )),
    ]));
  }

  kids.push(el("div", { class: "prop__acts" }, acts));
  shell(one.near, one.title, kids);
  field.focus();
  field.setSelectionRange(0, 0);
}

/* --- las tripas ----------------------------------------------------------- */

/**
 * El marco: título, cierre y lo que traiga dentro.
 *
 * Los tres estados lo comparten, y por eso pasar de «pensando» a la propuesta
 * no mueve el globo de sitio ni lo cierra y vuelve a abrir: cambia lo de
 * dentro, que es lo único que cambió.
 */
function shell(near: Element, title: string, kids: readonly HTMLElement[]): void {
  const already = live;
  if (already && already.near === near) {
    const body = already.root.querySelector(".prop__body");
    const head = already.root.querySelector(".prop__title");
    if (body instanceof HTMLElement && head instanceof HTMLElement) {
      head.textContent = title;
      render(body, ...kids);
      place(already.root, near);
      return;
    }
  }

  closeProposal(false);

  const giveBack = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const body = el("div", { class: "prop__body" }, kids);
  const root = el("div", {
    class: "prop",
    attrs: { role: "dialog", "aria-label": title },
  }, [
    el("div", { class: "prop__head" }, [
      icon("spark", "ico ico--small"),
      el("span", { class: "prop__title", text: title }),
      el("button", {
        class: "prop__x",
        attrs: { type: "button", "aria-label": "Cerrar la propuesta" },
        on: { click: () => { closeProposal(); } },
      }, [icon("cross", "ico ico--small")]),
    ]),
    body,
  ]);

  document.body.append(root);
  place(root, near);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeProposal();
      return;
    }
    // Meterlo con el teclado: es el gesto que se repite, y llegar al botón con
    // el tabulador desde un campo de varias líneas es incómodo.
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      const insert = root.querySelector(".prop__acts .btn");
      if (insert instanceof HTMLButtonElement) insert.click();
    }
  };

  // Recolocar y no cerrar: comparar la propuesta con el texto de al lado pide
  // mover la hoja, y un globo que se cierra al desplazar no se deja leer.
  const moved = (): void => {
    if (!live) return;
    if (!near.isConnected) { closeProposal(false); return; }
    place(root, near);
  };

  root.addEventListener("keydown", onKey);
  window.addEventListener("resize", moved);
  document.addEventListener("scroll", moved, true);

  live = {
    root,
    near,
    giveBack,
    off: () => {
      window.removeEventListener("resize", moved);
      document.removeEventListener("scroll", moved, true);
    },
  };
}

/** Junto al bloque: debajo si cabe, encima si no, y dentro de la ventana. */
function place(root: HTMLElement, near: Element): void {
  const anchor = near.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  const width = box.width || WIDTH;

  let top = anchor.bottom + 6;
  if (top + box.height + MARGIN > window.innerHeight) {
    const above = anchor.top - box.height - 6;
    top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - box.height - MARGIN);
  }

  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, window.innerWidth - width - MARGIN),
  );

  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;
  root.classList.add("is-in");
}
