import { el } from "../dom.ts";
import { icon, type IconName } from "../icons.ts";
import {
  activeProvider, hasCredential, providerLabel,
} from "../../core/ai/config.ts";
import { askStep, draftAnswer, synthesize } from "../../core/ai/inquire.ts";
import { COMMON, SITUATED_HEAD, SYNTHESIS_HEAD, flat } from "../../core/method/indagar.ts";
import { asksOf, type Route, type RouteAsk, type RouteStep } from "../../core/method/route.ts";
import { busyProposal, closeProposal, failProposal, openProposal } from "./propose.ts";
import type { Visual } from "./visual.ts";

/**
 * Las preguntas dentro del documento.
 *
 * Esto es lo que se pidió: que la plataforma pregunte **en el documento** y que
 * responder sea escribir debajo, con la IA echando una mano si se le pide y sin
 * que nada entre sin pasar por delante de quien escribe. Antes las preguntas
 * estaban a un lado y el documento era una hoja en blanco; ahora la ruta de
 * Indagar viene escrita dentro —`indagar.ts` la pone— y lo único que falta es
 * poder obrar sobre ella sin salir del texto. De eso va este módulo.
 *
 * Cada pregunta de la ruta recibe dos iconos pegados a su cita: responder
 * —lleva el cursor al hueco de debajo, creándolo si no está— y que la IA lo
 * intente, que redacta un borrador con lo que el documento ya dice y lo ofrece
 * en un globo antes de tocar nada. Cada título de paso recibe el suyo: pedirle
 * preguntas de este proyecto, abrir el mapa donde está la bifurcación, cerrar
 * la fase donde está la salida.
 *
 * Los mandos no son texto del documento y no pueden viajar a Notion, así que
 * son nodos con `data-widget` y el `contenteditable` apagado, y `visual.ts` los
 * quita al leer el Markdown. Tampoco llevan letras dentro —sólo iconos y un
 * `title`—, de modo que ni siquiera una selección que los abarque puede
 * arrastrarlos al texto que se manda al modelo.
 *
 * Se repintan enteros en cada cambio y se reconocen por el texto de la cita,
 * no por una posición guardada. Suena a fuerza bruta y es al revés: un
 * documento que se edita en Notion desde el teléfono vuelve con otras líneas y
 * otros ids, y lo único que sigue siendo verdad es lo que la pregunta dice. Así
 * un mando borrado sin querer vuelve solo en el siguiente repintado.
 */

export interface AsksOptions {
  visual: Visual;
  /** La ruta tal como está el documento ahora. */
  route: () => Route;
  /** El documento entero, para los encargos al modelo. */
  content: () => string;
  intent: () => string | null;
  /** Algo entró en el documento: que se cuente y se guarde. */
  changed: () => void;
  /** Abrir el mapa de rutas. */
  onMap: () => void;
  /** Llevar algo al asistente. */
  onAsk: (question: string) => void;
}

export interface Asks {
  /** Vuelve a colgar los mandos donde toca. Barato: se llama en cada edición. */
  paint: () => void;
  clear: () => void;
  /** Pedirle preguntas para un paso, como pulsando en su título. */
  askFor: (stepId: string) => void;
  /** Redactar el borrador de una pregunta. */
  draft: (ask: RouteAsk) => void;
  /** Cerrar la fase: la síntesis y la intención situada. */
  closeOut: () => void;
  /** Llevar la hoja hasta una pregunta y abrir su hueco. */
  goTo: (ask: RouteAsk) => void;
  /** Llevar la hoja hasta el título de un paso. */
  goToStep: (step: RouteStep) => void;
}

/** Lo que corta un apartado: el título siguiente. */
const HEADS = new Set(["H2", "H3", "H4"]);
/** Los bloques que pueden ser respuesta de una pregunta. */
const PROSE = new Set(["P", "UL", "OL", "FIGURE", "PRE"]);

export function mountAsks(options: AsksOptions): Asks {
  const { visual } = options;

  /** Dónde quedó cada pregunta en la última pintada. */
  let placed: { ask: RouteAsk; block: HTMLElement }[] = [];
  let running: AbortController | null = null;

  /* --- colgar los mandos ------------------------------------------------- */

  function paint(): void {
    const route = options.route();
    const blocks = visual.blocks();

    // Un documento que no es de Indagar no tiene ruta que atender: se limpian
    // los mandos que pudieran quedar de otro y se sale. Es lo que pasa al
    // cambiar de documento sin cerrar la hoja.
    if (route.questions.length === 0) {
      strip(blocks);
      placed = [];
      return;
    }

    placed = [];
    const pending = [...route.questions];

    for (const block of blocks) {
      if (block.tagName === "BLOCKQUOTE") {
        const said = flat(visual.plain(block));
        const index = pending.findIndex((one) => flat(one.question) === said);
        if (index < 0) { drop(block); continue; }
        const ask = pending.splice(index, 1)[0];
        if (!ask) continue;
        placed.push({ ask, block });
        askWidget(block, ask);
        continue;
      }
      if (HEADS.has(block.tagName)) {
        const said = flat(visual.plain(block));
        const step = route.steps.find((one) => flat(one.head) === said) ?? null;
        if (!step) { drop(block); continue; }
        stepWidget(block, step, route);
        continue;
      }
      drop(block);
    }
  }

  function clear(): void {
    strip(visual.blocks());
    placed = [];
    running?.abort();
    running = null;
  }

  /** Los mandos de todos los bloques, fuera. */
  function strip(blocks: readonly HTMLElement[]): void {
    for (const block of blocks) drop(block);
  }

  function drop(block: HTMLElement): void {
    for (const one of [...block.querySelectorAll("[data-widget]")]) one.remove();
    block.removeAttribute("data-ask");
    block.removeAttribute("data-step");
  }

  /**
   * El mando de una pregunta.
   *
   * Se reconstruye sólo si el estado cambió. No es una optimización: cada vez
   * que se reemplaza un nodo dentro del `contenteditable` el navegador puede
   * mover el cursor, y esto se repinta con cada tecla. Si el estado es el
   * mismo, no se toca nada y el cursor se queda donde está.
   */
  function askWidget(block: HTMLElement, ask: RouteAsk): void {
    const state = ask.answered ? "done" : "open";
    if (block.getAttribute("data-ask") === state) return;
    drop(block);
    block.setAttribute("data-ask", state);

    block.append(el("span", {
      class: "ask",
      attrs: { "data-widget": "", contenteditable: "false" },
    }, [
      mando(
        ask.answered ? "check" : "askhere",
        ask.answered ? "Respondida. Pulsa para seguir escribiendo." : "Responder aquí",
        () => { open(block); },
        ask.answered ? "ask__b ask__b--done" : "ask__b",
      ),
      mando("spark", "Que la IA redacte un borrador con lo que ya hay escrito", () => {
        draft(ask);
      }, "ask__b ask__b--ai"),
    ]));
  }

  /**
   * El mando de un título de paso.
   *
   * Cambia según dónde esté el paso, porque lo que se puede pedir cambia: en
   * los pasos se piden preguntas de este proyecto; en el diagnóstico se abre el
   * mapa, que es donde se elige la ruta; en la salida se cierra la fase.
   */
  function stepWidget(block: HTMLElement, step: RouteStep, route: Route): void {
    const state = `${step.id}:${step.done ? "done" : "open"}:${route.nature?.id ?? "-"}`;
    if (block.getAttribute("data-step") === state) return;
    drop(block);
    block.setAttribute("data-step", state);
    if (step.done) block.setAttribute("data-ask", "done");

    const kids: HTMLElement[] = [];

    if (step.part === "salida") {
      kids.push(mando("doneAll", "Proponer la salida de Indagar con lo indagado", () => {
        closeOut();
      }, "ask__b ask__b--ai"));
    } else {
      kids.push(mando("ask", "Pedirle preguntas de este proyecto para este paso", () => {
        askFor(step.id);
      }, "ask__b ask__b--ai"));
    }

    if (step.id === "diagnostico") {
      kids.push(mando(
        "hub",
        route.nature
          ? `Ruta tomada: ${route.nature.name}. Ver el mapa o cambiarla.`
          : "Abrir el mapa: aquí se bifurca la ruta",
        () => { options.onMap(); },
        route.nature ? "ask__b ask__b--map" : "ask__b ask__b--map is-due",
      ));
    }

    block.append(el("span", {
      class: "ask ask--step",
      attrs: { "data-widget": "", contenteditable: "false" },
    }, kids));
  }

  /** Un icono que hace algo. Sin letras dentro: el texto vive en el `title`. */
  function mando(
    glyph: IconName,
    title: string,
    run: () => void,
    className: string,
  ): HTMLElement {
    return el("button", {
      class: className,
      attrs: { type: "button", title, "aria-label": title, tabindex: "-1" },
      on: {
        mousedown: (event) => { event.preventDefault(); },
        click: (event) => { event.preventDefault(); event.stopPropagation(); run(); },
      },
    }, [icon(glyph, "ico ico--twist")]);
  }

  /* --- responder a mano -------------------------------------------------- */

  /**
   * El hueco de debajo de una pregunta, con el cursor dentro.
   *
   * Si ya hay algo escrito, el cursor va al final de lo escrito: seguir una
   * respuesta es lo normal. Si no hay nada, se abre un párrafo vacío pegado a
   * la pregunta, que es la forma que tiene el documento de decir «aquí».
   */
  function open(block: HTMLElement): void {
    const next = block.nextElementSibling;
    if (next instanceof HTMLElement && PROSE.has(next.tagName)) {
      visual.focusOn(next);
      return;
    }
    visual.insertAfterBlock(block, "");
    options.changed();
  }

  function goTo(ask: RouteAsk): void {
    const found = placed.find((one) => flat(one.ask.question) === flat(ask.question));
    if (!found) return;
    flash(found.block);
    open(found.block);
  }

  /**
   * Hasta el título de un paso, sin abrir hueco.
   *
   * Un paso no es una pregunta: debajo de su título va la línea de entrada que
   * puso la plataforma, y meter ahí un párrafo vacío partiría el apartado por
   * donde no toca. Se lleva la vista y se deja el cursor donde estaba.
   */
  function goToStep(step: RouteStep): void {
    const block = headBlock(step);
    if (block) flash(block);
  }

  /** Que se vea a dónde llevó el salto. */
  function flash(block: HTMLElement): void {
    block.scrollIntoView({ block: "center", behavior: "smooth" });
    block.classList.add("is-found");
    setTimeout(() => { block.classList.remove("is-found"); }, 1600);
  }

  /* --- lo que pide la IA -------------------------------------------------- */

  /** Sin credencial no se pide nada, y se dice dónde se pone. */
  function ready(near: Element, title: string): boolean {
    const provider = activeProvider();
    if (hasCredential(provider)) return true;
    failProposal(near, title,
      `Para esto hace falta la credencial de ${providerLabel(provider)}. ` +
      "Se pone en la bandeja de la franja, en «IA».");
    return false;
  }

  /** Cada petición cancela la anterior: dos borradores a la vez no caben. */
  function fresh(): AbortController {
    running?.abort();
    const controller = new AbortController();
    running = controller;
    return controller;
  }

  function draft(ask: RouteAsk): void {
    const found = placed.find((one) => flat(one.ask.question) === flat(ask.question));
    const block = found?.block;
    if (!block) return;

    const title = "Borrador de respuesta";
    if (!ready(block, title)) return;
    const controller = fresh();
    busyProposal(block, title, "Leyendo lo que ya dice el documento…");

    void draftAnswer({
      question: ask.question,
      head: ask.head,
      content: options.content(),
      intent: options.intent(),
      signal: controller.signal,
    }).then((made) => {
      if (controller.signal.aborted) return;
      openProposal({
        near: block,
        title,
        body: made.answer,
        notes: made.gaps,
        notesTitle: "Esto no está en el documento",
        why: `Para: ${ask.question}`,
        verb: "Poner debajo de la pregunta",
        onInsert: (text) => {
          visual.insertAfterBlock(tailOf(block), text);
          options.changed();
        },
        onRedo: () => { draft(ask); },
        onAsk: (said) => {
          options.onAsk(
            `Estoy respondiendo esta pregunta de mi documento: «${ask.question}».\n\n` +
            `Este es el borrador que tengo:\n«${said}»\n\n` +
            "¿Qué le falta para sostenerse, y qué tendría que averiguar yo?",
          );
        },
      });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      failProposal(block, title, why(cause, "No se pudo redactar el borrador."), () => {
        draft(ask);
      });
    });
  }

  function askFor(stepId: string): void {
    const route = options.route();
    const step = route.steps.find((one) => one.id === stepId);
    const block = step ? headBlock(step) : null;
    if (!step || !block) return;

    const title = "Preguntas para este paso";
    if (!ready(block, title)) return;
    const controller = fresh();
    busyProposal(block, title, "Buscando qué falta preguntar de este proyecto…");

    const common = COMMON.find((one) => one.id === stepId);
    void askStep({
      step: {
        head: step.head,
        action: common?.action ?? step.name.toLocaleLowerCase("es"),
        output: step.says,
        already: asksOf(route, step.id).map((one) => one.question),
      },
      content: options.content(),
      intent: options.intent(),
      nature: route.nature?.name ?? null,
      signal: controller.signal,
    }).then((questions) => {
      if (controller.signal.aborted) return;
      if (questions.length === 0) {
        failProposal(block, title,
          "El modelo no encontró nada más que preguntar aquí con lo que hay escrito. " +
          "Escribe un poco más y vuelve a pedirlo.");
        return;
      }
      openProposal({
        near: block,
        title,
        body: questions.map((one) => `> ${one}`).join("\n\n"),
        why: `En: ${step.head}`,
        verb: "Añadir al paso",
        onInsert: (text) => {
          visual.insertAfterBlock(lastOf(block), text);
          options.changed();
        },
        onRedo: () => { askFor(stepId); },
      });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      failProposal(block, title, why(cause, "No se pudieron pedir las preguntas."), () => {
        askFor(stepId);
      });
    });
  }

  /**
   * La salida de Indagar: los siete puntos y la intención situada.
   *
   * Ésta es la única que no entra por un solo sitio: cada punto va debajo de su
   * pregunta, que ya está escrita en el documento. Por eso el globo muestra el
   * conjunto para leerlo y no para editarlo —una vez repartido, cada respuesta
   * se corrige donde vive, que es lo que hace la persona con todo lo demás—.
   */
  function closeOut(): void {
    const route = options.route();
    const synth = route.steps.find((one) => one.id === "sintesis");
    const block = synth ? headBlock(synth) : null;
    if (!block) return;

    const title = "Salida de Indagar";
    if (!ready(block, title)) return;
    const controller = fresh();
    busyProposal(block, title, "Reuniendo lo indagado…");

    void synthesize({
      content: options.content(),
      intent: options.intent(),
      nature: route.nature?.name ?? null,
      signal: controller.signal,
    }).then((made) => {
      if (controller.signal.aborted) return;
      const preview = [
        ...made.points.map((one) => `${one.question}\n${one.answer || "(sin responder)"}`),
        made.situated ? `${SITUATED_HEAD}\n${made.situated}` : "",
      ].filter(Boolean).join("\n\n");

      openProposal({
        near: block,
        title,
        body: preview,
        readOnly: true,
        why: `${SYNTHESIS_HEAD} · ${SITUATED_HEAD}`,
        verb: "Poner cada respuesta en su sitio",
        onInsert: () => { spread(made); },
        onRedo: () => { closeOut(); },
      });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      failProposal(block, title, why(cause, "No se pudo cerrar la fase."), () => {
        closeOut();
      });
    });
  }

  /** Cada punto debajo de su pregunta, y la intención situada en su apartado. */
  function spread(made: {
    points: readonly { question: string; answer: string }[];
    situated: string;
  }): void {
    for (const point of made.points) {
      if (!point.answer) continue;
      const found = placed.find((one) => flat(one.ask.question) === flat(point.question));
      // Ya respondida a mano: no se pisa. Lo escrito manda sobre lo propuesto.
      if (!found || found.ask.answered) continue;
      visual.insertAfterBlock(tailOf(found.block), point.answer);
    }

    if (made.situated) {
      const route = options.route();
      const step = route.steps.find((one) => one.id === "situada");
      const head = step ? headBlock(step) : null;
      if (head && !step?.done) visual.insertAfterBlock(lastOf(head), made.situated);
    }

    options.changed();
    closeProposal(false);
  }

  /* --- encontrar sitios en la hoja --------------------------------------- */

  /** El bloque del título de un paso. */
  function headBlock(step: RouteStep): HTMLElement | null {
    const said = flat(step.head);
    return visual.blocks().find(
      (one) => HEADS.has(one.tagName) && flat(visual.plain(one)) === said,
    ) ?? null;
  }

  /**
   * El último bloque de la respuesta de una pregunta.
   *
   * Aceptar un borrador cuando ya hay media respuesta escrita tiene que
   * añadirlo **detrás** de lo escrito y no colarlo entre la pregunta y su
   * respuesta, que partiría en dos lo que alguien ya había dicho.
   */
  function tailOf(block: HTMLElement): HTMLElement {
    let last = block;
    let next = block.nextElementSibling;
    while (next instanceof HTMLElement && PROSE.has(next.tagName)) {
      last = next;
      next = next.nextElementSibling;
    }
    return last;
  }

  /**
   * El último bloque de un apartado, sin contar su criterio para avanzar.
   *
   * El criterio cierra el paso —«Avanza cuando: …»— y lo que se añade tiene que
   * quedar por encima de él: es lo que se está indagando, y el criterio es lo
   * que dice cuándo se deja de indagar.
   */
  function lastOf(head: HTMLElement): HTMLElement {
    let last = head;
    let next = head.nextElementSibling;
    while (next instanceof HTMLElement && !HEADS.has(next.tagName) && next.tagName !== "H1") {
      const said = visual.plain(next).trim();
      if (/^(Avanza cuando|Esta ruta termina en)\s*:/i.test(said)) break;
      if (said || next.tagName === "FIGURE") last = next;
      next = next.nextElementSibling;
    }
    return last;
  }

  return { paint, clear, askFor, draft, closeOut, goTo, goToStep };
}

/** El motivo de un fallo, en castellano y sin tecnicismos de por medio. */
function why(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
