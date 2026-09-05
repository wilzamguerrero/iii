import { createStore } from "../store.ts";
import type { NotionToken } from "../notion/types.ts";

/**
 * La sesión de Notion: el token y la página que hace de raíz del espacio de
 * trabajo. Sobrevive a la recarga en `localStorage`.
 *
 * Sobre guardar el token en `localStorage`: es aceptable para una herramienta
 * personal y queda expuesto a un XSS —cualquier script inyectado en la página
 * puede leerlo—. Se asume a cambio de no montar sesiones de servidor en este
 * momento del proyecto. Si la plataforma pasa a ser multiusuario, el token tiene
 * que moverse a una cookie `HttpOnly` y cifrarse en el servidor
 * (`reference/GUIA_NOTION_OAUTH.md`, y plan.md §10).
 */

const KEY = "3i.notion.session";

export interface NotionSession {
  token: string;
  botId: string;
  workspaceName: string | null;
  workspaceIcon: string | null;
  /** La página de Notion bajo la que vivirán los proyectos. La elige el usuario. */
  rootPageId: string | null;
  rootPageTitle: string | null;
  connectedAt: string;
}

function read(): NotionSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NotionSession>;
    // Sin token no hay sesión, por muy bien formado que esté el resto.
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    return {
      token: parsed.token,
      botId: parsed.botId ?? "",
      workspaceName: parsed.workspaceName ?? null,
      workspaceIcon: parsed.workspaceIcon ?? null,
      rootPageId: parsed.rootPageId ?? null,
      rootPageTitle: parsed.rootPageTitle ?? null,
      connectedAt: parsed.connectedAt ?? new Date().toISOString(),
    };
  } catch {
    // Un JSON corrupto no debe dejar la aplicación sin arrancar.
    return null;
  }
}

function write(session: NotionSession | null): void {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // Modo privado o cuota agotada: la sesión vive en memoria y se pierde al
    // recargar. Preferible a romper la conexión que se acaba de hacer.
  }
}

export const session = createStore<NotionSession | null>(read());

session.subscribe(write);

/** Guarda la sesión que sale de un intercambio OAuth correcto. */
export function openSession(token: NotionToken): void {
  session.set({
    token: token.access_token,
    botId: token.bot_id ?? "",
    workspaceName: token.workspace_name ?? null,
    workspaceIcon: token.workspace_icon ?? null,
    rootPageId: null,
    rootPageTitle: null,
    connectedAt: new Date().toISOString(),
  });
}

export function closeSession(): void {
  session.set(null);
}

export function setRootPage(pageId: string, title: string): void {
  session.set((current) =>
    current ? { ...current, rootPageId: pageId, rootPageTitle: title } : current,
  );
}

/**
 * Si el usuario desconecta en otra pestaña, esta se enteraría al recargar. El
 * evento `storage` sólo lo reciben las *otras* pestañas, así que no hay bucle.
 */
window.addEventListener("storage", (event) => {
  if (event.key === KEY) session.set(read());
});
