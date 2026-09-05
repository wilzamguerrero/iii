import { browserKey, customProvider } from "./config.ts";
import { isCustom, type ProviderId } from "./types.ts";

/**
 * Lo que comparten las llamadas a `api/ai-*`: dónde va la clave y cómo se lee un
 * error. Es el reflejo en el cliente de `api/_ai.ts`.
 */

/**
 * El proveedor tal como lo entiende el servidor. Los propios van todos como
 * `custom`: el nombre que la persona les puso es cosa de este navegador, y el
 * servidor sólo necesita la URL, que viaja en `X-Ai-Base`.
 */
export function wireProvider(provider: ProviderId): string {
  return isCustom(provider) ? "custom" : provider;
}

/** Una cabecera no puede llevar caracteres fuera del ASCII imprimible. */
function ascii(value: string): string {
  return /^[ -~]*$/.test(value) ? value : encodeURI(value);
}

/**
 * Las cabeceras de una llamada a `api/ai-*`.
 *
 * La clave del navegador viaja en `X-Ai-Key`. Si no hay, no se manda cabecera y
 * el servidor usará la del entorno; así el mismo código sirve para las dos formas
 * de tener credencial.
 *
 * En un proveedor propio va además su URL base, y el identificador del registro
 * público si se eligió del directorio: con él los modelos salen con su nombre en
 * vez de con el identificador desnudo.
 *
 * Y, si esa API no habla `Authorization: Bearer` o pide alguna cabecera suya, van
 * también: `X-Ai-Key-Header` dice por dónde va la clave y `X-Ai-Headers` lleva las
 * demás en JSON. Viajan en una sola cabecera y no una por cada una para que no se
 * puedan confundir con las de la petición: lo que llegue ahí lo revisa
 * `safeHeaders` en el servidor antes de reenviarlo a nadie.
 */
export function providerHeaders(provider: ProviderId): Record<string, string> {
  const headers: Record<string, string> = {};

  const key = browserKey(provider);
  if (key) headers["X-Ai-Key"] = ascii(key);

  const custom = customProvider(provider);
  if (custom) {
    headers["X-Ai-Base"] = ascii(custom.baseUrl);
    if (custom.registry) headers["X-Ai-Registry"] = ascii(custom.registry);
    if (custom.keyHeader) headers["X-Ai-Key-Header"] = ascii(custom.keyHeader);
    if (custom.headers && Object.keys(custom.headers).length > 0) {
      headers["X-Ai-Headers"] = JSON.stringify(custom.headers);
    }
  }

  return headers;
}

export class ApiError extends Error {
  readonly status: number;
  /** El código del endpoint —`missing_key`, `unknown_provider`…— o `""`. */
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * El motivo real de un fallo. Puede venir de nuestros endpoints
 * (`{error, message}`) o del proveedor tal cual (`{error: {message}}`), porque
 * `api/ai-chat.ts` pasa su respuesta sin reinterpretarla: es lo único que explica
 * de verdad un 429 o un 402.
 */
export async function apiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  let message = "";
  let code = "";

  try {
    const data = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
    };
    if (typeof data.message === "string") message = data.message;
    if (typeof data.error === "string") code = data.error;
    else if (typeof data.error === "object" && data.error !== null) {
      const nested = data.error as { message?: unknown; code?: unknown };
      if (!message && typeof nested.message === "string") message = nested.message;
      if (typeof nested.code === "string") code = nested.code;
    }
  } catch {
    // No era JSON. El servidor ya resume las páginas de error del proveedor
    // (`explainBody` en api/_ai.ts), así que llegar aquí con etiquetas es raro;
    // por si acaso, se quitan: una página entera no explica nada en una línea.
    message = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  }

  if (!message) message = `El servidor respondió ${response.status}.`;
  return new ApiError(message, response.status, code);
}
