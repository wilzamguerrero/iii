import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { KIND_LABEL, reviewDocument, type Observation, type Review } from "../../core/ai/review.ts";
import {
  activeProvider, aiConfig, hasCredential, providerLabel, serverKeys,
} from "../../core/ai/config.ts";
import { openAiSettings } from "../dock/tray.ts";
import { intent } from "../../core/state/intent.ts";
import type { PhaseId } from "../../core/method/structures.ts";

/**
 * La revisión, a la derecha.
 *
 * Es la parte del encargo que decía «que la IA también esté revisando lo que
 * estamos haciendo y nos ayude», y la forma en que se cumple tiene un límite
 * deliberado: **observaciones, nunca reemplazos**. Ninguna de estas tarjetas trae
 * un botón que arregle el párrafo, porque el documento se defiende delante de un
 * jurado y sólo se puede defender lo que uno escribió.
 *
 * Cada observación hace dos cosas: lleva hasta el sitio del que habla —pulsándola—
 * y se puede llevar al asistente, que es donde se conversa. No contesta aquí: si la
 * respuesta apareciera dentro de esta columna habría dos sitios donde el modelo
 * habla y sobraría uno.
 *
 * No se revisa sola. Revisar cuesta una petición con el documento entero dentro, y
 * hacerlo cada vez que se abre la columna sería gastarle a la persona su cuota sin
 * que lo pida. Se revisa cuando se pide, y si el texto cambió desde la última vez
 * se dice, para que nadie confunda una revisión vieja con lo que hay ahora.
 */

export interface DocumentNow {
  name: string;
  content: string;
  /** La fase, cuando el documento es uno de los tres del proyecto. */
  phase: PhaseId | null;
  /** El id de la estructura que sigue, si sigue alguna. */
  structure: string | null;
}

export interface PanelOptions {
  now: () => DocumentNow;
  /** Llevar el documento hasta ese fragmento. */
  onLocate: (where: string) => void;
  /** Llevar la observación al asistente. */
  onAsk: (question: string) => void;
}

export interface Panel {
  root: HTMLElement;
  button: HTMLButtonElement;
  toggle: () => void;
  close: () => void;
  /** Se cambió de documento: lo revisado ya no es de este. */
  reset: () => void;
}

export function mountPanel(options: PanelOptions): Panel {
  const body = el("div", { class: "rev__body" });
  const root = el("aside", {
    class: "rev",
    attrs: { "aria-label": "Revisión del documento", hidden: true },
  }, [
    el("div", { class: "rev__head" }, [
      el("span", { class: "rev__title", text: "Revisión" }),
      el("button", {
        class: "rev__x",
        attrs: { type: "button", "aria-label": "Cerrar la revisión" },
        on: { click: () => { close(); } },
      }, [icon("cross", "ico ico--small")]),
    ]),
    body,
  ]);

  const button = el("button", {
    class: "wr__act",
    text: "Revisar",
    attrs: { type: "button", "aria-expanded": "false", "aria-controls": "wr-rev" },
    on: { click: () => { toggle(); } },
  });
  root.setAttribute("id", "wr-rev");

  /** La última revisión y el texto exacto sobre el que se hizo. */
  let last: Review | null = null;
  let reviewed = "";
  let asking = false;
  let failed = "";
  let running: AbortController | null = null;

  function paint(): void {
    const now = options.now();

    if (asking) {
      render(body, el("p", { class: "rev__lead", text: "Leyendo el documento…" }));
      return;
    }

    const provider = activeProvider();
    if (!hasCredential(provider)) {
      render(body,
        el("p", { class: "rev__lead", text:
          `Para revisar hace falta la credencial de ${providerLabel(provider)}.` }),
        el("button", {
          class: "btn btn--quiet",
          text: "Configurar la IA",
          attrs: { type: "button" },
          on: { click: () => { openAiSettings(); } },
        }),
      );
      return;
    }

    const parts: (Node | string)[] = [];

    if (failed) parts.push(el("p", { class: "rev__bad", text: failed }));

    if (!last) {
      parts.push(el("p", { class: "rev__lead", text:
        "Lee el documento entero y dice qué falta, qué no se sostiene y qué necesita " +
        "respaldo. No reescribe nada." }));
    } else {
      if (last.verdict) parts.push(el("p", { class: "rev__verdict", text: last.verdict }));
      if (reviewed !== now.content) {
        parts.push(el("p", { class: "rev__stale", text:
          "El documento cambió desde esta revisión." }));
      }
      if (last.observations.length === 0) {
        parts.push(el("p", { class: "rev__lead", text: "Sin observaciones." }));
      }
      parts.push(...last.observations.map((one) => card(one)));
    }

    parts.push(el("button", {
      class: "btn",
      text: last ? "Revisar otra vez" : "Revisar el documento",
      attrs: { type: "button" },
      on: { click: () => { void run(); } },
    }));

    render(body, ...parts);
  }

  /**
   * Una observación. El cuerpo es un botón porque su gesto principal es llevar
   * hasta el sitio del que habla; preguntar es el segundo y va aparte.
   */
  function card(one: Observation): HTMLElement {
    const kids: (Node | string)[] = [
      el("span", { class: `rev__kind rev__kind--${one.kind}`, text: KIND_LABEL[one.kind] }),
      el("span", { class: "rev__note", text: one.note }),
    ];
    if (one.where) kids.push(el("span", { class: "rev__where", text: one.where }));

    const go = el("button", {
      class: "rev__one",
      attrs: {
        type: "button",
        ...(one.where ? { title: `Ir a «${one.where}»` } : {}),
      },
      on: { click: () => { if (one.where) options.onLocate(one.where); } },
    }, kids);

    return el("div", { class: "rev__card" }, [
      go,
      el("button", {
        class: "lnkbtn",
        text: "Preguntar por esto",
        attrs: { type: "button" },
        on: { click: () => { options.onAsk(question(one)); } },
      }),
    ]);
  }

  /**
   * La observación convertida en pregunta para el asistente. Se manda lo que el
   * modelo observó y no un resumen, porque el asistente ya ve el documento: lo que
   * le falta es saber de qué se le está hablando.
   */
  function question(one: Observation): string {
    const where = one.where ? ` Está en: «${one.where}».` : "";
    return `Sobre la revisión de este documento, ${KIND_LABEL[one.kind].toLocaleLowerCase("es")}: ` +
      `${one.note}${where} ¿Qué tengo que decidir para resolverlo?`;
  }

  async function run(): Promise<void> {
    if (asking) return;
    const now = options.now();

    running?.abort();
    const controller = new AbortController();
    running = controller;
    asking = true;
    failed = "";
    paint();

    try {
      const review = await reviewDocument({
        name: now.name,
        content: now.content,
        intent: intent.get()?.text ?? null,
        phase: now.phase,
        structure: now.structure,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      last = review;
      reviewed = now.content;
    } catch (cause) {
      if (controller.signal.aborted) return;
      failed = cause instanceof Error ? cause.message : "No se pudo revisar el documento.";
    } finally {
      if (running === controller) {
        running = null;
        asking = false;
        paint();
      }
    }
  }

  function toggle(): void {
    if (!root.hidden) { close(); return; }
    root.hidden = false;
    button.setAttribute("aria-expanded", "true");
    paint();
    // Pedirla al abrir sólo la primera vez: pulsar «Revisar» es pedirla, y volver a
    // abrir la columna para leer lo de antes no debería costar otra petición.
    if (!last && !asking && hasCredential(activeProvider())) void run();
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function reset(): void {
    running?.abort();
    running = null;
    asking = false;
    last = null;
    reviewed = "";
    failed = "";
    if (!root.hidden) paint();
  }

  /**
   * La credencial puede llegar con la columna abierta: se pone en la bandeja, a la
   * que lleva el propio aviso de que falta. Sin esto, la columna seguiría pidiéndola
   * hasta cerrarla y volver a abrirla.
   *
   * Repintar no es revisar: aparece el botón, y pulsarlo sigue siendo de la persona.
   * Revisar sola al llegar la clave le gastaría una petición que no pidió.
   */
  function awake(): void {
    if (root.hidden || asking) return;
    paint();
  }

  aiConfig.subscribe(awake);
  serverKeys.subscribe(awake);

  return { root, button, toggle, close, reset };
}
