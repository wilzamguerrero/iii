import { el, render } from "../dom.ts";
import { icon, setIcon } from "../icons.ts";
import { anchorOf, openMenu, type MenuAt, type MenuItem } from "./menu.ts";
import { onMade } from "./reload.ts";
import { mountTree } from "./tree.ts";
import { openBegin } from "../start/open.ts";
import { NotionRequestError } from "../../core/notion/client.ts";
import {
  createPage, createProject, deleteNode, readChildren, renameNode,
  UNTITLED_PAGE, UNTITLED_PROJECT, type TreeNode,
} from "../../core/notion/tree.ts";
import { intent } from "../../core/state/intent.ts";
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
  /** La columna que se desplaza. El árbol se desplaza por su cuenta. */
  const body = el("div", { class: "exp__body" }, [grid, status]);
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
      const acts = [crumbAct("Nuevo proyecto", () => {
        askName("project", "Nombre del proyecto…", addFolder);
      })];
      /* Con una intención anotada, el camino corto: el asistente propone el nombre
         y las preguntas, y de ahí salen la carpeta y sus tres documentos. Va
         primero porque es el que se quiere: crear a mano es el de después. */
      if (intent.get()) {
        acts.unshift(crumbAct("Crear desde la intención", () => { openBegin(); }));
      }
      return acts;
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
    body.scrollTop = 0;
    void load();
  }

  /**
   * Ir a un camino entero, no un paso: es lo que pide el árbol, que puede
   * señalar cualquier rama. Se comprueba que cuelgue de esta raíz —cambiar de
   * raíz invalida los ids— y no se relee lo que ya se está mirando.
   */
  function goPath(next: readonly Crumb[]): void {
    const first = next[0];
    if (!first || first.id !== root) return;
    if (next.length === path.length && next.every((crumb, at) => crumb.id === path[at]?.id)) return;
    path.length = 0;
    path.push(...next.map((crumb) => ({ ...crumb })));
    moved();
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
      // La misma lectura sirve al árbol: primero se le da y después se le pide
      // que abra el camino, para que no vuelva a pedir lo que acaba de recibir.
      tree.feed(here().id, children);
      tree.reveal(path);
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
   * Un documento pulsado en el árbol: se abre y la retícula se va a la carpeta
   * donde vive. El árbol dice dónde está cada cosa, así que abrir desde ahí tiene
   * que dejar a la vista lo que hay alrededor.
   */
  function openFromTree(node: TreeNode, at: readonly Crumb[]): void {
    goPath(at);
    const folder = at[at.length - 1];
    selectPage({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      ...(at.length > 1 && folder ? { projectName: folder.name } : {}),
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
      tree.rename(node.id, name);
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
      tree.drop(node.id);
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
        attrs: { type: "button", "aria-label": `Acciones de ${name}`, "aria-haspopup": "menu" },
        on: {
          click: (event) => {
            event.stopPropagation();
            openMenu(anchorOf(more), menuOf(node, cell, edit));
          },
        },
      }, [icon("more", "ico ico--small")]);

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
      tree.add(here().id, created);
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
      tree.add(here().id, created);
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
      mark(node, "page");
    }
    const chosen = selection.get();
    if (!chosen) return;
    const open = grid.querySelector<HTMLElement>(
      `.tile[data-page-id="${CSS.escape(chosen.id)}"]`,
    );
    if (!open) return;
    open.setAttribute("aria-current", "true");
    mark(open, "pageFull");
  }

  /** La hoja del documento abierto es maciza; la de las demás, de contorno. */
  function mark(tile: HTMLElement, name: "page" | "pageFull"): void {
    const svg = tile.querySelector<SVGSVGElement>(".tile__ico svg");
    if (svg) setIcon(svg, name);
  }

  /* --- puesta en marcha --------------------------------------------------- */

  const tree = mountTree({
    token,
    root,
    rootTitle: options.rootTitle,
    goTo: goPath,
    open: openFromTree,
    revoked: () => { options.revoked?.(); },
  });

  /* El cuerpo de la pestaña deja de desplazarse él y pasa a ser dos columnas:
     el árbol a la izquierda y la retícula a la derecha, cada una con su
     desplazamiento. La clase se quita al desmontar porque el mismo hueco lo usan
     las otras pantallas —conectar, elegir raíz—, que sí se desplazan enteras. */
  pane.classList.add("dock__pane--exp");
  render(pane, el("div", { class: "exp" }, [
    el("aside", { class: "exp__tree", attrs: { "aria-label": "Desde la raíz" } }, [tree.root]),
    body,
  ]));

  paintCrumbs();
  announce();
  void load();

  const stop = selection.subscribe(markSelected);

  /**
   * Lo creado desde fuera: el proyecto que nace de la intención, que puede haberse
   * hecho con la franja plegada. Se pinta con los nodos que trae el aviso en vez de
   * releer la carpeta, y si el aviso señala un sitio, se entra en él.
   */
  /* La primera intención escrita con la franja abierta tiene que aparecer como
     acción sin recargar nada. */
  const stopIntent = intent.subscribe(() => { if (atRoot()) paintCrumbs(); });

  const stopMade = onMade((made) => {
    if (made.parentId === here().id) {
      grid.querySelector(".grid__note")?.remove();
      for (const node of made.nodes) grid.append(cellOf(node));
      markSelected();
    }
    for (const node of made.nodes) tree.add(made.parentId, node);
    // Entrar sólo lo hace la pestaña que se está viendo. Una pestaña es un sitio y
    // llevárselas todas al proyecto nuevo sería quitarle a alguien lo que dejó
    // abierto; las demás se enteran de que existe y se quedan donde están. Se
    // reconoce por el `hidden` que les pone la barra de pestañas.
    if (made.enter && !pane.closest("[hidden]")) goPath(made.enter);
  });

  return {
    retitle(title) {
      const first = path[0];
      if (!first || first.name === title) return;
      first.name = title;
      tree.retitle(title);
      paintCrumbs();
      announce();
    },
    dispose() {
      stop();
      stopIntent();
      stopMade();
      tree.dispose();
      pane.classList.remove("dock__pane--exp");
      render(head);
    },
  };
}
