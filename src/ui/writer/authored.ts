import { tidyRuns, type DocRun } from "../../core/notion/blocks.ts";

/**
 * Quién escribió cada trozo de una línea, dentro del editor.
 *
 * Se pidió que lo que redacta la IA se vea de otro color, y que **el color se
 * retire de las palabras en cuanto la persona las toca**. Lo segundo es lo que
 * da sentido a lo primero: un color que se quedara puesto para siempre no
 * diría «esto lo escribió el modelo», diría «esto salió de aquí alguna vez»,
 * que no es lo mismo y no sirve para releerse.
 *
 * La marca vive en el DOM, en `<span data-ai>`, y viaja a Notion como color de
 * texto nativo —la traducción está en `blocks.ts`—. El texto plano no cambia:
 * `textContent` de la línea es el mismo con color o sin él, así que el
 * Markdown que se guarda, el recuento de palabras y la ruta de Indagar no se
 * enteran de que esto existe.
 *
 * **Cómo se retira el color.** No se intercepta la escritura. Cada trozo de la
 * IA recuerda en `data-ai-was` lo que el modelo escribió; al escribir, se
 * compara con lo que hay ahora y la diferencia es de la persona. Se hace así y
 * no atrapando las pulsaciones porque las maneras de cambiar un texto son
 * muchas —teclear, pegar, arrastrar, dictar, el corrector del móvil, un
 * teclado de composición— y todas acaban en lo mismo: el texto es otro.
 * Comparar cubre todas a la vez; atrapar pulsaciones habría que hacerlo una
 * por una y se olvidaría alguna.
 *
 * La diferencia se estira a **palabras enteras**: si se cambia una letra de
 * «programa», la palabra entera pasa a ser de quien la tocó. Es lo que se
 * pidió —«lo que yo vaya modificando»— y lo que se lee bien: media palabra de
 * un color y media de otro es un tachón, no una atribución.
 */

const AI = "data-ai";
const WAS = "data-ai-was";

/** Lo que cuenta como palabra para estirar el cambio: letras y números. */
const WORDY = /[\p{L}\p{N}]/u;

function wordy(text: string, at: number): boolean {
  const one = text[at];
  return one !== undefined && WORDY.test(one);
}

/* --- pintar los trozos ---------------------------------------------------- */

/**
 * Los trozos de un bloque, puestos como `span`s dentro de sus nodos.
 *
 * Recorre lo que ya hay —que puede llevar negrita, cursiva, código o un
 * enlace— y parte los nodos de texto por donde cambia el autor. Un trozo de la
 * IA que caiga a medias dentro de una negrita se parte dentro de la negrita:
 * así el color es exacto y el formato se queda como estaba.
 */
export function dressRuns(block: Element, runs: readonly DocRun[]): void {
  const tidy = tidyRuns(runs);
  if (!tidy.some((one) => one.ai === true)) return;

  // Los cortes, en posiciones de carácter del texto plano de la línea.
  const cuts: { from: number; to: number }[] = [];
  let at = 0;
  for (const run of tidy) {
    if (run.ai === true) cuts.push({ from: at, to: at + run.text.length });
    at += run.text.length;
  }
  if (cuts.length === 0) return;

  dress(block, cuts, 0);
}

/** Devuelve cuántos caracteres llevaba consumidos al salir de este nodo. */
function dress(node: Node, cuts: readonly { from: number; to: number }[], from: number): number {
  let at = from;

  for (const kid of [...node.childNodes]) {
    if (kid.nodeType === Node.TEXT_NODE) {
      const text = kid.textContent ?? "";
      const pieces = split(text, at, cuts);
      at += text.length;
      // Un solo trozo y sin color: se queda tal cual, que es el caso normal.
      if (pieces.length === 1 && pieces[0]?.ai !== true) continue;
      const made = pieces.map((one) => one.ai === true
        ? aiSpan(one.text)
        : document.createTextNode(one.text));
      kid.replaceWith(...made);
      continue;
    }

    if (kid instanceof Element) {
      // Un mando de la plataforma no es texto de nadie: no se cuenta ni se
      // pinta. Si se contara, todo lo de después quedaría desplazado.
      if (kid.hasAttribute("data-widget")) continue;
      at = dress(kid, cuts, at);
      continue;
    }

    at += (kid.textContent ?? "").length;
  }

  return at;
}

/** Un texto partido por los cortes que lo cruzan. */
function split(
  text: string,
  from: number,
  cuts: readonly { from: number; to: number }[],
): { text: string; ai?: true }[] {
  const out: { text: string; ai?: true }[] = [];
  let at = 0;

  while (at < text.length) {
    const here = from + at;
    const cut = cuts.find((one) => here >= one.from && here < one.to);
    if (cut) {
      const end = Math.min(text.length, cut.to - from);
      out.push({ text: text.slice(at, end), ai: true });
      at = end;
      continue;
    }
    // Hasta donde empiece el siguiente corte, o hasta el final.
    const next = cuts
      .map((one) => one.from - from)
      .filter((one) => one > at)
      .sort((a, b) => a - b)[0] ?? text.length;
    out.push({ text: text.slice(at, Math.min(next, text.length)) });
    at = Math.min(next, text.length);
  }

  return out.filter((one) => one.text.length > 0);
}

function aiSpan(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "vis__ai";
  span.setAttribute(AI, "1");
  span.setAttribute(WAS, text);
  span.textContent = text;
  return span;
}

/* --- leer los trozos ------------------------------------------------------ */

/**
 * Los trozos de un bloque, leídos del DOM.
 *
 * El DOM es la verdad mientras se escribe: el Markdown no sabe decir quién
 * escribió qué, así que lo que se guarda sale de aquí.
 */
export function readRuns(block: Element): DocRun[] {
  const out: DocRun[] = [];
  walk(block, false, out);
  return tidyRuns(out);
}

function walk(node: Node, inside: boolean, out: DocRun[]): void {
  for (const kid of node.childNodes) {
    if (kid.nodeType === Node.TEXT_NODE) {
      const text = kid.textContent ?? "";
      if (text) out.push(inside ? { text, ai: true } : { text });
      continue;
    }
    if (kid instanceof Element) {
      if (kid.hasAttribute("data-widget")) continue;
      walk(kid, inside || kid.hasAttribute(AI), out);
      continue;
    }
  }
}

/** ¿Lleva este bloque algo escrito por la IA? */
export function hasAi(block: Element): boolean {
  return block.querySelector(`[${AI}]`) !== null;
}

/* --- marcar lo que acaba de escribir la IA -------------------------------- */

/**
 * Todo el contenido de estos bloques es de la IA.
 *
 * Es lo que se usa al insertar una propuesta: lo que entra lo escribió el
 * modelo, entero, y desde ese momento empieza a contar como suyo hasta que
 * alguien lo cambie.
 */
export function markAi(nodes: readonly Element[]): void {
  for (const node of nodes) {
    // Las listas llevan el texto en sus puntos, no en sí mismas.
    const targets = node.tagName === "UL" || node.tagName === "OL"
      ? [...node.children]
      : [node];
    for (const one of targets) mark(one);
  }
}

function mark(block: Element): void {
  const text = plainOf(block);
  if (!text.trim()) return;
  dressRuns(block, [{ text, ai: true }]);
}

/** El texto de un bloque sin los mandos de la plataforma. */
function plainOf(block: Element): string {
  if (!block.querySelector("[data-widget]")) return block.textContent ?? "";
  const copy = block.cloneNode(true) as Element;
  for (const one of [...copy.querySelectorAll("[data-widget]")]) one.remove();
  return copy.textContent ?? "";
}

/* --- retirar el color de lo que se toca ----------------------------------- */

/**
 * Lo que la persona haya cambiado dentro de un trozo de la IA deja de ser de
 * la IA.
 *
 * Devuelve `true` si algo cambió, para que quien llama sepa si tiene que
 * recolocar el cursor. No toca nada si no hace falta: se escribe muchas veces
 * y casi siempre fuera de un trozo del modelo.
 */
export function settle(block: Element): boolean {
  const spans = [...block.querySelectorAll(`[${AI}]`)];
  if (spans.length === 0) return false;

  let touched = false;

  for (const span of spans) {
    const now = span.textContent ?? "";
    const was = span.getAttribute(WAS) ?? "";
    if (now === was) continue;

    touched = true;

    if (!now) { span.remove(); continue; }

    const { head, tail } = between(was, now);

    // Nada en común: todo lo que hay es de la persona.
    if (head === 0 && tail === 0) {
      span.replaceWith(document.createTextNode(now));
      continue;
    }

    const made: Node[] = [];
    if (head > 0) made.push(aiSpan(now.slice(0, head)));
    const middle = now.slice(head, now.length - tail);
    if (middle) made.push(document.createTextNode(middle));
    if (tail > 0) made.push(aiSpan(now.slice(now.length - tail)));
    span.replaceWith(...made);
  }

  return touched;
}

/**
 * Cuánto se parecen por delante y por detrás, en palabras enteras.
 *
 * Primero se mide el parecido carácter a carácter y después se recorta hasta
 * el borde de la palabra: cambiar una letra de «programa» hace que «programa»
 * entera pase a ser de quien la tocó, no que quede media de cada color.
 */
function between(was: string, now: string): { head: number; tail: number } {
  const top = Math.min(was.length, now.length);

  let head = 0;
  while (head < top && was[head] === now[head]) head += 1;

  let tail = 0;
  while (
    tail < top - head
    && was[was.length - 1 - tail] === now[now.length - 1 - tail]
  ) tail += 1;

  // Al borde de la palabra: si el corte cae dentro de una, se abre hasta que
  // la palabra entera quede del lado de la persona.
  while (head > 0 && wordy(now, head - 1) && wordy(now, head)) head -= 1;

  let end = now.length - tail;
  while (end < now.length && wordy(now, end) && wordy(now, end - 1)) end += 1;
  tail = now.length - end;

  // Los dos extremos no pueden solaparse.
  if (head + tail > now.length) return { head: 0, tail: 0 };
  return { head, tail };
}

/* --- el cursor, que sobrevive a recomponer los nodos ---------------------- */

/** En qué carácter del bloque está el cursor, o `null` si no está dentro. */
export function caretIn(block: Element): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!block.contains(range.startContainer)) return null;

  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let at = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === range.startContainer) return at + range.startOffset;
    at += (node.textContent ?? "").length;
    node = walker.nextNode();
  }
  return at;
}

/** El cursor a ese carácter del bloque. */
export function putCaret(block: Element, offset: number): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let at = 0;
  let node = walker.nextNode();
  let last: Node | null = null;

  while (node) {
    const len = (node.textContent ?? "").length;
    if (at + len >= offset) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, Math.min(len, offset - at)));
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    at += len;
    last = node;
    node = walker.nextNode();
  }

  if (last) {
    const range = document.createRange();
    range.setStart(last, (last.textContent ?? "").length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}
