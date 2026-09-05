/**
 * Entrada de la aplicación.
 *
 * El orden de los `import` de aquí importa y no es estético:
 *
 * 1. `boot/oauth-callback.ts` limpia `?code=&state=` de la URL y deja `?intro=0`
 *    en su lugar. Tiene que ocurrir antes de nada.
 * 2. `main.js` lee `?intro=0` en el momento de evaluarse. Si el paso anterior no
 *    ha pasado ya, quien vuelve de autorizar en Notion se come la intro entera
 *    otra vez. Los módulos ES se evalúan en el orden en que se importan, así que
 *    ese orden es el mecanismo.
 *
 * `main.js` sigue siendo JavaScript sin tipos y no se toca: está calibrado y
 * cualquier reescritura arriesga la coreografía.
 */

import { oauthCallback } from "./boot/oauth-callback.ts";
import "./main.js";

import { exchangeCode, OAuthError } from "./core/notion/oauth.ts";
import { openSession } from "./core/persist/session.ts";
import { mountAssistant } from "./ui/assistant/assistant.ts";
import { mountDock, type DockTab } from "./ui/dock/dock.ts";
import { notionExchangeFailed, notionExchangeStarted } from "./ui/dock/notionTab.ts";
import { rememberIntent } from "./core/state/intent.ts";

export interface IntentSubmitDetail {
  /** Lo que la persona escribió o dictó, ya recortado. */
  intent: string;
  /** ISO 8601. */
  at: string;
}

declare global {
  interface DocumentEventMap {
    "intent:submit": CustomEvent<IntentSubmitDetail>;
    /** El asistente pide abrir una pestaña de la franja. Ver más abajo. */
    "dock:open": CustomEvent<string>;
  }
}

const dock = mountDock();
mountAssistant();

/**
 * La intención escrita en la entrada. `main.js` la anunciaba y no había nadie
 * escuchando: es el primer contexto que el asistente necesita para poder
 * preguntar por algo concreto. Llevarla a Notion es la Fase 3.
 */
document.addEventListener("intent:submit", (event) => {
  rememberIntent(event.detail.intent, event.detail.at);
});

function isDockTab(value: string): value is DockTab {
  return value === "proyectos" || value === "notion" || value === "ia";
}

/**
 * El asistente abre los ajustes de IA sin conocer la franja: manda un evento y
 * aquí se traduce. Importarse el uno al otro por un botón no compensa.
 */
document.addEventListener("dock:open", (event) => {
  if (isDockTab(event.detail)) dock.open(event.detail);
});

/**
 * Cierre del viaje de OAuth. La página se ha recargado por completo desde que
 * empezó, así que lo único que queda de aquel gesto es el código en la URL —ya
 * retirado— y el `state` en `sessionStorage`.
 */
async function resolveOAuth(): Promise<void> {
  switch (oauthCallback.kind) {
    case "none":
      return;

    case "denied":
      notionExchangeFailed(oauthCallback.message);
      dock.open("notion");
      return;

    case "bad-state":
      // O el `state` no cuadra, o se llegó aquí con un `code` que esta pestaña
      // nunca pidió. Se descarta sin canjearlo: es exactamente el caso que el
      // `state` existe para detectar.
      notionExchangeFailed(
        "La respuesta de Notion no correspondía a esta petición. No se completó " +
        "la conexión; vuelve a intentarlo desde aquí.",
      );
      dock.open("notion");
      return;

    case "code":
      notionExchangeStarted();
      dock.open("notion");
      try {
        openSession(await exchangeCode(oauthCallback.code));
      } catch (cause) {
        notionExchangeFailed(
          cause instanceof OAuthError
            ? cause.message
            : "No se pudo completar la conexión con Notion.",
        );
      }
  }
}

void resolveOAuth();
