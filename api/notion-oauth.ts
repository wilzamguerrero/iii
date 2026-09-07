import type { ApiRequest, ApiResponse } from "./_types";

/**
 * Intercambio OAuth con Notion. El `client_secret` vive sólo aquí.
 *
 *   GET  /api/notion-oauth        → { clientId, redirectUri }   (datos públicos)
 *   POST /api/notion-oauth {code} → la respuesta de token de Notion, tal cual
 *
 * Tres diferencias deliberadas respecto de
 * `reference/wzglexical-dev_mimem/api/notion-oauth.ts`:
 *
 * 1. **Sin `Access-Control-Allow-Origin: *`.** El cliente se sirve del mismo
 *    origen, así que no hace falta CORS. Abrirlo convertiría este endpoint en un
 *    intercambiador de códigos al servicio de cualquier página.
 * 2. **El `redirect_uri` sale del entorno, no del cuerpo de la petición.** Notion
 *    exige que el de la autorización y el del intercambio sean idénticos; si el
 *    servidor es la única fuente de ambos —el GET los publica, el POST los usa—
 *    no pueden divergir, y el navegador no puede inducir un valor ajeno.
 * 3. **El GET publica el `client_id`.** Así no hay que duplicarlo en una
 *    `VITE_*` del cliente: una sola variable, un solo sitio donde equivocarse.
 */

const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

/**
 * Notion pide las credenciales en un `Authorization: Basic`, que es base64.
 * `btoa` y no `Buffer`: es lo único de los dos que existe en los tres entornos
 * donde corre este archivo —Node bajo el plugin de desarrollo, Vercel y el
 * aislado de Cloudflare—, y así el adaptador de `functions/` no necesita activar
 * `nodejs_compat`. El `client_id` y el secreto son ASCII, así que no hace falta
 * pasar por UTF-8.
 */
function base64(text: string): string {
  return btoa(text);
}

interface OAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function readEnv(): OAuthEnv | null {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET ?? "";
  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

const UNCONFIGURED = {
  error: "notion_oauth_unconfigured",
  message:
    "Faltan NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET o " +
    "NOTION_OAUTH_REDIRECT_URI. Copia .env.example a .env y crea la " +
    "integración pública en https://www.notion.so/my-integrations",
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  const env = readEnv();
  if (!env) {
    res.status(503).json(UNCONFIGURED);
    return;
  }

  // Lo que el navegador necesita para construir la URL de autorización. Nada de
  // esto es secreto: el client_id viaja en la propia URL que abre el usuario.
  if (req.method === "GET") {
    res.status(200).json({ clientId: env.clientId, redirectUri: env.redirectUri });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const code = typeof req.body === "object" && req.body !== null
    ? (req.body as Record<string, unknown>).code
    : undefined;

  if (typeof code !== "string" || code.length === 0) {
    res.status(400).json({ error: "missing_code", message: "Falta el parámetro 'code'." });
    return;
  }

  const credentials = base64(`${env.clientId}:${env.clientSecret}`);

  let notionRes: Response;
  try {
    notionRes = await fetch(NOTION_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: env.redirectUri,
      }),
    });
  } catch (cause) {
    res.status(502).json({
      error: "notion_unreachable",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return;
  }

  // Se devuelve el cuerpo de Notion sin tocarlo (incluidos sus errores, que son
  // informativos: invalid_grant si el código ya se usó, invalid_client si el
  // secreto no corresponde). El token nunca se escribe en un log.
  const payload: unknown = await notionRes.json().catch(() => ({
    error: "notion_bad_response",
    message: `Notion respondió ${notionRes.status} sin JSON.`,
  }));

  res.status(notionRes.status).json(payload);
}
