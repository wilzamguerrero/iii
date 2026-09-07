import { el, render } from "../dom.ts";
import { icon, setIcon } from "../icons.ts";
import { NotionRequestError } from "../../core/notion/client.ts";
import {
  readChildren, UNTITLED_PAGE, type TreeNode,
} from "../../core/notion/tree.ts";
import { selection } from "../../core/state/selection.ts";
import type { Crumb } from "./folders.ts";

/**
 * El árbol, a la izquierda del explorador.
 *
 * Las baldosas dicen qué hay *aquí*; el árbol dice dónde está *aquí*. Son las dos
 * mitades de la misma pregunta y por eso se ven a la vez: se entra en una carpeta
 * por la retícula y se vuelve a la raíz por el árbol sin deshacer el camino miga a
 * miga. Se pidió así —«en el lado izquierdo del explorador debería estar el árbol
 * para poder ver desde la raíz»— y es la forma del explorador de la referencia.
 *
 * El árbol no navega: lo pide. Quien tiene el camino y lee las carpetas es
 * `folders.ts`, y si el árbol leyera por su cuenta habría dos verdades sobre lo
 * mismo. Aquí sólo se dibuja lo que se sabe y se avisa hacia arriba.
 *
 * Tampoco duplica peticiones. Cada vez que la retícula lee una carpeta se la
 * pasa (`feed`), y el árbol sólo pide a Notion las ramas que alguien abre a mano.
 * Notion admite unas tres peticiones por segundo: cada lectura ahorrada es una
 * espera que no se ve.
 *
 * El tipo `Crumb` viene de `folders.ts` y `folders.ts` monta esto: es un círculo
 * de importaciones que no existe en tiempo de ejecución, porque `import type` se
 * borra al compilar (`verbatimModuleSyntax`).
 */

/** Sangría por nivel. La misma que usa el explorador de la referencia. */
const INDENT = 14;

const NO_TOKEN =
  "La conexión con Notion ya no es válida. Vuelve a conectar aquí abajo.";

export interface TreeOptions {
  token: string;
  /** La página de Notion bajo la que vive todo. */
  root: string;
  rootTitle: string;
  /** Ir a esa carpeta. Navegar es de la retícula; el árbol sólo lo pide. */
  goTo: (path: readonly Crumb[]) => void;
  /** Abrir un documento que vive en ese camino. */
  open: (node: TreeNode, at: readonly Crumb[]) => void;
  /** Notion dijo que el token ya no vale. */
  revoked?: () => void;
}

export interface Tree {
  root: HTMLElement;
  /** Hijos que la retícula acaba de leer: se aprovechan tal cual. */
  feed(parentId: string, nodes: readonly TreeNode[]): void;
  /** Abre las ramas de ese camino y marca dónde se está. */
  reveal(path: readonly Crumb[]): void;
  /** Se creó algo estando en esa carpeta. */
  add(parentId: string, node: TreeNode): void;
  /** Se borró. Con una carpeta se va su rama entera. */
  drop(nodeId: string): void;
  rename(nodeId: string, name: string): void;
  /** Cambió el título de la raíz. */
  retitle(title: string): void;
  dispose(): void;
}

/** Una rama: el renglón, sus hijos y si están leídos. */
interface Branch {
  id: string;
  /** El nodo tal como lo vio Notion. La raíz no es un nodo: es la página. */
  node: TreeNode | null;
  parent: Branch | null;
  depth: number;
  item: HTMLLIElement;
  row: HTMLElement;
  glyph: SVGSVGElement;
  kids: HTMLUListElement;
  open: boolean;
  loaded: boolean;
  /** La lectura en curso, si la hay: dos peticiones a la misma rama son una. */
  pending: Promise<void> | null;
  children: Map<string, Branch>;
}

export function mountTree(options: TreeOptions): Tree {
  const list = el("ul", {
    class: "tree",
    attrs: { role: "tree", "aria-label": "Árbol de proyectos" },
  });

  /** La rama con el foco del teclado. El árbol entero es una sola parada. */
  let focused: Branch | null = null;
  /** Descarta la revelación de un camino que ya no es el que se pide. */
  let seq = 0;

  const rootBranch = branchOf(null, null);
  list.append(rootBranch.item);
  rootBranch.open = true;
  paintRow(rootBranch);
  focus(rootBranch, false);

  /* --- un renglón --------------------------------------------------------- */

  /**
   * El renglón no es un `<button>`: un árbol accesible es una lista de
   * `treeitem` gobernada por las flechas, y dentro va el triángulo, que también
   * se puede pulsar. Un botón dentro de otro botón no es HTML válido.
   */
  function branchOf(node: TreeNode | null, parent: Branch | null): Branch {
    const depth = parent ? parent.depth + 1 : 0;
    const kids = el("ul", { class: "tree__kids", attrs: { role: "group", hidden: true } });
    const glyph = icon(node?.kind === "page" ? "page" : "folder", "ico ico--small");
    const row = el("span", { class: "tree__row" });
    const item = el("li", {
      class: "tree__item",
      attrs: { role: "treeitem", tabindex: "-1" },
    }, [row, kids]);

    const branch: Branch = {
      id: node?.id ?? options.root,
      node, parent, depth, item, row, glyph, kids,
      open: false, loaded: false, pending: null,
      children: new Map(),
    };

    row.style.paddingLeft = `${depth * INDENT + 6}px`;
    row.addEventListener("click", (event) => {
      // El triángulo abre; el resto del renglón lleva a donde dice.
      if (event.target instanceof Element && event.target.closest(".tree__twist")) {
        event.stopPropagation();
        focus(branch, false);
        void toggle(branch);
        return;
      }
      focus(branch, false);
      activate(branch);
    });

    return branch;
  }

  function nameOf(branch: Branch): string {
    if (!branch.node) return options.rootTitle || "Proyectos";
    return branch.node.name || UNTITLED_PAGE;
  }

  function paintRow(branch: Branch): void {
    const name = nameOf(branch);
    const parts: Node[] = [];

    // Toda página puede tener dentro páginas o contenido: el triángulo va en
    // todas. Al abrir una que sólo tiene texto, la rama lo dice y no engaña.
    parts.push(el("span", {
      class: "tree__twist",
      attrs: { "aria-hidden": "true", title: branch.open ? "Cerrar" : "Abrir" },
    }, [icon(branch.open ? "down" : "right", "ico ico--twist")]));
    branch.item.setAttribute("aria-expanded", String(branch.open));

    setIcon(branch.glyph, glyphOf(branch));
    parts.push(branch.glyph, el("span", { class: "tree__name", text: name }));
    render(branch.row, ...parts);
    branch.row.title = name;
  }

  /** La figura dice el estado: la carpeta abierta y el documento que se está leyendo. */
  function glyphOf(branch: Branch): "folder" | "folderOpen" | "page" | "pageFull" {
    if (branch.open) return "folderOpen";
    return selection.get()?.id === branch.id ? "pageFull" : "page";
  }

  /* --- abrir, cerrar, leer ------------------------------------------------ */

  async function toggle(branch: Branch): Promise<void> {
    if (branch.open) { shut(branch); return; }
    await show(branch);
  }

  function shut(branch: Branch): void {
    branch.open = false;
    branch.kids.hidden = true;
    paintRow(branch);
    // Si el foco estaba dentro de lo que se acaba de cerrar, sube al renglón.
    if (focused && inside(branch, focused) && focused !== branch) focus(branch, true);
  }

  async function show(branch: Branch): Promise<void> {
    branch.open = true;
    branch.kids.hidden = false;
    paintRow(branch);
    if (branch.loaded) return;
    await read(branch);
  }

  /**
   * Lee una rama una sola vez: quien la pida mientras llega se engancha a la
   * misma petición. Abrir a mano una carpeta y revelar el camino que pasa por
   * ella ocurren juntos más veces de las que parece.
   */
  function read(branch: Branch): Promise<void> {
    if (branch.pending) return branch.pending;
    if (branch.children.size === 0) branch.kids.replaceChildren(note("Leyendo…"));

    branch.pending = (async () => {
      try {
        put(branch, await readChildren(options.token, branch.id));
      } catch (cause) {
        // Sin hijos a la vista, el fallo va en el sitio de los hijos; con ellos
        // a la vista, se deja lo que ya se veía y no se borra nada.
        if (branch.children.size === 0) branch.kids.replaceChildren(note(why(cause)));
      }
    })().finally(() => { branch.pending = null; });

    return branch.pending;
  }

  function note(text: string): HTMLLIElement {
    return el("li", { class: "tree__note", text });
  }

  /**
   * Por qué falló. Un 401 no es un fallo de esta rama sino de la conexión, así
   * que además de contarlo se avisa hacia arriba.
   */
  function why(cause: unknown): string {
    if (cause instanceof NotionRequestError && cause.status === 401) {
      options.revoked?.();
      return NO_TOKEN;
    }
    return "No se pudo leer.";
  }

  /**
   * Los hijos que se acaban de conocer. Las ramas que ya existían se conservan
   * —con lo que tuvieran abierto dentro— y las que ya no están se van: al mover
   * o borrar en Notion, el árbol no puede quedarse enseñando lo que no existe.
   */
  function put(branch: Branch, nodes: readonly TreeNode[]): void {
    branch.loaded = true;
    const kept = new Map<string, Branch>();
    const rows: HTMLElement[] = [];

    for (const node of nodes) {
      const had = branch.children.get(node.id);
      const kid = had ?? branchOf(node, branch);
      if (had) {
        // El nombre pudo cambiar en Notion desde la última vez.
        if (had.node) had.node.name = node.name;
        paintRow(had);
      } else {
        paintRow(kid);
      }
      kept.set(node.id, kid);
      rows.push(kid.item);
    }

    branch.children = kept;
    branch.kids.replaceChildren(...rows);
    if (rows.length === 0) branch.kids.replaceChildren(note(vacant(branch)));
  }

  function vacant(branch: Branch): string {
    return branch.node ? "Vacía" : "Todavía no hay proyectos";
  }

  function inside(parent: Branch, maybe: Branch): boolean {
    for (let at: Branch | null = maybe; at; at = at.parent) if (at === parent) return true;
    return false;
  }

  /** El camino desde la raíz hasta esa rama, en migas. */
  function pathOf(branch: Branch): Crumb[] {
    const trail: Crumb[] = [];
    for (let at: Branch | null = branch; at; at = at.parent) {
      trail.unshift({ id: at.id, name: nameOf(at) });
    }
    return trail;
  }

  /**
   * Un renglón se abre como una baldosa: la página puede ser carpeta o
   * documento y el árbol no lo sabe sin leerla —decidirlo lo hace
   * `folders.ts`, que ya lee lo que hay dentro al entrar.
   */
  function activate(branch: Branch): void {
    void show(branch);
    const node = branch.node;
    if (node) options.open(node, branch.parent ? pathOf(branch.parent) : pathOf(branch));
  }

  /* --- lo que está señalado ----------------------------------------------- */

  /** Dónde está la retícula. Es una sola rama y se marca con `aria-current`. */
  function markHere(id: string): void {
    for (const marked of list.querySelectorAll<HTMLElement>('[aria-current="true"]')) {
      marked.removeAttribute("aria-current");
    }
    const branch = find(id);
    branch?.item.setAttribute("aria-current", "true");
  }

  /** El documento abierto: hoja maciza y `aria-selected`, como en las baldosas. */
  function markSelected(): void {
    const chosen = selection.get()?.id ?? "";
    walk(rootBranch, (branch) => {
      const mine = branch.id === chosen;
      branch.item.setAttribute("aria-selected", String(mine));
      setIcon(branch.glyph, glyphOf(branch));
    });
  }

  function walk(from: Branch, run: (branch: Branch) => void): void {
    run(from);
    for (const kid of from.children.values()) walk(kid, run);
  }

  function find(id: string): Branch | null {
    let found: Branch | null = null;
    walk(rootBranch, (branch) => { if (branch.id === id) found = branch; });
    return found;
  }

  /* --- el teclado --------------------------------------------------------- */

  /** Las ramas a la vista, de arriba abajo: es el orden en que se recorren. */
  function onScreen(): Branch[] {
    const rows: Branch[] = [];
    (function push(branch: Branch): void {
      rows.push(branch);
      if (!branch.open) return;
      for (const kid of branch.children.values()) push(kid);
    })(rootBranch);
    return rows;
  }

  /**
   * Una sola parada de tabulación para el árbol entero: dentro se anda con las
   * flechas. Es lo que espera quien usa un árbol, y evita que treinta carpetas
   * sean treinta pulsaciones de tabulador para llegar al documento.
   */
  function focus(branch: Branch, move: boolean): void {
    if (focused) focused.item.tabIndex = -1;
    focused = branch;
    branch.item.tabIndex = 0;
    if (move) branch.item.focus();
  }

  function step(by: number): void {
    const rows = onScreen();
    const at = focused ? rows.indexOf(focused) : -1;
    const next = rows[Math.min(Math.max(at + by, 0), rows.length - 1)];
    if (next) focus(next, true);
  }

  list.addEventListener("keydown", (event) => {
    const branch = focused;
    if (!branch) return;
    const rows = onScreen();

    switch (event.key) {
      case "ArrowDown": step(1); break;
      case "ArrowUp": step(-1); break;
      case "Home": { const first = rows[0]; if (first) focus(first, true); break; }
      case "End": { const last = rows[rows.length - 1]; if (last) focus(last, true); break; }
      case "ArrowRight":
        // Cerrada, se abre; abierta, se entra en el primer hijo. Es la única
        // manera de recorrer un árbol sin levantar la mano del teclado.
        if (!branch.open) { void show(branch); break; }
        { const first = branch.children.values().next().value; if (first) focus(first, true); }
        break;
      case "ArrowLeft":
        if (branch.open) { shut(branch); break; }
        if (branch.parent) focus(branch.parent, true);
        break;
      case "Enter": case " ":
        activate(branch);
        break;
      default: return;
    }

    // Sólo se para lo que se ha atendido: el resto sigue su camino, y el Escape
    // de la franja tiene que llegar a la franja.
    event.preventDefault();
    event.stopPropagation();
  });

  /* --- lo que pide la retícula -------------------------------------------- */

  /**
   * Abre las ramas del camino hasta dónde está la retícula.
   *
   * Se hace paso a paso porque cada nivel puede no estar leído: una pestaña que
   * arranca dentro de una carpeta, o un documento abierto desde otra pestaña,
   * llegan con un camino del que el árbol todavía no sabe nada. El contador
   * descarta un camino que dejó de ser el actual mientras se leía.
   */
  async function walkTo(path: readonly Crumb[]): Promise<void> {
    const mine = ++seq;
    let at = rootBranch;
    await show(at);
    if (mine !== seq) return;

    for (const crumb of path.slice(1)) {
      const kid = at.children.get(crumb.id);
      if (!kid) break;
      at = kid;
      await show(at);
      if (mine !== seq) return;
    }

    markHere(at.id);
    markSelected();
  }

  const stop = selection.subscribe(markSelected);

  return {
    root: list,

    feed(parentId, nodes) {
      const branch = find(parentId);
      if (!branch) return;
      put(branch, nodes);
      // Si la retícula está mostrando esa carpeta, en el árbol se ve abierta.
      if (!branch.open) { branch.open = true; branch.kids.hidden = false; paintRow(branch); }
      markSelected();
    },

    reveal(path) { void walkTo(path); },

    add(parentId, node) {
      const branch = find(parentId);
      if (!branch || !branch.loaded) return;
      if (branch.children.has(node.id)) return;
      const kid = branchOf(node, branch);
      branch.children.set(node.id, kid);
      paintRow(kid);
      branch.kids.querySelector(".tree__note")?.remove();
      branch.kids.append(kid.item);
      if (!branch.open) { branch.open = true; branch.kids.hidden = false; paintRow(branch); }
    },

    drop(nodeId) {
      const branch = find(nodeId);
      if (!branch?.parent) return;
      const parent = branch.parent;
      // El foco no puede quedarse en un renglón que ya no está en la página.
      if (focused && inside(branch, focused)) focus(parent, false);
      parent.children.delete(nodeId);
      branch.item.remove();
      if (parent.children.size === 0) parent.kids.replaceChildren(note(vacant(parent)));
    },

    rename(nodeId, name) {
      const branch = find(nodeId);
      if (!branch?.node) return;
      branch.node.name = name;
      paintRow(branch);
    },

    retitle(title) {
      options.rootTitle = title;
      paintRow(rootBranch);
    },

    dispose() {
      stop();
      seq++;   // lo que estuviera revelándose ya no tiene a quién contárselo
    },
  };
}
