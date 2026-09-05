import type { NotionPage, SearchResponse } from "./types.ts";

/**
 * Cliente de Notion. Todo pasa por `/api/notion`, que es quien pone el
 * `Notion-Version` y el `Bearer`; la API de Notion no manda cabeceras CORS y el
 * navegador no puede llamarla de frente.
 *
 * El límite de Notion son unas tres peticiones por segundo. `notionRequest`
 * reintenta una vez cuando llega un 429 respetando el `Retry-After`, porque el
 * caso normal —un pico corto— se arregla esperando, y hacer que lo resuelva cada
 * llamante acabaría en cinco versiones distintas del mismo bucle.
 */

const PROXY = "/api/notion";
const RETRY_STATUS = new Set([429, 502, 503, 504]);

export class NotionRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NotionRequestError";
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export async function notionRequest<T>(
  token: string,
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const url = `${PROXY}?endpoint=${encodeURIComponent(endpoint)}&method=${method}`;

  const headers: Record<string, string> = {
    "X-Notion-Token": token,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body ?? {});
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { method: "POST", headers, body, signal: options.signal });
    // El proxy se invoca siempre con POST para poder llevar cuerpo; el método
    // real hacia Notion viaja en el parámetro `method`.

    if (response.ok) return await response.json() as T;

    if (RETRY_STATUS.has(response.status) && attempt === 0) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 700);
      continue;
    }

    const error = await response.json().catch(() => null) as
      | { code?: string; error?: string; message?: string }
      | null;
    throw new NotionRequestError(
      response.status,
      error?.code ?? error?.error ?? "notion_error",
      error?.message ?? `Notion respondió ${response.status}.`,
    );
  }

  throw new NotionRequestError(0, "unreachable", "No se pudo hablar con Notion.");
}

export interface NotionBot {
  id: string;
  type: string;
  name?: string | null;
  bot?: { workspace_name?: string | null; [key: string]: unknown };
}

/** Valida el token y dice a nombre de quién se está trabajando. */
export function whoAmI(token: string): Promise<NotionBot> {
  return notionRequest<NotionBot>(token, "/users/me");
}

/**
 * Páginas que el usuario compartió con la integración, la más reciente primero.
 * `/v1/search` sin `query` devuelve todo lo accesible; con `query` filtra por
 * título.
 */
export function searchPages(
  token: string,
  query = "",
  options: { pageSize?: number; cursor?: string } = {},
): Promise<SearchResponse> {
  const body: Record<string, unknown> = {
    filter: { property: "object", value: "page" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
    page_size: options.pageSize ?? 25,
  };
  if (query.trim()) body.query = query.trim();
  if (options.cursor) body.start_cursor = options.cursor;

  return notionRequest<SearchResponse>(token, "/search", { method: "POST", body });
}

export function getPage(token: string, pageId: string): Promise<NotionPage> {
  return notionRequest<NotionPage>(token, `/pages/${pageId}`);
}
