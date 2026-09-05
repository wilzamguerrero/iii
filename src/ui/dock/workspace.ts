import { el, render, debounce } from "../dom.ts";
import {
  closeSession, session, setRootPage, type NotionSession,
} from "../../core/persist/session.ts";
import { beginAuthorization, fetchOAuthConfig, OAuthError } from "../../core/notion/oauth.ts";
import { NotionRequestError, searchPages, whoAmI } from "../../core/notion/client.ts";
import { pageTitle, type NotionPage } from "../../core/notion/types.ts";
import { mountFolders, type Crumb, type Folders } from "./folders.ts";

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
 * Esta pantalla se monta **una vez por pestaña** de la franja. Lo que es de la
 * conexión —si está, si se está canjeando un código, si se pidió cambiar de
 * raíz— vive al nivel del módulo y lo comparten todas: son hechos del espacio,
 * no de la ventana desde la que se mira. Lo que es del recorrido —en qué carpeta
 * está cada una— vive dentro, que es lo que hace que dos pestañas sirvan.
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

/* --- lo que comparten todas las pestañas ---------------------------------- */

/**
 * Estado que esta pantalla comparte con el arranque de la aplicación, porque el
 * intercambio del código ocurre antes de que nadie la mire (ver src/app.ts), y
 * con las demás pestañas, porque la conexión es una sola.
 */
let notice: string | null = null;
let pending = false;
/** Se pidió cambiar la raíz: lo pide una pestaña y va con todas. */
let picking = false;
/** El token que ya se comprobó contra Notion; no se pregunta una vez por pestaña. */
let verified = "";

const painters = new Set<() => void>();

function repaintAll(): void {
  // Copia: repintar puede montar o soltar pantallas, y el conjunto cambiaría
  // mientras se recorre.
  for (const paint of [...painters]) paint();
}

/** Se volvió de Notion con un código y se está canjeando. */
export function notionExchangeStarted(): void {
  pending = true;
  notice = null;
  repaintAll();
}

/** El canje no salió: se explica aquí, no en la consola. */
export function notionExchangeFailed(message: string): void {
  pending = false;
  notice = message;
  repaintAll();
}

/**
 * Elegir otra página raíz. Lo pide la bandeja de la franja, y afecta a todas las
 * pestañas a la vez: los caminos que tenían abiertos cuelgan de la raíz vieja y
 * dejan de significar nada en cuanto cambia.
 */
export function chooseRoot(on = true): void {
  picking = on;
  repaintAll();
}

/**
 * Empieza el viaje de OAuth. Devuelve el porqué si no se pudo ni empezar, o
 * `null` si la página ya se está yendo a Notion.
 *
 * Vive aquí y no en el botón porque hay dos sitios desde donde se conecta —esta
 * pantalla y la bandeja— y el paso previo (pedir al servidor el `client_id` y
 * fabricar el `state`) tiene que ser exactamente el mismo en los dos.
 */
export async function beginNotion(): Promise<string | null> {
  try {
    const config = await fetchOAuthConfig();
    location.assign(beginAuthorization(config));
    return null;
  } catch (cause) {
    return cause instanceof OAuthError ? cause.message : "No se pudo empezar la conexión.";
  }
}

export interface WorkspaceSlots {
  /** La fila fija de arriba de la pestaña: ahí van las migas. */
  head: HTMLElement;
  /** El cuerpo que se desplaza. */
  pane: HTMLElement;
  /** Dónde abrir esta pestaña, si se abrió desde otra. */
  seedPath?: readonly Crumb[];
  /** Cómo se llama esta pestaña ahora mismo. */
  setLabel?: (text: string) => void;
  /** Abrir otra pestaña en ese camino. */
  openTab?: (path: readonly Crumb[]) => void;
}

export interface Workspace {
  dispose(): void;
}

type Mode = "unknown" | "off" | "busy" | "pick" | "on";

export function mountWorkspace(slots: WorkspaceSlots): Workspace {
  let mode: Mode = "unknown";
  let rootId = "";
  let folders: Folders | null = null;
  /** Lo que se actualiza sin reconstruir: el nombre del espacio y la raíz. */
  let refresh: ((current: NotionSession) => void) | null = null;
  /**
   * La última carpeta en la que estuvo esta pestaña. Al reconstruirse —volver
   * del elegir-raíz, por ejemplo— se retoma ahí en vez de saltar a la raíz. Se
   * descarta si la raíz cambió, porque entonces los ids no valen.
   */
  let lastPath: readonly Crumb[] | null = slots.seedPath ?? null;

  function label(text: string): void {
    slots.setLabel?.(text);
  }

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

    // El aviso es de la conexión, no de una pantalla: se queda hasta que haya
    // conexión, y así lo ven todas las pestañas y no sólo la que repintó primero.
    if (next !== "off") notice = null;

    // Cambiar la página raíz cambia el contenido entero: eso sí se reconstruye.
    if (next !== mode || (next === "on" && current?.rootPageId !== rootId)) {
      mode = next;
      refresh = null;
      folders?.dispose();
      folders = null;
      if (current?.rootPageId !== rootId) lastPath = null;
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
    label("Conectando…");
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
    label("Espacio de trabajo");

    const message = el("p", { class: notice ? "msg msg--bad" : "msg", text: notice ?? "" });
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
      const failed = await beginNotion();
      // Si salió bien la página ya se está yendo: no hace falta rehabilitar nada.
      if (!failed) return;
      button.disabled = false;
      message.className = "msg msg--bad";
      message.textContent = failed;
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
    label("Elegir raíz");

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
                // Elegir cierra el asunto en todas las pestañas: es lo que se
                // venía a hacer, y las demás estaban esperando lo mismo.
                picking = false;
                setRootPage(page.id, title);
                repaintAll();
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
          on: { click: () => { chooseRoot(false); } },
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

    refresh = (updated) => {
      folders?.retitle(updated.rootPageTitle ?? "Proyectos");
    };

    folders = mountFolders({
      head: slots.head,
      pane: slots.pane,
      token: current.token,
      root: current.rootPageId as string,
      rootTitle: current.rootPageTitle ?? "Proyectos",
      ...(lastPath ? { initialPath: lastPath } : {}),
      onPath: (path) => {
        lastPath = path;
        // La pestaña se llama como la carpeta que muestra. Es lo que se busca al
        // mirar la fila de pestañas: dónde está cada una.
        const last = path[path.length - 1];
        label(last?.name || "Proyectos");
      },
      ...(slots.openTab ? { onNewTab: slots.openTab } : {}),
      revoked: revoke,
    });

    refresh(current);
  }

  /* --- puesta en marcha --------------------------------------------------- */

  painters.add(apply);
  const stop = session.subscribe(apply);
  apply();

  return {
    dispose() {
      painters.delete(apply);
      stop();
      folders?.dispose();
      folders = null;
    },
  };
}
