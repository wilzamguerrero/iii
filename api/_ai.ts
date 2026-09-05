/**
 * Lo compartido de los endpoints de IA.
 *
 * Un solo sitio con la tabla de proveedores, porque el endurecimiento importante
 * está justo ahí: la URL de destino **nunca** se construye con nada que venga de
 * la petición. El cliente manda un identificador de proveedor, se busca en esta
 * tabla y si no está, 400. Sin eso, `/api/ai-chat` sería un proxy abierto a
 * cualquier host de internet con la IP del servidor.
 *
 * Diferencias deliberadas con `reference/` (ver plan.md §D3):
 *
 * - No hay `Access-Control-Allow-Origin: *`. Los endpoints los llama esta página
 *   y nadie más; el comodín convertía el despliegue en un proxy de IA público
 *   pagado por quien despliega.
 * - El `client_id` del flujo de dispositivo de GitHub lo pone el servidor. En el
 *   original venía en el cuerpo, y eso hacía del endpoint un relé al alta de
 *   dispositivos de GitHub para cualquier aplicación.
 * - Las claves no se registran nunca, ni completas ni recortadas.
 *
 * Vercel no despliega como función los archivos de `api/` que empiezan por `_`.
 */

import type { ApiRequest, ApiResponse } from "./_types.ts";

export type ProviderId = "openrouter" | "nvidia" | "github";

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /**
   * Destinos de la conversación, en orden. Si el primero contesta 401 o 403 se
   * prueba el siguiente: es el caso de una cuenta de GitHub sin Copilot, que
   * puede seguir usando el catálogo gratuito de GitHub Models.
   */
  chatUrls: readonly string[];
  /** Destinos del catálogo de modelos, con la misma regla de cascada. */
  modelUrls: readonly string[];
  defaultModel: string;
  /** Variable de entorno con la que quien despliega puede poner su propia clave. */
  envKey: string;
  /** Cabeceras fijas que el proveedor pide además del `Bearer`. */
  headers?: Readonly<Record<string, string>>;
  /** Cierto cuando el catálogo de modelos es público (OpenRouter). */
  publicCatalog?: boolean;
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderSpec>> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    chatUrls: ["https://openrouter.ai/api/v1/chat/completions"],
    modelUrls: ["https://openrouter.ai/api/v1/models"],
    defaultModel: "openai/gpt-4o-mini",
    envKey: "OPENROUTER_API_KEY",
    headers: { "X-Title": "Plataforma 3i" },
    publicCatalog: true,
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA",
    chatUrls: ["https://integrate.api.nvidia.com/v1/chat/completions"],
    modelUrls: ["https://integrate.api.nvidia.com/v1/models"],
    defaultModel: "nvidia/llama-3.3-nemotron-super-49b-v1",
    envKey: "NVIDIA_API_KEY",
  },
  github: {
    id: "github",
    label: "GitHub Copilot",
    chatUrls: [
      "https://api.githubcopilot.com/chat/completions",
      "https://models.github.ai/inference/v1/chat/completions",
    ],
    modelUrls: [
      "https://api.githubcopilot.com/models",
      "https://models.github.ai/catalog/models",
      "https://models.github.ai/inference/v1/models",
    ],
    defaultModel: "gpt-4o-mini",
    envKey: "GITHUB_AI_TOKEN",
    headers: { "User-Agent": "plataforma-3i/1.0", "Openai-Intent": "conversation-edits" },
  },
};

export function readProvider(value: unknown): ProviderSpec | null {
  if (typeof value !== "string") return null;
  // `hasOwn` y no un acceso directo: `PROVIDERS["constructor"]` devolvería algo
  // heredado del prototipo y pasaría por proveedor válido.
  if (!Object.hasOwn(PROVIDERS, value)) return null;
  return PROVIDERS[value as ProviderId];
}

/**
 * La clave que se usará: la que manda el navegador o, si no la manda, la que
 * haya en el entorno del servidor. Las dos vías existen a propósito —la persona
 * pega su clave en la pestaña IA, y quien despliega puede poner una para todos—
 * y el navegador nunca ve la del entorno.
 */
export function resolveKey(req: ApiRequest, spec: ProviderSpec): string | null {
  const sent = req.headers["x-ai-key"];
  const header = Array.isArray(sent) ? sent[0] : sent;
  const trimmed = header?.trim();
  if (trimmed) return trimmed;
  const fromEnv = process.env[spec.envKey]?.trim();
  return fromEnv ? fromEnv : null;
}

export function noStore(res: ApiResponse): void {
  res.setHeader("Cache-Control", "no-store");
}

/** Qué claves tiene puestas el servidor. Se dice si hay, nunca cuál. */
export function configuredProviders(): Record<ProviderId, boolean> {
  return {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    nvidia: Boolean(process.env.NVIDIA_API_KEY),
    github: Boolean(process.env.GITHUB_AI_TOKEN),
  };
}

/**
 * Llama a los destinos en cascada. Devuelve la primera respuesta que no sea un
 * rechazo de credenciales, o la última si todas lo son.
 */
export async function fetchWithFallback(
  urls: readonly string[],
  init: RequestInit,
): Promise<Response> {
  let last: Response | null = null;

  for (const url of urls) {
    const response = await fetch(url, init);
    if (response.status !== 401 && response.status !== 403) return response;
    last = response;
  }

  // Todos rechazaron: se devuelve el último para que el cliente vea el motivo
  // real del proveedor en vez de un error inventado por nosotros.
  return last as Response;
}

/** Vuelca el flujo del proveedor tal cual. Es texto SSE y se pasa sin tocar. */
export async function pipeStream(upstream: Response, res: ApiResponse): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Sin esto, algunos intermediarios acumulan el flujo y la respuesta llega de
  // golpe al final, que es justo lo que el streaming evita.
  res.setHeader("X-Accel-Buffering", "no");

  const body = upstream.body;
  if (!body) {
    res.end();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const flush = (): void => {
    const maybe = res as unknown as { flush?: () => void };
    try { maybe.flush?.(); } catch { /* sin compresión no hay nada que vaciar */ }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(decoder.decode(value, { stream: true }));
    flush();
  }
  res.end();
}

/** Mensaje de error legible sin filtrar cabeceras ni claves. */
export function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Error interno del servidor.";
}
