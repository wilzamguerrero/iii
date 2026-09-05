import type { NotionToken } from "./types.ts";

/**
 * El lado del navegador del OAuth de Notion.
 *
 * El único secreto —el `client_secret`— no aparece por aquí ni puede: el
 * intercambio del código por el token lo hace `api/notion-oauth.ts` en el
 * servidor. Este archivo sólo abre la puerta y recoge el resultado.
 *
 * El `state` es la defensa contra CSRF: se sortea antes de salir, se guarda y se
 * compara al volver. Va en `sessionStorage`, no en `localStorage`, porque muere
 * con la pestaña —el viaje entero ocurre en una sola— y así no queda un valor
 * viejo esperando a que alguien lo reutilice.
 */

const AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const OAUTH_ENDPOINT = "/api/notion-oauth";
const STATE_KEY = "3i.oauth.state";

export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
}

/** Error con el mensaje que el servidor quiso dar, para poder mostrarlo. */
export class OAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

async function readError(response: Response, fallback: string): Promise<OAuthError> {
  const body = await response.json().catch(() => null) as
    | { error?: string; message?: string }
    | null;
  return new OAuthError(body?.error ?? fallback, body?.message ?? fallback);
}

/**
 * `client_id` y `redirect_uri` los publica el servidor. Se leen en vez de
 * duplicarlos en una variable `VITE_*`: una sola fuente, y el `redirect_uri` de
 * la autorización es por construcción el mismo que usará el intercambio.
 */
export async function fetchOAuthConfig(): Promise<OAuthConfig> {
  const response = await fetch(OAUTH_ENDPOINT, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw await readError(response, "No se pudo leer la configuración de Notion.");
  }
  const config = await response.json() as Partial<OAuthConfig>;
  if (!config.clientId || !config.redirectUri) {
    throw new OAuthError("bad_config", "El servidor no devolvió client_id ni redirect_uri.");
  }
  return { clientId: config.clientId, redirectUri: config.redirectUri };
}

function createState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Sortea el `state`, lo guarda y devuelve la URL a la que hay que ir. */
export function beginAuthorization(config: OAuthConfig): string {
  const state = createState();
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    owner: "user",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Compara el `state` que vuelve con el que se guardó y lo consume: un `state`
 * sólo vale una vez, así que se borra pase lo que pase.
 */
export function consumeState(received: string | null): boolean {
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return Boolean(expected) && expected === received;
}

export async function exchangeCode(code: string): Promise<NotionToken> {
  const response = await fetch(OAUTH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw await readError(response, "Notion rechazó el intercambio del código.");
  }

  const token = await response.json() as Partial<NotionToken>;
  if (!token.access_token) {
    throw new OAuthError("no_access_token", "La respuesta de Notion no traía token.");
  }
  return token as NotionToken;
}
