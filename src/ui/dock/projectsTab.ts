import { el, render } from "../dom.ts";
import { session, type NotionSession } from "../../core/persist/session.ts";
import { NotionRequestError } from "../../core/notion/client.ts";
import {
  createPage, createProject, deleteNode, readChildren, renameNode,
  UNTITLED_PAGE, UNTITLED_PROJECT, type TreeNode,
} from "../../core/notion/tree.ts";
import { clearSelection, selectPage, selection } from "../../core/state/selection.ts";

/**
 * Pestaña «Proyectos»: el árbol que vive bajo la página raíz.
 *
 * Cada proyecto es una lista desplegable de Notion y cada página un bloque de
 * código en markdown dentro (plan.md D2). El árbol no es un visor de Notion: es
 * la estructura de la plataforma, y por eso sólo muestra lo que la plataforma
 * crea. Lo demás que haya en esa página raíz se deja en paz.
 *
 * Los hijos se piden al desplegar y no al abrir la pestaña. Con veinte proyectos
 * serían veinte peticiones para pintar una lista que igual nadie toca, y Notion
 * admite unas tres por segundo.
 */

const NO_TOKEN =
  "La conexión con Notion ya no es válida. Vuelve a conectar en la pestaña de al lado.";

/** Lo que tarda «¿Seguro?» en volver a ser «Eliminar». */
const ARM_MS = 4000;

function reason(cause: unknown, fallback: string): string {
  if (cause instanceof NotionRequestError) {
    return cause.status === 401 ? NO_TOKEN : `${fallback} ${cause.message}`;
  }
  return fallback;
}

export function mountProjectsTab(container: HTMLElement): void {
  let mode: "unknown" | "off" | "noroot" | "on" = "unknown";
  let rootId = "";
  /** Repinta el título de la raíz sin reconstruir el árbol. */
  let retitle: ((current: NotionSession) => void) | null = null;

  function apply(): void {
    const current = session.get();
    const next = !current ? "off" : !current.rootPageId ? "noroot" : "on";

    // Cambiar la página raíz cambia el árbol entero: eso sí se reconstruye.
    if (next !== mode || (next === "on" && current?.rootPageId !== rootId)) {
      mode = next;
      retitle = null;
      rootId = current?.rootPageId ?? "";
      if (next === "off") buildDisconnected();
      else if (next === "noroot") buildNoRoot();
      else if (current) buildTree(current);
      return;
    }
    if (current && retitle) retitle(current);
  }

  /* --- lo que falta antes del árbol -------------------------------------- */

  /**
   * El botón que lleva a la pestaña de al lado. Decir «ve a Notion» y dejar a la
   * persona buscando la pestaña es media indicación; el evento lo atiende `app.ts`
   * para no importar el dock desde una de sus propias pestañas.
   */
  function goToNotion(label: string): HTMLElement {
    const button = el("button", { class: "btn", text: label, attrs: { type: "button" } });
    button.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("dock:open", { detail: "notion" }));
    });
    return el("div", { class: "pnl__row" }, [button]);
  }

  function buildDisconnected(): void {
    render(container, el("div", { class: "pnl" }, [
      el("p", { class: "pnl__lead", text: "Aún no hay dónde guardar los proyectos." }),
      el("p", { class: "pnl__note", text:
        "Conecta tu Notion en la pestaña de al lado. Cada proyecto será una " +
        "lista desplegable, y cada página del proyecto un documento dentro." }),
      goToNotion("Conectar Notion"),
    ]));
  }

  function buildNoRoot(): void {
    render(container, el("div", { class: "pnl" }, [
      el("p", { class: "pnl__lead", text: "Falta elegir la página raíz." }),
      el("p", { class: "pnl__note", text:
        "Ya estás conectado. Queda decir bajo qué página de tu Notion vivirán " +
        "los proyectos: se creará un desplegable por proyecto dentro de ella." }),
      goToNotion("Elegir la página raíz"),
    ]));
  }

  /* --- el árbol ---------------------------------------------------------- */

  function buildTree(current: NotionSession): void {
    const token = current.token;
    const root = current.rootPageId as string;

    const where = el("p", { class: "pnl__note" });
    const status = el("p", { class: "msg" });
    const list = el("ul", { class: "tree" });

    retitle = (updated) => {
      where.textContent = updated.rootPageTitle
        ? `Bajo ${updated.rootPageTitle}, en tu Notion.`
        : "Bajo la página raíz que elegiste.";
    };

    function say(message: string, bad = false): void {
      status.className = bad ? "msg msg--bad" : "msg";
      status.textContent = message;
    }

    /**
     * Un campo que se convierte en nodo. Aparece en el sitio donde va a estar la
     * cosa nueva, y no en un formulario aparte, para que se vea dónde se crea.
     */
    function nameField(
      placeholder: string,
      commit: (name: string) => Promise<void>,
      cancel: () => void,
    ): HTMLLIElement {
      let closed = false;

      const input = el("input", {
        class: "tree__field",
        attrs: {
          type: "text", placeholder, maxlength: 120,
          autocomplete: "off", spellcheck: false,
        },
      });

      const item = el("li", { class: "tree__item" }, [
        el("div", { class: "tree__row" }, [input]),
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

    /* --- acciones de una fila -------------------------------------------- */

    function actionButton(label: string, title: string, run: () => void): HTMLButtonElement {
      return el("button", {
        class: "tree__act",
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
        class: "tree__act tree__act--risk",
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
          class: "tree__field",
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

    /* --- una página ------------------------------------------------------- */

    function pageItem(node: TreeNode, projectName?: string): HTMLLIElement {
      const label = el("span", { class: "tree__name", text: node.name || UNTITLED_PAGE });

      const open = el("button", {
        class: "tree__open",
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
              ...(projectName ? { projectName } : {}),
            });
          },
        },
      }, [el("span", { class: "tree__dot", attrs: { "aria-hidden": "true" } }), label]);

      const row = el("div", { class: "tree__row" }, [open]);
      const item = el("li", { class: "tree__item" }, [row]);

      row.append(el("span", { class: "tree__acts" }, [
        renameAction(node, label),
        deleteButton(node, async () => {
          try {
            await deleteNode(token, node.id);
            if (selection.get()?.id === node.id) clearSelection();
            item.remove();
            say("");
          } catch (cause) {
            say(reason(cause, "No se pudo eliminar."), true);
          }
        }),
      ]));

      return item;
    }

    /* --- un proyecto ------------------------------------------------------ */

    function projectItem(node: TreeNode): HTMLLIElement {
      const label = el("span", { class: "tree__name", text: node.name || UNTITLED_PROJECT });
      const kids = el("ul", { class: "tree__kids", attrs: { hidden: true } });

      let expanded = false;
      let loaded = false;

      const twist = el("button", {
        class: "tree__twist",
        attrs: { type: "button", "aria-expanded": "false" },
        on: { click: () => { void toggle(); } },
      }, [el("span", { class: "tree__caret", attrs: { "aria-hidden": "true" } }), label]);

      const row = el("div", { class: "tree__row" }, [twist]);
      const item = el("li", { class: "tree__item" }, [row, kids]);

      async function toggle(): Promise<void> {
        expanded = !expanded;
        kids.hidden = !expanded;
        twist.setAttribute("aria-expanded", String(expanded));
        if (expanded && !loaded) await load();
      }

      async function load(): Promise<void> {
        kids.replaceChildren(el("li", { class: "tree__wait", text: "Leyendo…" }));
        try {
          const children = await readChildren(token, node.id);
          loaded = true;
          paintKids(children);
        } catch (cause) {
          kids.replaceChildren();
          say(reason(cause, "No se pudo leer el proyecto."), true);
        }
      }

      function paintKids(children: readonly TreeNode[]): void {
        if (children.length === 0) {
          kids.replaceChildren(el("li", { class: "tree__wait", text: "Vacío por ahora." }));
          return;
        }
        kids.replaceChildren(...children.map((child) => (
          child.kind === "project" ? projectItem(child) : pageItem(child, node.name)
        )));
        markSelected();
      }

      async function addPage(name: string): Promise<void> {
        try {
          const created = await createPage(token, node.id, name);
          kids.querySelector(".tree__wait")?.remove();
          kids.append(pageItem(created, node.name));
          loaded = true;
          // Se abre lo que se acaba de crear: es lo que se iba a hacer con ella.
          selectPage({
            id: created.id, name: created.name, parentId: node.id, projectName: node.name,
          });
          say("");
        } catch (cause) {
          say(reason(cause, "No se pudo crear la página."), true);
        }
      }

      row.append(el("span", { class: "tree__acts" }, [
        actionButton("Nueva página", `Nueva página en ${node.name}`, () => {
          // Crear dentro obliga a desplegar: si no, no se vería el campo.
          expanded = true;
          kids.hidden = false;
          twist.setAttribute("aria-expanded", "true");
          kids.append(nameField("Nombre de la página…", addPage, () => { /* nada */ }));
        }),
        renameAction(node, label),
        deleteButton(node, async () => {
          try {
            await deleteNode(token, node.id);
            const chosen = selection.get();
            if (chosen && (chosen.parentId === node.id || chosen.id === node.id)) clearSelection();
            item.remove();
            if (list.children.length === 0) paintEmpty();
            say("");
          } catch (cause) {
            say(reason(cause, "No se pudo eliminar."), true);
          }
        }),
      ]));

      return item;
    }

    /* --- la lista de arriba ---------------------------------------------- */

    function paintEmpty(): void {
      list.replaceChildren(el("li", { class: "tree__wait", text:
        "Todavía no hay proyectos. Crea el primero." }));
    }

    function paint(nodes: readonly TreeNode[]): void {
      if (nodes.length === 0) { paintEmpty(); return; }
      list.replaceChildren(...nodes.map((node) => (
        node.kind === "project" ? projectItem(node) : pageItem(node)
      )));
      markSelected();
    }

    async function addProject(name: string): Promise<void> {
      try {
        const created = await createProject(token, root, name);
        list.querySelector(".tree__wait")?.remove();
        list.append(projectItem(created));
        say("");
      } catch (cause) {
        say(reason(cause, "No se pudo crear el proyecto."), true);
      }
    }

    const newProject = el("button", {
      class: "btn",
      text: "Nuevo proyecto",
      attrs: { type: "button" },
      on: {
        click: () => {
          list.querySelector(".tree__wait")?.remove();
          list.append(nameField("Nombre del proyecto…", addProject, () => {
            if (list.children.length === 0) paintEmpty();
          }));
        },
      },
    });

    async function loadRoot(): Promise<void> {
      list.replaceChildren(el("li", { class: "tree__wait", text: "Leyendo tu Notion…" }));
      try {
        paint(await readChildren(token, root));
        say("");
      } catch (cause) {
        list.replaceChildren();
        say(reason(cause, "No se pudo leer la página raíz."), true);
      }
    }

    render(container, el("div", { class: "pnl" }, [
      el("div", { class: "pnl__row" }, [
        el("p", { class: "pnl__lead", text: "Tus proyectos" }),
        newProject,
      ]),
      where,
      list,
      status,
      el("p", { class: "pnl__note", text:
        "En tu Notion cada proyecto es una lista desplegable y cada página un " +
        "bloque de código en markdown. Se guarda el texto tal cual, así que el " +
        "documento vuelve exactamente como se escribió." }),
    ]));

    retitle(current);
    void loadRoot();
  }

  /**
   * Marca la página abierta. Se busca en el DOM en vez de guardar una tabla de
   * botones: las ramas se pintan y se tiran al plegarse, y la tabla se quedaría
   * apuntando a nodos que ya no existen.
   */
  function markSelected(): void {
    const chosen = selection.get();
    const marked = container.querySelectorAll<HTMLElement>(
      `.tree__open[aria-current="true"]`,
    );
    for (const node of marked) node.setAttribute("aria-current", "false");
    if (!chosen) return;
    container
      .querySelector<HTMLElement>(`.tree__open[data-page-id="${CSS.escape(chosen.id)}"]`)
      ?.setAttribute("aria-current", "true");
  }

  apply();
  session.subscribe(apply);
  selection.subscribe(markSelected);
}
