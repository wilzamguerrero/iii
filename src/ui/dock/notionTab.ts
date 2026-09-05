import { el, render, debounce } from "../dom.ts";
import {
  session, closeSession, setRootPage,
  type NotionSession,
} from "../../core/persist/session.ts";
import { beginAuthorization, fetchOAuthConfig, OAuthError } from "../../core/notion/oauth.ts";
import { NotionRequestError, searchPages, whoAmI } from "../../core/notion/client.ts";
import { pageTitle, type NotionPage } from "../../core/notion/types.ts";

/**
 * Pestaña «Notion»: conectar, ver de qué espacio se trata, elegir la página raíz
 * y desconectar.
 *
 * La página raíz es la decisión importante de esta pantalla. Debajo de ella
 * vivirá todo: cada proyecto es una lista desplegable y cada página del proyecto
 * un bloque dentro (plan.md D2). La elige el usuario porque es su Notion, y
 * porque la integración sólo ve lo que él le haya compartido.
 *
 * La vista se reconstruye entera sólo cuando cambia el hecho de estar conectado
 * o no. Dentro de «conectado» se actualizan las partes sueltas: si cada cambio de
 * sesión repintara todo, elegir una página raíz borraría lo escrito en el
 * buscador en el mismo gesto.
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
 * Estado que la pestaña comparte con el arranque de la aplicación, porque el
 * intercambio del código ocurre antes de que nadie mire esta pestaña (ver
 * src/app.ts).
 *
 * Vive al nivel del módulo y no dentro de mountNotionTab porque quien lo escribe
 * está fuera: la pestaña se monta una sola vez y no puede recibir el resultado de
 * un viaje que empezó en la carga anterior de la página.
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

/** El canje no salió: se explica en la pestaña, no en la consola. */
export function notionExchangeFailed(message: string): void {
  pending = false;
  notice = message;
  repaint?.();
}

export function mountNotionTab(container: HTMLElement): void {
  let mode: "unknown" | "off" | "on" | "busy" = "unknown";
  let refresh: ((current: NotionSession) => void) | null = null;

  /**
   * Cerrar la sesión repinta la pestaña entera, así que el mensaje no puede
   * escribirse antes: se deja aquí y lo recoge la vista de «sin conectar».
   */
  function revoke(): void {
    notice = REVOKED;
    closeSession();
  }

  function apply(): void {
    const current = session.get();
    const next = current ? "on" : pending ? "busy" : "off";
    if (next !== mode) {
      mode = next;
      refresh = null;
      if (current) buildConnected(current);
      else if (pending) buildPending();
      else buildDisconnected();
      return;
    }
    if (current && refresh) refresh(current);
  }

  /* --- volviendo de Notion ---------------------------------------------- */

  function buildPending(): void {
    render(container,
      el("div", { class: "pnl" }, [
        el("p", { class: "pnl__lead", text: "Completando la conexión…" }),
        el("p", { class: "pnl__note", text:
          "Se está canjeando el código de Notion por un token. El código es de " +
          "un solo uso y ya se ha borrado de la barra de direcciones." }),
      ]),
    );
  }

  /* --- sin conectar ----------------------------------------------------- */

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

    render(container,
      el("div", { class: "pnl" }, [
        el("p", { class: "pnl__lead" }, [
          "Todo lo que escribas se guarda en ", el("em", { text: "tu" }), " Notion. " +
          "La plataforma no guarda una copia.",
        ]),
        el("p", { class: "pnl__note", text:
          "Al conectar eliges qué páginas comparte contigo la integración. " +
          "Puedes revocarla desde Notion en cualquier momento." }),
        el("div", { class: "pnl__row" }, [button]),
        message,
      ]),
    );
  }

  /* --- conectado -------------------------------------------------------- */

  function buildConnected(current: NotionSession): void {
    pending = false;
    const name = el("span", {
      class: "ws__name",
      text: current.workspaceName ?? "Espacio de Notion",
    });

    const identity = el("div", { class: "ws" }, [name]);
    if (current.workspaceIcon && /^https?:\/\//.test(current.workspaceIcon)) {
      identity.prepend(el("img", {
        class: "ws__icon",
        attrs: { src: current.workspaceIcon, alt: "", width: 22, height: 22 },
      }));
    }

    const status = el("p", { class: "msg" });
    const list = el("ul", { class: "plist" });

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
        status.textContent = found.results.length === 0
          ? "Ninguna página coincide."
          : "";
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
            on: { click: () => { setRootPage(page.id, title); } },
          }, [
            el("span", { class: "plist__title", text: title }),
            el("span", { class: "plist__mark", text: isRoot ? "raíz" : "" }),
          ]),
        ]);
      }));
    }

    input.addEventListener("input", debounce(() => { void load(input.value); }, 280));

    const chosenLine = el("p", { class: "pnl__note" });

    // Sólo esto cambia sin reconstruir la pestaña: el nombre del espacio y la
    // página raíz elegida.
    refresh = (updated) => {
      name.textContent = updated.workspaceName ?? "Espacio de Notion";
      chosenLine.textContent = updated.rootPageTitle
        ? `Raíz: ${updated.rootPageTitle}`
        : "Todavía no has elegido la página raíz.";
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

    render(container,
      el("div", { class: "pnl" }, [
        el("div", { class: "pnl__row" }, [
          identity,
          el("button", {
            class: "btn btn--quiet",
            text: "Desconectar",
            attrs: { type: "button" },
            on: { click: () => { closeSession(); } },
          }),
        ]),
        el("hr", { class: "pnl__sep" }),
        el("p", { class: "pnl__lead", text: "¿Bajo qué página van a vivir los proyectos?" }),
        chosenLine,
        el("div", { class: "search" }, [input]),
        list,
        status,
        sharePagesHint(),
      ]),
    );

    refresh(current);
    void load("");

    // El token pudo revocarse desde Notion mientras la pestaña estaba cerrada.
    // Se comprueba una vez, en segundo plano, para no anunciar una conexión que
    // ya no existe.
    void whoAmI(current.token).catch((cause: unknown) => {
      if (cause instanceof NotionRequestError && cause.status === 401) revoke();
    });
  }

  repaint = apply;
  apply();
  session.subscribe(apply);
}
