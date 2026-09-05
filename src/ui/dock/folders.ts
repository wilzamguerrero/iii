import { el, render } from "../dom.ts";
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
 * Cada carpeta es un `toggle` de Notion y cada documento un bloque `code` en
 * markdown dentro (plan.md D2). Esto no es un visor de Notion: sólo muestra lo
 * que la plataforma crea, y lo demás que haya en esa página se deja en paz.
 *
 * Se lee una carpeta al entrar en ella y no se guarda lo leído: Notion admite
 * unas tres peticiones por segundo y nadie navega tan rápido, así que la lista
 * está siempre al día en vez de casi al día.
 */

const NO_TOKEN =
  "La conexión con Notion ya no es válida. Vuelve a conectar aquí abajo.";

/** Lo que tarda «¿Seguro?» en volver a ser «Eliminar». */
const ARM_MS = 4000;

/** Un tramo del camino: la raíz es siempre el primero y no se quita. */
interface Crumb {
  id: string;
  name: string;
}

export interface FoldersOptions {
  /** La fila fija de arriba, fuera del desplazamiento: las migas y crear. */
  head: HTMLElement;
  /** El cuerpo que se desplaza: la lista. */
  pane: HTMLElement;
  token: string;
  /** La página de Notion bajo la que vive todo. */
  root: string;
  rootTitle: string;
  /** La nota del final: de dónde es esto y cómo cambiarlo. La trae quien monta. */
  foot: HTMLElement;
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
  const { head, pane, token, root, foot } = options;

  const path: Crumb[] = [{ id: root, name: options.rootTitle }];
  const list = el("ul", { class: "fold" });
  const status = el("p", { class: "msg" });
  /** Descarta la respuesta de una carpeta que ya no es la que se está viendo. */
  let seq = 0;

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
        askName("Nombre del proyecto…", addFolder);
      })];
    }
    return [
      crumbAct("Nueva página", () => { askName("Nombre de la página…", addPage); }),
      crumbAct("Nueva carpeta", () => { askName("Nombre de la carpeta…", addFolder); }),
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
    paintCrumbs();
    pane.scrollTop = 0;
    void load();
  }

  function goTo(index: number): void {
    if (index >= path.length - 1) return;
    path.length = index + 1;
    paintCrumbs();
    pane.scrollTop = 0;
    void load();
  }

  /* --- leer y pintar ----------------------------------------------------- */

  async function load(): Promise<void> {
    const mine = ++seq;
    list.replaceChildren(el("li", { class: "fold__wait", text: "Leyendo…" }));
    try {
      const children = await readChildren(token, here().id);
      if (mine !== seq) return;   // se entró en otra carpeta mientras llegaba
      paint(children);
      say("");
    } catch (cause) {
      if (mine !== seq) return;
      list.replaceChildren();
      say(reason(cause, atRoot()
        ? "No se pudo leer la página raíz."
        : "No se pudo leer la carpeta."), true);
    }
  }

  function paintEmpty(): void {
    list.replaceChildren(el("li", { class: "fold__wait", text: atRoot()
      ? "Todavía no hay proyectos. Crea el primero."
      : "Carpeta vacía. Crea la primera página." }));
  }

  function paint(nodes: readonly TreeNode[]): void {
    if (nodes.length === 0) { paintEmpty(); return; }
    list.replaceChildren(...nodes.map((node) => (
      node.kind === "project" ? folderItem(node) : pageItem(node)
    )));
    markSelected();
  }

  /**
   * Un campo que se convierte en fila. Aparece al final de la lista de donde se
   * está, y no en un formulario aparte, para que se vea dónde se crea.
   */
  function nameField(
    placeholder: string,
    commit: (name: string) => Promise<void>,
    cancel: () => void,
  ): HTMLLIElement {
    let closed = false;

    const input = el("input", {
      class: "fold__field",
      attrs: {
        type: "text", placeholder, maxlength: 120,
        autocomplete: "off", spellcheck: false,
      },
    });

    const item = el("li", { class: "fold__item" }, [
      el("div", { class: "fold__row" }, [input]),
    ]);

    function close(): void {
      closed = true;
      item.remove();
      cancel();
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) { close(); return; }
        closed = true;
        input.disabled = true;
        void commit(name).finally(() => { item.remove(); });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // El Escape de aquí cancela el campo; no cierra la franja.
        event.stopPropagation();
        close();
      }
    });

    // Perder el foco cancela: es lo que espera quien pulsa en otro sitio.
    input.addEventListener("blur", () => { if (!closed) close(); });

    setTimeout(() => { input.focus(); }, 0);
    return item;
  }

  function askName(placeholder: string, commit: (name: string) => Promise<void>): void {
    list.querySelector(".fold__wait")?.remove();
    list.append(nameField(placeholder, commit, () => {
      if (list.children.length === 0) paintEmpty();
    }));
  }

  async function addFolder(name: string): Promise<void> {
    try {
      const created = await createProject(token, here().id, name);
      list.querySelector(".fold__wait")?.remove();
      list.append(folderItem(created));
      say("");
    } catch (cause) {
      say(reason(cause, "No se pudo crear la carpeta."), true);
    }
  }

  async function addPage(name: string): Promise<void> {
    try {
      const created = await createPage(token, here().id, name);
      list.querySelector(".fold__wait")?.remove();
      list.append(pageItem(created));
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

  /* --- acciones de una fila ---------------------------------------------- */

  function actionButton(label: string, title: string, run: () => void): HTMLButtonElement {
    return el("button", {
      class: "fold__act",
      text: label,
      attrs: { type: "button", title, "aria-label": title },
      on: { click: (event) => { event.stopPropagation(); run(); } },
    });
  }

  /** Borrar pide dos pulsaciones. No hay ventana del navegador de por medio. */
  function deleteButton(node: TreeNode, run: () => Promise<void>): HTMLButtonElement {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const button = el("button", {
      class: "fold__act fold__act--risk",
      text: "Eliminar",
      attrs: { type: "button", title: `Eliminar ${node.name}` },
    });

    function disarm(): void {
      armed = false;
      button.textContent = "Eliminar";
      button.classList.remove("is-armed");
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (armed) {
        clearTimeout(timer);
        disarm();
        void run();
        return;
      }
      armed = true;
      button.textContent = "¿Seguro?";
      button.classList.add("is-armed");
      say(node.kind === "project"
        ? "Se irá con todo lo que tenga dentro, a la papelera de Notion."
        : "Irá a la papelera de Notion, de donde puedes recuperarla.");
      timer = setTimeout(disarm, ARM_MS);
    });

    return button;
  }

  /** Renombrar cambia la etiqueta por un campo, en su sitio. */
  function renameAction(node: TreeNode, label: HTMLElement): HTMLButtonElement {
    return actionButton("Renombrar", `Renombrar ${node.name}`, () => {
      const previous = node.name;
      const input = el("input", {
        class: "fold__field",
        attrs: {
          type: "text", value: previous, maxlength: 120,
          autocomplete: "off", spellcheck: false,
        },
      });
      let closed = false;

      function restore(): void {
        closed = true;
        input.replaceWith(label);
      }

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const name = input.value.trim();
          if (!name || name === previous) { restore(); return; }
          closed = true;
          input.disabled = true;
          void renameNode(token, node, name)
            .then(() => {
              node.name = name;
              label.textContent = name;
              // La miga de una carpeta en la que se está dentro no se ve desde
              // aquí, pero la de ésta sí si se entra después: el nodo ya lleva
              // el nombre nuevo.
              say("");
            })
            .catch((cause: unknown) => { say(reason(cause, "No se pudo renombrar."), true); })
            .finally(() => { input.replaceWith(label); });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          restore();
        }
      });
      input.addEventListener("blur", () => { if (!closed) restore(); });

      label.replaceWith(input);
      input.focus();
      input.select();
    });
  }

  function removeAction(node: TreeNode, item: HTMLLIElement): HTMLButtonElement {
    return deleteButton(node, async () => {
      try {
        await deleteNode(token, node.id);
        const chosen = selection.get();
        if (chosen && (chosen.id === node.id || chosen.parentId === node.id)) clearSelection();
        item.remove();
        if (list.children.length === 0) paintEmpty();
        say("");
      } catch (cause) {
        say(reason(cause, "No se pudo eliminar."), true);
      }
    });
  }

  /* --- las filas ---------------------------------------------------------- */

  /** Una carpeta: se entra en ella. La punta hacia la derecha es la entrada. */
  function folderItem(node: TreeNode): HTMLLIElement {
    const label = el("span", { class: "fold__name", text: node.name || UNTITLED_PROJECT });

    const into = el("button", {
      class: "fold__into",
      attrs: { type: "button", title: `Abrir ${node.name}` },
      on: { click: () => { enter(node); } },
    }, [el("span", { class: "fold__mark", attrs: { "aria-hidden": "true" } }), label]);

    const row = el("div", { class: "fold__row" }, [into]);
    const item = el("li", { class: "fold__item" }, [row]);

    row.append(el("span", { class: "fold__acts" }, [
      renameAction(node, label),
      removeAction(node, item),
    ]));

    return item;
  }

  /** Un documento: se abre, y el asistente lee el que esté abierto. */
  function pageItem(node: TreeNode): HTMLLIElement {
    const label = el("span", { class: "fold__name", text: node.name || UNTITLED_PAGE });

    const open = el("button", {
      class: "fold__open",
      attrs: {
        type: "button", "data-page-id": node.id, "aria-current": "false",
        title: `Abrir ${node.name}`,
      },
      on: {
        click: () => {
          selectPage({
            id: node.id,
            name: node.name,
            parentId: node.parentId,
            ...(atRoot() ? {} : { projectName: here().name }),
          });
        },
      },
    }, [el("span", { class: "fold__dot", attrs: { "aria-hidden": "true" } }), label]);

    const row = el("div", { class: "fold__row" }, [open]);
    const item = el("li", { class: "fold__item" }, [row]);

    row.append(el("span", { class: "fold__acts" }, [
      renameAction(node, label),
      removeAction(node, item),
    ]));

    return item;
  }

  /**
   * Marca el documento abierto. Se busca en el DOM en vez de guardar una tabla
   * de botones: las filas se pintan y se tiran al cambiar de carpeta, y la tabla
   * se quedaría apuntando a nodos que ya no existen.
   */
  function markSelected(): void {
    for (const node of list.querySelectorAll<HTMLElement>('.fold__open[aria-current="true"]')) {
      node.setAttribute("aria-current", "false");
    }
    const chosen = selection.get();
    if (!chosen) return;
    list
      .querySelector<HTMLElement>(`.fold__open[data-page-id="${CSS.escape(chosen.id)}"]`)
      ?.setAttribute("aria-current", "true");
  }

  /* --- puesta en marcha --------------------------------------------------- */

  render(pane, list, status, foot);
  paintCrumbs();
  void load();

  const stop = selection.subscribe(markSelected);

  return {
    retitle(title) {
      const first = path[0];
      if (!first || first.name === title) return;
      first.name = title;
      paintCrumbs();
    },
    dispose() {
      stop();
      render(head);
    },
  };
}
