import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { COMMON, RULES } from "../../core/method/indagar.ts";
import { asksOf, type Route, type RouteAsk, type RouteStep } from "../../core/method/route.ts";

/**
 * La columna de Indagar: qué toca ahora y qué queda sin responder.
 *
 * Las preguntas viven dentro del documento —eso lo hace `asks.ts`— y esta
 * columna no las repite: las **cuenta** y lleva hasta ellas. Es la diferencia
 * entre un índice y un formulario. Quien escribe trabaja en el texto; esto le
 * dice desde fuera en qué paso está, qué falta para poder avanzar y dónde
 * quedaron las preguntas que dejó abiertas, que en un documento largo es lo
 * primero que se pierde de vista.
 *
 * Todo lo que muestra sale de `readRoute`, o sea del documento. No hay progreso
 * guardado en ningún sitio: si alguien borra una respuesta en Notion desde el
 * teléfono, el paso deja de estar hecho aquí en el siguiente repintado. Por eso
 * los números de esta columna no pueden contradecir lo que se ve escrito.
 *
 * No le pide nada al modelo por su cuenta. Los dos botones que sí lo hacen
 * —pedir preguntas de un paso, cerrar la fase— son los mismos de dentro del
 * documento y van a través de `asks.ts`: un solo camino para lo que gasta
 * peticiones, y ninguna petición que no se haya pulsado.
 */

export interface GuideOptions {
  route: () => Route;
  /** Pedirle preguntas de este proyecto para un paso. */
  onAskFor: (stepId: string) => void;
  /** Llevar la hoja hasta una pregunta y abrir su hueco. */
  onGoTo: (ask: RouteAsk) => void;
  /** Llevar la hoja hasta el título de un paso. */
  onGoStep: (step: RouteStep) => void;
  /** Abrir el mapa de la ruta. */
  onMap: () => void;
  /** Proponer la salida de la fase. */
  onCloseOut: () => void;
}

export interface Guide {
  root: HTMLElement;
  button: HTMLButtonElement;
  /** Volver a leer la ruta. Barato: no pinta si está cerrada. */
  paint: () => void;
  open: () => void;
  toggle: () => void;
  close: () => void;
}

/** Preguntas abiertas que se listan antes de resumir el resto. */
const MAX_OPEN = 8;

export function mountGuide(options: GuideOptions): Guide {
  const body = el("div", { class: "guia__body" });

  const button = el("button", {
    class: "wr__act",
    attrs: {
      type: "button",
      title: "La ruta de Indagar: qué toca y qué falta",
      "aria-expanded": "false",
      "aria-controls": "wr-guia",
    },
    on: { click: () => { toggle(); } },
  }, [icon("route", "ico ico--small"), el("span", { text: "Indagar" })]);

  const root = el("aside", {
    class: "guia",
    attrs: { "aria-label": "La ruta de Indagar", hidden: true, id: "wr-guia" },
  }, [
    el("div", { class: "guia__head" }, [
      el("span", { class: "guia__title", text: "Indagar" }),
      el("button", {
        class: "guia__x",
        attrs: { type: "button", "aria-label": "Cerrar la columna de Indagar" },
        on: { click: () => { close(); } },
      }, [icon("cross", "ico ico--small")]),
    ]),
    body,
  ]);

  function paint(): void {
    if (root.hidden) return;
    const route = options.route();

    // Un documento que no es de Indagar no tiene ruta. Se dice, en vez de
    // mostrar once pasos sin empezar que no son de este texto.
    if (!route.steps.some((one) => one.present)) {
      render(body, el("p", { class: "guia__lead", text:
        "Este documento no lleva la ruta de Indagar escrita dentro. La ruta entra " +
        "al crear el documento de Indagar del proyecto." }));
      return;
    }

    render(body, ...[
      now(route),
      nature(route),
      open(route),
      steps(route),
      rules(),
    ].flat());
  }

  /* --- qué toca ahora ----------------------------------------------------- */

  function now(route: Route): HTMLElement[] {
    const step = route.next;
    const out: HTMLElement[] = [
      el("div", { class: "guia__now" }, [
        el("span", { class: "guia__now__stage", text: stageSays(route) }),
        ...(step
          ? [
              el("button", {
                class: "guia__now__head",
                attrs: { type: "button", title: "Ir a este paso en el documento" },
                on: { click: () => { options.onGoStep(step); } },
              }, [el("span", { text: step.head }), icon("right", "ico ico--twist")]),
              el("p", { class: "guia__now__says", text: `Sale de aquí: ${step.says}.` }),
              ...criterion(step, route),
            ]
          : [el("p", { class: "guia__now__says", text:
              "Los once pasos están recorridos. La salida ya puede pasar a Idear." })]),
        progress(route),
      ]),
    ];

    const acts: HTMLElement[] = [];
    if (route.stage === "diagnostico") {
      acts.push(el("button", {
        class: "btn",
        attrs: { type: "button" },
        on: { click: () => { options.onMap(); } },
      }, [icon("hub", "ico ico--small"), el("span", { text: "Elegir la ruta en el mapa" })]));
    }
    if (step && route.stage !== "diagnostico" && step.part !== "salida") {
      acts.push(el("button", {
        class: "btn btn--quiet",
        attrs: { type: "button", title: "Preguntas de este proyecto para este paso" },
        on: { click: () => { options.onAskFor(step.id); } },
      }, [icon("ask", "ico ico--small"), el("span", { text: "Pedir preguntas" })]));
    }
    if (route.stage === "salida" || route.stage === "listo") {
      acts.push(el("button", {
        class: "btn",
        attrs: { type: "button" },
        on: { click: () => { options.onCloseOut(); } },
      }, [icon("doneAll", "ico ico--small"), el("span", { text: "Proponer la salida" })]));
    }
    if (acts.length > 0) out.push(el("div", { class: "guia__acts" }, acts));

    return out;
  }

  /**
   * El criterio para avanzar.
   *
   * Lo trae la lámina y es lo que separa esto de una lista de tareas: un paso no
   * se marca hecho porque alguien lo diga, se cierra cuando cumple su criterio.
   * Los pasos de la naturaleza no llevan uno propio; llevan el final de la ruta,
   * que es lo que hace de criterio para todos ellos.
   */
  function criterion(step: RouteStep, route: Route): HTMLElement[] {
    const common = COMMON.find((one) => one.id === step.id);
    if (common) {
      return [el("p", { class: "guia__crit" }, [
        el("span", { class: "guia__crit__label", text: "Avanza cuando" }),
        el("span", { text: `${common.criterion}.` }),
      ])];
    }
    if (step.part === "naturaleza" && route.nature) {
      return [el("p", { class: "guia__crit" }, [
        el("span", { class: "guia__crit__label", text: "Esta ruta termina en" }),
        el("span", { text: `${route.nature.output}.` }),
      ])];
    }
    return [];
  }

  function progress(route: Route): HTMLElement {
    const fill = el("span", { class: "guia__bar__fill" });
    fill.style.width = `${Math.round((route.done / Math.max(route.total, 1)) * 100)}%`;
    return el("div", { class: "guia__prog" }, [
      el("span", {
        class: "guia__bar",
        attrs: {
          role: "progressbar",
          "aria-valuenow": route.done,
          "aria-valuemin": 0,
          "aria-valuemax": route.total,
          "aria-label": "Pasos recorridos",
        },
      }, [fill]),
      el("span", { class: "guia__prog__n", text: `${route.done} de ${route.total}` }),
    ]);
  }

  /* --- la naturaleza ------------------------------------------------------ */

  function nature(route: Route): HTMLElement[] {
    if (!route.nature) {
      return [el("button", {
        class: "guia__nat guia__nat--due",
        attrs: { type: "button", title: "Abrir el mapa de la ruta" },
        on: { click: () => { options.onMap(); } },
      }, [
        icon("hub", "ico ico--small"),
        el("span", { class: "guia__nat__name", text: "Sin naturaleza diagnosticada" }),
        el("span", { class: "guia__nat__ask", text:
          "Desde el cuarto paso la ruta se bifurca en siete. Se infiere de la evidencia." }),
      ])];
    }
    return [el("button", {
      class: "guia__nat",
      attrs: { type: "button", title: "Ver el mapa o cambiar de ruta" },
      on: { click: () => { options.onMap(); } },
    }, [
      icon("hub", "ico ico--small"),
      el("span", { class: "guia__nat__name", text: route.nature.name }),
      el("span", { class: "guia__nat__ask", text: route.nature.question }),
    ])];
  }

  /* --- lo que queda sin responder ----------------------------------------- */

  /**
   * Las preguntas abiertas, en el orden del documento.
   *
   * Van agrupadas por apartado porque una lista de veinte preguntas seguidas no
   * dice en qué parte de la indagación se está. Se muestran ocho y se cuenta el
   * resto: la columna es para volver al hilo, no para responder desde aquí.
   */
  function open(route: Route): HTMLElement[] {
    if (route.questions.length === 0) return [];
    if (route.open.length === 0) {
      return [el("p", { class: "guia__clear" }, [
        icon("check", "ico ico--small"),
        el("span", { text: "Todas las preguntas escritas están respondidas." }),
      ])];
    }

    const shown = route.open.slice(0, MAX_OPEN);
    const rest = route.open.length - shown.length;
    const groups: { head: string; asks: RouteAsk[] }[] = [];
    for (const ask of shown) {
      const last = groups[groups.length - 1];
      if (last && last.head === ask.head) last.asks.push(ask);
      else groups.push({ head: ask.head, asks: [ask] });
    }

    return [el("div", { class: "guia__open" }, [
      el("span", { class: "guia__open__title", text:
        route.open.length === 1
          ? "Queda una pregunta sin responder"
          : `Quedan ${route.open.length} preguntas sin responder` }),
      ...groups.flatMap((group) => [
        el("span", { class: "guia__open__head", text: group.head }),
        el("ul", { class: "guia__open__list" }, group.asks.map((ask) => el("li", {}, [
          el("button", {
            class: "guia__q",
            attrs: { type: "button", title: "Ir a esta pregunta en el documento" },
            on: { click: () => { options.onGoTo(ask); } },
          }, [
            icon("askhere", "ico ico--twist"),
            el("span", { text: ask.question }),
          ]),
        ]))),
      ]),
      ...(rest > 0
        ? [el("p", { class: "guia__open__rest", text:
            rest === 1 ? "Y una más adelante." : `Y ${rest} más adelante.` })]
        : []),
    ])];
  }

  /* --- los once pasos ----------------------------------------------------- */

  function steps(route: Route): HTMLElement[] {
    const rows = route.steps.map((step) => {
      const count = asksOf(route, step.id);
      const answered = count.filter((one) => one.answered).length;
      const where = step.done
        ? "done"
        : route.next?.id === step.id ? "now" : step.present ? "todo" : "away";

      return el("li", {}, [
        el("button", {
          class: `guia__s is-${where}`,
          attrs: {
            type: "button",
            ...(step.present ? { title: "Ir a este paso" } : { disabled: true }),
          },
          on: { click: () => { if (step.present) options.onGoStep(step); } },
        }, [
          el("span", { class: "guia__s__dot" }, step.done
            ? [icon("check", "ico ico--twist")]
            : []),
          el("span", { class: "guia__s__name", text: step.head }),
          el("span", { class: "guia__s__n", text: count.length > 0
            ? `${answered}/${count.length}`
            : step.present ? `${step.words} pal.` : "por escribir" }),
        ]),
      ]);
    });

    return [el("div", { class: "guia__steps" }, [
      el("span", { class: "guia__steps__title", text: "La ruta entera" }),
      el("ol", { class: "guia__steps__list" }, rows),
      ...(route.nature
        ? []
        : [el("p", { class: "guia__steps__soft", text:
            "Los cinco pasos de la naturaleza aparecen al tomar una ruta." })]),
    ])];
  }

  /* --- las seis reglas ---------------------------------------------------- */

  /**
   * Las reglas operativas, plegadas.
   *
   * Están porque son parte del método y porque se olvidan a mitad de un
   * documento largo; plegadas porque leerlas es cosa de una vez y lo de arriba
   * se consulta a cada rato.
   */
  function rules(): HTMLElement[] {
    return [el("details", { class: "guia__rules" }, [
      el("summary", { class: "guia__rules__sum", text: "Las seis reglas de Indagar" }),
      el("ol", { class: "guia__rules__list" }, RULES.map((one) => el("li", {}, [
        el("span", { class: "guia__rules__name", text: one.name }),
        el("span", { class: "guia__rules__says", text: one.says }),
      ]))),
    ])];
  }

  function stageSays(route: Route): string {
    switch (route.stage) {
      case "comun": return "Secuencia común";
      case "diagnostico": return "Toca diagnosticar la naturaleza";
      case "naturaleza": return `Ruta: ${route.nature?.name ?? ""}`;
      case "salida": return "Salida común";
      case "listo": return "Ruta recorrida";
    }
  }

  /* --- abrir, cerrar ------------------------------------------------------ */

  function show(): void {
    if (!root.hidden) return;
    root.hidden = false;
    button.setAttribute("aria-expanded", "true");
    paint();
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function toggle(): void {
    if (root.hidden) show();
    else close();
  }

  return { root, button, paint, open: show, toggle, close };
}
