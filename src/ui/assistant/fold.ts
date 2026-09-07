import { el } from "../dom.ts";

/**
 * El pliego: la ventana del asistente llega volando del papel y se despliega.
 *
 * De `reference/PFold-master` se toma la técnica —bisagras anidadas con
 * `preserve-3d`, giro de 180° sobre el borde del pliegue, un velo por capa— y no
 * el código: el plugin clona el contenido dentro de un envoltorio por cada
 * pliegue, y aquí eso rompería el campo de texto, el foco, el desplazamiento del
 * registro y las suscripciones vivas de la ventana. También se corrige lo que en
 * PFold se lee como rígido: pliegues seguidos con retardo fijo y curva lineal.
 *
 * Lo que se dobla es un pliego de papel en blanco, no la ventana. La ventana
 * aparece opaca en el fotograma en que el papel acaba de desplegarse —el último
 * fotograma del pliego es su rectángulo exacto, con el mismo `--paper` y las
 * mismas esquinas— y su contenido entra después. Cuatro razones, todas de
 * producción:
 *
 * - el texto dentro de un `rotateX/Y` sale borroso en Chromium y repinta el
 *   registro desplazable en cada fotograma;
 * - el campo, el foco, la selección y el `aria-live` del registro no se tocan;
 * - el velo de cada capa necesita una capa encima de cada cara, y sobre la
 *   ventana viva no hay dónde ponerla;
 * - los quince nodos se construyen y se tiran en cada gesto, sin dejar nada.
 *
 * No hay fundido cruzado a propósito: dos papeles al 50 % dejarían ver el fondo
 * un instante.
 *
 * Y no se usa `filter: drop-shadow` en ninguna parte de aquí dentro: aplana el
 * contexto 3D y mataría el pliegue. La sombra es un nodo aparte con `box-shadow`.
 *
 * El estado de la ventana —`hidden`, `aria-expanded`, el foco— no está aquí: es
 * inmediato y lo pone `assistant.ts`. Esto es adorno, y el adorno no retrasa lo
 * que anuncia un lector de pantalla.
 */

/* --- la figura ------------------------------------------------------------ */

/** Por qué eje parte un pliegue: `x` dobla el ancho, `y` dobla el alto. */
type Axis = "x" | "y";

/** En qué esquina descansa el paquete. Es la que tiene el asa más cerca. */
interface Anchor { x: "left" | "right"; y: "top" | "bottom" }

interface Box { x: number; y: number; w: number; h: number }

/**
 * Los pliegues, en el orden en que se **abren**: primero se dobla el ancho y
 * después el alto dos veces. Es un cuarto de pliego, y en reposo el paquete mide
 * medio ancho por un cuarto de alto.
 *
 * Cambiar esta lista cambia el origami y nada más: los tiempos, el reparto del
 * árbol, el tamaño del paquete y los saltos de la sombra salen todos de aquí.
 */
const CREASES: readonly Axis[] = ["x", "y", "y"];

/** Entre estos dos instantes del reloj cabe todo el plegado. */
const FOLD_FROM = 0.2;
const FOLD_TO = 0.92;

/**
 * Cada pliegue arranca cuando el anterior va por aquí. Es lo único que separa
 * esto de PFold: allí un pliegue espera a que acabe el otro y se lee como una
 * máquina haciendo tres cosas seguidas; solapados se lee como papel.
 */
const OVERLAP = 0.42;

interface Step { axis: Axis; from: number; to: number }

/**
 * Los pliegues emparejados con su momento y puestos en el orden en que se reparte
 * el árbol: el último que se abre es el primero que se parte, porque al desdoblar
 * un papel se deshace primero el doblez que se hizo al final.
 */
const FOLDS: readonly Step[] = ((): readonly Step[] => {
  const n = CREASES.length;
  const span = (FOLD_TO - FOLD_FROM) / (1 + (n - 1) * OVERLAP);
  return CREASES
    .map((axis, i) => {
      const from = FOLD_FROM + i * OVERLAP * span;
      return { axis, from, to: from + span };
    })
    .reverse();
})();

/* --- el reloj ------------------------------------------------------------- */

const DUR_OPEN = 640;
/** Cerrar es más corto: recoger no es un descubrimiento. */
const DUR_CLOSE = 300;

/** El vuelo desde el asa, y lo que tarda el paquete en crecer. */
const FLY_TO = 0.26;
const GROW_TO = 0.32;

/** Cuando el pliego ya es el rectángulo de la ventana, releva. */
const RELAY = FOLD_TO;
const RELAY_END = RELAY + 0.03;

/**
 * El paquete sale del asa a un tercio: del orden de sus 44 píxeles, un pelo más
 * grande para que se vea salir. Menos que esto y lo que sale es una raya.
 */
const SEED = 0.34;
/** Y sale torcido, como queda el papel del asa cuando está abierta. */
const TILT = -14;

/** Grosor del papel: cada capa se levanta esto sobre la de debajo. */
const LIFT = 0.6;
/** Cuánto oscurece cada capa que un trozo de papel tenga encima. */
const SHADE = 0.06;

/* --- ayudas --------------------------------------------------------------- */

const curves = new Map<string, string>();

/**
 * Las curvas viven en `tokens.css` y la API de animaciones no lee variables, así
 * que se leen de la raíz en vez de copiarlas aquí: una sola fuente de verdad.
 */
function curve(name: string): string {
  const known = curves.get(name);
  if (known !== undefined) return known;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ease = value === "" ? "ease" : value;
  curves.set(name, ease);
  return ease;
}

/**
 * Un tramo dentro del reloj único: quieto hasta `a`, se mueve hasta `b`, quieto
 * hasta el final.
 *
 * Todo se declara con la misma duración y el escalonado va en los `offset`. Eso
 * vuelve la coreografía entera un solo guion, que se puede invertir en marcha
 * desde donde esté sin un salto.
 */
function span(
  a: number,
  b: number,
  from: Record<string, string>,
  to: Record<string, string>,
  ease: string,
): Keyframe[] {
  const frames: Keyframe[] = [{ offset: 0, ...from, easing: a > 0 ? "linear" : ease }];
  if (a > 0) frames.push({ offset: a, ...from, easing: ease });
  frames.push({ offset: b, ...to, easing: "linear" });
  if (b < 1) frames.push({ offset: 1, ...to });
  return frames;
}

function place(node: HTMLElement, at: Box): void {
  node.style.left = `${at.x}px`;
  node.style.top = `${at.y}px`;
  node.style.width = `${at.w}px`;
  node.style.height = `${at.h}px`;
}

interface Hinge { origin: string; turn: "rotateX" | "rotateY"; deg: number }

/**
 * La bisagra de un faldón: el borde que comparte con la mitad que se queda, y el
 * signo del giro.
 *
 * Con el eje +z hacia quien mira, `rotateY` positivo lleva lo que está a la
 * izquierda del origen hacia fuera de la pantalla, y `rotateX` negativo hace lo
 * mismo con lo que está encima. Con los signos al revés el papel se doblaría
 * hacia dentro del monitor, que es lo que delata un pliegue de mentira.
 */
function hinge(axis: Axis, first: boolean): Hinge {
  if (axis === "x") {
    return first
      ? { origin: "100% 50%", turn: "rotateY", deg: 180 }
      : { origin: "0% 50%", turn: "rotateY", deg: -180 };
  }
  return first
    ? { origin: "50% 100%", turn: "rotateX", deg: -180 }
    : { origin: "50% 0%", turn: "rotateX", deg: 180 };
}

/**
 * La mitad que se queda es la del lado del ancla. Al doblarse, el faldón cae
 * sobre ella dando la vuelta, así que dentro del faldón el ancla es la contraria
 * en ese eje: es lo que hace que las ocho hojas acaben apiladas sobre la misma.
 */
function mirror(anchor: Anchor, axis: Axis): Anchor {
  return axis === "x"
    ? { x: anchor.x === "left" ? "right" : "left", y: anchor.y }
    : { x: anchor.x, y: anchor.y === "top" ? "bottom" : "top" };
}

/** El rectángulo del paquete en reposo: la mitad que se queda de cada pliegue. */
function packetOf(sheet: Box, anchor: Anchor): Box {
  let box = sheet;
  for (const step of FOLDS) {
    box = step.axis === "x"
      ? { x: box.x + (anchor.x === "left" ? 0 : box.w / 2), y: box.y, w: box.w / 2, h: box.h }
      : { x: box.x, y: box.y + (anchor.y === "top" ? 0 : box.h / 2), w: box.w, h: box.h / 2 };
  }
  return box;
}

/**
 * El velo de una hoja: una capa por cada pliegue que tenga encima, y cada capa se
 * aclara cuando su pliegue abre. Es lo que hace que el paquete se lea como papel
 * doblado varias veces y no como un gris que baja.
 *
 * La función es lineal a trozos y sus vértices son justo los extremos de los
 * tramos, así que muestrearla ahí y dejar que la animación interpole recto la
 * reproduce exacta.
 */
function veilFrames(ups: readonly Step[]): Keyframe[] {
  const stops = [...new Set([0, ...ups.flatMap((s) => [s.from, s.to]), 1])].sort((x, y) => x - y);
  return stops.map((offset) => {
    let layers = 0;
    for (const s of ups) {
      layers += Math.min(1, Math.max(0, (s.to - offset) / (s.to - s.from)));
    }
    return { offset, opacity: `${layers * SHADE}`, easing: "linear" };
  });
}

/* --- el módulo ------------------------------------------------------------ */

export interface Fold {
  /** El pliego se despliega y entrega el panel. */
  open(): Promise<void>;
  /** Recoge el papel. Quien llama esconde el panel; esto sólo lo midió antes. */
  close(): Promise<void>;
  busy(): boolean;
}

interface Live { shell: HTMLElement; anims: Animation[] }

/**
 * Monta el pliegue de un panel. Genérico: recibe el panel y el nodo del que sale
 * el papel, y no sabe nada del asistente.
 */
export function mountFold(panel: HTMLElement, from: HTMLElement): Fold {
  let state: "shut" | "opening" | "open" | "closing" = "shut";
  let live: Live | null = null;
  let pending: Promise<void> | null = null;
  /** Cada gesto invalida la espera del anterior: al invertir en marcha, la
   *  promesa del gesto viejo también se cumple, y con la dirección contraria. */
  let gen = 0;

  const still = matchMedia("(prefers-reduced-motion: reduce)");

  /** La tinta va por su cuenta: no la espera nadie y se limpia sola. */
  let inkAnims: Animation[] = [];

  function dropInk(): void {
    for (const anim of inkAnims) anim.cancel();
    inkAnims = [];
  }

  /** Tira el pliego. La tinta no: al acabar de abrir todavía está entrando. */
  function drop(): void {
    if (live) {
      for (const anim of live.anims) anim.cancel();
      live.shell.remove();
      live = null;
    }
    panel.classList.remove("is-folding");
  }

  /** Construye el pliego contra el rectángulo que ocupa el panel ahora mismo. */
  function build(ink: boolean): Live | null {
    const sheet = panel.getBoundingClientRect();
    if (sheet.width < 8 || sheet.height < 8) return null;
    const hand = from.getBoundingClientRect();

    // El cuadrante del paquete es el que tiene el asa más cerca: el asa se
    // arrastra donde se quiera y el pliego la sigue.
    const anchor: Anchor = {
      x: hand.left + hand.width / 2 < sheet.left + sheet.width / 2 ? "left" : "right",
      y: hand.top + hand.height / 2 < sheet.top + sheet.height / 2 ? "top" : "bottom",
    };

    const full: Box = { x: 0, y: 0, w: sheet.width, h: sheet.height };
    const packet = packetOf(full, anchor);
    const heart = { x: packet.x + packet.w / 2, y: packet.y + packet.h / 2 };
    const corner = `${anchor.x === "left" ? "0%" : "100%"} ${anchor.y === "top" ? "0%" : "100%"}`;

    const anims: Animation[] = [];
    const clock: KeyframeAnimationOptions = { duration: DUR_OPEN, fill: "both", easing: "linear" };

    /** Se crean paradas: mandar el reloj es de `drive`, no de aquí. */
    function add(node: Element, frames: Keyframe[]): void {
      const anim = node.animate(frames, clock);
      anim.pause();
      anims.push(anim);
    }

    const shell = el("div", { class: "ai-fold", attrs: { "aria-hidden": "true" } });
    place(shell, { x: sheet.left, y: sheet.top, w: sheet.width, h: sheet.height });
    shell.style.perspectiveOrigin = `${heart.x}px ${heart.y}px`;

    /* --- el vuelo ------------------------------------------------------- */

    // Dos envoltorios de un solo eje con curvas distintas: el papel va en arco y
    // no en línea recta. Un tercero lo hace crecer desde el tamaño del asa.
    const flyX = el("div", { class: "fold__fly" });
    const flyY = el("div", { class: "fold__fly" });
    const grow = el("div", { class: "fold__fly" });
    grow.style.transformOrigin = `${heart.x}px ${heart.y}px`;
    shell.append(flyX);
    flyX.append(flyY);
    flyY.append(grow);

    const dx = hand.left + hand.width / 2 - (sheet.left + heart.x);
    const dy = hand.top + hand.height / 2 - (sheet.top + heart.y);
    add(flyX, span(0, FLY_TO,
      { transform: `translateX(${dx}px)` }, { transform: "translateX(0px)" }, curve("--out-quart")));
    add(flyY, span(0, FLY_TO,
      { transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }, curve("--out-expo")));
    add(grow, span(0, GROW_TO,
      { transform: `scale(${SEED}) rotate(${TILT}deg)` },
      { transform: "scale(1) rotate(0deg)" }, curve("--out-expo")));

    /* --- la sombra ------------------------------------------------------ */

    // Crece a saltos, con la silueta: un envoltorio por pliegue, cada uno con el
    // momento y la curva del suyo. Multiplicados dan el pliego entero. Sin
    // relleno a propósito: el papel que todavía no ha llegado no tapa nada, y un
    // fondo aquí adelantaría la ventana al pliegue.
    let host: HTMLElement = grow;
    FOLDS.forEach((step, depth) => {
      const wrap = el("div", { class: "fold__cast-step" });
      place(wrap, depth === 0 ? packet : { x: 0, y: 0, w: packet.w, h: packet.h });
      wrap.style.transformOrigin = corner;
      host.append(wrap);
      add(wrap, span(step.from, step.to,
        { transform: "scale(1, 1)" },
        { transform: step.axis === "x" ? "scale(2, 1)" : "scale(1, 2)" },
        curve("--out-expo")));
      host = wrap;
    });

    const cast = el("div", { class: "fold__cast" });
    place(cast, { x: 0, y: 0, w: packet.w, h: packet.h });
    host.append(cast);
    // Y se apaga cuando entra la de la ventana, para no sumar dos sombras.
    add(cast, span(RELAY, RELAY + 0.05, { opacity: "1" }, { opacity: "0" }, "linear"));

    /* --- el pliego ------------------------------------------------------ */

    const bendEase = curve("--out-expo");

    function part(local: Box, depth: number, anchored: Anchor, ups: readonly Step[]): HTMLElement {
      const node = el("div", { class: "fold__part" });
      place(node, local);

      const step = FOLDS[depth];
      if (!step) {
        // Hoja: una cara de papel y, si tiene pliegues encima, su velo.
        node.classList.add("fold__face");
        if (ups.length > 0) {
          const veil = el("div", { class: "fold__shade" });
          node.append(veil);
          add(veil, veilFrames(ups));
        }
        return node;
      }

      const near: Box = step.axis === "x"
        ? { x: 0, y: 0, w: local.w / 2, h: local.h }
        : { x: 0, y: 0, w: local.w, h: local.h / 2 };
      const far: Box = step.axis === "x"
        ? { x: local.w / 2, y: 0, w: local.w / 2, h: local.h }
        : { x: 0, y: local.h / 2, w: local.w, h: local.h / 2 };

      const keepsNear = step.axis === "x" ? anchored.x === "left" : anchored.y === "top";
      node.append(part(keepsNear ? near : far, depth + 1, anchored, ups));

      const flap = part(keepsNear ? far : near, depth + 1, mirror(anchored, step.axis), [step, ...ups]);
      flap.classList.add("fold__flap");
      const bend = hinge(step.axis, !keepsNear);
      flap.style.transformOrigin = bend.origin;
      // El levantar va **antes** del giro para que ocurra en el marco del padre:
      // así en reposo la pila queda ordenada y se lee como capas, y no como dos
      // caras peleándose por el mismo plano. Al abrir vuelve a cero y no deja
      // costura.
      add(flap, span(step.from, step.to,
        { transform: `translateZ(${LIFT}px) ${bend.turn}(${bend.deg}deg)` },
        { transform: `translateZ(0px) ${bend.turn}(0deg)` },
        bendEase));
      node.append(flap);

      return node;
    }

    grow.append(part(full, 0, anchor, []));

    /* --- el relevo ------------------------------------------------------ */

    // La ventana real, opaca en dos fotogramas. Sin fundido: es papel sobre papel
    // y a medias se vería el fondo entre los dos.
    add(panel, span(RELAY, RELAY_END, { opacity: "0" }, { opacity: "1" }, "linear"));

    /* --- la tinta ------------------------------------------------------- */

    // El contenido entra escalonado cuando la ventana ya es opaca, y acaba
    // después del pliegue: dentro del reloj le quedarían cuarenta milisegundos y
    // no se vería. Por eso va aparte y no en `anims`: si el reloj la esperara, el
    // pliego se quedaría montado —invisible— casi medio segundo de más, y un
    // cierre en ese rato tendría que rebobinar una tinta que ya no se ve.
    //
    // Sólo al abrir: al cerrar, la ventana se esconde y no hay tinta que recoger.
    if (ink) {
      dropInk();
      const start = RELAY_END * DUR_OPEN;
      const inkEase = curve("--out-expo");
      inkAnims = [...panel.children]
        .filter((node) => !(node instanceof HTMLElement && node.hidden))
        .map((node, i) => {
          const anim = node.animate(
            [{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }],
            { duration: 280, delay: start + i * 70, easing: inkEase, fill: "both" },
          );
          anim.pause();
          return anim;
        });
    }

    document.body.append(shell);
    return { shell, anims };
  }

  /** Pone el guion en marcha en un sentido y avisa al acabar. */
  function drive(rate: number, dir: "open" | "close"): Promise<void> {
    const held = live;
    if (!held) return Promise.resolve();
    const mark = (gen += 1);

    for (const anim of held.anims) {
      anim.playbackRate = rate;
      anim.play();
    }

    if (rate > 0) {
      const mine = inkAnims;
      for (const anim of mine) anim.play();
      // Se cancelan al acabar y no antes: cancelarlas deja a cada hijo con su
      // opacidad de siempre, que es justo donde acaban.
      Promise.all(mine.map((anim) => anim.finished))
        .then(() => { if (inkAnims === mine) dropInk(); })
        .catch(() => undefined);
    } else {
      // Recogiendo: la tinta ya no pinta nada, la ventana se va a esconder.
      dropInk();
    }

    return Promise.all(held.anims.map((anim) => anim.finished))
      .then(() => {
        if (mark !== gen) return;
        drop();
        state = dir === "open" ? "open" : "shut";
      })
      // Cancelada: manda otro gesto, y ése dirá cómo acaba esto.
      .catch(() => undefined);
  }

  async function open(): Promise<void> {
    if (still.matches) { drop(); state = "open"; return; }
    if (state === "open") return;
    if (state === "opening") { await pending; return; }

    if (state !== "closing" || !live) {
      drop();
      const built = build(true);
      if (!built) { state = "open"; return; }
      live = built;
      panel.classList.add("is-folding");
    }

    state = "opening";
    // Al invertir un cierre se vuelve a la velocidad de abrir: lo que queda por
    // delante es un despliegue, no un cierre puesto del revés.
    pending = drive(1, "open");
    await pending;
  }

  async function close(): Promise<void> {
    if (still.matches) { drop(); state = "shut"; return; }
    if (state === "shut") return;
    if (state === "closing") { await pending; return; }

    if (state !== "opening" || !live) {
      drop();
      // Se mide antes de que quien llama esconda el panel; el pliego se queda con
      // el rectángulo y lo recoge encima.
      const built = build(false);
      if (!built) { state = "shut"; return; }
      live = built;
      panel.classList.add("is-folding");
      for (const anim of built.anims) anim.currentTime = DUR_OPEN;
    }

    state = "closing";
    pending = drive(-(DUR_OPEN / DUR_CLOSE), "close");
    await pending;
  }

  // Cambiar de tamaño en mitad del gesto lo termina de golpe: el pliego está
  // medido contra un rectángulo que ya no existe.
  window.addEventListener("resize", () => {
    if (!live) return;
    gen += 1;
    const wasClosing = state === "closing";
    drop();
    state = wasClosing ? "shut" : "open";
  });

  return {
    open,
    close,
    busy: () => state === "opening" || state === "closing",
  };
}
