import { el, render } from "../dom.ts";
import { markdownToLines, runKey, tmpId, type DocBlock, type DocRun, type DocRuns } from "../../core/notion/blocks.ts";
import { caretIn, dressRuns, hasAi, markAi, putCaret, readRuns, settle } from "./authored.ts";
import { inline, headingsOf, type Heading } from "./markdown.ts";

/**
 * El editor visual: un solo modo donde se escribe y se lee a la vez.
 *
 * Se pidió quitar el dos-modos —«escribiendo» que mostraba Markdown crudo y
 * «leyendo» que componía— y quedarse con lo que hacía la referencia en su modo
 * visual: lo que se teclea es lo que se ve, como en Notion. El texto que viaja
 * a Notion sigue siendo Markdown —la traducción ya existe en `blocks.ts`—, así
 * que aquí lo único que cambia es dónde vive el texto mientras se escribe: en
 * un documento de nodos de verdad y no en un campo de texto.
 *
 * La forma es la de un documento, no la de un editor de código: cada bloque es
 * un hijo directo del `contenteditable` —`h2`, `p`, `ul`, `blockquote`…— y
 * lleva su `data-b:id` de Notion cuando ya lo tiene. Al escribir, el navegador
 * mete lo nuevo como texto del bloque; aquí se lo deja y se recompone al
 * guardado. Sin ProseMirror ni plugins: el navegador ya sabe escribir en un
 * documento, y lo que esta plataforma añade es la forma del bloque y su id.
 *
 * Dos cosas que no se hacen a propósito:
 *
 * - No se compone mientras se escribe **dentro** de la línea —negrita que se
 *   ve sólo al marcarla con Ctrl+B, listas que nacen de una línea vacía con
 *   «- » al empezar—: un editor que adivina lo que querías escribir te obliga
 *   a pelear con él. La referencia lo aprendió con tiptap y su plan lo cuenta.
 * - No hay un tercer estado «fuente Markdown»: el Markdown es cómo viaja el
 *   texto, no un modo en el que estar.
 */

/** Los tipos de bloque que el editor sabe ser. */
export type VisualKind =
  | "h1" | "h2" | "h3"
  | "p" | "bullet" | "number" | "quote" | "divider" | "code" | "image";

/**
 * El documento entero: el texto que se guarda y de quién es cada trozo.
 *
 * Van juntos porque se sacan de la misma pasada: la autoría se apunta por el
 * id del bloque si ya lo tiene, y por la línea en la que queda si todavía no
 * —lo que la IA acaba de escribir aún no existe en Notion—, así que sólo se
 * sabe dónde va cada cosa mientras se van poniendo las líneas.
 */
export interface VisualDoc {
  content: string;
  runs: Map<string, readonly DocRun[]>;
}

/** El cuerpo del editor. Se escribe por dentro; se lee por fuera. */
export interface Visual {
  root: HTMLElement;
  /** Todo el documento, como Markdown con marcas de id. */
  markdown(): string;
  /** El documento y su autoría, de una vez. Es lo que se guarda. */
  doc(): VisualDoc;
  /** Los bloques recien creados ya tienen id de Notion: se anotan sin repintar. */
  born(idMap: ReadonlyMap<string, string>): void;
  /** Reemplaza todo el documento. Pierde el cursor: es para abrir o recuperar. */
  set(markdown: string, urls?: ReadonlyMap<string, string>, runs?: DocRuns): void;
  /** Pone el cursor al principio. */
  focusStart(): void;
  /** Se escribió algo: el que guarda, cuenta y saca apartados, escucha aquí. */
  onEdit(run: (doc: VisualDoc) => void): void;
  /** La tecla «/» en un bloque vacío: dónde abrir el menú de bloques. */
  onSlash(run: (at: { x: number; y: number }) => void): void;
  /** El menú «/» está abierto: el teclado es suyo. */
  slashOpen(): boolean;
  setSlashOpen(on: boolean): void;
  /** El fragmento marcado, en Markdown plano. */
  selected(): string;
  /** Llevar la vista al bloque con ese id de Notion, o al de esa línea. */
  goToBlock(id: string): void;
  goToLine(line: number): void;
  /** Llevar el cursor hasta un fragmento de texto, si está. */
  locate(fragment: string): void;
  /** Inserta Markdown al final del cursor —lo que trae «Añadir al documento». */
  insertAtCaret(markdown: string, ai?: boolean): void;
  /** Dicatado: escribe una frase donde esté el cursor. */
  dictate(said: string): void;
  /** El menú «/» eligió un bloque: el bloque vacío del cursor pasa a ser eso. */
  applyBlock(id: string): void;
  /**
   * Un archivo subido entra justo donde estaba el cursor: imagen y vídeo se
   * ven, el resto es su línea 📎. `blockId` es el id real de Notion —el bloque
   * ya existe—, así que el guardado no lo toca.
   */
  insertAttachment(file: { name: string; kind: "image" | "video" | "audio" | "pdf" | "file"; url?: string | null; blockId?: string }): void;
  /** El id del bloque que está justo antes del cursor: el ancla de la subida. */
  blockBeforeCaret(): string | null;
  /** Los bloques del documento, en orden. */
  blocks(): readonly HTMLElement[];
  /** El texto de un bloque, sin marcas de id ni mandos de la plataforma. */
  plain(node: Element): string;
  /** Pone bloques nuevos justo detrás de uno y deja el cursor dentro. */
  insertAfterBlock(node: Element, markdown: string, ai?: boolean): void;
  /** Lleva el cursor a un bloque. */
  focusOn(node: Element): void;
  /** Archivos arrastrados sobre la hoja: la plataforma los cuelga. */
  onDropFiles(run: (files: readonly File[]) => void): void;
}

const TAGS: Record<VisualKind, string> = {
  h1: "h2", h2: "h3", h3: "h4",
  p: "p", bullet: "ul", number: "ol", quote: "blockquote",
  divider: "hr", code: "pre", image: "figure",
};

/** El kinds que cada etiqueta es al leer de vuelta. */
function kindOfTag(tag: string): VisualKind | null {
  switch (tag) {
    case "H2": return "h1";
    case "H3": return "h2";
    case "H4": return "h3";
    case "P": return "p";
    case "UL": return "bullet";
    case "OL": return "number";
    case "BLOCKQUOTE": return "quote";
    case "HR": return "divider";
    case "PRE": return "code";
    default: return null;
  }
}

const MARK = /<!--b:([A-Za-z0-9-]+)-->\s*$/;

/** Un documento sin autoría apuntada: lo normal al insertar algo nuevo. */
const NO_RUNS: DocRuns = new Map();

export function mountVisual(): Visual {
  const root = el("div", {
    class: "vis",
    attrs: {
      contenteditable: "true",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": "Documento",
      spellcheck: "true",
    },
  });

  let editing = false;

  /* --- cargar: Markdown a nodos ---------------------------------------- */

  /**
   * El Markdown con marcas, a bloques del editor.
   *
   * Cada bloque de `markdownToLines` sabe en qué línea nace; la marca de esa
   * línea es su id de Notion. Los puntos consecutivos se agrupan en una sola
   * lista —es como se lee—, y cada `li` guarda su propio id: en Notion cada
   * punto es un bloque, y el diff conserva los que no cambien.
   */
  function nodesOf(markdown: string, runs: DocRuns = NO_RUNS): HTMLElement[] {
    const lines = markdown.split("\n");
    const out: HTMLElement[] = [];

    let group: {
      tag: "ul" | "ol";
      items: { block: DocBlock; id: string | null; runs?: readonly DocRun[] }[];
    } | null = null;

    const flush = (): void => {
      if (!group) return;
      const list = el(group.tag, { class: "vis__list" });
      for (const one of group.items) {
        const item = el("li", { text: one.block.text });
        item.setAttribute("data-b", one.id ?? "");
        if (one.runs) dressRuns(item, one.runs);
        list.append(item);
      }
      const first = group.items[0]?.id ?? null;
      list.setAttribute("data-b", first ?? "");
      out.push(list);
      group = null;
    };

    for (const [block, born] of markdownToLines(
      lines.map((line) => line.replace(MARK, "")).join("\n"),
    )) {
      const id = (MARK.exec(lines[born] ?? "") ?? [null, null])[1];

      // Quién escribió cada trozo de esta línea, si alguien lo apuntó. Viene
      // por id cuando el bloque ya existe en Notion y por línea cuando no.
      const mine = runs.get(runKey(id, born));

      // La URL temporal de un adjunto no viaja en el Markdown —caduca a la
      // hora—: viaja aparte, en el mapa de urls que el cargador pasa al
      // montar. Si la línea es un adjunto con id, su URL va al bloque.
      if (block.type === "attachment" && id && clipUrls.has(id)) {
        block.url = clipUrls.get(id);
      }

      if (block.type === "bullet" || block.type === "number") {
        const tag = block.type === "bullet" ? "ul" : "ol";
        if (!group || group.tag !== tag) { flush(); group = { tag, items: [] }; }
        group.items.push(mine ? { block, id, runs: mine } : { block, id });
        continue;
      }

      flush();
      const node = nodeOf(block, id);
      // El bloque de código se queda fuera: ahí dentro el color no dice quién
      // lo escribió, diría qué clase de palabra es.
      if (mine && block.type !== "code") dressRuns(node, mine);
      out.push(node);
    }

    flush();
    return out;
  }

  /**
   * Las URLs temporales de los adjuntos de este documento, por id de bloque.
   * Las pone `set()` en cada carga: son las que dejan ver imágenes y vídeos
   * sin pedirle otra vez a Notion.
   */
  let clipUrls = new Map<string, string>();

  /** Un bloque, como nodo listo para el editor. */
  function nodeOf(block: DocBlock, id: string | null): HTMLElement {
    switch (block.type) {
      case "heading": {
        const kind = (["h1", "h2", "h3"] as const)[Math.min(2, Math.max(0, (block.level ?? 2) - 1))] ?? "h2";
        return textNode(TAGS[kind], kind, block.text, id);
      }
      case "paragraph":
        return textNode("p", "p", block.text, id);
      case "quote":
        return textNode("blockquote", "quote", block.text, id);
      case "divider":
        return el("hr", { class: "vis__hr", attrs: { "data-b": id ?? "" } });
      case "code":
        return el("pre", { class: "vis__pre", attrs: { "data-b": id ?? "", "data-lang": block.language ?? "" } },
          [el("code", { text: block.text })]);
      case "image":
        return el("figure", { class: "vis__fig", attrs: { "data-b": id ?? "" } }, [
          el("img", {
            class: "vis__img",
            attrs: { src: block.url ?? "", alt: block.text, loading: "lazy", referrerpolicy: "no-referrer" },
          }),
        ]);
      case "attachment": {
        // Según lo que sea, se ve: la imagen como imagen, el vídeo con sus
        // controles; el resto —pdf, zip, lo demás— como la línea con su
        // nombre. La URL de Notion caduca a la hora: si ya no sirve, el
        // navegador no pinta nada y la línea dice qué archivo vive ahí.
        // Todos llevan `data-clip` —sean imagen o línea— y `data-name` con el
        // nombre original: es lo que vuelve a la línea `📎` al leer el nodo.
        const name = block.file?.name ?? block.text;
        const url = block.url ?? "";
        const baseAttrs = { "data-b": id ?? "", "data-clip": "1", "data-name": name };

        if (block.file?.kind === "image" && url) {
          return el("figure", { class: "vis__fig", attrs: { ...baseAttrs, "data-kind": "image" } }, [
            el("img", {
              class: "vis__img",
              attrs: { src: url, alt: name, loading: "lazy", referrerpolicy: "no-referrer" },
            }),
          ]);
        }
        if (block.file?.kind === "video" && url) {
          return el("figure", { class: "vis__fig", attrs: { ...baseAttrs, "data-kind": "video" } }, [
            el("video", {
              class: "vis__img",
              attrs: { src: url, controls: true, preload: "metadata" },
            }),
          ]);
        }
        if (block.file?.kind === "audio" && url) {
          return el("figure", { class: "vis__fig", attrs: { ...baseAttrs, "data-kind": "audio" } }, [
            el("audio", {
              class: "vis__audio",
              attrs: { src: url, controls: true, preload: "metadata" },
            }),
          ]);
        }
        if (block.file?.kind === "pdf" && url) {
          return el("figure", { class: "vis__clip vis__clip--link", attrs: { ...baseAttrs, "data-kind": "pdf" } }, [
            el("span", { class: "vis__clip__mark", text: "📄" }),
            el("a", {
              class: "vis__clip__name",
              text: name,
              attrs: { href: url, target: "_blank", rel: "noreferrer" },
            }),
          ]);
        }
        // El resto: la línea que dice qué archivo vive ahí. No es un enlace —
        // la URL de Notion caduca—, es el nombre tal cual se subió.
        return el("figure", {
          class: "vis__clip",
          attrs: baseAttrs,
        }, [
          el("span", { class: "vis__clip__mark", text: "📎" }),
          el("span", { class: "vis__clip__name", text: name }),
        ]);
      }
      case "bullet":
      case "number": {
        const tag = block.type === "bullet" ? "ul" : "ol";
        const item = el("li", { text: block.text });
        return el(tag, { class: "vis__list", attrs: { "data-b": id ?? "" } }, [item]);
      }
    }
  }

  function textNode(tag: string, kind: string, text: string, id: string | null): HTMLElement {
    const node = el(tag as "p", { class: `vis__b vis__b--${kind}` });
    node.setAttribute("data-b", id ?? "");
    node.append(...inline(text));
    return node;
  }

  /* --- leer: nodos a Markdown ------------------------------------------- */

  /**
   * El texto plano de un nodo: lo que se escribió, sin marcas de id y sin lo
   * que la plataforma haya colgado dentro.
   *
   * Las preguntas de la ruta de Indagar llevan dentro de su bloque un mando
   * —responder, que la IA lo intente— que es un nodo con `data-widget` y el
   * `contenteditable` apagado. Eso no lo escribió nadie, así que no puede
   * viajar a Notion: se quita sobre una copia, para no tocar lo que se está
   * viendo. Sin esto, la palabra «Responder» acabaría dentro de la cita.
   */
  function plainOf(node: Node): string {
    if (node instanceof Element && node.querySelector("[data-widget]")) {
      const copy = node.cloneNode(true) as Element;
      for (const one of [...copy.querySelectorAll("[data-widget]")]) one.remove();
      return (copy.textContent ?? "").replace(MARK, "");
    }
    return (node.textContent ?? "").replace(MARK, "");
  }

  /** Un nodo del editor, a la línea de Markdown que lo guarda. */
  function lineOf(node: Element): string {
    const id = node.getAttribute("data-b") || "";
    const mark = id ? ` <!--b:${id}-->` : "";

    switch (node.tagName) {
      case "H2": return `# ${plainOf(node)}${mark}`;
      case "H3": return `## ${plainOf(node)}${mark}`;
      case "H4": return `### ${plainOf(node)}${mark}`;
      case "P": return `${plainOf(node)}${mark}`;
      case "BLOCKQUOTE": return `> ${plainOf(node)}${mark}`;
      case "HR": return `---${mark}`;
      case "PRE": {
        const lang = node.getAttribute("data-lang") || "markdown";
        // La marca va en la valla de cierre, que es donde la busca el lector:
        // el cuerpo es texto libre y una linea de dentro podria leerse como
        // marca. Sin esto el bloque de codigo perdia su id en cada vuelta.
        return "```" + lang + "\n" + plainOf(node) + "\n```" + mark;
      }
      case "UL":
      case "OL": {
        // Cada punto es un bloque de Notion con su id: la marca viaja en el
        // propio punto, no en la lista.
        const items = [...node.children].map((item) => {
          const id = item instanceof Element ? (item.getAttribute("data-b") || "") : "";
          const mark = id ? ` <!--b:${id}-->` : "";
          return (node.tagName === "UL" ? "- " : "1. ") + plainOf(item) + mark;
        });
        return items.join("\n");
      }
      case "FIGURE": {
        // Los adjuntos comparten etiqueta con la imagen: los distingue su
        // `data-clip`, y todos vuelven a la misma línea 📎 —el nombre viaja en
        // `data-name`—, sea imagen, vídeo o archivo.
        if (node.getAttribute("data-clip")) {
          const name = node.getAttribute("data-name")
            ?? node.querySelector(".vis__clip__name")?.textContent
            ?? node.querySelector("img")?.getAttribute("alt")
            ?? plainOf(node);
          return `📎 ${name ?? ""}${mark}`;
        }
        const img = node.querySelector("img");
        const src = img ? img.getAttribute("src") ?? "" : "";
        const alt = img ? img.getAttribute("alt") ?? "" : "";
        return `![${alt}](${src})${mark}`;
      }
      default:
        return plainOf(node);
    }
  }

  /**
   * El documento entero, texto y autoría, en una sola pasada.
   *
   * Los huecos se cuidan aquí, al poner cada línea, y no con un `replace`
   * sobre el texto ya unido: limpiarlos después movería las posiciones que se
   * están apuntando, y son esas posiciones las que dicen de quién es cada
   * línea mientras el bloque no tenga id de Notion.
   */
  function compose(): VisualDoc {
    const lines: string[] = [];
    const runs = new Map<string, readonly DocRun[]>();

    /** Una línea al final, y dónde quedó. Dos huecos seguidos son un hueco. */
    const put = (line: string): number => {
      if (line === "" && (lines.length === 0 || lines[lines.length - 1] === "")) return -1;
      lines.push(line);
      return lines.length - 1;
    };

    const note = (owner: Element | undefined, at: number): void => {
      if (!owner || at < 0 || !hasAi(owner)) return;
      runs.set(runKey(owner.getAttribute("data-b") || null, at), readRuns(owner));
    };

    for (const node of [...root.children]) {
      if (!plainOf(node).trim() && node.tagName === "P") continue;
      put("");
      // Cada punto de una lista es un bloque de Notion con su propia autoría:
      // la línea `i` de lo que escribe `lineOf` es el hijo `i`.
      const kids = node.tagName === "UL" || node.tagName === "OL" ? [...node.children] : null;
      const piece = lineOf(node).split("\n");
      for (let i = 0; i < piece.length; i += 1) {
        const at = put(piece[i] ?? "");
        if (node.tagName === "PRE") continue;
        note(kids ? kids[i] : (i === 0 ? node : undefined), at);
      }
    }

    return { content: lines.join("\n").trimEnd(), runs };
  }

  function markdown(): string {
    return compose().content;
  }

  /* --- editar ---------------------------------------------------------- */

  /**
   * Después de cada gesto, los nodos que el navegador haya dejado raros se
   * ponen en forma: un `div` suelto vuelve a ser párrafo, y el id del bloque
   * se conserva. Es la única intervención sobre lo escrito: nunca se cambia
   * el texto, sólo su envoltura.
   */
  function tidy(): void {
    for (const node of [...root.children]) {
      // Un mando que se quedó solo en la raíz no es texto de nadie: lo suelta
      // el navegador al borrar la cita que lo llevaba dentro, y volverlo
      // párrafo metería «Responder» en el documento. Se va, y la ruta lo
      // repone en su sitio en el siguiente repintado.
      if (node.hasAttribute("data-widget")) { node.remove(); continue; }
      if (node.tagName === "DIV" || node.tagName === "SPAN" || node.tagName === "BR") {
        const para = el("p", { class: "vis__b vis__b--p" });
        para.setAttribute("data-b", node.getAttribute?.("data-b") ?? "");
        para.append(...[...node.childNodes]);
        node.replaceWith(para);
      }
      if (node.tagName === "LI" || (node.parentElement && node.parentElement !== root)) {
        // Un `li` sin lista: párrafo. El navegador lo hace al borrar la lista.
        if (!node.closest("ul, ol") || node.parentElement === root) {
          const para = el("p", { class: "vis__b vis__b--p" });
          para.append(...[...node.childNodes]);
          node.replaceWith(para);
        }
      }
    }

    // Un `h2`..`h4` vacío es el gesto de querer título: se queda, pero sin
    // irse en Markdown vacío al guardar. `markdown()` ya filtra párrafos
    // vacíos; los títulos vacíos se dejan pasar —escribir encima es normal.
    if (root.children.length === 0) {
      root.append(el("p", { class: "vis__b vis__b--p" }));
    }
  }

  const listeners = new Set<(doc: VisualDoc) => void>();

  function edited(): void {
    if (editing) return;
    tidy();
    // Lo que la persona acaba de tocar deja de ser de la IA. Se mira sólo el
    // bloque del cursor —es el único que una pulsación puede cambiar— y se
    // repone el cursor después: retirar el color recompone los nodos de la
    // línea, y el navegador lo dejaría donde estaba el nodo que ya no existe.
    const block = caretBlock();
    if (block) {
      const at = caretIn(block);
      if (settle(block) && at !== null) putCaret(block, at);
    }
    const doc = compose();
    for (const run of [...listeners]) run(doc);
  }

  root.addEventListener("input", () => { edited(); });

  // Pegar texto plano: sin estilos ajenos. El texto viene de cualquier sitio.
  root.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
  });

  /* --- teclado --------------------------------------------------------- */

  /**
   * La tecla «/» al empezar un bloque vacío abre el menú de bloques; el
   * propio menú se monta aparte (`slash.ts`) y escucha esta seña.
   */
  let slash = false;
  const slashListeners = new Set<(at: { x: number; y: number }) => void>();
  let caret: { x: number; y: number } = { x: 20, y: 20 };

  root.addEventListener("keydown", (event) => {
    if (slash && ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key)) {
      return;   // el menú lo atiende él mismo, sobre el documento
    }

    if (event.key === "/") {
      const block = caretBlock();
      if (block && !plainOf(block).trim()) {
        event.preventDefault();
        const box = block.getBoundingClientRect();
        caret = { x: box.left, y: box.bottom + 6 };
        for (const run of [...slashListeners]) run(caret);
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      // En un título o una cita, Enter pasa a párrafo normal: es lo que
      // espera quien escribe un título y sigue con su texto.
      const block = caretBlock();
      if (block && ["H2", "H3", "H4", "BLOCKQUOTE"].includes(block.tagName)) {
        event.preventDefault();
        const para = el("p", { class: "vis__b vis__b--p" });
        para.setAttribute("data-b", "");
        block.after(para);
        place(para);
        edited();
      }
      return;
    }

    if (event.key === "Backspace") {
      const block = caretBlock();
      if (block && block !== root.firstChild && !plainOf(block).trim()) {
        // Borrar un bloque vacío lo quita y se sube al anterior.
        event.preventDefault();
        const back = block.previousElementSibling;
        block.remove();
        if (back instanceof HTMLElement) place(back);
        edited();
        return;
      }
    }
  });

  /* --- el cursor y la selección ---------------------------------------- */

  function caretBlock(): HTMLElement | null {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!node) return null;
    const element = node instanceof Element ? node : node.parentElement;
    const block = element?.closest(".vis > *");
    return block instanceof HTMLElement ? block : null;
  }

  /** El cursor dentro de un bloque, al final si no hay más sitio. */
  function place(node: HTMLElement): void {
    root.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    sel?.addRange(range);
  }

  /* --- los archivos sobre la hoja --------------------------------------- */

  /**
   * Arrastrar archivos encima: el borde lo avisa y soltarlos los cuelga. Va
   * aquí —y no en el writer— porque lo que se arrastra es «hacia el papel», y
   * la gramática del arrastre es la del editor que está debajo.
   */
  const dropListeners = new Set<(files: readonly File[]) => void>();
  let dragging = 0;

  root.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragging += 1;
    root.classList.add("is-dropping");
  });
  root.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
  });
  root.addEventListener("dragleave", () => {
    dragging = Math.max(0, dragging - 1);
    if (dragging === 0) root.classList.remove("is-dropping");
  });
  root.addEventListener("drop", (event) => {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    dragging = 0;
    root.classList.remove("is-dropping");
    for (const run of [...dropListeners]) run([...files]);
  });

  /**
   * Un archivo subido entra justo donde estaba el cursor.
   *
   * El nodo attachment se construye con el mismo `nodeOf` que usaría al leer
   * el documento —mismo render, mismo `data-clip`— y se inserta después del
   * bloque del cursor; un párrafo vacío lo sigue para seguir escribiendo.
   * `blockId` ya es el de Notion: el guardado lo deja quieto.
   */
  function insertAttachment(file: { name: string; kind: "image" | "video" | "audio" | "pdf" | "file"; url?: string | null; blockId?: string }): void {
    const node = nodeOf({
      id: file.blockId ?? tmpId(),
      type: "attachment",
      text: file.name,
      url: file.url ?? undefined,
      file: { name: file.name, kind: file.kind },
    }, file.blockId ?? null);
    root.focus();

    const block = caretBlock();
    if (block) {
      block.after(node);
    } else {
      root.append(node);
    }

    // Un párrafo después, para que Enter siga siendo Enter y el adjunto no se
    // parta al escribir debajo.
    const para = el("p", { class: "vis__b vis__b--p" });
    para.setAttribute("data-b", "");
    node.after(para);
    place(para);
    edited();
  }

  /** El id del bloque justo antes del cursor: el ancla de la subida. */
  function blockBeforeCaret(): string | null {
    const block = caretBlock();
    if (!block) return null;
    // El cursor dentro de un adjunto: el ancla es él mismo —los archivos
    // quedan detrás, que es donde se los puso—.
    const before = block.previousElementSibling ?? block;
    const id = before.getAttribute("data-b");
    // Sin id no hay ancla de verdad: el bloque aún no existe en Notion y
    // `after` lo rechazaría. Va al final.
    return id && /^[a-f0-9-]{32}$/i.test(id.replace(/-/g, "")) ? id : null;
  }

  /* --- lo que se ofrece por fuera -------------------------------------- */

  return {
    root,
    markdown,
    doc: compose,
    /**
     * Los ids reales de lo que acaba de crearse en Notion.
     *
     * Se anotan sobre los nodos que ya estan, sin volver a pintar nada: la
     * persona sigue escribiendo mientras el guardado viaja y repintar le
     * moveria el cursor. Sin esto el DOM se quedaba con `data-b` vacio para
     * siempre, el bloque volvia a nacer temporal en el guardado siguiente y
     * Notion lo borraba y lo recreaba en cada pulsacion.
     *
     * El emparejamiento es por el orden en que se pidieron los creates, que es
     * el orden del documento: se recorren los nodos sin id y se les va dando
     * el que les toca.
     */
    born(idMap) {
      if (idMap.size === 0) return;
      const real = [...idMap.values()];
      let at = 0;
      const give = (node: Element): void => {
        if (at >= real.length) return;
        if (node.getAttribute("data-b")) return;
        const id = real[at];
        if (id) { node.setAttribute("data-b", id); at += 1; }
      };
      for (const node of [...root.children]) {
        if (!plainOf(node).trim() && node.tagName === "P") continue;
        if (node.tagName === "UL" || node.tagName === "OL") {
          for (const item of [...node.children]) give(item);
          continue;
        }
        give(node);
      }
    },
    set(markdown, urls, runs) {
      editing = true;
      clipUrls = new Map(urls ?? []);
      render(root, ...nodesOf(markdown, runs ?? NO_RUNS));
      if (root.children.length === 0) root.append(el("p", { class: "vis__b vis__b--p" }));
      editing = false;
    },
    focusStart() {
      const first = root.firstElementChild;
      if (first instanceof HTMLElement) place(first);
    },
    onEdit(run) {
      listeners.add(run);
    },
    onSlash(run) {
      slashListeners.add(run);
    },
    slashOpen() {
      return slash;
    },
    setSlashOpen(on) {
      slash = on;
    },
    onDropFiles(run) {
      dropListeners.add(run);
    },
    insertAttachment,
    blockBeforeCaret,
    blocks() {
      return [...root.children].filter((one): one is HTMLElement => one instanceof HTMLElement);
    },
    plain(node) {
      return plainOf(node);
    },
    insertAfterBlock(node, markdown, ai) {
      // Sin Markdown que poner, se abre un párrafo vacío: es lo que pide el
      // mando de «responder aquí», que no trae texto sino sitio donde ponerlo.
      const fresh = markdown.trim()
        ? nodesOf(markdown)
        : [el("p", { class: "vis__b vis__b--p" })];
      if (fresh.length === 0) return;
      // Lo que entra de una propuesta lo escribió el modelo, entero: se marca
      // aquí, en la puerta, y desde este momento el color cuenta.
      if (ai) markAi(fresh);
      node.after(...fresh);
      const last = fresh[fresh.length - 1];
      if (last) place(last);
      edited();
    },
    focusOn(node) {
      if (node instanceof HTMLElement) place(node);
    },
    selected() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return "";
      // Sólo lo que esté dentro del editor.
      if (!root.contains(sel.anchorNode)) return "";
      return sel.toString().trim();
    },
    goToBlock(id) {
      const node = root.querySelector(`[data-b="${CSS.escape(id)}"]`);
      if (!node) return;
      node.scrollIntoView({ block: "start", behavior: "smooth" });
      node.classList.add("is-found");
      setTimeout(() => { node.classList.remove("is-found"); }, 1600);
    },
    goToLine(line) {
      // La línea del Markdown no existe aquí; el apartado se busca por su
      // texto, que es lo único que comparten los dos mundos.
      const heads = headingsOf(markdown());
      let best: Heading | null = null;
      for (const head of heads) {
        if (head.line <= line) best = head;
        else break;
      }
      if (!best) return;

      for (const node of [...root.children]) {
        const kind = kindOfTag(node.tagName);
        if (kind !== "h1" && kind !== "h2" && kind !== "h3") continue;
        if (plainOf(node) === best.text) {
          node.scrollIntoView({ block: "start", behavior: "smooth" });
          node.classList.add("is-found");
          setTimeout(() => { node.classList.remove("is-found"); }, 1600);
          return;
        }
      }
    },
    locate(fragment) {
      const clean = fragment.trim();
      if (!clean) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let found: Text | null = null;
      while (walker.nextNode()) {
        if ((walker.currentNode.textContent ?? "").includes(clean)) {
          found = walker.currentNode as Text;
          break;
        }
      }
      if (!found) return;
      const sel = window.getSelection();
      sel?.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(found);
      sel?.addRange(range);
      (found.parentElement ?? root).scrollIntoView({ block: "center", behavior: "smooth" });
    },
    insertAtCaret(markdown, ai) {
      root.focus();
      for (const node of nodesOf("\n" + markdown + "\n")) {
        document.execCommand("insertHTML", false, "");
        if (ai) markAi([node]);
        root.append(node);
      }
      const last = root.lastElementChild;
      if (last instanceof HTMLElement) place(last);
      edited();
    },
    dictate(said) {
      root.focus();
      document.execCommand("insertText", false, said);
    },
    applyBlock(id) {
      const block = caretBlock();
      if (!block) return;

      // La imagen pide su dirección: es la única que no se escribe.
      if (id === "image") {
        const url = prompt("Dirección de la imagen (https://…)");
        const clean = url && /^https:\/\//i.test(url.trim()) ? url.trim() : null;
        if (!clean) return;
        const figure = el("figure", { class: "vis__fig" }, [
          el("img", { class: "vis__img", attrs: { src: clean, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }),
        ]);
        figure.setAttribute("data-b", "");
        block.replaceWith(figure);
        edited();
        return;
      }

      // El resto se escriben encima: el mismo bloque, con su forma.
      const fresh = nodeOf(
        id === "h1" ? { type: "heading", level: 1, text: "" } as DocBlock
        : id === "h2" ? { type: "heading", level: 2, text: "" } as DocBlock
        : id === "h3" ? { type: "heading", level: 3, text: "" } as DocBlock
        : id === "bullet" ? { type: "bullet", text: "" } as DocBlock
        : id === "number" ? { type: "number", text: "" } as DocBlock
        : id === "quote" ? { type: "quote", text: "" } as DocBlock
        : id === "divider" ? { type: "divider", text: "" } as DocBlock
        : id === "code" ? { type: "code", text: "", language: "markdown" } as DocBlock
        : { type: "paragraph", text: "" } as DocBlock,
        null,
      );
      fresh.setAttribute("data-b", block.getAttribute("data-b") ?? "");
      block.replaceWith(fresh);
      place(fresh);
      edited();
    },
  };
}
