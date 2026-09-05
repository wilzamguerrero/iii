import { el } from "../dom.ts";
import { onMenuVisible } from "../afterIntro.ts";
import { mountProjectsTab } from "./projectsTab.ts";
import { mountNotionTab } from "./notionTab.ts";
import { mountAiTab } from "./aiTab.ts";

/**
 * La franja de abajo: Proyectos · Notion · IA.
 *
 * Vive fuera de `.stage` a propósito. Dentro heredaría el apilamiento del lienzo
 * y no podría quedar por encima; fuera puede además desplazar sólo la capa del
 * menú al abrirse, sin arrastrar la escena 3D con ella.
 *
 * Aparece cuando aparece el menú. No hay evento que lo anuncie —`main.js` se
 * limita a quitarle el atributo `hidden`—, así que se observa ese atributo en vez
 * de tocar `main.js`, que está calibrado y no se toca (plan.md §2).
 */

const OPEN_KEY = "3i.dock.open";
const TAB_KEY = "3i.dock.tab";

export type DockTab = "proyectos" | "notion" | "ia";

interface TabSpec {
  id: DockTab;
  label: string;
  mount: (container: HTMLElement) => void;
}

const TABS: readonly TabSpec[] = [
  { id: "proyectos", label: "Proyectos", mount: mountProjectsTab },
  { id: "notion", label: "Notion", mount: mountNotionTab },
  { id: "ia", label: "IA", mount: mountAiTab },
];

export interface Dock {
  reveal(): void;
  open(tab?: DockTab): void;
  close(): void;
}

function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* modo privado: da igual */ }
}

function recall(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function mountDock(): Dock {
  const chev = el("span", { class: "dock__chev", attrs: { "aria-hidden": "true" } });
  const handle = el("button", {
    class: "dock__handle",
    attrs: { type: "button", "aria-expanded": "false", "aria-controls": "dock-body" },
  }, [el("span", { text: "Espacio de trabajo" }), chev]);

  const tablist = el("div", {
    class: "dock__tabs",
    attrs: { role: "tablist", "aria-label": "Espacio de trabajo" },
  });
  const panes = el("div", { class: "dock__panes" });

  const buttons = new Map<DockTab, HTMLButtonElement>();
  const sections = new Map<DockTab, HTMLElement>();

  for (const tab of TABS) {
    const button = el("button", {
      class: "dock__tab",
      text: tab.label,
      attrs: {
        type: "button", role: "tab", id: `dock-tab-${tab.id}`,
        "aria-controls": `dock-pane-${tab.id}`, "aria-selected": "false", tabindex: -1,
      },
      on: { click: () => { select(tab.id); } },
    });
    const section = el("section", {
      class: "dock__pane",
      attrs: {
        role: "tabpanel", id: `dock-pane-${tab.id}`,
        "aria-labelledby": `dock-tab-${tab.id}`, tabindex: -1, hidden: true,
      },
    });
    buttons.set(tab.id, button);
    sections.set(tab.id, section);
    tablist.append(button);
    panes.append(section);
    tab.mount(section);
  }

  const body = el("div", { class: "dock__body", attrs: { id: "dock-body", inert: true } },
    [tablist, panes]);

  const dock = el("aside", {
    class: "dock",
    attrs: { id: "dock", "data-open": "false", hidden: true },
  }, [handle, body]);

  /* --- pestañas ---------------------------------------------------------- */

  let active: DockTab = (recall(TAB_KEY) as DockTab | null) ?? "proyectos";
  if (!buttons.has(active)) active = "proyectos";

  function select(id: DockTab, focus = false): void {
    active = id;
    remember(TAB_KEY, id);
    for (const tab of TABS) {
      const isActive = tab.id === id;
      const button = buttons.get(tab.id) as HTMLButtonElement;
      const section = sections.get(tab.id) as HTMLElement;
      button.setAttribute("aria-selected", String(isActive));
      // Un solo punto de entrada con el tabulador; dentro se navega con flechas.
      button.tabIndex = isActive ? 0 : -1;
      section.hidden = !isActive;
    }
    if (focus) buttons.get(id)?.focus();
  }

  tablist.addEventListener("keydown", (event) => {
    const order = TABS.map((tab) => tab.id);
    const index = order.indexOf(active);
    let next: DockTab | undefined;

    if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
    else if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order[order.length - 1];
    else return;

    event.preventDefault();
    if (next) select(next, true);
  });

  /* --- abrir y cerrar ---------------------------------------------------- */

  let open = false;

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    dock.dataset.open = String(next);
    handle.setAttribute("aria-expanded", String(next));
    // `inert` saca el cuerpo del recorrido del tabulador y del árbol de
    // accesibilidad mientras está fuera de cuadro, sin romper la transición como
    // haría `display: none`.
    if (next) body.removeAttribute("inert");
    else body.setAttribute("inert", "");
    document.body.dataset.dock = next ? "open" : "closed";
    remember(OPEN_KEY, next ? "1" : "0");
  }

  handle.addEventListener("click", () => { setOpen(!open); });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    // No se roba el Escape de un campo de texto: ahí sirve para limpiarlo.
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    setOpen(false);
    handle.focus();
  });

  /* --- entrada ----------------------------------------------------------- */

  let revealed = false;
  const startOpen = recall(OPEN_KEY) === "1";
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * `animate` en falso cuando la franja se va a abrir en el mismo gesto: la
   * animación de entrada fija la posición cerrada durante su medio segundo y
   * encadenarla con la apertura suma dos esperas para un solo movimiento.
   */
  function reveal(animate = true): void {
    if (revealed) return;
    revealed = true;
    dock.hidden = false;

    if (animate && !still) {
      dock.classList.add("is-in");
      // La animación de entrada termina en la posición cerrada y la fija con
      // `both`. Se quita la clase al acabar para devolver el mando a la
      // propiedad `transform`, que es la que abre y cierra.
      dock.addEventListener("animationend", () => { dock.classList.remove("is-in"); }, { once: true });
    }

    // Si quedó abierta la última vez, se abre después de entrar y no a la vez:
    // dos movimientos seguidos se leen; superpuestos, no. Con temporizador y no
    // con `animationend`, que con movimiento reducido no llega a dispararse.
    if (startOpen) setTimeout(() => { setOpen(true); }, still || !animate ? 0 : 760);
  }

  select(active);
  document.body.append(dock);
  document.body.dataset.dock = "closed";

  // El observador de `#menu` y el medio segundo de cortesía viven en
  // `afterIntro.ts`: el asa del asistente entra con la misma regla y no tiene
  // sentido que cada pieza vigile el atributo por su cuenta.
  onMenuVisible(() => { reveal(); });

  return {
    reveal: () => { reveal(); },

    open(tab) {
      const fresh = !revealed;
      reveal(!fresh);
      if (tab) select(tab);

      if (!fresh) {
        setOpen(true);
        return;
      }
      // Dos fotogramas para que el navegador haya calculado la posición cerrada
      // antes de pedirle la abierta. Sin esa lectura intermedia agrupa los dos
      // cambios y la transición no ocurre: aparecería abierta de golpe.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { setOpen(true); });
      });
    },

    close() { setOpen(false); },
  };
}
