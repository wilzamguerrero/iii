import { el, render } from "../dom.ts";

/**
 * El menú de una baldosa.
 *
 * Va colgado del `<body>` y no del sitio donde se pulsó, por dos razones que
 * pesan: la franja recorta lo que se sale de ella (`overflow: hidden`, es lo que
 * le da las esquinas redondeadas) y el menú necesita poder salirse; y así el
 * mismo menú sirve para una baldosa dentro de la franja y para un icono de la
 * bandeja cuando la franja está cerrada.
 *
 * Sólo hay uno abierto a la vez. Abrir otro cierra el anterior, que es lo que
 * uno espera de un menú contextual y ahorra tener que acordarse de cerrarlo.
 *
 * Lo que borra pregunta antes: el elemento cambia su etiqueta por «¿Seguro?» y
 * hay que volver a pulsarlo. Es la misma gramática que ya tenían los botones de
 * eliminar de las filas, y evita un `confirm()` del navegador, que en esta
 * página se vería como lo que es: otra aplicación interrumpiendo.
 */

export interface MenuItem {
  label: string;
  run: () => void;
  /** Pinta la acción como algo que quita, no que lleva a otro sitio. */
  risk?: boolean;
  /** Pide una segunda pulsación antes de ejecutar. */
  confirm?: boolean;
  /** Lo que dice el elemento ya armado. Ahí cabe la consecuencia entera. */
  confirmLabel?: string;
}

export interface MenuAt {
  /** Esquina desde la que crece el menú, en coordenadas de ventana. */
  x: number;
  y: number;
  /** Alto del elemento que lo abrió, para no taparlo al crecer hacia abajo. */
  below?: number;
}

interface Live {
  root: HTMLElement;
  giveBack: HTMLElement | null;
  off: () => void;
}

const MARGIN = 8;
let live: Live | null = null;

export function closeMenu(giveFocus = true): void {
  if (!live) return;
  const { root, giveBack, off } = live;
  live = null;
  off();
  root.remove();
  if (giveFocus && giveBack?.isConnected) giveBack.focus();
}

export function menuIsOpen(): boolean {
  return live !== null;
}

/** Abre el menú junto a un punto. Devuelve nada: se cierra solo. */
export function openMenu(at: MenuAt, items: readonly MenuItem[]): void {
  closeMenu(false);
  if (items.length === 0) return;

  const giveBack = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const root = el("div", { class: "menu-pop", attrs: { role: "menu" } });
  const buttons: HTMLButtonElement[] = [];

  for (const item of items) {
    let armed = false;
    const button = el("button", {
      class: `menu-pop__item${item.risk ? " menu-pop__item--risk" : ""}`,
      text: item.label,
      attrs: { type: "button", role: "menuitem" },
      on: {
        click: () => {
          if (item.confirm && !armed) {
            armed = true;
            button.textContent = item.confirmLabel ?? "¿Seguro?";
            button.classList.add("is-armed");
            return;
          }
          closeMenu(false);
          item.run();
        },
      },
    });
    buttons.push(button);
  }

  render(root, ...buttons);
  document.body.append(root);
  place(root, at);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation(); // Que no cierre además la franja entera.
      closeMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = buttons.findIndex((b) => b === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = (index + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const onOutside = (event: Event): void => {
    if (event.target instanceof Node && root.contains(event.target)) return;
    closeMenu(false);
  };

  // El propio gesto que abre el menú termina de propagarse después de esto: si
  // se escuchara ya, el `pointerdown` que lo abrió lo cerraría en el acto.
  const arm = setTimeout(() => {
    document.addEventListener("pointerdown", onOutside, true);
  }, 0);

  const scrolled = (): void => { closeMenu(false); };
  root.addEventListener("keydown", onKey);
  window.addEventListener("resize", scrolled);
  // En captura: lo que desplaza es el panel de la franja, no la ventana.
  document.addEventListener("scroll", scrolled, true);

  live = {
    root,
    giveBack,
    off: () => {
      clearTimeout(arm);
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("resize", scrolled);
      document.removeEventListener("scroll", scrolled, true);
    },
  };

  buttons[0]?.focus();
}

/** Junto al punto, o al otro lado si por ahí no cabe. */
function place(root: HTMLElement, at: MenuAt): void {
  const box = root.getBoundingClientRect();
  const below = at.y + (at.below ?? 0);

  let top = below;
  if (below + box.height + MARGIN > window.innerHeight) {
    const above = at.y - box.height;
    top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - box.height - MARGIN);
  }

  const left = Math.max(
    MARGIN,
    Math.min(at.x, window.innerWidth - box.width - MARGIN),
  );

  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;
  root.classList.add("is-in");
}

/** El punto de un elemento: el menú cuelga de su esquina inferior izquierda. */
export function anchorOf(node: Element): MenuAt {
  const box = node.getBoundingClientRect();
  return { x: box.left, y: box.top, below: box.height + 4 };
}
