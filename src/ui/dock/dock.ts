import { el } from "../dom.ts";
import { onMenuVisible } from "../afterIntro.ts";
import { mountWorkspace } from "./workspace.ts";

/**
 * La franja de abajo: el espacio de trabajo.
 *
 * Tenía tres pestañas —Proyectos · Notion · IA— y ya no tiene ninguna. La de IA
 * se fue a la ventana del asistente, que es donde se usa lo que configura; la de
 * Notion se disolvió dentro de Proyectos, porque conectar es el primer paso de
 * esa pantalla y no un sitio aparte. Lo que queda es una cosa sola, y una cosa
 * sola no necesita pestañas: la fila de arriba dice dónde estás dentro de las
 * carpetas y el cuerpo muestra su contenido.
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
  const chev = el("span", { class: "dock__chev", attrs: { "aria-hidden": "true" } });
  const handle = el("button", {
    class: "dock__handle",
    attrs: { type: "button", "aria-expanded": "false", "aria-controls": "dock-body" },
  }, [el("span", { text: "Espacio de trabajo" }), chev]);

  /**
   * La fila de arriba se queda fija y sólo el cuerpo se desplaza: al bajar por
   * una carpeta larga, el camino de vuelta tiene que seguir a la vista. Está
   * vacía mientras no haya carpetas que recorrer, y vacía no ocupa (`:empty`).
   */
  const head = el("div", { class: "dock__head" });
  const pane = el("div", { class: "dock__pane" });

  const body = el("div", { class: "dock__body", attrs: { id: "dock-body", inert: true } },
    [head, pane]);

  const dock = el("aside", {
    class: "dock",
    attrs: { id: "dock", "data-open": "false", hidden: true },
  }, [handle, body]);

  mountWorkspace({ head, pane });

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

  document.body.append(dock);
  document.body.dataset.dock = "closed";

  // El observador de `#menu` y el medio segundo de cortesía viven en
  // `afterIntro.ts`: el asa del asistente entra con la misma regla y no tiene
  // sentido que cada pieza vigile el atributo por su cuenta.
  onMenuVisible(() => { reveal(); });

  return {
    reveal: () => { reveal(); },

    open() {
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
    },

    close() { setOpen(false); },
  };
}
