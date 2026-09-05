/**
 * Traducción entre el formato de OpenAI y el de Anthropic.
 *
 * Existe por un caso concreto y comprobado: una pasarela cuya lista de modelos se
 * lee sin problema y cuyo `POST /v1/chat/completions` devuelve 403 desde
 * Cloudflare, mientras `POST /v1/messages` contesta 200 con la respuesta entera.
 * Esa pasarela sólo sirve el camino de Anthropic, y ninguna cabecera arregla eso:
 * el cuerpo es distinto —el `system` va aparte, `max_tokens` es obligatorio— y el
 * flujo manda otros eventos.
 *
 * La traducción vive **sólo en el servidor**. El cliente (`src/core/ai/chat.ts`)
 * habla un único formato, el de OpenAI, y no sabe que esto existe: entra un cuerpo
 * de OpenAI y sale un cuerpo de OpenAI, aunque por el medio la conversación haya
 * ido y vuelto en el de Anthropic.
 */

import type { ApiResponse } from "./_types.ts";

/**
 * Anthropic exige `max_tokens` y OpenAI no, así que hay que poner uno. Cuatro mil
 * caben en todos los modelos —los topes por modelo varían y pasarse es un 400— y
 * dan de sobra para una respuesta de esta plataforma.
 */
const MAX_TOKENS = 4096;

interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

/** El cuerpo de Anthropic a partir del de OpenAI. */
export function toAnthropicBody(
  model: string,
  messages: readonly ChatMessage[],
  stream: boolean,
): Record<string, unknown> {
  const system: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];

  for (const message of messages) {
    if (!message.content.trim()) continue;
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    // Anthropic rechaza dos mensajes seguidos del mismo papel; OpenAI los admite.
    const last = turns[turns.length - 1];
    if (last && last.role === message.role) {
      last.content += "\n\n" + message.content;
      continue;
    }
    turns.push({ role: message.role, content: message.content });
  }

  // Y rechaza también que el primero sea del asistente.
  while (turns.length > 0 && turns[0]?.role === "assistant") turns.shift();

  return {
    model,
    max_tokens: MAX_TOKENS,
    messages: turns,
    ...(system.length > 0 ? { system: system.join("\n\n") } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

/* --- la respuesta de una vez ------------------------------------------------- */

const STOP: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
};

/** El cuerpo de OpenAI a partir del de Anthropic. */
export function fromAnthropicReply(raw: unknown): Record<string, unknown> {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as {
    id?: unknown; model?: unknown; content?: unknown; stop_reason?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };

  // El contenido es una lista de bloques. Sólo los de texto son la respuesta: un
  // bloque `thinking` es el razonamiento del modelo y no se enseña como si fuera
  // lo que contestó.
  let text = "";
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      const piece = block as { type?: unknown; text?: unknown };
      if (piece.type === "text" && typeof piece.text === "string") text += piece.text;
    }
  }

  const input = typeof data.usage?.input_tokens === "number" ? data.usage.input_tokens : 0;
  const output = typeof data.usage?.output_tokens === "number" ? data.usage.output_tokens : 0;
  const reason = typeof data.stop_reason === "string" ? STOP[data.stop_reason] ?? "stop" : "stop";

  return {
    id: typeof data.id === "string" ? data.id : "",
    object: "chat.completion",
    model: typeof data.model === "string" ? data.model : "",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: reason }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  };
}

/* --- el flujo ---------------------------------------------------------------- */

/**
 * Reenvía el flujo de Anthropic como uno de OpenAI, trozo a trozo.
 *
 * Anthropic manda eventos con nombre —`message_start`, `content_block_delta`,
 * `message_stop`— y OpenAI manda un único tipo de trozo con `choices[0].delta`.
 * Lo que sale de aquí es lo segundo, así que el cliente no distingue esta
 * conversación de cualquier otra.
 *
 * Los bloques `thinking` se dejan pasar de largo: son el razonamiento del modelo,
 * llegan antes del texto y enseñarlos sería presentar el borrador como respuesta.
 */
export async function pipeAnthropicStream(upstream: Response, res: ApiResponse): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const flush = (): void => {
    const maybe = res as unknown as { flush?: () => void };
    try { maybe.flush?.(); } catch { /* sin compresión no hay nada que vaciar */ }
  };
  const send = (chunk: Record<string, unknown>): void => {
    res.write("data: " + JSON.stringify(chunk) + "\n\n");
    flush();
  };
  const text = (piece: string): void => {
    send({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: piece } }] });
  };
  const done = (): void => {
    res.write("data: [DONE]\n\n");
    flush();
  };

  const body = upstream.body;
  if (!body) {
    done();
    res.end();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;

  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      // `event:` no hace falta: cada `data:` de Anthropic lleva su propio `type`.
      if (!line.startsWith("data:")) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      const event = parsed as {
        type?: unknown;
        delta?: { type?: unknown; text?: unknown; stop_reason?: unknown };
        content_block?: { type?: unknown; text?: unknown };
        error?: { message?: unknown };
      };

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block?.type === "text" && typeof block.text === "string" && block.text) text(block.text);
        continue;
      }

      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
          text(delta.text);
        }
        continue;
      }

      if (event.type === "message_delta") {
        const reason = event.delta?.stop_reason;
        if (typeof reason === "string") {
          send({
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: STOP[reason] ?? "stop" }],
          });
        }
        continue;
      }

      if (event.type === "error") {
        // Un fallo a media respuesta viaja dentro del propio flujo. El cliente lo
        // reconoce por la forma de OpenAI —`error.message`— y corta con ese texto.
        const message = typeof event.error?.message === "string"
          ? event.error.message
          : "El proveedor cortó la respuesta.";
        send({ error: { message } });
        continue;
      }

      if (event.type === "message_stop") {
        done();
        closed = true;
      }
    }
  }

  // Si el proveedor cerró sin `message_stop`, el cierre lo pone este servidor: un
  // flujo sin `[DONE]` deja al cliente esperando algo que ya no va a llegar.
  if (!closed) done();
  res.end();
}
