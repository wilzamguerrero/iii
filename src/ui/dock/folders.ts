import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { anchorOf, openMenu, type MenuAt, type MenuItem } from "./menu.ts";
import { NotionRequestError } from "../../core/notion/client.ts";
import {
  createPage, createProject, deleteNode, readChildren, renameNode,
  UNTITLED_PAGE, UNTITLED_PROJECT, type TreeNode,
} from "../../core/notion/tree.ts";
import { clearSelection, selectPage, selection } from "../../core/state/selection.ts";

/**
 * Las carpetas del espacio de trabajo, recorridas en horizontal.
 *
 * Antes esto era un árbol que se desplegaba hacia abajo. En una franja de 340 px
 * de alto, dos niveles abiertos dejaban la lista sin sitio y la sangría contaba
 * la jerarquía dos veces. Ahora se entra: la fila de arriba dice dónde estás
 * —con la misma gramática que tenían las pestañas del espacio de trabajo:
 * mayúsculas pequeñas y una línea bajo la actual— y debajo va sólo el contenido
 * de esa carpeta. Volver es pulsar una miga.
 *
 * El contenido son baldosas y no filas. Una carpeta es un sitio, y un sitio se
 * reconoce por su figura antes que por su nombre; en filas, treinta proyectos
 * son treinta renglones iguales que hay que leer. La retícula además aprovecha
 * el ancho, que es lo que sobra en una franja baja y ancha.
 *
 * Cada carpeta es un `toggle` de Notion y cada documento un bloque `code` en
 * markdown dentro (plan.md D2). Esto no es un visor de Notion: sólo muestra lo
 * que la plataforma crea, y lo demás que haya en esa página se deja en paz.
 *
 * Se lee una carpeta al entrar en ella y no se guarda lo leído: Notion admite
 * unas tres peticiones por segundo y nadie navega tan rápido, así que la lista
 * está siempre al día en vez de casi al día.
 *
 * Lo que se puede hacer con una baldosa está en su menú —el botón «⋯» o el clic
 * derecho—, no en botones a la vista. Con acciones a la vista, la baldosa mide
 * lo que mide su acción más larga y la retícula se convierte en una lista.
 */

const NO_TOKEN =
  "La conexión con Notion ya no es válida. Vuelve a conectar aquí abajo.";

/** Un tramo del camino: la raíz es siempre el primero y no se quita. */
export interface Crumb {
  id: string;
  name: string;
}

export interface FoldersOptions {
  /** La fila fija de arriba, fuera del desplazamiento: las migas y crear. */
  head: HTMLElement;
  /** El cuerpo que se desplaza: la retícula. */
  pane: HTMLElement;
  token: string;
  /** La página de Notion bajo la que vive todo. */
  root: string;
  rootTitle: string;
  /**
   * Dónde empezar. Sirve para dos cosas: abrir una pestaña nueva ya dentro de
   * una carpeta, y no perder el sitio cuando esta pantalla se reconstruye.
   */
  initialPath?: readonly Crumb[];
  /** Cada vez que se cambia de carpeta. La pestaña lo usa para su etiqueta. */
  onPath?: (path: readonly Crumb[]) => void;
  /** «Abrir en otra pestaña». Lo atiende quien gobierna las pestañas. */
  onNewTab?: (path: readonly Crumb[]) => void;
  /** Notion dijo que el token ya no vale. Lo atiende quien montó esto. */
  revoked?: () => void;
}

export interface Folders {
  /** Cambió el título de la raíz: se repinta la primera miga y nada más. */
  retitle(title: string): void;
  /** Suelta las suscripciones. Se llama antes de volver a montar. */
  dispose(): void;
}

export function mountFolders(options: FoldersOptions): Folders {
  const { head, pane, token, root } = options;

  const path: Crumb[] = seed();
  const grid = el("ul", { class: "grid" });
  const status = el("p", { class: "msg" });
  /** Descarta la respuesta de una carpeta que ya no es la que se está viendo. */
  let seq = 0;

  /**
   * El camino de partida se copia, no se comparte: dos pestañas que empiecen en
   * el mismo sitio se van por su lado en cuanto una entra en una carpeta. Y se
   * descarta si no cuelga de esta raíz, porque cambiar de raíz invalida los ids.
   */
  function seed(): Crumb[] {
    const given = options.initialPath;
    if (!given || given.length === 0 || given[0]?.id !== root) {
      return [{ id: root, name: options.rootTitle }];
    }
    const copy = given.map((crumb) => ({ ...crumb }));
    // El título de la raíz manda el que se acaba de recibir: pudo renombrarse.
    if (copy[0]) copy[0].name = options.rootTitle;
    return copy;
  }

  function here(): Crumb {
    return path[path.length - 1] ?? { id: root, name: options.rootTitle };
  }

  function atRoot(): boolean {
    return path.length === 1;
  }

  function say(message: string, bad = false): void {
    status.className = bad ? "msg msg--bad" : "msg";
    status.textContent = message;
  }

  function announce(): void {
    options.onPath?.(path.map((crumb) => ({ ...crumb })));
  }

  /**
   * Por qué falló, en una frase. Un 401 no es un fallo de la operación sino de
   * la conexión, así que además de contarlo se avisa hacia arriba: seguir
   * pintando carpetas de un token muerto es enseñar una lista que ya no existe.
   */
  function reason(cause: unknown, fallback: string): string {
    if (cause instanceof NotionRequestError) {
      if (cause.status !== 401) return `${fallback} ${cause.message}`;
      options.revoked?.();
      return NO_TOKEN;
    }
    return fallback;
  }

  /* --- la fila de arriba -------------------------------------------------- */

  function crumbAct(label: string, run: () => void): HTMLButtonElement {
    return el("button", {
      class: "crumb__act",
      text: label,
      attrs: { type: "button" },
      on: { click: run },
    });
  }

  /**
   * Crear ocurre donde se está, así que los botones viven en la fila del camino
   * y cambian con ella: en la raíz se crean proyectos; dentro, páginas y las
   * carpetas que hagan falta para ordenarlas.
   */
  function actions(): HTMLElement[] {
    if (atRoot()) {
      return [crumbAct("Nuevo proyecto", () => {
        askName("project", "Nombre del proyecto…", addFolder);
      })];
    }
    return [
      crumbAct("Nueva página", () => { askName("page", "Nombre de la página…", addPage); }),
      crumbAct("Nueva carpeta", () => { askName("project", "Nombre de la carpeta…", addFolder); }),
    ];
  }

  function paintCrumbs(): void {
    const trail: HTMLElement[] = [];

    path.forEach((crumb, index) => {
      const first = index === 0;
      const last = index === path.length - 1;
      if (!first) {
        trail.push(el("span", {
          class: "crumbs__sep", text: "/", attrs: { "aria-hidden": "true" },
        }));
      }
      const name = crumb.name || (first ? "Proyectos" : UNTITLED_PROJECT);
      // La última no es un botón: pulsarla no llevaría a ninguna parte.
      trail.push(last
        ? el("span", {
            class: "crumb crumb--now", text: name,
            attrs: { "aria-current": "page", title: name },
          })
        : el("button", {
            class: "crumb", text: name,
            attrs: { type: "button", title: `Volver a ${name}` },
            on: { click: () => { goTo(index); } },
          }));
    });

    render(head, el("nav", { class: "crumbs", attrs: { "aria-label": "Dónde estás" } }, [
      el("div", { class: "crumbs__trail" }, trail),
      el("div", { class: "crumbs__acts" }, actions()),
    ]));
  }

  /* --- entrar y volver --------------------------------------------------- */

  function enter(node: TreeNode): void {
    path.push({ id: node.id, name: node.name });
    moved();
  }

  function goTo(index: number): void {
    if (index >= path.length - 1) return;
    path.length = index + 1;
    moved();
  }

  function moved(): void {
    paintCrumbs();
    announce();
    pane.scrollTop = 0;
    void load();
  }

  /* --- leer y pintar ----------------------------------------------------- */

  function note(text: string): HTMLLIElement {
    return el("li", { class: "grid__note", text });
  }

  async function load(): Promise<void> {
    const mine = ++seq;
    grid.replaceChildren(note("Leyendo…"));
    try {
      const children = await readChildren(token, here().id);
      if (mine !== seq) return;   // se entró en otra carpeta mientras llegaba
      paint(children);
      say("");
    } catch (cause) {
      if (mine !== seq) return;
      grid.replaceChildren();
      say(reason(cause, atRoot()
        ? "No se pudo leer la página raíz."
        : "No se pudo leer la carpeta."), true);
    }
  }

  function paintEmpty(): void {
    grid.replaceChildren(note(atRoot()
      ? "Todavía no hay proyectos. Crea el primero."
      : "Carpeta vacía. Crea la primera página."));
  }

  function paint(nodes: readonly TreeNode[]): void {
    if (nodes.length === 0) { paintEmpty(); return; }
    grid.replaceChildren(...nodes.map((node) => cellOf(node)));
    markSelected();
  }

  /* --- lo que se puede hacer con una baldosa ------------------------------ */

  /** Una carpeta se entra; un documento se abre y el asistente lo lee. */
  function openNode(node: TreeNode): void {
    if (node.kind === "project") { enter(node); return; }
    selectPage({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      ...(atRoot() ? {} : { projectName: here().name }),
    });
  }

  /**
   * En otra pestaña: una carpeta se abre dentro; un documento abre la carpeta
   * donde vive y se selecciona. Es la misma idea —la pestaña es un sitio— y deja
   * dos carpetas a la vista para mover cosas de una a otra con la mirada.
   */
  function openElsewhere(node: TreeNode): void {
    if (node.kind === "project") {
      options.onNewTab?.([...path, { id: node.id, name: node.name }]);
      return;
    }
    options.onNewTab?.([...path]);
    openNode(node);
  }

  async function rename(node: TreeNode, name: string): Promise<void> {
    try {
      await renameNode(token, node, name);
      node.name = name;
      say("");
    } catch (cause) {
      say(reason(cause, "No se pudo renombrar."), true);
    }
  }

  async function remove(node: TreeNode, cell: HTMLElement): Promise<void> {
    try {
      await deleteNode(token, node.id);
      const chosen = selection.get();
      if (chosen && (chosen.id === node.id || chosen.parentId === node.id)) clearSelection();
      cell.remove();
      if (grid.children.length === 0) paintEmpty();
      say("");
    } catch (cause) {
      say(reason(cause, "No se pudo eliminar."), true);
    }
  }

  /** El menú de una baldosa. Borrar pregunta dentro del propio menú. */
  function menuOf(node: TreeNode, cell: HTMLLIElement, edit: () => void): MenuItem[] {
    const items: MenuItem[] = [
      { label: node.kind === "project" ? "Abrir" : "Abrir y leer", run: () => { openNode(node); } },
    ];

    if (options.onNewTab) {
      items.push({ label: "Abrir en otra pestaña", run: () => { openElsewhere(node); } });
    }

    items.push({ label: "Renombrar", run: edit });
    items.push({
      label: "Eliminar",
      risk: true,
      confirm: true,
      // La consecuencia va en la propia etiqueta armada: es donde se está
      // mirando al decidir, y ahorra un diálogo del navegador.
      confirmLabel: node.kind === "project"
        ? "¿Seguro? Se va con todo dentro"
        : "¿Seguro? Va a la papelera",
      run: () => { void remove(node, cell); },
    });

    return items;
  }

  /** El clic derecho abre donde está el puntero; el teclado, bajo la baldosa. */
  function pointOf(event: MouseEvent, node: Element): MenuAt {
    if (event.clientX <= 0 && event.clientY <= 0) return anchorOf(node);
    return { x: event.clientX, y: event.clientY, below: 2 };
  }

  /* --- las baldosas ------------------------------------------------------- */

  function glyph(kind: TreeNode["kind"]): HTMLElement {
    return el("span", { class: "tile__ico" }, [icon(kind === "project" ? "folder" : "page")]);
  }

  /**
   * Una baldosa y su celda. La celda es la que sobrevive a todo: renombrar
   * cambia lo que hay dentro —la baldosa por un campo y otra vez la baldosa—, y
   * así el sitio en la retícula no se mueve mientras se escribe.
   */
  function cellOf(node: TreeNode): HTMLLIElement {
    const cell = el("li", { class: "grid__cell" });

    function show(): void {
      const name = node.name || (node.kind === "project" ? UNTITLED_PROJECT : UNTITLED_PAGE);

      const tile = el("button", {
        class: "tile",
        attrs: {
          type: "button",
          title: name,
          ...(node.kind === "page"
            ? { "data-page-id": node.id, "aria-current": "false" }
            : {}),
        },
        on: {
          click: () => { openNode(node); },
          contextmenu: (event) => {
            event.preventDefault();
            openMenu(pointOf(event, tile), menuOf(node, cell, edit));
          },
        },
      }, [glyph(node.kind), el("span", { class: "tile__name", text: name })]);

      const more = el("button", {
        class: "tile__more",
        text: "⋯",
        attrs: { type: "button", "aria-label": `Acciones de ${name}`, "aria-haspopup": "menu" },
        on: {
          click: (event) => {
            event.stopPropagation();
            openMenu(anchorOf(more), menuOf(node, cell, edit));
          },
        },
      });

      render(cell, tile, more);
      if (node.kind === "page") markSelected();
    }

    function edit(): void {
      render(cell, field(node.kind, node.name, async (next) => { await rename(node, next); }, show));
    }

    show();
    return cell;
  }

  /**
   * El campo con forma de baldosa. Sirve para renombrar y para crear, que son el
   * mismo gesto —escribir un nombre en el sitio donde va a quedar—, y por eso es
   * una sola función. `done` cierra el campo pase lo que pase: al confirmar, al
   * cancelar y al fallar.
   */
  function field(
    kind: TreeNode["kind"],
    value: string,
    commit: (name: string) => Promise<void>,
    done: () => void,
    placeholder = "",
  ): HTMLElement {
    let closed = false;

    const input = el("input", {
      class: "tile__field",
      attrs: {
        type: "text", value, placeholder, maxlength: 120,
        autocomplete: "off", spellcheck: false,
        "aria-label": placeholder || "Nombre",
      },
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const name = input.value.trim();
        if (!name || name === value) { closed = true; done(); return; }
        closed = true;
        input.disabled = true;
        // `commit` nunca rechaza: cuenta su propio fallo en la línea de estado.
        void commit(name).finally(done);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // El Escape de aquí cancela el campo; no cierra la franja.
        event.stopPropagation();
        closed = true;
        done();
      }
    });

    // Perder el foco cancela: es lo que espera quien pulsa en otro sitio.
    input.addEventListener("blur", () => { if (!closed) { closed = true; done(); } });

    setTimeout(() => { input.focus(); input.select(); }, 0);

    return el("div", { class: "tile tile--edit" }, [glyph(kind), input]);
  }

  /* --- crear -------------------------------------------------------------- */

  function askName(
    kind: TreeNode["kind"],
    placeholder: string,
    commit: (name: string) => Promise<void>,
  ): void {
    grid.querySelector(".grid__note")?.remove();
    const cell = el("li", { class: "grid__cell" });

    function done(): void {
      cell.remove();
      if (grid.children.length === 0) paintEmpty();
    }

    render(cell, field(kind, "", commit, done, placeholder));
    grid.append(cell);
    cell.scrollIntoView({ block: "nearest" });
  }

  async function addFolder(name: string): Promise<void> {
    try {
      const created = await createProject(token, here().id, name);
      grid.querySelector(".grid__note")?.remove();
      grid.append(cellOf(created));
      say("");
    } catch (cause) {
      say(reason(cause, "No se pudo crear la carpeta."), true);
    }
  }

  async function addPage(name: string): Promise<void> {
    try {
      const created = await createPage(token, here().id, name);
      grid.querySelector(".grid__note")?.remove();
      grid.append(cellOf(created));
      // Se abre lo que se acaba de crear: es lo que se iba a hacer con ella.
      selectPage({
        id: created.id, name: created.name, parentId: here().id,
        ...(atRoot() ? {} : { projectName: here().name }),
      });
      say("");
    } catch (cause) {
      say(reason(cause, "No se pudo crear la página."), true);
    }
  }

  /**
   * Marca el documento abierto. Se busca en el DOM en vez de guardar una tabla
   * de botones: las baldosas se pintan y se tiran al cambiar de carpeta, y la
   * tabla se quedaría apuntando a nodos que ya no existen.
   */
  function markSelected(): void {
    for (const node of grid.querySelectorAll<HTMLElement>('.tile[aria-current="true"]')) {
      node.setAttribute("aria-current", "false");
    }
    const chosen = selection.get();
    if (!chosen) return;
    grid
      .querySelector<HTMLElement>(`.tile[data-page-id="${CSS.escape(chosen.id)}"]`)
      ?.setAttribute("aria-current", "true");
  }

  /* --- puesta en marcha --------------------------------------------------- */

  render(pane, grid, status);
  paintCrumbs();
  announce();
  void load();

  const stop = selection.subscribe(markSelected);

  return {
    retitle(title) {
      const first = path[0];
      if (!first || first.name === title) return;
      first.name = title;
      paintCrumbs();
      announce();
    },
    dispose() {
      stop();
      render(head);
    },
  };
}
