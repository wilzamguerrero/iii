/**
 * Markdown ⇄ bloques nativos de Notion.
 *
 * La plataforma escribe y guarda Markdown —es el texto de la persona, y el
 * editor es un campo de texto— pero el documento en Notion ya no es un bloque
 * `code` sino **páginas con bloques nativos dentro**: prosa, títulos, listas,
 * citas, imágenes. Así el documento se lee como una página de Notion de verdad
 * y las imágenes que se peguen allí se ven.
 *
 * Este archivo es la traducción en los dos sentidos, y las dos direcciones no
 * son simétricas a propósito:
 *
 * - **Markdown → bloques** traduce todo lo que la persona escribe aquí.
 * - **Bloques → Markdown** traduce de vuelta lo que Notion sepa decir de los
 *   bloques que la plataforma creó, y deja el resto como mejor pueda: un bloque
 *   que no sabemos leer se escribe como párrafo con su texto plano, porque
 *   perder el sitio de un bloque por no saber traducirlo sería peor que
 *   escribirlo mal.
 *
 * La decisión de fondo (plan.md §12 D2bis): la fidelidad la da el **diff**
 * (`diff.ts`), no la traducción. Como los bloques sólo cambian por lo que
 * escribe la persona aquí, la traducción de vuelta nunca tiene que inventar:
 * se guarda el estado confirmado y se compara contra el borrador, así que un
 * bloque que aquí nadie tocó no se reescribe aunque su Markdown no fuera
 * perfecto.
 */

import { notionRequest } from "./client.ts";
import type { RichText } from "./types.ts";

/* --- lo que un bloque es para nosotros ---------------------------------- */

/**
 * Un trozo de texto dentro de un bloque, con quién lo escribió.
 *
 * Existe por una petición concreta: que se vea de otro color lo que redactó la
 * IA, y que el color se retire de las palabras en cuanto la persona las toca.
 * Para eso hace falta saber, dentro de una misma línea, qué parte vino del
 * modelo y qué parte se escribió a mano.
 *
 * El color viaja a Notion como **color de texto nativo**, así que se ve igual
 * en la página de Notion, en el móvil y en otro equipo. Tiene una
 * consecuencia que hay que saber: Notion no guarda datos propios por trozo de
 * texto, sólo formato, así que el color *es* el dato. Si alguien pinta un
 * texto de este mismo azul a mano en Notion, al volver se leerá como escrito
 * por la IA. Es el precio de que el color sea de verdad y no un apunte que
 * sólo entiende este navegador.
 */
export interface DocRun {
  text: string;
  /** Lo escribió el modelo y nadie lo ha tocado desde entonces. */
  ai?: true;
}

/**
 * El color de Notion que marca lo escrito por la IA.
 *
 * Azul y no otro: se lee bien sobre blanco y sobre el tema oscuro de Notion,
 * y no es ninguno de los que la plataforma usa para avisar de algo (el rojo de
 * un fallo, el ámbar de una falta de la revisión).
 */
export const AI_COLOR = "blue";

/** Un bloque nativo ya leído, en el modelo mínimo que hace falta para diff. */
export interface DocBlock {
  /** Id de Notion, o uno propio de `tmpId()` mientras no exista. */
  id: string;
  type: "heading" | "paragraph" | "bullet" | "number" | "quote" | "divider" | "code" | "image" | "attachment";
  /** El texto completo del bloque, plano. */
  text: string;
  /**
   * El texto partido por quién lo escribió, cuando hay algo de la IA.
   *
   * Ausente quiere decir «todo esto lo escribió una persona», que es el caso
   * de la inmensa mayoría de los bloques: no se guarda una lista de un solo
   * trozo para no cargar el diff con algo que no dice nada. Cuando está, la
   * suma de los trozos es exactamente `text`, y `text` sigue siendo la verdad
   * para todo lo demás —el recuento de palabras, la ruta, la revisión—.
   */
  runs?: readonly DocRun[];
  /** Nivel 1-3 del título. */
  level?: 1 | 2 | 3;
  /** Lenguaje del bloque de código. */
  language?: string;
  /** URL de la imagen. */
  url?: string;
  /** Un archivo adjunto: su nombre y qué clase de bloque es en Notion. */
  file?: { name: string; kind: "image" | "video" | "audio" | "pdf" | "file" };
  /** Lo que Notion dijo del bloque, para no perder lo que no sabemos leer. */
  raw?: unknown;
}

/**
 * Un id para un bloque que todavia no existe en Notion.
 *
 * Unico, y se nota a simple vista que no es de Notion: los de Notion son un
 * UUID. Tiene que ser unico porque el guardado los usa como clave —`idMap`
 * cambia el temporal por el real, y `changes` cuenta bloques tocados—, y con
 * un `"tmp"` repetido tres parrafos nuevos eran un solo bloque para las dos
 * cosas: solo el ultimo recuperaba su id real y los otros volvian a nacer sin
 * el en el guardado siguiente.
 *
 * Y hace falta para ordenar. Un bloque nuevo detras de otro bloque nuevo tiene
 * que poder decir de quien cuelga, y para eso hay que poder nombrarlo.
 *
 * El contador vive en el modulo y no se reinicia: dos bloques de la misma
 * sesion nunca coinciden, que es lo unico que hace falta —un id temporal no
 * sobrevive a un guardado—.
 */
let born = 0;
export function tmpId(): string {
  born += 1;
  return `tmp-${born}`;
}

/** ¿Es un id nuestro, de un bloque que aun no existe en Notion? */
export function isTmp(id: string): boolean {
  return id.startsWith("tmp");
}

/** Los trozos de un bloque, o el bloque entero como un trozo de persona. */
export function runsOf(block: DocBlock): readonly DocRun[] {
  if (block.runs && block.runs.length > 0) return block.runs;
  return block.text ? [{ text: block.text }] : [];
}

/** ¿Hay algo del modelo aquí dentro? */
export function hasAiRun(block: DocBlock): boolean {
  return (block.runs ?? []).some((one) => one.ai === true);
}

/**
 * Trozos seguidos del mismo autor, juntos; los vacíos, fuera.
 *
 * Escribir dentro de una línea parte los trozos —cada pulsación puede dejar
 * uno nuevo—, y sin juntarlos una línea muy trabajada acabaría con decenas de
 * trozos que dicen todos lo mismo. Notion los cobra como fragmentos y el diff
 * los compararía uno por uno.
 */
export function tidyRuns(runs: readonly DocRun[]): DocRun[] {
  const out: DocRun[] = [];
  for (const one of runs) {
    if (!one.text) continue;
    const last = out[out.length - 1];
    if (last && (last.ai === true) === (one.ai === true)) {
      out[out.length - 1] = one.ai === true
        ? { text: last.text + one.text, ai: true }
        : { text: last.text + one.text };
      continue;
    }
    out.push(one.ai === true ? { text: one.text, ai: true } : { text: one.text });
  }
  return out;
}

/** Los trozos puestos en un bloque, sin guardar la lista que no dice nada. */
export function withRuns(block: DocBlock, runs: readonly DocRun[]): DocBlock {
  const tidy = tidyRuns(runs);
  const marked = tidy.some((one) => one.ai === true);
  const text = tidy.map((one) => one.text).join("");
  if (!marked) {
    const { runs: _drop, ...rest } = block;
    return { ...rest, text };
  }
  return { ...block, text, runs: tidy };
}

/**
 * Quién escribió cada trozo, viajando **al lado** del Markdown.
 *
 * El Markdown no sabe decir de quién es cada palabra, así que la autoría va
 * aparte, como ya iban las URLs de los adjuntos. La clave de cada bloque es su
 * id de Notion cuando lo tiene y la línea donde nace cuando no: lo que la IA
 * acaba de escribir todavía no existe en Notion y por tanto no tiene id, y es
 * justo lo que hay que pintar.
 */
export type DocRuns = ReadonlyMap<string, readonly DocRun[]>;

/**
 * La clave de un bloque en ese mapa.
 *
 * Por id siempre que se pueda: sobrevive a mover el bloque de sitio, que es lo
 * que hace cambiar de naturaleza. Por línea sólo mientras el bloque no exista
 * en Notion, y esa clave vale para el documento tal y como está ahora mismo.
 */
export function runKey(id: string | null | undefined, line: number): string {
  return id ? `b:${id}` : `l:${line}`;
}

/** Sólo lo anclado a un id: lo que sigue siendo verdad si el texto se reordena. */
export function runsById(runs: DocRuns): Map<string, readonly DocRun[]> {
  const out = new Map<string, readonly DocRun[]>();
  for (const [key, value] of runs) {
    if (key.startsWith("b:")) out.set(key, value);
  }
  return out;
}

/** Un tramo de los trozos, en posiciones de carácter del texto entero. */
function sliceRuns(runs: readonly DocRun[], from: number, to: number): DocRun[] {
  const out: DocRun[] = [];
  let at = 0;
  for (const run of runs) {
    const start = Math.max(from, at);
    const end = Math.min(to, at + run.text.length);
    if (end > start) {
      const piece = run.text.slice(start - at, end - at);
      out.push(run.ai === true ? { text: piece, ai: true } : { text: piece });
    }
    at += run.text.length;
  }
  return tidyRuns(out);
}

/**
 * Los trozos ajustados al texto que de verdad tiene el bloque.
 *
 * El editor y el lector de Markdown no recortan igual los extremos de una
 * línea, así que la suma de los trozos puede traer un espacio de más. Se busca
 * el texto dentro de esa suma y se recorta ahí. Si no aparece, se dejan caer:
 * más vale una línea sin color que el color en las palabras equivocadas.
 */
function fitRuns(runs: readonly DocRun[], text: string): DocRun[] | null {
  const tidy = tidyRuns(runs);
  const sum = tidy.map((one) => one.text).join("");
  if (sum === text) return tidy;
  const from = sum.indexOf(text);
  if (from < 0) return null;
  return sliceRuns(tidy, from, from + text.length);
}

/* --- Markdown → bloques --------------------------------------------------- */

/** Un fragmento de texto con un formato simple: nada de negrita dentro. */
function span(text: string): { text: { content: string } }[] {
  if (!text) return [];
  // Notion parte en fragmentos de 2000; el texto de un bloque rara vez llega.
  const parts: { text: { content: string } }[] = [];
  for (let at = 0; at < text.length; at += 1900) {
    parts.push({ text: { content: text.slice(at, at + 1900) } });
  }
  return parts;
}

/**
 * Los fragmentos de un bloque, con el color de lo que escribió la IA.
 *
 * Un fragmento por trozo, y el tope de 2000 de Notion se respeta dentro de
 * cada uno: un trozo largo se parte en varios fragmentos del mismo color, que
 * es lo mismo que hace `span()` con el texto plano.
 */
function spans(block: DocBlock): Record<string, unknown>[] {
  const runs = runsOf(block);
  const out: Record<string, unknown>[] = [];
  for (const run of runs) {
    for (let at = 0; at < run.text.length; at += 1900) {
      const content = run.text.slice(at, at + 1900);
      out.push(run.ai === true
        ? { text: { content }, annotations: { color: AI_COLOR } }
        : { text: { content } });
    }
  }
  return out;
}

/** El cuerpo de un bloque de Notion según nuestro `DocBlock`. */
export function notionBodyOf(block: DocBlock): Record<string, unknown> | null {
  const rich = spans(block);
  switch (block.type) {
    case "heading":
      return { heading_2: { rich_text: rich } };
    case "paragraph":
      return { paragraph: { rich_text: rich } };
    case "bullet":
      return { bulleted_list_item: { rich_text: rich } };
    case "number":
      return { numbered_list_item: { rich_text: rich } };
    case "quote":
      return { quote: { rich_text: rich } };
    case "divider":
      return { divider: {} };
    case "code":
      return { code: { rich_text: span(block.text), language: block.language ?? "markdown" } };
    case "image":
      return block.url
        ? { image: { type: "external", external: { url: block.url } } }
        : null;
    case "attachment":
      // Un adjunto que ya vive en Notion no se re-escribe: el diff lo deja
      // quieto. Si llegara aquí con id temporal sería un error de la
      // traducción, y mejor no mandar nada que mandar un bloque roto.
      return null;
  }
}

/**
 * Markdown a bloques. Un recorrido de líneas, sin árbol intermedio.
 *
 * El nivel del título baja uno: el `#` del documento es el título de la página
 * en Notion, así que aquí los `##` son `heading_2` y los `###`, `heading_3`.
 * Sólo hay tres niveles de título en Notion y el cuarto o más alto se queda en
 * el tercero.
 */
export function markdownToBlocks(markdown: string): DocBlock[] {
  return markdownToLines(markdown).map(([block]) => block);
}

/** Lo mismo, con la línea en la que nace cada bloque: para el anclaje de ids. */
export function markdownToLines(markdown: string): [DocBlock, number][] {
  const lines = markdown.split("\n");
  const out: [DocBlock, number][] = [];
  let at = 0;

  while (at < lines.length) {
    const raw = (lines[at] ?? "").trim();

    if (!raw) { at += 1; continue; }

    const born = at;

    // Cerca de código: se guarda entera como un bloque `code`.
    const fence = /^```(\w*)/.exec(raw);
    if (fence) {
      const language = fence[1] || "markdown";
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !/^```/.test((lines[at] ?? "").trim())) {
        body.push(lines[at] ?? "");
        at += 1;
      }
      // La valla de cierre es la que lleva la marca del bloque, asi que el
      // bloque de codigo nace en ella: es la linea de la que hay que leer el
      // id. Los demas bloques nacen en su primera linea.
      const close = at;
      at += 1;
      out.push([{ id: tmpId(), type: "code", text: body.join("\n"), language }, close]);
      continue;
    }

    // Un adjunto: la línea `📎 nombre` que dejó un archivo subido. Si la línea
    // trae su id de Notion, el bloque ya existe allí —el diff lo dejará
    // quieto—; si no, es un adjunto recién elegido y quien lo sube es el
    // motor de subida, no el guardado del documento.
    const clip = /^📎\s+(.+)$/.exec(raw);
    if (clip) {
      const name = (clip[1] ?? "").trim();
      out.push([{ id: tmpId(), type: "attachment", text: name, file: { name, kind: "file" } }, born]);
      at += 1;
      continue;
    }

    if (/^([-*_])(\s*\1){2,}$/.test(raw)) {
      out.push([{ id: tmpId(), type: "divider", text: "" }, born]);
      at += 1;
      continue;
    }

    // Imagen en Markdown: `![alt](https://…)`.
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(raw);
    if (image) {
      out.push([{ id: tmpId(), type: "image", text: image[1] ?? "", url: image[2] }, born]);
      at += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      const hashes = (heading[1] ?? "#").length;
      const level = Math.min(3, Math.max(1, hashes)) as 1 | 2 | 3;
      out.push([{
        id: tmpId(), type: "heading",
        text: (heading[2] ?? "").replace(/\s*#+\s*$/, "").trim(),
        level,
      }, born]);
      at += 1;
      continue;
    }

    const quoted = /^>\s?(.*)$/.exec(raw);
    if (quoted) {
      const body: string[] = [];
      while (at < lines.length) {
        const one = /^>\s?(.*)$/.exec((lines[at] ?? "").trim());
        if (!one) break;
        body.push((one[1] ?? "").trim());
        at += 1;
      }
      out.push([{ id: tmpId(), type: "quote", text: body.join(" ").trim() }, born]);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(raw);
    const number = /^\d+[.)]\s+(.*)$/.exec(raw);
    if (bullet || number) {
      const kind = bullet ? "bullet" : "number";
      const pick = bullet ?? number;
      let text = (pick?.[1] ?? "").trim();
      at += 1;
      // Una línea suelta debajo continúa el punto.
      while (at < lines.length) {
        const one = (lines[at] ?? "").trim();
        if (!one || /^[-*+]\s|^\d+[.)]\s|^#{1,6}\s|^>|^```/.test(one)) break;
        text += ` ${one}`;
        at += 1;
      }
      out.push([{ id: tmpId(), type: kind, text }, born]);
      continue;
    }

    // Párrafo: todo lo que no sea otra cosa hasta una línea vacía o bloque.
    const body: string[] = [];
    while (at < lines.length) {
      const one = (lines[at] ?? "");
      const trim = one.trim();
      if (!trim || /^#{1,6}\s|^>|^[-*+]\s|^\d+[.)]\s|^```|^!\[|^([-*_])(\s*\1){2,}$/.test(trim)) break;
      body.push(trim);
      at += 1;
    }
    if (body.length > 0) out.push([{ id: tmpId(), type: "paragraph", text: body.join(" ") }, born]);
  }

  return out;
}

/* --- bloques → Markdown ---------------------------------------------------- */

function plain(spans: RichText[] | undefined): string {
  if (!spans) return "";
  return spans.map((one) => one.plain_text ?? "").join("");
}

/**
 * Los mismos fragmentos, conservando qué parte la escribió la IA.
 *
 * Notion devuelve el color en `annotations.color`, y puede venir como
 * `"blue"` o como `"blue_background"` según cómo se haya pintado; las dos
 * cuentan. Un fragmento sin color es de la persona, que es el caso normal.
 */
function marked(spans: RichText[] | undefined): DocRun[] {
  if (!spans) return [];
  return tidyRuns(spans.map((one) => {
    const notes = one.annotations as { color?: string } | undefined;
    const color = notes?.color ?? "default";
    const text = one.plain_text ?? "";
    return color === AI_COLOR || color === `${AI_COLOR}_background`
      ? { text, ai: true as const }
      : { text };
  }));
}

/** Los bloques crudos de Notion, tal como los devuelve `/children`. */
export interface RawBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

function richOf(block: RawBlock): RichText[] | undefined {
  const part = block[block.type] as { rich_text?: RichText[] } | undefined;
  return part?.rich_text;
}

/** El texto plano de la caption de un bloque de medios. */
function captionOf(raw: RawBlock): string {
  const part = raw[raw.type] as { caption?: RichText[] } | undefined;
  return (part?.caption ?? []).map((one) => one.plain_text ?? "").join("").trim();
}

/**
 * Un bloque crudo a nuestro modelo. Lo que no se sabe leer se conserva tal
 * cual en `raw` —el diff lo reescribirá sin tocarlo— y su texto plano, si
 * tiene, entra como párrafo para no perderlo de la vista.
 */
export function blockOf(raw: RawBlock): DocBlock {
  const base: DocBlock = { id: raw.id, type: "paragraph", text: "", raw };

  const image = raw.image as
    | { type?: string; external?: { url?: string }; file?: { url?: string } }
    | undefined;
  if (raw.type === "image") {
    const url = image?.external?.url ?? image?.file?.url ?? "";
    return { ...base, type: "image", url };
  }
  if (raw.type === "divider") return { ...base, type: "divider", text: "" };
  if (raw.type === "code") {
    const part = raw.code as { language?: string } | undefined;
    return { ...base, type: "code", text: plain(richOf(raw)), language: part?.language };
  }

  // Los adjuntos: bloques de medios con archivo de Notion dentro (subidos por
  // la plataforma o puestos a mano en Notion). Se guardan como `attachment`
  // con su nombre —la URL que trae `file` caduca a la hora— y el diff los
  // deja quietos: no se re-suben ni se re-escriben.
  if (raw.type === "video" || raw.type === "file" || raw.type === "pdf" || raw.type === "audio") {
    const kind = raw.type as "video" | "file" | "pdf" | "audio";
    const media = raw[raw.type] as
      | { type?: string; file?: { url?: string }; external?: { url?: string }; name?: string; caption?: RichText[] }
      | undefined;
    const name = (media?.name ?? captionOf(raw) ?? "").trim();
    // El texto del bloque es el nombre: es lo que se ve en el editor y lo que
    // se busca. Con uno vacío se usa el tipo, para no perder la línea.
    return {
      ...base,
      type: "attachment",
      text: name || `archivo-${kind}`,
      url: media?.file?.url ?? media?.external?.url ?? undefined,
      file: { name: name || `archivo-${kind}`, kind: kind === "pdf" ? "pdf" : kind },
    };
  }

  /* Los tipos con prosa dentro llevan también sus trozos: es donde la IA
     escribe y donde el color tiene que sobrevivir al viaje. El bloque de
     código queda fuera a propósito —ahí dentro el color no significa autoría,
     y un `code` con fragmentos de colores es ruido—. */
  const rich = richOf(raw);
  const text = plain(rich);
  const runs = marked(rich);
  const withText = (one: DocBlock): DocBlock =>
    runs.some((run) => run.ai === true) ? { ...one, runs } : one;

  if (/^heading_[123]$/.test(raw.type)) {
    return withText({ ...base, type: "heading", text, level: Number(raw.type.slice(-1)) as 1 | 2 | 3 });
  }
  if (raw.type === "bulleted_list_item") return withText({ ...base, type: "bullet", text });
  if (raw.type === "numbered_list_item") return withText({ ...base, type: "number", text });
  if (raw.type === "quote" || raw.type === "callout") return withText({ ...base, type: "quote", text });

  return withText({ ...base, type: "paragraph", text });
}

/** Un bloque de los nuestros, a su línea de Markdown. */
export function blockMarkdown(block: DocBlock): string {
  switch (block.type) {
    case "heading":
      // El nivel es el de Notion tal cual: heading_2 → ##. El `#` del
      // documento es el título de la página, que en Notion no es bloque.
      return `${"#".repeat(block.level ?? 2)} ${block.text}`;
    case "bullet":
      return `- ${block.text}`;
    case "number":
      return `1. ${block.text}`;
    case "quote":
      return `> ${block.text}`;
    case "divider":
      return "---";
    case "code":
      return `\`\`\`${block.language ?? "markdown"}\n${block.text}\n\`\`\``;
    case "image":
      return `![${block.text}](${block.url ?? ""})`;
    case "attachment":
      // El adjunto en el editor: la línea que lo representa. No es un enlace
      // real —la URL de Notion caduca a la hora— sino el nombre tal cual se
      // subió, en la gramática `📎 nombre` que `markdownToLines` reconoce.
      return `📎 ${block.file?.name ?? block.text}`;
    case "paragraph":
      return block.text;
  }
}

/**
 * Los bloques ya leídos, a Markdown para el editor.
 *
 * El id de cada bloque viaja con la línea en un comentario invisible para la
 * persona —`<!--b:id-->` al final de la línea—, y `markdownToBlocks` no lo
 * ve porque se limpia antes de traducir. Es lo que permite el diff: la línea
 * del editor sabe a qué bloque de Notion pertenece, así que guardar cambia
 * sólo lo que cambió.
 *
 * Un bloque desconocido (`raw` presente y sin tipo conocido) se escribe con
 * su texto plano: no se pierde del documento aunque Notion lo haya cambiado
 * por fuera.
 */
export function blocksToMarkdown(blocks: readonly DocBlock[]): string {
  return layout(blocks).content;
}

/**
 * Lo mismo, y además quién escribió cada trozo.
 *
 * Es lo que pide el editor al abrir un documento: el texto para escribir y la
 * autoría para pintarla. Van juntos porque se calculan a la vez —la clave de
 * cada bloque es su id, y el id lo pone esta misma pasada—.
 */
export function blocksToMarkdownWithRuns(
  blocks: readonly DocBlock[],
): { content: string; runs: Map<string, readonly DocRun[]> } {
  return layout(blocks);
}

/** El reparto en líneas, que es de donde salen las dos cosas. */
function layout(
  blocks: readonly DocBlock[],
): { content: string; runs: Map<string, readonly DocRun[]> } {
  const lines: string[] = [];
  const runs = new Map<string, readonly DocRun[]>();
  let prev = "";

  /**
   * Una línea al final, y en qué posición quedó.
   *
   * Dos huecos seguidos son un hueco y el documento no empieza por hueco: es
   * lo que hacía antes un `replace` sobre el texto ya unido. Se hace aquí, al
   * ponerlas, porque hacerlo después movería las posiciones que se están
   * apuntando —y son esas posiciones las que dicen de quién es cada línea—.
   */
  const put = (line: string): number => {
    if (line === "" && (lines.length === 0 || lines[lines.length - 1] === "")) return -1;
    lines.push(line);
    return lines.length - 1;
  };

  for (const block of blocks) {
    // Los puntos seguidos son una lista: entre ellos no se abre hueco. En
    // todo lo demás, cada bloque es su propio párrafo con su aire.
    const grouped = block.type === "bullet" || block.type === "number";
    const wasGrouped = prev === "bullet" || prev === "number";

    if (block.type === "code") {
      if (prev) put("");
      put("```" + (block.language ?? "markdown"));
      for (const one of block.text.split("\n")) put(one);
      // La marca va en la valla de cierre y no en la de apertura: el cuerpo
      // del bloque es texto libre y una linea de dentro podria acabar en algo
      // que se leyera como marca. Sin esto el bloque perdia su id en cada
      // vuelta y Notion lo borraba y lo recreaba en cada guardado, con sus
      // comentarios y su historial dentro.
      put(mark("```", block.id));
      put("");
      prev = block.type;
      continue;
    }

    if (!grouped || !wasGrouped) { if (prev) put(""); }
    const at = put(mark(blockMarkdown(block), block.id));
    if (at >= 0 && hasAiRun(block)) runs.set(runKey(block.id, at), block.runs ?? []);
    prev = block.type;
  }

  return { content: lines.join("\n").trimEnd(), runs };
}

/** La línea con su id de bloque, escondido. */
function mark(line: string, id: string): string {
  return `${line} <!--b:${id}-->`;
}

/** Los ids de bloque que lleva una línea, si lleva alguno. */
export function blockIdOf(line: string): string | null {
  const found = /<!--b:([A-Za-z0-9-]+)-->\s*$/.exec(line);
  return found?.[1] ?? null;
}

/** La línea sin la marca. */
export function unmark(line: string): string {
  return line.replace(/<!--b:([A-Za-z0-9-]+)-->\s*$/, "").trimEnd();
}

/* --- el texto con marcas a bloques, conservando los ids -------------------- */

/**
 * Markdown con marcas a bloques, conservando los ids de las líneas.
 *
 * El id viaja al final de la línea donde **nace** el bloque —un párrafo de
 * tres líneas lleva la marca en la primera—, así que el emparejamiento es
 * exacto: `markdownToLines` dice en qué línea nace cada bloque y aquí se
 * lee la marca de esa misma línea. Sin esto, mover un párrafo de sitio
 * borraría y re-crear el bloque en Notion.
 */
export function markedMarkdownToBlocks(markdown: string, runs?: DocRuns): DocBlock[] {
  const lines = markdown.split("\n");
  return markdownToLines(markdown.split("\n").map(unmark).join("\n"))
    .map(([block, born]) => {
      const id = blockIdOf(lines[born] ?? "");
      const one = id ? { ...block, id } : block;
      // La autoría viaja aparte y se engancha aquí, por la misma línea que
      // ancla el id: el bloque de código se queda fuera —ahí dentro el color no
      // significa quién lo escribió, significa qué clase de palabra es—.
      if (!runs || one.type === "code") return one;
      const mine = runs.get(runKey(id, born));
      if (!mine || mine.length === 0) return one;
      const fitted = fitRuns(mine, one.text);
      return fitted ? withRuns(one, fitted) : one;
    });
}

/* --- leer y escribir páginas de verdad ------------------------------------ */

/** Respuesta de leer los hijos de una página. */
interface ChildrenResponse {
  results: RawBlock[];
  next_cursor: string | null;
  has_more: boolean;
}

/** Todos los bloques hijos de una página, paginados. */
export async function fetchChildren(
  token: string,
  pageId: string,
  signal?: AbortSignal,
): Promise<RawBlock[]> {
  const blocks: RawBlock[] = [];
  let cursor: string | null = null;

  do {
    const query: string = cursor
      ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
      : "?page_size=100";
    const page: ChildrenResponse = await notionRequest<ChildrenResponse>(
      token,
      `/blocks/${pageId}/children${query}`,
      { signal },
    );
    blocks.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  return blocks;
}

/** El documento completo de una página: bloques ya traducidos a los nuestros. */
export async function readBlocks(
  token: string,
  pageId: string,
  signal?: AbortSignal,
): Promise<DocBlock[]> {
  const raw = await fetchChildren(token, pageId, signal);
  return raw.filter((one) => one.type !== "child_page").map(blockOf);
}

/** Crear una página dentro de otra. El título es lo único que hace falta. */
export async function createNotionPage(
  token: string,
  parentId: string,
  title: string,
): Promise<{ id: string; url?: string }> {
  const created = await notionRequest<{ id: string; url?: string }>(token, "/pages", {
    method: "POST",
    body: {
      parent: { page_id: parentId },
      // El título por la propiedad que sea: Notion la crea como «title».
      properties: { title: { title: span(title) } },
    },
  });
  return created;
}

/** Escribir los bloques de una página de una vez: reemplazo completo. */
export async function appendChildren(
  token: string,
  pageId: string,
  children: readonly Record<string, unknown>[],
): Promise<RawBlock[]> {
  const out: RawBlock[] = [];
  for (let at = 0; at < children.length; at += 100) {
    const slice = children.slice(at, at + 100);
    const made = await notionRequest<{ results: RawBlock[] }>(
      token,
      `/blocks/${pageId}/children`,
      { method: "PATCH", body: { children: slice } },
    );
    out.push(...(made.results ?? []));
  }
  return out;
}
