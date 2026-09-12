import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { activeProvider, hasCredential, providerLabel } from "../../core/ai/config.ts";
import { diagnose, type Guess } from "../../core/ai/inquire.ts";
import {
  COMMON, DIAGNOSIS_RULE, FRAMING, NATURES, NOT_A_TYPE,
  SITUATED_HEAD, SYNTHESIS_HEAD, commonHead, natureOf,
  type Nature, type NatureId,
} from "../../core/method/indagar.ts";
import type { Route, RouteStep } from "../../core/method/route.ts";

/**
 * El mapa de la ruta: nodos, aristas y la bifurcación.
 *
 * Se pidió «una conexión por nodos para saber cuál camino se tomó», poder
 * «seleccionar el camino antes de dejarlo» y un botón que muestre «el camino
 * que estamos recorriendo como un mapa». Esto es eso, y su forma no es
 * decorativa: Indagar es la única fase con una ruta que se bifurca, y una
 * bifurcación no se entiende en una lista. Cuatro pasos comunes, un abanico de
 * siete naturalezas, cinco pasos de la que se tome y una salida común.
 *
 * Las tres cosas que hace y que una lista no haría:
 *
 * - **Muestra dónde se está.** Los nodos se pintan con lo que dice el
 *   documento: hecho, en curso, por recorrer. No hay un progreso guardado en
 *   otro sitio que pudiera contradecirlo.
 * - **Deja probar antes de decidir.** Pulsar una naturaleza la previsualiza:
 *   se ve su rama entera, su pregunta central y sus herramientas, y el
 *   documento sigue intacto. Tomarla es un segundo gesto, aparte y con nombre.
 * - **Deja cambiar de ruta.** Cambiar no castiga: lo escrito en la rama
 *   anterior se conserva —lo hace `withNature`—, y aquí se dice antes de
 *   pulsar, que es cuando importa saberlo.
 *
 * La regla del método manda sobre el mapa y está escrita arriba: la naturaleza
 * no se elige por intuición, se infiere de la evidencia. Por eso el botón de la
 * IA de esta pantalla **ordena y cita**, y no toma la ruta: pulsar lo que la
 * evidencia sostiene sigue siendo un gesto de la persona.
 */

export interface MapOptions {
  route: () => Route;
  content: () => string;
  intent: () => string | null;
  /** Tomar una ruta: el documento se reescribe con esa naturaleza dentro. */
  onTake: (id: NatureId) => void;
  /** Ir a un paso del documento. Cierra el mapa. */
  onGo: (step: RouteStep) => void;
  onAsk: (question: string) => void;
}

export interface RouteMap {
  root: HTMLElement;
  button: HTMLButtonElement;
  open: () => void;
  toggle: () => void;
  close: () => void;
  /** Vuelve a leer la ruta del documento. Sin efecto con el mapa cerrado. */
  repaint: () => void;
}

/* --- la retícula del lienzo ----------------------------------------------- */

const NODE_W = 210;
const NODE_H = 64;
/** Separación entre columnas y entre filas, de borde a borde del siguiente. */
const COL = 260;
const ROW = 80;
const PAD = 20;

/** El centro vertical del abanico: todo lo demás se alinea con él. */
const FAN_H = (NATURES.length - 1) * ROW + NODE_H;
const MID = PAD + FAN_H / 2;

const CANVAS_W = PAD + 7 * COL + NODE_W + PAD;
const CANVAS_H = PAD + FAN_H + PAD;

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.6;

interface Box {
  x: number;
  y: number;
}

interface Dot {
  /** Identidad para las aristas. */
  key: string;
  at: Box;
  kind: "paso" | "naturaleza" | "salida";
  head: string;
  say: string;
  state: "done" | "now" | "todo" | "ghost" | "taken" | "pick";
  /** El número que lleva la chapa, si lleva. */
  tag?: string;
  onPick?: () => void;
  title?: string;
}

export function mountMap(options: MapOptions): RouteMap {
  /** La naturaleza que se está mirando sin haberla tomado. */
  let picked: NatureId | null = null;
  let guesses: readonly Guess[] = [];
  let missing: readonly string[] = [];
  let asking = false;
  let failed = "";
  let running: AbortController | null = null;

  let zoom = 0.62;
  let tx = 0;
  let ty = 0;

  const edges = svg("svg", { class: "map__edges" });
  const nodes = el("div", { class: "map__nodes" });
  const canvas = el("div", { class: "map__canvas" }, [edges, nodes]);
  const stage = el("div", { class: "map__stage", attrs: { tabindex: "0" } }, [canvas]);
  const aside = el("aside", { class: "map__side" });
  const footer = el("div", { class: "map__foot" });

  const button = el("button", {
    class: "wr__act",
    text: "Mapa",
    attrs: {
      type: "button",
      title: "Ver la ruta de Indagar como un mapa",
      "aria-expanded": "false",
      "aria-controls": "wr-map",
    },
    on: { click: () => { toggle(); } },
  });

  const root = el("section", {
    class: "map",
    attrs: { hidden: true, "aria-label": "Mapa de la ruta", id: "wr-map" },
  }, [
    el("header", { class: "map__bar" }, [
      icon("hub", "ico"),
      el("span", { class: "map__title", text: "La ruta de Indagar" }),
      el("span", { class: "map__rule", text: DIAGNOSIS_RULE }),
      el("div", { class: "map__zoom" }, [
        zoomer("minus", "Alejar", () => { scale(zoom - 0.12); }),
        zoomer("fit", "Ajustar a la pantalla", () => { fit(); }),
        zoomer("plus", "Acercar", () => { scale(zoom + 0.12); }),
      ]),
      el("button", {
        class: "map__x",
        attrs: { type: "button", "aria-label": "Cerrar el mapa" },
        on: { click: () => { close(); } },
      }, [icon("cross", "ico ico--small")]),
    ]),
    el("div", { class: "map__body" }, [stage, aside]),
    footer,
  ]);

  function zoomer(glyph: "minus" | "plus" | "fit", title: string, run: () => void): HTMLElement {
    return el("button", {
      class: "map__zb",
      attrs: { type: "button", title, "aria-label": title },
      on: { click: () => { run(); } },
    }, [icon(glyph, "ico ico--small")]);
  }

  /* --- el grafo ----------------------------------------------------------- */

  /**
   * Los nodos con sus sitios y su estado.
   *
   * El estado sale del documento y no de aquí: `route` ya sabe qué pasos están
   * hechos y cuál toca. Lo único que este módulo añade es la naturaleza que se
   * está mirando sin haberla tomado, que por definición todavía no está escrita
   * en ninguna parte.
   */
  function graph(route: Route): Dot[] {
    const out: Dot[] = [];
    const shown = picked ?? route.nature?.id ?? null;
    const nature = shown ? natureOf(shown) : null;

    COMMON.forEach((step, index) => {
      const head = commonHead(step);
      const live = route.steps.find((one) => one.head === head);
      out.push({
        key: `comun-${step.id}`,
        at: { x: PAD + index * COL, y: MID - NODE_H / 2 },
        kind: "paso",
        head,
        say: step.output,
        state: state(live, route),
        tag: String(step.n),
        title: `${step.action}. Avanza cuando: ${step.criterion}.`,
        ...(live ? { onPick: () => { close(); options.onGo(live); } } : {}),
      });
    });

    NATURES.forEach((one, index) => {
      const taken = route.nature?.id === one.id;
      const rank = guesses.findIndex((guess) => guess.nature === one.id);
      out.push({
        key: `nat-${one.id}`,
        at: { x: PAD + 4 * COL, y: PAD + index * ROW },
        kind: "naturaleza",
        head: one.name,
        say: one.question,
        state: taken ? "taken" : picked === one.id ? "pick" : "todo",
        ...(rank >= 0 ? { tag: `${rank + 1}ª` } : {}),
        title: one.question,
        onPick: () => { picked = picked === one.id ? null : one.id; paint(); },
      });
    });

    const steps = nature?.steps ?? [];
    const top = MID - ((Math.max(steps.length, 1) - 1) * ROW + NODE_H) / 2;
    if (nature && steps.length > 0) {
      steps.forEach((step, index) => {
        const live = route.nature?.id === nature.id
          ? route.steps.find((one) => one.n === step.n && one.part === "naturaleza")
          : undefined;
        out.push({
          key: `ram-${nature.id}-${step.n}`,
          at: { x: PAD + 5 * COL, y: top + index * ROW },
          kind: "paso",
          head: step.name,
          say: step.ask,
          state: route.nature?.id === nature.id ? state(live, route) : "ghost",
          tag: String(step.n),
          title: step.ask,
          ...(live ? { onPick: () => { close(); options.onGo(live); } } : {}),
        });
      });
    } else {
      // Sin naturaleza no hay rama que dibujar, y dejar el hueco vacío haría
      // pensar que la ruta se acaba en el abanico. Se pone un nodo que dice
      // exactamente qué falta.
      out.push({
        key: "ram-vacia",
        at: { x: PAD + 5 * COL, y: MID - NODE_H / 2 },
        kind: "paso",
        head: "Cinco pasos",
        say: "elige una naturaleza para verlos",
        state: "ghost",
      });
    }

    const synth = route.steps.find((one) => one.id === "sintesis");
    const situated = route.steps.find((one) => one.id === "situada");
    out.push({
      key: "out-sintesis",
      at: { x: PAD + 6 * COL, y: MID - NODE_H / 2 },
      kind: "salida",
      head: SYNTHESIS_HEAD,
      say: "los siete puntos de la situación",
      state: state(synth, route),
      ...(synth ? { onPick: () => { close(); options.onGo(synth); } } : {}),
    });
    out.push({
      key: "out-situada",
      at: { x: PAD + 7 * COL, y: MID - NODE_H / 2 },
      kind: "salida",
      head: SITUATED_HEAD,
      say: "pasa a Idear",
      state: state(situated, route),
      ...(situated ? { onPick: () => { close(); options.onGo(situated); } } : {}),
    });

    return out;
  }

  function state(step: RouteStep | undefined, route: Route): Dot["state"] {
    if (!step) return "ghost";
    if (step.done) return "done";
    if (route.next && route.next.id === step.id) return "now";
    return "todo";
  }

  /** Las aristas: de qué nodo a qué nodo, y si la ruta pasa por ellas. */
  function wires(route: Route, all: readonly Dot[]): [string, string, boolean][] {
    const shown = picked ?? route.nature?.id ?? null;
    const nature = shown ? natureOf(shown) : null;
    const live = (id: string): boolean => shown !== null && id === shown;

    const out: [string, string, boolean][] = [];
    for (let index = 0; index < COMMON.length - 1; index += 1) {
      const from = COMMON[index]?.id;
      const to = COMMON[index + 1]?.id;
      if (from && to) out.push([`comun-${from}`, `comun-${to}`, true]);
    }

    // El abanico: cuatro pasos comunes y de ahí siete caminos posibles. Es la
    // imagen de la lámina —«desde aquí la ruta se bifurca»— y es lo único de
    // este mapa que no se puede decir con una línea recta.
    for (const one of NATURES) out.push(["comun-diagnostico", `nat-${one.id}`, live(one.id)]);

    if (nature) {
      const steps = nature.steps;
      out.push([`nat-${nature.id}`, `ram-${nature.id}-${steps[0]?.n ?? 1}`, true]);
      for (let index = 0; index < steps.length - 1; index += 1) {
        out.push([
          `ram-${nature.id}-${steps[index]?.n ?? 0}`,
          `ram-${nature.id}-${steps[index + 1]?.n ?? 0}`,
          true,
        ]);
      }
      out.push([`ram-${nature.id}-${steps[steps.length - 1]?.n ?? 5}`, "out-sintesis", true]);
    } else {
      out.push(["ram-vacia", "out-sintesis", false]);
    }
    out.push(["out-sintesis", "out-situada", true]);

    const known = new Set(all.map((one) => one.key));
    return out.filter(([from, to]) => known.has(from) && known.has(to));
  }

  /* --- pintar ------------------------------------------------------------- */

  function paint(): void {
    const route = options.route();
    const all = graph(route);
    const spots = new Map(all.map((one) => [one.key, one.at]));

    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    edges.setAttribute("viewBox", `0 0 ${CANVAS_W} ${CANVAS_H}`);
    edges.setAttribute("width", String(CANVAS_W));
    edges.setAttribute("height", String(CANVAS_H));

    render(edges, ...wires(route, all).flatMap(([from, to, on]) => {
      const a = spots.get(from);
      const b = spots.get(to);
      if (!a || !b) return [];
      return [svg("path", {
        class: `map__wire${on ? " is-on" : ""}`,
        d: curve(a, b),
      })];
    }));

    render(nodes, ...all.map((one) => node(one)));
    render(aside, ...side(route));
    render(footer, ...foot(route));
    place();
  }

  function node(one: Dot): HTMLElement {
    const kids: (Node | string)[] = [];
    if (one.tag) kids.push(el("span", { class: "map__n__tag", text: one.tag }));
    kids.push(el("span", { class: "map__n__head", text: one.head }));
    kids.push(el("span", { class: "map__n__say", text: one.say }));
    if (one.state === "done") kids.push(icon("check", "ico ico--twist map__n__ok"));

    const tag = one.onPick ? "button" : "div";
    const box = el(tag as "button", {
      class: `map__n map__n--${one.kind} is-${one.state}`,
      attrs: {
        ...(one.onPick ? { type: "button" } : {}),
        ...(one.title ? { title: one.title } : {}),
      },
      ...(one.onPick ? { on: { click: () => { one.onPick?.(); } } } : {}),
    }, kids);

    box.style.left = `${one.at.x}px`;
    box.style.top = `${one.at.y}px`;
    box.style.width = `${NODE_W}px`;
    box.style.minHeight = `${NODE_H}px`;
    return box;
  }

  /**
   * La columna del lado: qué es la naturaleza que se está mirando, y lo que la
   * lámina dice sobre elegirla.
   */
  function side(route: Route): HTMLElement[] {
    const shown = picked ?? route.nature?.id ?? null;
    const nature = shown ? natureOf(shown) : null;
    const out: HTMLElement[] = [];

    out.push(el("div", { class: "map__where" }, [
      el("span", { class: "map__where__say", text: whereSays(route) }),
      el("span", { class: "map__where__n", text: `${route.done} de ${route.total} pasos` }),
      bar(route.done, route.total),
    ]));

    if (nature) out.push(natureCard(nature, route));

    out.push(el("div", { class: "map__ai" }, aiBits()));

    out.push(el("div", { class: "map__notes" }, [
      el("span", { class: "map__notes__title", text: "Cómo se lee este mapa" }),
      el("ul", { class: "map__notes__list" }, [
        ...FRAMING.map((one) => el("li", { text: one })),
        el("li", { text: NOT_A_TYPE }),
      ]),
    ]));

    return out;
  }

  function natureCard(nature: Nature, route: Route): HTMLElement {
    const taken = route.nature?.id === nature.id;
    return el("div", { class: `map__card${taken ? " is-taken" : ""}` }, [
      el("span", { class: "map__card__kind", text: taken ? "Ruta tomada" : "Estás mirando" }),
      el("span", { class: "map__card__head", text: nature.name }),
      el("p", { class: "map__card__ask", text: nature.question }),
      ...(nature.combined
        ? [el("p", { class: "map__card__mix", text:
            "Varias naturalezas trenzadas: se nombran todas y se ordena por dónde empezar." })]
        : []),
      el("p", { class: "map__card__tools" }, [
        el("span", { class: "map__card__label", text: "Herramientas sugeridas" }),
        el("span", { text: nature.tools.join(" · ") }),
        el("span", { class: "map__card__soft", text: "Orientativas, no obligatorias." }),
      ]),
      el("p", { class: "map__card__out" }, [
        el("span", { class: "map__card__label", text: "Termina en" }),
        el("span", { text: nature.output }),
      ]),
      ...guessOf(nature.id),
    ]);
  }

  /** Lo que el modelo dijo de esta naturaleza, si dijo algo. */
  function guessOf(id: NatureId): HTMLElement[] {
    const found = guesses.find((one) => one.nature === id);
    if (!found) return [];
    const rank = guesses.indexOf(found) + 1;
    return [el("div", { class: "map__why" }, [
      el("span", { class: "map__why__title", text: `Lectura ${rank}ª según la evidencia` }),
      el("p", { class: "map__why__say", text: found.why }),
      ...(found.evidence
        ? [el("p", { class: "map__why__ev", text: `«${found.evidence}»` })]
        : []),
    ])];
  }

  /** El botón de diagnosticar y lo que devolvió. Ordena; no toma la ruta. */
  function aiBits(): HTMLElement[] {
    if (asking) {
      return [el("p", { class: "map__busy" }, [
        el("span", { class: "prop__dot" }), "Leyendo la evidencia del documento…",
      ])];
    }

    const out: HTMLElement[] = [];
    if (failed) out.push(el("p", { class: "map__bad", text: failed }));

    out.push(el("button", {
      class: "btn btn--quiet",
      attrs: { type: "button" },
      on: { click: () => { void run(); } },
    }, [
      icon("aim", "ico ico--small"),
      el("span", { text: guesses.length > 0 ? "Volver a diagnosticar" : "Diagnosticar con la evidencia" }),
    ]));

    if (guesses.length === 0) {
      out.push(el("p", { class: "map__soft", text:
        "Lee lo escrito y ordena las naturalezas que el documento sostiene, con el " +
        "fragmento en que se apoya cada una. No toma la ruta: eso lo haces tú." }));
      return out;
    }

    out.push(el("ul", { class: "map__rank" }, guesses.map((one, index) => {
      const nature = natureOf(one.nature);
      return el("li", {}, [
        el("button", {
          class: `map__rank__b${picked === one.nature ? " is-on" : ""}`,
          attrs: { type: "button", title: one.why },
          on: { click: () => { picked = one.nature; paint(); } },
        }, [
          el("span", { class: "map__rank__n", text: `${index + 1}ª` }),
          el("span", { class: "map__rank__name", text: nature?.name ?? one.nature }),
        ]),
      ]);
    })));

    if (missing.length > 0) {
      out.push(el("div", { class: "map__gaps" }, [
        el("span", { class: "map__gaps__title", text: "Para diagnosticar con seguridad falta" }),
        el("ul", {}, missing.map((one) => el("li", { text: one }))),
      ]));
    }

    out.push(el("button", {
      class: "lnkbtn",
      text: "Discutir el diagnóstico",
      attrs: { type: "button" },
      on: {
        click: () => {
          const said = guesses.map((one, index) =>
            `${index + 1}. ${natureOf(one.nature)?.name ?? one.nature}: ${one.why}`).join("\n");
          close();
          options.onAsk(
            "Sobre el diagnóstico de la naturaleza de mi situación, la IA ordenó así " +
            `las lecturas posibles:\n${said}\n\n¿Qué evidencia de mi documento le falta ` +
            "a la primera para sostenerse, y qué me convendría mirar antes de tomar la ruta?",
          );
        },
      },
    }));

    return out;
  }

  /** La barra de abajo: tomar la ruta, cambiarla, o nada. */
  function foot(route: Route): HTMLElement[] {
    const taken = route.nature;
    if (!picked || picked === taken?.id) {
      if (!taken) {
        return [el("p", { class: "map__foot__say", text:
          "Pulsa una naturaleza para ver su rama entera. El documento no se toca hasta " +
          "que tomes la ruta." })];
      }
      return [el("p", { class: "map__foot__say", text:
        `La ruta de este documento es «${taken.name}». Pulsa otra naturaleza para ver ` +
        "a dónde llevaría." })];
    }

    const nature = natureOf(picked);
    if (!nature) return [];

    return [
      el("p", { class: "map__foot__say", text: taken
        ? `Cambiar de «${taken.name}» a «${nature.name}». Lo que ya escribiste en la rama ` +
          "anterior se queda en el documento: no se borra nada."
        : `Tomar la ruta de «${nature.name}»: sus cinco pasos entran en el documento con ` +
          "sus preguntas dentro." }),
      el("div", { class: "map__foot__acts" }, [
        el("button", {
          class: "btn",
          text: taken ? `Cambiar a ${nature.name}` : `Tomar la ruta de ${nature.name}`,
          attrs: { type: "button" },
          on: {
            click: () => {
              const id = nature.id;
              picked = null;
              options.onTake(id);
              paint();
            },
          },
        }),
        el("button", {
          class: "lnkbtn",
          text: "Seguir mirando",
          attrs: { type: "button" },
          on: { click: () => { picked = null; paint(); } },
        }),
      ]),
    ];
  }

  function whereSays(route: Route): string {
    switch (route.stage) {
      case "comun": return `Estás en ${route.next?.head ?? "los pasos comunes"}.`;
      case "diagnostico": return "Los tres primeros pasos están: toca diagnosticar la naturaleza.";
      case "naturaleza": return `Recorriendo la rama: ${route.next?.head ?? ""}.`;
      case "salida": return "La rama está recorrida: queda cerrar la salida común.";
      case "listo": return "La ruta está recorrida entera.";
    }
  }

  function bar(done: number, total: number): HTMLElement {
    const fill = el("span", { class: "map__track__fill" });
    fill.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
    return el("span", {
      class: "map__track",
      attrs: {
        role: "progressbar",
        "aria-valuenow": done,
        "aria-valuemin": 0,
        "aria-valuemax": total,
      },
    }, [fill]);
  }

  /* --- diagnosticar ------------------------------------------------------- */

  async function run(): Promise<void> {
    if (asking) return;
    const provider = activeProvider();
    if (!hasCredential(provider)) {
      failed = `Para diagnosticar hace falta la credencial de ${providerLabel(provider)}. ` +
        "Se pone en la bandeja de la franja, en «IA».";
      paint();
      return;
    }

    running?.abort();
    const controller = new AbortController();
    running = controller;
    asking = true;
    failed = "";
    paint();

    try {
      const read = await diagnose({
        content: options.content(),
        intent: options.intent(),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      guesses = read.ranked;
      missing = read.missing;
      // Se mira la primera, no se toma: leer la lectura mejor sostenida es el
      // gesto siguiente, y tomarla sigue siendo el de después.
      picked = read.ranked[0]?.nature ?? null;
    } catch (cause) {
      if (controller.signal.aborted) return;
      failed = cause instanceof Error ? cause.message : "No se pudo diagnosticar.";
    } finally {
      if (running === controller) {
        running = null;
        asking = false;
        paint();
      }
    }
  }

  /* --- mover el lienzo ---------------------------------------------------- */

  function place(): void {
    canvas.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${zoom})`;
  }

  function scale(next: number): void {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next.toFixed(2))));
    place();
  }

  /** Todo el grafo dentro de la pantalla, centrado. */
  function fit(): void {
    const box = stage.getBoundingClientRect();
    if (box.width < 40) return;
    const margin = 28;
    zoom = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, Math.min(
        (box.width - margin * 2) / CANVAS_W,
        (box.height - margin * 2) / CANVAS_H,
      )),
    );
    tx = (box.width - CANVAS_W * zoom) / 2;
    ty = (box.height - CANVAS_H * zoom) / 2;
    place();
  }

  // Arrastrar el fondo mueve el lienzo. Sobre un nodo no: ahí el gesto es
  // pulsarlo, y un mapa que se desplaza al intentar elegir una ruta se pelea
  // con quien lo usa.
  let drag: { x: number; y: number; tx: number; ty: number } | null = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest(".map__n")) return;
    drag = { x: event.clientX, y: event.clientY, tx, ty };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    tx = drag.tx + (event.clientX - drag.x);
    ty = drag.ty + (event.clientY - drag.y);
    place();
  });
  const letGo = (): void => { drag = null; stage.classList.remove("is-dragging"); };
  stage.addEventListener("pointerup", letGo);
  stage.addEventListener("pointercancel", letGo);

  stage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    scale(zoom - event.deltaY * 0.002);
  }, { passive: false });

  /* --- abrir, cerrar ------------------------------------------------------ */

  function open(): void {
    if (!root.hidden) return;
    root.hidden = false;
    button.setAttribute("aria-expanded", "true");
    picked = null;
    failed = "";
    paint();
    // Ajustar después de pintar: antes el escenario no tiene tamaño y el
    // encaje saldría con las medidas de la pantalla anterior.
    requestAnimationFrame(() => { fit(); stage.focus(); });
  }

  function close(): void {
    if (root.hidden) return;
    running?.abort();
    running = null;
    asking = false;
    root.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function toggle(): void {
    if (root.hidden) open();
    else close();
  }

  /**
   * El mapa detrás del documento, cuando el documento cambia.
   *
   * Se puede escribir con el mapa abierto —está al lado, no encima—, y entonces
   * el avance que dibuja tiene que ser el de ahora mismo: responder la pregunta
   * de un paso lo da por hecho, y un mapa que siguiera diciendo lo de antes
   * estaría contando otra cosa que la que hay escrita. Cerrado no se pinta: no
   * hay nada que mirar y el documento se escribe más veces de lo que se abre.
   */
  function repaint(): void {
    if (root.hidden) return;
    paint();
  }

  return { root, button, open, toggle, close, repaint };
}

/* --- las tripas ----------------------------------------------------------- */

/** Un nodo SVG, que `el()` no sabe hacer: necesita su espacio de nombres. */
function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "class") node.setAttribute("class", value);
    else node.setAttribute(name, value);
  }
  return node;
}

/**
 * La arista entre dos nodos, como en la referencia: una curva de Bézier de
 * trazo discontinuo.
 *
 * Sale por el lado que corresponde —derecha si el siguiente está a la derecha,
 * abajo si está debajo— porque una línea que sale por donde no toca hace pensar
 * que el orden es otro. Los tiradores de la curva crecen con la distancia: en
 * el abanico de siete son curvas amplias, y entre dos pasos seguidos casi una
 * recta.
 */
function curve(a: Box, b: Box): string {
  const sideways = b.x > a.x + NODE_W / 2;
  if (sideways) {
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const pull = Math.max(40, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + pull} ${y1}, ${x2 - pull} ${y2}, ${x2} ${y2}`;
  }
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  const y2 = b.y;
  const pull = Math.max(24, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + pull}, ${x2} ${y2 - pull}, ${x2} ${y2}`;
}
