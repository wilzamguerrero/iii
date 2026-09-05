import { activeProvider, chosenModel } from "./config.ts";
import { apiError, providerHeaders, wireProvider } from "./wire.ts";
import type { ChatMessage, ProviderId } from "./types.ts";

/**
 * La conversación, en flujo.
 *
 * Se pide `stream: true` y se leen los trozos conforme llegan: en una respuesta
 * larga, la diferencia entre ver texto a los 300 ms y esperar veinte segundos en
 * blanco es la diferencia entre una herramienta y un formulario.
 *
 * El formato es el de OpenAI —una línea `data:` por trozo y `data: [DONE]` al
 * final— porque los tres proveedores lo hablan. `api/ai-chat.ts` lo reenvía sin
 * tocarlo.
 */

export interface StreamOptions {
  messages: ChatMessage[];
  provider?: ProviderId;
  model?: string | null;
  signal?: AbortSignal;
  /** Se llama con cada trozo nuevo, no con el texto acumulado. */
  onDelta?: (chunk: string) => void;
}

/** Devuelve el texto completo; los trozos ya se entregaron por `onDelta`. */
export async function streamChat(options: StreamOptions): Promise<string> {
  const provider = options.provider ?? activeProvider();
  const model = options.model ?? chosenModel(provider);

  const response = await fetch("/api/ai-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...providerHeaders(provider),
    },
    body: JSON.stringify({
      provider: wireProvider(provider),
      model,
      messages: options.messages,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) throw await apiError(response);

  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    // El proveedor ignoró `stream`. La respuesta viene entera y de una vez.
    const data = await response.json() as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    if (text) options.onDelta?.(text);
    return text;
  }

  return readSse(response, options.onDelta);
}

async function readSse(response: Response, onDelta?: (chunk: string) => void): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Lo que quede tras el último salto de línea es una línea a medias: se
    // guarda para el trozo siguiente en vez de intentar interpretarla.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return full;

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // Un comentario o un latido del proveedor.
      }

      const chunk = parsed as {
        choices?: { delta?: { content?: unknown } }[];
        error?: { message?: unknown } | string;
      };

      // Un proveedor puede abortar a media respuesta con un error dentro del
      // propio flujo. Callarlo dejaría un mensaje cortado sin explicación.
      if (chunk.error) {
        const message = typeof chunk.error === "string"
          ? chunk.error
          : typeof chunk.error.message === "string" ? chunk.error.message : "";
        throw new Error(message || "El proveedor cortó la respuesta.");
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        full += delta;
        onDelta?.(delta);
      }
    }
  }

  return full;
}
