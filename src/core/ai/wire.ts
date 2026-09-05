import { browserKey } from "./config.ts";
import type { ProviderId } from "./types.ts";

/**
 * Lo que comparten las llamadas a `api/ai-*`: dónde va la clave y cómo se lee un
 * error. Es el reflejo en el cliente de `api/_ai.ts`.
 */

/**
 * La clave del navegador viaja en `X-Ai-Key`. Si no hay, no se manda cabecera y
 * el servidor usará la del entorno; así el mismo código sirve para las dos formas
 * de tener credencial.
 */
export function keyHeaders(provider: ProviderId): Record<string, string> {
  const key = browserKey(provider);
  return key ? { "X-Ai-Key": key } : {};
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
    // No era JSON: se usa el texto crudo, recortado.
    message = text.slice(0, 300);
  }

  if (!message) message = `El servidor respondió ${response.status}.`;
  return new ApiError(message, response.status, code);
}
