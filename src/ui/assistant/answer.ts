import { el } from "../dom.ts";
import { renderMarkdown } from "../writer/markdown.ts";

/**
 * La respuesta del asistente, compuesta y con acciones.
 *
 * Antes la respuesta era texto plano y quedaba ahí: para hacer algo con ella
 * había que copiarla a mano. Ahora se compone como el modo lectura —mismo
 * traductor, `markdown.ts`, una sola gramática en la plataforma— y trae
 * acciones: **Copiar** al portapapeles y, con un documento abierto, **Añadir
 * al documento**, que lo pega donde esté el cursor.
 *
 * Son las dos cosas que se hacen de verdad con una respuesta útil, y ninguna
 * reemplaza nada del documento: añadir pega al final de donde esté el cursor
 * y quien decide qué queda es quien escribe.
 */

/** Qué pasa con el texto cuando se pide añadirlo al documento. */
export type AddToDocument = (text: string) => void;

/** El que acaba de llegando tiene acciones; los viejos también, cuando se repintan. */
let adder: AddToDocument | null = null;

/** El documento abierto: quién recibe lo que se añada. Se pone el editor. */
export function setAddTarget(add: AddToDocument | null): void {
  adder = add;
}

/** El turno de la respuesta, ya compuesto. */
export function answerTurn(text: string): HTMLElement {
  const blocks = renderMarkdown(text);

  const body = el("div", { class: "ai-md" }, blocks.length > 0 ? blocks : [text]);

  const acts = el("div", { class: "ai-turn__acts" }, [
    el("button", {
      class: "lnkbtn",
      text: "Copiar",
      attrs: { type: "button" },
      on: { click: () => { void navigator.clipboard.writeText(text); } },
    }),
    el("button", {
      class: "lnkbtn",
      text: "Añadir al documento",
      attrs: { type: "button" },
      on: { click: () => { if (adder) adder(cleanOf(text)); } },
    }),
  ]);

  return el("div", { class: "ai-turn ai-turn--answer" }, [body, acts]);
}

/** El texto que se añade: sin las marcas de id de bloque, si las llevara. */
function cleanOf(text: string): string {
  return text.split("\n").map((line) =>
    line.replace(/<!--b:[a-f0-9-]+-->\s*$/, "").trimEnd(),
  ).join("\n");
}
