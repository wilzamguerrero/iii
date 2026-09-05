import { el } from "../dom.ts";
import { icon } from "../icons.ts";
import type { Crumb } from "./folders.ts";

/**
 * Las pestañas de la franja.
 *
 * No son las de antes. La franja tuvo pestañas de *sección* —Proyectos · Notion ·
 * IA— y se quitaron porque partían una sola pantalla en tres sitios a los que
 * había que ir y volver (plan.md §12, D6). Éstas son de *sitio*: cada una es una
 * carpeta abierta, como las de un navegador. Sirven para lo que las otras no
 * servían —tener dos carpetas a la vista y mover la mirada de una a otra— y no
 * esconden nada que hubiera que buscar.
 *
 * Cada pestaña tiene su propia pantalla montada y viva. Cambiar de pestaña sólo
 * enseña la que ya estaba: no se vuelve a pedir nada a Notion, que admite unas
 * tres peticiones por segundo y no hay que gastarlas en volver a mirar lo mismo.
 * Por eso se esconden con `hidden` en vez de tirarlas.
 *
 * No se guardan entre visitas, igual que no se guarda qué documento estaba
 * abierto: al volver, el sitio de partida es el mismo para todo el mundo.
 */

export interface TabSlots {
  /** La fila fija de arriba de esta pestaña. */
  head: HTMLElement;
  /** El cuerpo que se desplaza. */
  pane: HTMLElement;
  /** Dónde abrirla, si nace desde otra. */
  seedPath?: readonly Crumb[];
  /** Cómo se llama ahora mismo. Lo dice la pantalla, no la pestaña. */
  setLabel: (text: string) => void;
  /** Abrir otra pestaña en ese camino. */
  openTab: (path: readonly Crumb[]) => void;
}

export interface TabApp {
  dispose(): void;
}

export interface TabsOptions {
  /** Monta la pantalla de una pestaña recién creada. */
  mount: (slots: TabSlots) => TabApp;
  /** Se pulsó la pestaña que ya estaba activa: la franja se pliega. */
  toggle?: () => void;
  /** Se activó otra pestaña o nació una: la franja tiene que estar abierta. */
  reveal?: () => void;
}

export interface Tabs {
  /** Lo que va en la franja de arriba. */
  strip: HTMLElement;
  /** El contenedor de las pantallas. */
  views: HTMLElement;
  /** Abre una nueva y la activa. */
  open: (path?: readonly Crumb[]) => void;
}

interface Sheet {
  wrap: HTMLElement;
  pick: HTMLButtonElement;
  name: HTMLElement;
  shut: HTMLButtonElement;
  view: HTMLElement;
  app: TabApp;
}

const FALLBACK = "Espacio de trabajo";

export function mountTabs(options: TabsOptions): Tabs {
  const list = el("div", {
    class: "tabs__list",
    attrs: { role: "tablist", "aria-label": "Carpetas abiertas" },
  });

  const add = el("button", {
    class: "tabs__new",
    attrs: { type: "button", title: "Nueva pestaña", "aria-label": "Nueva pestaña" },
    on: { click: () => { open(); } },
  }, [icon("plus", "ico ico--small")]);

  const strip = el("div", { class: "tabs" }, [list, add]);
  const views = el("div", { class: "dock__views" });

  const sheets: Sheet[] = [];
  let active: Sheet | null = null;
  let count = 0;

  /**
   * Sólo la activa es alcanzable con el tabulador —ella y su cruz—; entre
   * pestañas se anda con las flechas. Es lo que se espera de una fila de
   * pestañas, y evita que tabular cruce catorce paradas para llegar al cuerpo.
   */
  function mark(): void {
    for (const sheet of sheets) {
      const on = sheet === active;
      sheet.pick.setAttribute("aria-selected", String(on));
      sheet.pick.tabIndex = on ? 0 : -1;
      sheet.shut.tabIndex = on ? 0 : -1;
      sheet.shut.hidden = sheets.length < 2;
      sheet.view.hidden = !on;
      sheet.wrap.classList.toggle("is-on", on);
    }
  }

  function activate(sheet: Sheet, focus = false): void {
    active = sheet;
    mark();
    if (focus) sheet.pick.focus();
    sheet.wrap.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  function drop(sheet: Sheet): void {
    // La última no se cierra: la franja sin pestañas no sería nada.
    if (sheets.length < 2) return;
    const index = sheets.indexOf(sheet);
    if (index < 0) return;

    sheets.splice(index, 1);
    sheet.app.dispose();
    sheet.wrap.remove();
    sheet.view.remove();

    if (active === sheet) {
      // La de la derecha, o la última si se cerró la de la punta.
      const next = sheets[Math.min(index, sheets.length - 1)];
      if (next) activate(next, true);
    } else {
      mark();
    }
  }

  function create(path?: readonly Crumb[]): Sheet {
    const id = ++count;
    const tabId = `dock-tab-${id}`;
    const viewId = `dock-view-${id}`;

    const head = el("div", { class: "dock__head" });
    const pane = el("div", { class: "dock__pane" });
    const view = el("div", {
      class: "dock__view",
      attrs: { id: viewId, role: "tabpanel", "aria-labelledby": tabId, hidden: true },
    }, [head, pane]);

    const name = el("span", { class: "tab__name", text: FALLBACK });
    const pick = el("button", {
      class: "tab__pick",
      attrs: {
        type: "button", role: "tab", id: tabId, "aria-controls": viewId,
        "aria-selected": "false", tabindex: -1,
      },
    }, [name]);

    const shut = el("button", {
      class: "tab__x",
      attrs: { type: "button", "aria-label": "Cerrar pestaña", tabindex: -1, hidden: true },
    }, [icon("cross", "ico ico--small")]);

    const wrap = el("div", { class: "tab" }, [pick, shut]);

    const sheet: Sheet = {
      wrap, pick, name, shut, view,
      app: options.mount({
        head,
        pane,
        ...(path && path.length > 0 ? { seedPath: path } : {}),
        setLabel(text) {
          const clean = text.trim() || FALLBACK;
          name.textContent = clean;
          pick.title = clean;
          shut.setAttribute("aria-label", `Cerrar ${clean}`);
        },
        openTab(next) { open(next); },
      }),
    };

    pick.addEventListener("click", () => {
      // Pulsar la que ya está abierta pliega la franja: es el mismo gesto que en
      // el asa, y así la pestaña activa sirve de interruptor.
      if (active === sheet) { options.toggle?.(); return; }
      activate(sheet);
      options.reveal?.();
    });

    shut.addEventListener("click", (event) => {
      event.stopPropagation();
      drop(sheet);
    });

    // El botón de en medio cierra, como en cualquier navegador. Y se le quita al
    // ratón el desplazamiento automático, que si no se queda pegado al puntero.
    wrap.addEventListener("pointerdown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    wrap.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      drop(sheet);
    });

    sheets.push(sheet);
    list.append(wrap);
    views.append(view);
    return sheet;
  }

  function open(path?: readonly Crumb[]): void {
    activate(create(path));
    options.reveal?.();
  }

  list.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = sheets.findIndex((sheet) => sheet === active);
    const next = sheets[(index + step + sheets.length) % sheets.length];
    if (next) activate(next, true);
  });

  // La primera nace con la franja, sin abrirla: al cargar la página nadie ha
  // pedido nada todavía.
  activate(create());

  return { strip, views, open };
}
