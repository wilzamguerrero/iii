import { el, render } from "../dom.ts";
import { icon, type IconName } from "../icons.ts";
import { ACTIONS, type FragmentAction } from "./contextai.ts";

/**
 * Los iconos que salen al marcar un fragmento.
 *
 * Se pidió que «al seleccionar un texto aparezcan unos iconos para las
 * funciones que le pueden aportar», y aparecer **donde está la selección** es
 * la mitad del encargo: lo que se marca y lo que se le pide al respecto tienen
 * que estar a la vista a la vez, o hay que acordarse de lo que se marcó
 * mientras se busca el botón.
 *
 * Antes no se podía. El documento era un campo de texto y dentro de un
 * `<textarea>` no hay manera de saber en qué punto de la pantalla cae la
 * selección sin duplicar el campo en un espejo invisible, así que la barra vivía
 * clavada al pie de la hoja. Con el editor visual la selección es un rango del
 * documento y tiene su rectángulo: la barra se cuelga de él.
 *
 * Las seis acciones son las de `contextai.ts`, las mismas del clic derecho, y no
 * se duplican aquí: un solo sitio donde se decide qué se le puede pedir a un
 * fragmento. Ninguna reemplaza texto —todas contestan en el asistente—, que es
 * la línea que separa esto de una plataforma que escribe el párrafo por ti.
 *
 * Los iconos llevan su nombre en el `title` y, cuando hay sitio, también al
 * lado: un icono solo se aprende a la tercera vez y una investigación no se
 * hace todos los días.
 */

export interface ToolsOptions {
  /** Dónde vive el documento: sólo se atiende a lo marcado ahí dentro. */
  root: () => HTMLElement | null;
  /** El fragmento marcado ahora, en Markdown plano. */
  selected: () => string;
  /** Pedir una acción sobre el fragmento. */
  onAct: (action: FragmentAction, fragment: string) => void;
}

export interface Tools {
  root: HTMLElement;
  /** Mirar la selección y salir, moverse o esconderse según toque. */
  watch: () => void;
  /** Esconderla y recordar sobre qué, para que no vuelva sola. */
  hide: () => void;
  visible: () => boolean;
}

/** Lo que hace falta marcar para que valga la pena preguntar por ello. */
const MIN_SELECTION = 12;
/** Aire entre la barra y el borde de la ventana. */
const MARGIN = 10;
/** Separación entre la barra y el renglón marcado. */
const GAP = 8;

/**
 * Un icono por acción.
 *
 * Se eligen por lo que la acción hace y no por su inicial: preguntar es el
 * signo de interrogación, precisar es la diana, respaldar es el libro, y
 * parafrasear es el intercambio. Si mañana entra una acción nueva en
 * `contextai.ts` y no está aquí, lleva el icono de chispa, que es el de la IA:
 * la barra no se rompe por no conocerla.
 */
const GLYPH: Record<string, IconName> = {
  cuestionar: "ask",
  explicar: "bulb",
  precisar: "aim",
  resumir: "brief",
  respaldar: "book",
  parafrasear: "swap",
};

export function mountTools(options: ToolsOptions): Tools {
  const root = el("div", {
    class: "marca",
    attrs: { hidden: true, role: "toolbar", "aria-label": "Sobre lo marcado" },
  });

  /**
   * El fragmento con el que ya se hizo algo.
   *
   * Pedir una acción lleva el foco a la ventana del asistente, y mover el foco
   * avisa de que la selección cambió. Ese aviso vuelve a mirar lo marcado —que
   * sigue marcado, porque el texto no se toca— y devolvería la barra un instante
   * después de haberla quitado. Así que se recuerda para qué se quitó: mientras
   * siga marcado eso mismo, no vuelve; en cuanto se marque otra cosa, sí.
   */
  let usedOn = "";

  render(root, ...ACTIONS.map((action) => el("button", {
    class: "marca__b",
    attrs: {
      type: "button",
      title: `${action.label}: ${action.title}`,
      "aria-label": action.label,
      "data-id": action.id,
    },
    on: {
      // Con el ratón abajo la selección todavía no se ha soltado: si el
      // navegador le da el foco al botón, se deshace antes de poder usarla.
      mousedown: (event) => { event.preventDefault(); },
      click: () => {
        const fragment = options.selected();
        if (fragment.length < MIN_SELECTION) return;
        hide();
        options.onAct(action, fragment);
      },
    },
  }, [
    icon(GLYPH[action.id] ?? "spark", "ico ico--small"),
    el("span", { class: "marca__say", text: action.label }),
  ])));

  function visible(): boolean {
    return !root.hidden;
  }

  function hide(): void {
    if (root.hidden) return;
    root.hidden = true;
    usedOn = options.selected();
  }

  function watch(): void {
    const fragment = options.selected();

    if (fragment.length < MIN_SELECTION) {
      usedOn = "";
      root.hidden = true;
      return;
    }
    if (fragment === usedOn) {
      root.hidden = true;
      return;
    }

    usedOn = "";
    const box = rect(options.root());
    if (!box) { root.hidden = true; return; }

    // Enseñarla antes de medirla: oculta no tiene tamaño y se colocaría en la
    // esquina. Un repintado no se ve porque ocurre en el mismo fotograma.
    root.hidden = false;
    place(box);
  }

  function place(box: DOMRect): void {
    const size = root.getBoundingClientRect();
    const width = size.width || 280;

    // Encima del renglón marcado, que es donde no tapa lo que se acaba de
    // leer. Si no cabe arriba —el fragmento está en la primera línea—, debajo.
    let top = box.top - size.height - GAP;
    if (top < MARGIN) {
      const below = box.bottom + GAP;
      top = below + size.height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, window.innerHeight - size.height - MARGIN);
    }

    const middle = box.left + box.width / 2 - width / 2;
    const left = Math.max(MARGIN, Math.min(middle, window.innerWidth - width - MARGIN));

    root.style.top = `${Math.round(top)}px`;
    root.style.left = `${Math.round(left)}px`;
  }

  // Al desplazar la hoja la barra se esconde en vez de perseguir el renglón:
  // perseguirlo pide medir en cada fotograma, y una barra que se mueve mientras
  // se lee es peor que una que espera a que se vuelva a marcar.
  const gone = (): void => { if (!root.hidden) root.hidden = true; };
  document.addEventListener("scroll", gone, true);
  window.addEventListener("resize", gone);

  return { root, watch, hide, visible };
}

/**
 * El rectángulo de lo marcado, si está dentro del documento.
 *
 * Se pide el del **primer** trozo del rango y no el del conjunto: una selección
 * de varios párrafos tiene un rectángulo alto como la pantalla, y colgarse de su
 * borde pondría la barra lejísimos del sitio donde empieza lo marcado. Un rango
 * plegado —o uno en un elemento sin caja— no da rectángulo, y entonces no hay
 * dónde colgarla.
 */
function rect(root: HTMLElement | null): DOMRect | null {
  if (!root) return null;
  const now = window.getSelection();
  if (!now || now.rangeCount === 0 || now.isCollapsed) return null;

  const range = now.getRangeAt(0);
  const inside = range.commonAncestorContainer;
  const node = inside instanceof Element ? inside : inside.parentElement;
  if (!node || !root.contains(node)) return null;

  const first = range.getClientRects()[0];
  if (first && first.width > 0) return first;
  const whole = range.getBoundingClientRect();
  return whole.width > 0 || whole.height > 0 ? whole : null;
}
