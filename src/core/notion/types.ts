/**
 * Los trozos de la API de Notion que este proyecto usa de verdad.
 *
 * Se describe lo que se lee, no el esquema completo: cada campo que aparece aquí
 * es un campo que alguna pantalla necesita. Los objetos de Notion traen mucho
 * más, y `[key: string]: unknown` deja constancia de eso sin invitar a leerlo a
 * ciegas.
 */

/** Respuesta de `POST /v1/oauth/token`, ya intercambiado el código. */
export interface NotionToken {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name: string | null;
  workspace_icon: string | null;
  owner?: {
    type: string;
    user?: { id: string; name?: string | null; avatar_url?: string | null };
  };
}

/** Error de la API de Notion, o de nuestros propios endpoints. */
export interface NotionError {
  object?: "error";
  status?: number;
  code?: string;
  error?: string;
  message?: string;
}

export interface RichText {
  plain_text: string;
  [key: string]: unknown;
}

/** Una página tal como la devuelve `/v1/search` o `/v1/pages/{id}`. */
export interface NotionPage {
  object: "page";
  id: string;
  url?: string;
  archived?: boolean;
  in_trash?: boolean;
  parent?: { type: string; page_id?: string; database_id?: string; workspace?: boolean };
  icon?: { type: string; emoji?: string; [key: string]: unknown } | null;
  properties?: Record<string, { type: string; title?: RichText[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface SearchResponse {
  object: "list";
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * El título de una página vive en la única propiedad de tipo `title`, y su
 * nombre cambia según la página («title», «Name», el que le puso el usuario).
 * Por eso se busca por tipo y no por clave.
 */
export function pageTitle(page: NotionPage, fallback = "Sin título"): string {
  const properties = page.properties;
  if (!properties) return fallback;

  for (const property of Object.values(properties)) {
    if (property.type !== "title" || !property.title) continue;
    const text = property.title.map((span) => span.plain_text).join("").trim();
    if (text) return text;
  }
  return fallback;
}
