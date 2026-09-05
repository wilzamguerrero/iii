import { consumeState } from "../core/notion/oauth.ts";

/**
 * Lo que hay que hacer con la URL **antes** de que arranque nada más.
 *
 * Notion devuelve al usuario a esta página con `?code=…&state=…` colgando. Ese
 * código es de un solo uso pero es una credencial: no debe quedarse en la barra
 * de direcciones, ni en el historial, ni irse en el `Referer` de la primera
 * imagen que cargue la página. Se limpia con `history.replaceState` en el mismo
 * turno en que se lee.
 *
 * Este módulo se importa antes que `main.js` a propósito (ver `src/app.ts`).
 * `main.js` lee `?intro=0` en el momento de evaluarse, así que la reescritura de
 * la URL tiene que haber ocurrido ya: quien vuelve de autorizar no quiere ver
 * otra vez la intro de quince segundos antes de poder tocar el panel.
 */

export type OAuthCallback =
  | { kind: "none" }
  | { kind: "code"; code: string }
  | { kind: "denied"; message: string }
  | { kind: "bad-state" };

const CALLBACK_PARAMS = ["code", "state", "error", "error_description"] as const;

function detect(): OAuthCallback {
  const params = new URLSearchParams(location.search);

  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  const errorDetail = params.get("error_description");
  if (!code && !error) return { kind: "none" };

  // Un `state` sólo vale una vez. Se consume aquí incluso si Notion devolvió un
  // error, para no dejarlo guardado esperando a otra vuelta.
  const stateMatches = consumeState(state);

  for (const key of CALLBACK_PARAMS) params.delete(key);
  params.set("intro", "0");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}?${query}${location.hash}`);

  if (error) {
    return {
      kind: "denied",
      message: error === "access_denied"
        ? "Se canceló la autorización en Notion."
        : errorDetail ?? `Notion devolvió el error «${error}».`,
    };
  }

  if (!stateMatches || !code) return { kind: "bad-state" };
  return { kind: "code", code };
}

export const oauthCallback: OAuthCallback = detect();
