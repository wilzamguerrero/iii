import { el, render } from "../dom.ts";
import { markdownToLines, type DocBlock } from "../../core/notion/blocks.ts";
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

/** El cuerpo del editor. Se escribe por dentro; se lee por fuera. */
export interface Visual {
  root: HTMLElement;
  /** Todo el documento, como Markdown con marcas de id. */
  markdown(): string;
  /** Reemplaza todo el documento. Pierde el cursor: es para abrir o recuperar. */
  set(markdown: string): void;
  /** Pone el cursor al principio. */
  focusStart(): void;
  /** Se escribió algo: el que guarda, cuenta y saca apartados, escucha aquí. */
  onEdit(run: (markdown: string) => void): void;
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
  insertAtCaret(markdown: string): void;
  /** Dicatado: escribe una frase donde esté el cursor. */
  dictate(said: string): void;
  /** El menú «/» eligió un bloque: el bloque vacío del cursor pasa a ser eso. */
  applyBlock(id: string): void;
  /** La línea 📎 que acaba de entrar recibe el id real de su bloque de Notion. */
  anchorLastClip(blockId: string): void;
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

const MARK = /<!--b:([a-f0-9-]+)-->\s*$/;

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
  function nodesOf(markdown: string): HTMLElement[] {
    const lines = markdown.split("\n");
    const out: HTMLElement[] = [];

    let group: { tag: "ul" | "ol"; items: { block: DocBlock; id: string | null }[] } | null = null;

    const flush = (): void => {
      if (!group) return;
      const list = el(group.tag, { class: "vis__list" });
      for (const one of group.items) {
        const item = el("li", { text: one.block.text });
        item.setAttribute("data-b", one.id ?? "");
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

      if (block.type === "bullet" || block.type === "number") {
        const tag = block.type === "bullet" ? "ul" : "ol";
        if (!group || group.tag !== tag) { flush(); group = { tag, items: [] }; }
        group.items.push({ block, id });
        continue;
      }

      flush();
      out.push(nodeOf(block, id));
    }

    flush();
    return out;
  }

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
        // El adjunto se lee como un nodo `figure` con el nombre y su clase: no
        // es un enlace —la URL de Notion caduca a la hora—, es la línea que
        // dice qué archivo vive ahí. `markdownToLines` lo vuelve a leer por su
        // texto, así que el nombre es el bloque entero.
        const name = block.file?.name ?? block.text;
        return el("figure", {
          class: "vis__clip",
          attrs: { "data-b": id ?? "", "data-clip": "1" },
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

  /** El texto plano de un nodo: lo que se escribió, sin marcas de id. */
  function plainOf(node: Node): string {
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
        return "```" + lang + "\n" + plainOf(node) + "\n```";
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
        // El adjunto y la imagen comparten etiqueta: el adjunto se reconoce
        // por su `data-clip` y se escribe con su gramática 📎.
        if (node.getAttribute("data-clip")) {
          const name = node.querySelector(".vis__clip__name");
          return `📎 ${name ? name.textContent ?? "" : plainOf(node)}${mark}`;
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

  function markdown(): string {
    const parts: string[] = [];
    let prevGroup = false;

    for (const node of [...root.children]) {
      const grouped = node.tagName === "UL" || node.tagName === "OL";
      const wasGroup = prevGroup;
      prevGroup = grouped;
      if (!node.textContent?.trim() && node.tagName === "P") continue;
      parts.push(grouped && wasGroup ? "" : "", lineOf(node));
    }

    return parts.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").trimEnd();
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

  const listeners = new Set<(markdown: string) => void>();

  function edited(): void {
    if (editing) return;
    tidy();
    for (const run of [...listeners]) run(markdown());
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

  /** La última línea 📎 que entró: para anclarla a su bloque de Notion. */
  function anchorLastClip(blockId: string): void {
    const clips = [...root.querySelectorAll<HTMLElement>(".vis__clip")];
    const last = clips[clips.length - 1];
    if (last) last.setAttribute("data-b", blockId);
  }

  /* --- lo que se ofrece por fuera -------------------------------------- */

  return {
    root,
    markdown,
    set(markdown) {
      editing = true;
      render(root, ...nodesOf(markdown));
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
    anchorLastClip,
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
    insertAtCaret(markdown) {
      root.focus();
      for (const node of nodesOf("\n" + markdown + "\n")) {
        document.execCommand("insertHTML", false, "");
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
