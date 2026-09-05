import type { ApiRequest, ApiResponse } from "./_types";

/**
 * Proxy hacia la API de Notion.
 *
 *   /api/notion?endpoint=/search&method=POST
 *
 * El token del usuario viaja en `X-Notion-Token` y este archivo lo reenvía; no
 * lo guarda ni lo registra. Existe porque la API de Notion no manda cabeceras
 * CORS: el navegador no puede llamarla directamente.
 *
 * Dos diferencias deliberadas respecto de
 * `reference/wzglexical-dev_mimem/api/notion.ts`:
 *
 * 1. **No hay clave de servidor de reserva.** El original caía en `NOTION_KEY`
 *    cuando la petición no traía token y además servía `Access-Control-Allow-
 *    Origin: *`. Las dos cosas juntas son un lector público del Notion del
 *    dueño del despliegue. Aquí, sin `X-Notion-Token` no hay petición.
 * 2. **`endpoint` se valida contra una lista blanca.** El original lo concatenaba
 *    a la base, y `fetch` normaliza los `..` del camino: bastaba
 *    `endpoint=/../../x` para alcanzar rutas que no queríamos exponer. La lista
 *    ya cubre las rutas de las fases siguientes, así que no habrá que volver.
 */

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/** Los ids de Notion son UUID, con guiones o sin ellos. */
const ID = "(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";

const ALLOWED_PATHS: readonly RegExp[] = [
  new RegExp("^/users/me$"),                    // quién soy: valida el token
  new RegExp("^/search$"),                      // buscar la página raíz
  new RegExp(`^/pages$`),                       // crear página
  new RegExp(`^/pages/${ID}$`),                 // leer o archivar una página
  new RegExp(`^/blocks/${ID}$`),                // leer, editar o borrar un bloque
  new RegExp(`^/blocks/${ID}/children$`),       // listar o añadir hijos
];

/** Sólo los parámetros de paginación de Notion. */
const ALLOWED_QUERY_KEYS = new Set(["start_cursor", "page_size"]);

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Devuelve la ruta ya validada, o el motivo del rechazo. */
function checkEndpoint(raw: string): { path: string; search: string } | string {
  if (!raw.startsWith("/")) return "El endpoint debe empezar por '/'.";
  if (raw.includes("..")) return "El endpoint no puede contener '..'.";

  const hash = raw.indexOf("#");
  const cleaned = hash === -1 ? raw : raw.slice(0, hash);
  const split = cleaned.indexOf("?");
  const path = split === -1 ? cleaned : cleaned.slice(0, split);
  const query = split === -1 ? "" : cleaned.slice(split + 1);

  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    return `Ruta no permitida: ${path}`;
  }

  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) return `Parámetro no permitido: ${key}`;
  }

  const search = params.toString();
  return { path, search: search ? `?${search}` : "" };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  const token = firstValue(req.headers["x-notion-token"]);
  if (!token) {
    res.status(401).json({
      error: "missing_token",
      message: "Falta la cabecera X-Notion-Token. Conecta Notion primero.",
    });
    return;
  }

  const endpoint = firstValue(req.query.endpoint);
  if (!endpoint) {
    res.status(400).json({ error: "missing_endpoint", message: "Falta ?endpoint=" });
    return;
  }

  const checked = checkEndpoint(endpoint);
  if (typeof checked === "string") {
    res.status(400).json({ error: "endpoint_not_allowed", message: checked });
    return;
  }

  const method = (firstValue(req.query.method) ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    res.status(405).json({ error: "method_not_allowed", message: `Método ${method}` });
    return;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
  };

  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.body ?? {});
  }

  let notionRes: Response;
  try {
    notionRes = await fetch(`${NOTION_API_BASE}${checked.path}${checked.search}`, {
      method,
      headers,
      body,
    });
  } catch (cause) {
    res.status(502).json({
      error: "notion_unreachable",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return;
  }

  const payload: unknown = await notionRes.json().catch(() => ({
    error: "notion_bad_response",
    message: `Notion respondió ${notionRes.status} sin JSON.`,
  }));

  res.status(notionRes.status).json(payload);
}
