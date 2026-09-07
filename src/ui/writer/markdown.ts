import { el } from "../dom.ts";

/**
 * Markdown a nodos, para el modo lectura.
 *
 * El documento se guarda en Markdown —es lo que va y vuelve de Notion sin
 * perderse, decisión D2— pero leerlo en Markdown no es leerlo: los almohadillas y
 * los asteriscos se meten entre la vista y el texto justo cuando lo que hace falta
 * es ver si el argumento se sostiene. Así que hay dos modos, escribir y leer, y
 * esto es lo segundo.
 *
 * Se traduce lo que un proyecto de investigación usa de verdad: títulos, párrafos,
 * listas, citas, reglas y código. No hay tablas ni notas al pie a propósito: media
 * biblioteca de Markdown para dos casos que hoy no existen es peso muerto, y
 * cuando existan se añaden aquí y sólo aquí.
 *
 * Nunca `innerHTML`. El texto viene de Notion, de un modelo y de la persona, y los
 * tres son entrada: se construyen nodos y el texto va siempre por `textContent`,
 * que es lo que hace `el()` en `dom.ts`.
 *
 * Cada bloque lleva su número de línea en `data-line`. Es lo que permite que el
 * índice de la izquierda lleve a un apartado y que una observación de la revisión
 * lleve a la frase de la que habla, en los dos modos: la línea es la misma en el
 * campo de escritura y en la hoja de lectura.
 */

export interface Heading {
  /** 1 a 6, tal cual las almohadillas. */
  level: number;
  text: string;
  /** Línea donde está, contando desde 0. */
  line: number;
}

/** Los títulos del documento, en orden. El índice de la izquierda es esto. */
export function headingsOf(text: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;

  for (const [line, raw] of text.split("\n").entries()) {
    if (/^\s*```/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const found = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (!found) continue;
    const hashes = found[1] ?? "";
    const body = (found[2] ?? "").trim();
    if (!body) continue;
    out.push({ level: hashes.length, text: strip(body), line });
  }

  return out;
}

/** Un título se lee sin sus marcas —ni las de formato ni el id de bloque—. */
function strip(text: string): string {
  return text
    .replace(/<!--b:[a-f0-9-]+-->\s*$/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s*#+\s*$/, "")
    .trim();
}

/* --- lo de dentro de una línea --------------------------------------------- */

/** Negrita, cursiva, código, enlaces e imágenes. Lo que un proyecto usa. */
const INLINE =
  /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Sólo se enlaza lo que se puede abrir sin peligro. El texto del documento puede
 * venir de un modelo, y un `javascript:` metido en un enlace sería suyo y no de la
 * persona: cuando el destino no convence, queda el texto y se pierde el enlace.
 *
 * Las imágenes siguen la misma regla y una más: sólo `https`, porque una
 * imagen se pega en un `<img>` y el navegador la pide sin preguntar.
 */
function safeHref(url: string, image = false): string | null {
  const clean = url.trim();
  const ok = image
    ? /^https:\/\//i.test(clean)
    : /^(https?:\/\/|mailto:)/i.test(clean);
  return ok ? clean : null;
}

/** Una imagen en su propia línea: `![alt](https://…)`. */
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

function inline(text: string): Node[] {
  const out: Node[] = [];
  let at = 0;

  for (const found of text.matchAll(INLINE)) {
    const start = found.index;
    if (start > at) out.push(document.createTextNode(text.slice(at, start)));
    at = start + found[0].length;

    const [, strongA, strongB, emA, emB, code, linkText, linkUrl] = found;

    if (strongA ?? strongB) { out.push(el("strong", { text: strongA ?? strongB ?? "" })); continue; }
    if (emA ?? emB) { out.push(el("em", { text: emA ?? emB ?? "" })); continue; }
    if (code) { out.push(el("code", { class: "doc__code", text: code })); continue; }

    if (linkText && linkUrl) {
      const href = safeHref(linkUrl);
      if (!href) { out.push(document.createTextNode(linkText)); continue; }
      out.push(el("a", {
        class: "doc__link",
        text: linkText,
        attrs: { href, target: "_blank", rel: "noreferrer noopener" },
      }));
      continue;
    }

    out.push(document.createTextNode(found[0]));
  }

  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

/* --- los bloques ------------------------------------------------------------ */

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```(.*)$/;

/** Los seis niveles, como etiquetas: `el()` pide una etiqueta que exista. */
const H = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** Un bloque recuerda de qué línea salió: es lo que se busca al llevar a alguien. */
function block(
  tag: keyof HTMLElementTagNameMap,
  className: string,
  line: number,
  kids: readonly Node[],
): HTMLElement {
  return el(tag, { class: className, attrs: { "data-line": String(line) } }, kids);
}

/**
 * El documento en nodos.
 *
 * Un recorrido y nada más: no hay árbol intermedio porque no hay nada anidado que
 * lo pida —listas dentro de listas incluidas, que en un proyecto se escriben como
 * dos niveles de título y se leen mejor así—. Cuando aparezca la primera necesidad
 * de verdad de anidar, aquí es donde se anida.
 */
export function renderMarkdown(text: string): HTMLElement[] {
  // El id de bloque viaja con la línea para el diff del guardado; al componer
  // no pinta nada y al traducir no dice nada: se quita aquí, una sola vez.
  const lines = text.split("\n").map((line) => line.replace(/<!--b:[a-f0-9-]+-->\s*$/, ""));
  const out: HTMLElement[] = [];
  let at = 0;

  while (at < lines.length) {
    const raw = lines[at] ?? "";

    if (!raw.trim()) { at += 1; continue; }

    // Una imagen en su línea es una figura, no texto.
    const picture = IMAGE.exec(raw.trim());
    if (picture) {
      const url = safeHref(picture[2] ?? "", true);
      if (url) {
        out.push(el("figure", { class: "doc__fig", attrs: { "data-line": String(at) } }, [
          el("img", {
            class: "doc__img",
            attrs: {
              src: url,
              alt: picture[1] ?? "",
              loading: "lazy",
              referrerpolicy: "no-referrer",
            },
          }),
        ]));
      }
      at += 1;
      continue;
    }

    const fence = FENCE.exec(raw);
    if (fence) {
      const from = at;
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !FENCE.test(lines[at] ?? "")) {
        body.push(lines[at] ?? "");
        at += 1;
      }
      at += 1;   // la línea que cierra
      out.push(block("pre", "doc__pre", from, [el("code", { text: body.join("\n") })]));
      continue;
    }

    if (RULE.test(raw)) {
      out.push(block("hr", "doc__rule", at, []));
      at += 1;
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      const level = (heading[1] ?? "#").length;
      const body = (heading[2] ?? "").replace(/\s*#+\s*$/, "").trim();
      out.push(block(H[level - 1] ?? "h6", `doc__h doc__h${level}`, at, inline(body)));
      at += 1;
      continue;
    }

    const quoted = QUOTE.exec(raw);
    if (quoted) {
      const from = at;
      const body: string[] = [];
      while (at < lines.length) {
        const one = QUOTE.exec(lines[at] ?? "");
        if (!one) break;
        body.push((one[1] ?? "").trim());
        at += 1;
      }
      out.push(block("blockquote", "doc__quote", from, inline(body.join(" ").trim())));
      continue;
    }

    if (BULLET.test(raw) || NUMBER.test(raw)) {
      const from = at;
      const numbered = NUMBER.test(raw) && !BULLET.test(raw);
      const items: { line: number; text: string }[] = [];

      while (at < lines.length) {
        const one = lines[at] ?? "";
        const item = numbered ? NUMBER.exec(one) : BULLET.exec(one);
        if (item) {
          items.push({ line: at, text: (item[1] ?? "").trim() });
          at += 1;
          continue;
        }
        // Una línea suelta debajo de un punto es su continuación; una vacía o
        // cualquier otro bloque cierran la lista.
        const last = items[items.length - 1];
        if (last && one.trim() && !HEADING.test(one) && !QUOTE.test(one) && !RULE.test(one)) {
          last.text += ` ${one.trim()}`;
          at += 1;
          continue;
        }
        break;
      }

      out.push(block(numbered ? "ol" : "ul", "doc__list", from,
        items.map((item) => block("li", "doc__item", item.line, inline(item.text)))));
      continue;
    }

    const from = at;
    const body: string[] = [];
    while (at < lines.length) {
      const one = lines[at] ?? "";
      if (!one.trim() || HEADING.test(one) || QUOTE.test(one) || RULE.test(one)
        || BULLET.test(one) || NUMBER.test(one) || FENCE.test(one)) break;
      body.push(one.trim());
      at += 1;
    }
    out.push(block("p", "doc__p", from, inline(body.join(" "))));
  }

  return out;
}
