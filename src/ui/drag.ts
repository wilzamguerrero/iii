/**
 * «Ponlo donde quieras».
 *
 * El asa del asistente y su ventana se colocan a mano y se quedan donde se las
 * deja, también al recargar. Es el patrón del proyecto de referencia —captura de
 * puntero, umbral de cuatro píxeles y posición guardada— sin su parte de React.
 *
 * Dos detalles que no son de adorno:
 *
 * - El umbral distingue arrastrar de pulsar. Sin él, mover el asa un píxel
 *   abriría el asistente al soltarlo.
 * - Con el asa enfocada, las flechas también la mueven. Quien no usa ratón
 *   tiene derecho a colocarla igual.
 */

const PREFIX = "3i.pos.";
/** Píxeles que hay que recorrer para que deje de ser una pulsación. */
const THRESHOLD = 4;
/** Aire mínimo contra el borde de la ventana. */
const MARGIN = 8;
const STEP = 8;
const BIG_STEP = 24;
/** Cuánto dura la sospecha de que lo que viene es el clic del arrastre. */
const TAP_GUARD_MS = 250;

export interface Point { x: number; y: number }

export interface MovableOptions {
  /** Con qué nombre se recuerda la posición. */
  name: string;
  /** Lo que se agarra. Por omisión, el propio nodo. */
  grip?: HTMLElement;
  /** Dónde ponerlo la primera vez, cuando no hay nada guardado. */
  initial: (viewport: Point, size: Point) => Point;
}

export interface Movable {
  /** Coloca el nodo: lo guardado si cabe, o la posición inicial. */
  place(): void;
  /** Cierto justo después de un arrastre, para no abrir lo que se movía. */
  dragged(): boolean;
  /** Lo lleva a la posición inicial y olvida lo guardado. */
  reset(): void;
}

function stored(name: string): Point | null {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Point>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function remember(name: string, point: Point): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(point));
  } catch {
    // Modo privado: la posición vale para esta sesión.
  }
}

export function makeMovable(node: HTMLElement, options: MovableOptions): Movable {
  const grip = options.grip ?? node;
  let moved = false;
  let guard = 0;

  /** Nunca fuera de la ventana: al reducirla, lo de fuera volvería inalcanzable. */
  function clamp(point: Point): Point {
    const maxX = Math.max(MARGIN, window.innerWidth - node.offsetWidth - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - node.offsetHeight - MARGIN);
    return {
      x: Math.min(Math.max(point.x, MARGIN), maxX),
      y: Math.min(Math.max(point.y, MARGIN), maxY),
    };
  }

  function apply(point: Point): void {
    node.style.left = `${point.x}px`;
    node.style.top = `${point.y}px`;
  }

  function current(): Point {
    return { x: node.offsetLeft, y: node.offsetTop };
  }

  function place(): void {
    const size = { x: node.offsetWidth, y: node.offsetHeight };
    const viewport = { x: window.innerWidth, y: window.innerHeight };
    apply(clamp(stored(options.name) ?? options.initial(viewport, size)));
  }

  function moveTo(point: Point, save: boolean): void {
    const next = clamp(point);
    apply(next);
    if (save) remember(options.name, next);
  }

  grip.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;

    // Un campo o un botón dentro del asa —la «x» de cerrar— se pulsa, no arrastra.
    const inner = (down.target as Element | null)?.closest("button, a, input, textarea, select");
    if (inner && inner !== grip) return;

    const from = { x: down.clientX, y: down.clientY };
    const origin = current();
    let dragging = false;
    moved = false;
    window.clearTimeout(guard);

    grip.setPointerCapture(down.pointerId);

    const onMove = (event: PointerEvent): void => {
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (!dragging && Math.hypot(dx, dy) < THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        node.classList.add("is-moving");
      }
      event.preventDefault();
      moveTo({ x: origin.x + dx, y: origin.y + dy }, false);
    };

    const onUp = (): void => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
      node.classList.remove("is-moving");
      if (!dragging) return;

      remember(options.name, current());
      moved = true;
      // El clic del propio arrastre llega justo después; el resto del tiempo,
      // `moved` debe volver a ser falso o el teclado dejaría de abrirlo.
      guard = window.setTimeout(() => { moved = false; }, TAP_GUARD_MS);
    };

    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });

  grip.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const delta: Point = { x: 0, y: 0 };
    if (event.key === "ArrowLeft") delta.x = -step;
    else if (event.key === "ArrowRight") delta.x = step;
    else if (event.key === "ArrowUp") delta.y = -step;
    else if (event.key === "ArrowDown") delta.y = step;
    else return;

    event.preventDefault();
    const from = current();
    moveTo({ x: from.x + delta.x, y: from.y + delta.y }, true);
  });

  // Al cambiar el tamaño de la ventana se vuelve a encajar sin olvidar dónde
  // estaba: si luego se agranda, sigue queriendo estar en su sitio.
  window.addEventListener("resize", () => { apply(clamp(current())); });

  return {
    place,
    dragged: () => moved,
    reset: () => {
      try { localStorage.removeItem(PREFIX + options.name); } catch { /* nada */ }
      place();
    },
  };
}
