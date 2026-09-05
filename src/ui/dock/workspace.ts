import { el, render, debounce } from "../dom.ts";
import {
  closeSession, session, setRootPage, type NotionSession,
} from "../../core/persist/session.ts";
import { beginAuthorization, fetchOAuthConfig, OAuthError } from "../../core/notion/oauth.ts";
import { NotionRequestError, searchPages, whoAmI } from "../../core/notion/client.ts";
import { pageTitle, type NotionPage } from "../../core/notion/types.ts";
import { mountFolders, type Folders } from "./folders.ts";

/**
 * El espacio de trabajo: conectar Notion, decir bajo qué página vive todo y
 * recorrer las carpetas que hay dentro.
 *
 * Era dos pestañas —«Proyectos» y «Notion»— y ahora es una sola pantalla con
 * estados. La razón es que eran la misma cosa contada en dos sitios: sin
 * conexión no hay proyectos que mostrar, y con conexión la pestaña de Notion no
 * tenía nada más que decir. Conectar es el primer paso de esta pantalla, no un
 * lugar aparte al que hay que ir y volver.
 *
 * La página raíz es la decisión importante. Debajo de ella vivirá todo: cada
 * carpeta es una lista desplegable y cada documento un bloque dentro (plan.md
 * D2). La elige la persona porque es su Notion, y porque la integración sólo ve
 * lo que le haya compartido.
 *
 * Se reconstruye entera sólo cuando cambia el estado. Dentro de un mismo estado
 * se actualizan las partes sueltas: si cada cambio de sesión repintara todo,
 * elegir la página raíz borraría lo escrito en el buscador en el mismo gesto.
 */

const REVOKED = "Notion rechazó el token: la conexión ya no es válida. Vuelve a conectar.";

function sharePagesHint(): HTMLElement {
  return el("p", { class: "pnl__note" }, [
    "Si no aparece ninguna, la integración todavía no tiene acceso: abre la " +
    "página en Notion, menú ",
    el("code", { text: "···" }),
    " → ",
    el("code", { text: "Conexiones" }),
    ", y añade la integración de la Plataforma 3i.",
  ]);
}

/**
 * Estado que esta pantalla comparte con el arranque de la aplicación, porque el
 * intercambio del código ocurre antes de que nadie la mire (ver src/app.ts).
 *
 * Vive al nivel del módulo y no dentro de `mountWorkspace` porque quien lo
 * escribe está fuera: la pantalla se monta una sola vez y no puede recibir el
 * resultado de un viaje que empezó en la carga anterior de la página.
 */
let notice: string | null = null;
let pending = false;
let repaint: (() => void) | null = null;

/** Se volvió de Notion con un código y se está canjeando. */
export function notionExchangeStarted(): void {
  pending = true;
  notice = null;
  repaint?.();
}

/** El canje no salió: se explica aquí, no en la consola. */
export function notionExchangeFailed(message: string): void {
  pending = false;
  notice = message;
  repaint?.();
}

export interface WorkspaceSlots {
  /** La fila fija de arriba de la franja: ahí pone las migas el navegador de carpetas. */
  head: HTMLElement;
  /** El cuerpo que se desplaza. */
  pane: HTMLElement;
}

type Mode = "unknown" | "off" | "busy" | "pick" | "on";

export function mountWorkspace(slots: WorkspaceSlots): void {
  let mode: Mode = "unknown";
  let rootId = "";
  let folders: Folders | null = null;
  /** Lo que se actualiza sin reconstruir: el nombre del espacio y la raíz. */
  let refresh: ((current: NotionSession) => void) | null = null;
  /** Se pidió cambiar la raíz estando ya conectado. */
  let picking = false;
  /** El token que ya se comprobó contra Notion; no se pregunta dos veces. */
  let verified = "";

  /**
   * Cerrar la sesión repinta la pantalla entera, así que el mensaje no puede
   * escribirse antes: se deja en `notice` y lo recoge la vista de «sin conectar».
   */
  function revoke(): void {
    notice = REVOKED;
    picking = false;
    verified = "";
    closeSession();
  }

  /**
   * El token pudo revocarse desde Notion mientras la franja estaba cerrada. Se
   * comprueba una vez por token, en segundo plano, para no anunciar una conexión
   * que ya no existe.
   */
  function verify(token: string): void {
    if (verified === token) return;
    verified = token;
    void whoAmI(token).catch((cause: unknown) => {
      if (cause instanceof NotionRequestError && cause.status === 401) revoke();
    });
  }

  function apply(): void {
    const current = session.get();
    const next: Mode = !current
      ? (pending ? "busy" : "off")
      : (picking || !current.rootPageId) ? "pick" : "on";

    // Cambiar la página raíz cambia el contenido entero: eso sí se reconstruye.
    if (next !== mode || (next === "on" && current?.rootPageId !== rootId)) {
      mode = next;
      refresh = null;
      folders?.dispose();
      folders = null;
      rootId = current?.rootPageId ?? "";
      // Las migas son de las carpetas: fuera de ahí, la fila de arriba no existe.
      if (next !== "on") render(slots.head);
      if (next === "off") buildDisconnected();
      else if (next === "busy") buildPending();
      else if (current && next === "pick") buildPicker(current);
      else if (current) buildFolders(current);
      slots.pane.scrollTop = 0;
      return;
    }
    if (current && refresh) refresh(current);
  }

  /* --- volviendo de Notion ------------------------------------------------ */

  function buildPending(): void {
    render(slots.pane,
      el("div", { class: "pnl" }, [
        el("p", { class: "pnl__lead", text: "Completando la conexión…" }),
        el("p", { class: "pnl__note", text:
          "Se está canjeando el código de Notion por un token. El código es de " +
          "un solo uso y ya se ha borrado de la barra de direcciones." }),
      ]),
    );
  }

  /* --- sin conectar ------------------------------------------------------- */

  function buildDisconnected(): void {
    const message = el("p", { class: notice ? "msg msg--bad" : "msg", text: notice ?? "" });
    notice = null;
    const button = el("button", {
      class: "btn",
      text: "Conectar con Notion",
      attrs: { type: "button" },
      on: { click: () => { void connect(); } },
    });

    async function connect(): Promise<void> {
      button.disabled = true;
      message.className = "msg";
      message.textContent = "Abriendo la autorización de Notion…";
      try {
        const config = await fetchOAuthConfig();
        // A partir de aquí la página se va: no hace falta rehabilitar el botón.
        location.assign(beginAuthorization(config));
      } catch (cause) {
        button.disabled = false;
        message.className = "msg msg--bad";
        message.textContent = cause instanceof OAuthError
          ? cause.message
          : "No se pudo empezar la conexión.";
      }
    }

    render(slots.pane,
      el("div", { class: "pnl" }, [
        el("p", { class: "pnl__lead" }, [
          "Aquí viven tus proyectos. Todo lo que escribas se guarda en ",
          el("em", { text: "tu" }), " Notion: la plataforma no guarda una copia.",
        ]),
        el("p", { class: "pnl__note", text:
          "Al conectar eliges qué páginas comparte contigo la integración. " +
          "Cada carpeta será una lista desplegable y cada documento un bloque " +
          "dentro. Puedes revocar el acceso desde Notion en cualquier momento." }),
        el("div", { class: "pnl__row" }, [button]),
        message,
      ]),
    );
  }

  /* --- elegir la página raíz ---------------------------------------------- */

  function identityRow(current: NotionSession, name: HTMLElement): HTMLElement {
    const identity = el("div", { class: "ws" }, [name]);
    if (current.workspaceIcon && /^https?:\/\//.test(current.workspaceIcon)) {
      identity.prepend(el("img", {
        class: "ws__icon",
        attrs: { src: current.workspaceIcon, alt: "", width: 22, height: 22 },
      }));
    }
    return el("div", { class: "pnl__row" }, [
      identity,
      el("button", {
        class: "btn btn--quiet",
        text: "Desconectar",
        attrs: { type: "button" },
        on: { click: () => { closeSession(); } },
      }),
    ]);
  }

  function buildPicker(current: NotionSession): void {
    pending = false;
    verify(current.token);

    const name = el("span", {
      class: "ws__name",
      text: current.workspaceName ?? "Espacio de Notion",
    });
    const status = el("p", { class: "msg" });
    const list = el("ul", { class: "plist" });
    const chosenLine = el("p", { class: "pnl__note" });

    const input = el("input", {
      class: "search__input",
      attrs: {
        type: "search", placeholder: "Buscar una página de tu Notion…",
        autocomplete: "off", spellcheck: false,
        "aria-label": "Buscar la página raíz",
      },
    });

    let requestSeq = 0;

    async function load(query: string): Promise<void> {
      const seq = ++requestSeq;
      status.className = "msg";
      status.textContent = "Buscando…";
      try {
        const found = await searchPages(current.token, query);
        if (seq !== requestSeq) return;   // llegó una respuesta más nueva
        paint(found.results);
        status.textContent = found.results.length === 0 ? "Ninguna página coincide." : "";
      } catch (cause) {
        if (seq !== requestSeq) return;
        list.replaceChildren();
        status.className = "msg msg--bad";
        if (cause instanceof NotionRequestError && cause.status === 401) {
          revoke();
          return;
        }
        status.textContent = cause instanceof NotionRequestError
          ? `No se pudo buscar: ${cause.message}`
          : "No se pudo buscar en Notion.";
      }
    }

    function paint(pages: readonly NotionPage[]): void {
      const chosen = session.get()?.rootPageId;
      list.replaceChildren(...pages.map((page) => {
        const title = pageTitle(page);
        const isRoot = page.id === chosen;
        return el("li", {}, [
          el("button", {
            class: "plist__btn",
            attrs: { type: "button", "aria-current": isRoot, "data-page-id": page.id },
            on: {
              click: () => {
                // Elegir cierra el asunto: se vuelve a las carpetas, que es lo
                // que se venía a hacer.
                picking = false;
                setRootPage(page.id, title);
              },
            },
          }, [
            el("span", { class: "plist__title", text: title }),
            el("span", { class: "plist__mark", text: isRoot ? "raíz" : "" }),
          ]),
        ]);
      }));
    }

    input.addEventListener("input", debounce(() => { void load(input.value); }, 280));

    // Sólo esto cambia sin reconstruir: el nombre del espacio y la raíz marcada.
    refresh = (updated) => {
      name.textContent = updated.workspaceName ?? "Espacio de Notion";
      chosenLine.textContent = updated.rootPageTitle
        ? `Ahora es «${updated.rootPageTitle}». Elige otra para mudar el espacio.`
        : "Todavía no has elegido ninguna.";
      const marked = list.querySelector<HTMLElement>('[aria-current="true"]');
      if (marked) {
        marked.setAttribute("aria-current", "false");
        const mark = marked.querySelector(".plist__mark");
        if (mark) mark.textContent = "";
      }
      // Se casa por id y no por título: dos páginas pueden llamarse igual.
      const target = list.querySelector<HTMLButtonElement>(
        `.plist__btn[data-page-id="${CSS.escape(updated.rootPageId ?? "")}"]`,
      );
      if (target) {
        target.setAttribute("aria-current", "true");
        const mark = target.querySelector(".plist__mark");
        if (mark) mark.textContent = "raíz";
      }
    };

    const panel = el("div", { class: "pnl" }, [
      identityRow(current, name),
      el("hr", { class: "pnl__sep" }),
      el("p", { class: "pnl__lead", text: "¿Bajo qué página van a vivir los proyectos?" }),
      chosenLine,
      el("div", { class: "search" }, [input]),
      list,
      status,
      sharePagesHint(),
    ]);

    // Volver sólo tiene sentido si hay a dónde: sin raíz elegida, esta pantalla
    // es el único paso posible.
    if (current.rootPageId) {
      panel.append(el("p", { class: "pnl__note" }, [
        el("button", {
          class: "lnkbtn",
          text: "Volver a los proyectos",
          attrs: { type: "button" },
          on: { click: () => { picking = false; apply(); } },
        }),
      ]));
    }

    render(slots.pane, panel);
    refresh(current);
    void load("");
  }

  /* --- conectado y con raíz: las carpetas --------------------------------- */

  function buildFolders(current: NotionSession): void {
    pending = false;
    verify(current.token);

    /**
     * De dónde es esto y cómo cambiarlo, en una línea al final de la lista. Era
     * una pestaña entera; como pestaña obligaba a salir de los proyectos para
     * leer un dato que no cambia nunca, y aquí está sin estorbar.
     */
    const where = el("span", { class: "wfoot__where" });
    const foot = el("p", { class: "pnl__note wfoot" }, [
      where,
      " · ",
      el("button", {
        class: "lnkbtn",
        text: "Cambiar raíz",
        attrs: { type: "button", title: "Elegir otra página de Notion como raíz" },
        on: { click: () => { picking = true; apply(); } },
      }),
      " · ",
      el("button", {
        class: "lnkbtn",
        text: "Desconectar",
        attrs: { type: "button", title: "Cerrar la sesión de Notion en este navegador" },
        on: { click: () => { closeSession(); } },
      }),
    ]);

    refresh = (updated) => {
      const space = updated.workspaceName ?? "tu Notion";
      where.textContent = updated.rootPageTitle
        ? `En ${space}, bajo «${updated.rootPageTitle}».`
        : `En ${space}.`;
      folders?.retitle(updated.rootPageTitle ?? "Proyectos");
    };

    folders = mountFolders({
      head: slots.head,
      pane: slots.pane,
      token: current.token,
      root: current.rootPageId as string,
      rootTitle: current.rootPageTitle ?? "Proyectos",
      foot,
      revoked: revoke,
    });

    refresh(current);
  }

  repaint = apply;
  apply();
  session.subscribe(apply);
}
