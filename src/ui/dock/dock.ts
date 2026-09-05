import { el } from "../dom.ts";
import { onMenuVisible } from "../afterIntro.ts";
import { closeMenu } from "./menu.ts";
import { mountTabs } from "./tabs.ts";
import { mountTray } from "./tray.ts";
import { mountWorkspace } from "./workspace.ts";

/**
 * La franja de abajo: el espacio de trabajo.
 *
 * Es una pestaña que asoma desde abajo. No llega a los bordes: se separa a los
 * lados, y así se lee como una hoja que sube por delante de la página en vez de
 * como un borde de la ventana. Por eso es el mismo objeto que la ventana del
 * asistente —1 px de borde, esquinas de `--r-panel`, `--shadow`— y no un mueble
 * aparte: en esta interfaz todo lo que flota se parece.
 *
 * Plegada queda a la vista sólo su filo de arriba, y ese filo es la barra de
 * pestañas: el nombre de dónde estás, y a la derecha la bandeja. Los ajustes se
 * alcanzan sin abrir nada.
 *
 * Tuvo pestañas de *sección* —Proyectos · Notion · IA— y se quitaron (plan.md
 * §12, D6): partían una pantalla en tres sitios a los que había que ir y volver.
 * Las de ahora son de *sitio*, como las de un navegador: cada una es una carpeta
 * abierta. Lo que se descartó fue esconder secciones, no poder mirar dos cosas.
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

export interface Dock {
  reveal(): void;
  open(): void;
  close(): void;
}

function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* modo privado: da igual */ }
}

function recall(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function mountDock(): Dock {
  // Declarados antes de armar nada: las piezas de dentro reciben devoluciones que
  // tocan este estado, y una de ellas podría llamarla mientras se monta.
  let open = false;
  let revealed = false;

  const chev = el("span", { class: "dock__chev", attrs: { "aria-hidden": "true" } });
  const toggle = el("button", {
    class: "dock__toggle",
    attrs: {
      type: "button", "aria-expanded": "false", "aria-controls": "dock-body",
      title: "Espacio de trabajo", "aria-label": "Abrir el espacio de trabajo",
    },
  }, [chev]);

  /**
   * Cada pestaña monta su propia pantalla y la conserva viva mientras exista, así
   * que cambiar de pestaña no cuesta ninguna petición a Notion. `mountWorkspace`
   * se encarga de que lo compartido —de quién es la sesión, qué raíz, qué error—
   * sea igual en todas.
   */
  const tabs = mountTabs({
    mount: (slots) => mountWorkspace(slots),
    toggle: () => { setOpen(false); },
    reveal: () => { openDock(); },
  });

  const tray = mountTray({ openDock: () => { openDock(); } });

  /** El filo: lo único que se ve plegada. */
  const strip = el("div", { class: "dock__strip" }, [toggle, tabs.strip, tray.root]);

  const body = el("div", { class: "dock__body", attrs: { id: "dock-body", inert: true } },
    [tabs.views]);

  const dock = el("aside", {
    class: "dock",
    attrs: { id: "dock", "data-open": "false", hidden: true },
  }, [strip, body]);

  /* --- abrir y cerrar ---------------------------------------------------- */

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    dock.dataset.open = String(next);
    toggle.setAttribute("aria-expanded", String(next));
    toggle.setAttribute("aria-label",
      next ? "Cerrar el espacio de trabajo" : "Abrir el espacio de trabajo");
    // `inert` saca el cuerpo del recorrido del tabulador y del árbol de
    // accesibilidad mientras está fuera de cuadro, sin romper la transición como
    // haría `display: none`.
    if (next) body.removeAttribute("inert");
    else body.setAttribute("inert", "");
    document.body.dataset.dock = next ? "open" : "closed";
    remember(OPEN_KEY, next ? "1" : "0");

    // Lo que cuelga del `<body>` está anclado a un botón que acaba de moverse
    // medio panel hacia arriba o hacia abajo. Se cierra en vez de recolocarse:
    // el movimiento dura y una ventanita persiguiéndolo se lee como un error.
    tray.close();
    closeMenu(false);
  }

  toggle.addEventListener("click", () => {
    if (open) { setOpen(false); return; }
    openDock();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    // No se roba el Escape de un campo de texto: ahí sirve para limpiarlo.
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    setOpen(false);
    toggle.focus();
  });

  /* --- entrada ----------------------------------------------------------- */

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

  /** Abrirla desde fuera, esté ya a la vista o no. */
  function openDock(): void {
    const fresh = !revealed;
    reveal(!fresh);

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
  }

  document.body.append(dock);
  document.body.dataset.dock = "closed";

  // El observador de `#menu` y el medio segundo de cortesía viven en
  // `afterIntro.ts`: el asa del asistente entra con la misma regla y no tiene
  // sentido que cada pieza vigile el atributo por su cuenta.
  onMenuVisible(() => { reveal(); });

  return {
    reveal: () => { reveal(); },
    open: () => { openDock(); },
    close: () => { setOpen(false); },
  };
}
