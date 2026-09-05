/**
 * La conversación con el proveedor de IA.
 *
 * `POST /api/ai-chat` con `{provider, model, messages, stream}`. El proveedor se
 * busca en la tabla de `_ai.ts`; la URL de destino no se construye nunca con
 * datos de la petición.
 *
 * Existe porque las tres APIs quieren la clave en un `Authorization` y ninguna
 * manda cabeceras CORS: el navegador no puede llamarlas de frente. Y porque así
 * la clave puede vivir en el servidor cuando quien despliega pone la suya.
 */

import type { ApiHandler } from "./_types.ts";
import {
  describe, fetchWithFallback, noStore, pipeStream, readProvider, resolveKey,
} from "./_ai.ts";

/** Topes de cordura. No son de seguridad de la clave, son de no mandar un libro. */
const MAX_MESSAGES = 80;
const MAX_CHARS = 200_000;
const MAX_MODEL_LENGTH = 200;

type Role = "system" | "user" | "assistant";
const ROLES = new Set<Role>(["system", "user", "assistant"]);

interface ChatMessage { role: Role; content: string }

/** Devuelve los mensajes limpios, o el motivo por el que no valen. */
function checkMessages(value: unknown): ChatMessage[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return "Falta la lista de mensajes.";
  }
  if (value.length > MAX_MESSAGES) {
    return `Demasiados mensajes (máximo ${MAX_MESSAGES}).`;
  }

  const clean: ChatMessage[] = [];
  let chars = 0;

  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return "Un mensaje no es un objeto.";
    const { role, content } = raw as { role?: unknown; content?: unknown };
    if (typeof role !== "string" || !ROLES.has(role as Role)) {
      return "Un mensaje tiene un papel que no es system, user ni assistant.";
    }
    if (typeof content !== "string") return "El contenido de un mensaje no es texto.";
    chars += content.length;
    if (chars > MAX_CHARS) return "La conversación es demasiado larga.";
    clean.push({ role: role as Role, content });
  }

  return clean;
}

const handler: ApiHandler = async (req, res) => {
  noStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed", message: "Usa POST." });
    return;
  }

  const body = (req.body ?? {}) as {
    provider?: unknown; model?: unknown; messages?: unknown; stream?: unknown;
  };

  const spec = readProvider(body.provider);
  if (!spec) {
    res.status(400).json({ error: "unknown_provider", message: "Proveedor no reconocido." });
    return;
  }

  const messages = checkMessages(body.messages);
  if (typeof messages === "string") {
    res.status(400).json({ error: "bad_messages", message: messages });
    return;
  }

  const key = resolveKey(req, spec);
  if (!key) {
    res.status(401).json({
      error: "missing_key",
      message: `Falta la credencial de ${spec.label}. Configúrala en la pestaña IA.`,
    });
    return;
  }

  const model = typeof body.model === "string" && body.model.trim() && body.model.length <= MAX_MODEL_LENGTH
    ? body.model.trim()
    : spec.defaultModel;
  const stream = body.stream === true;

  const payload: Record<string, unknown> = { model, messages };
  if (stream) payload.stream = true;

  try {
    const upstream = await fetchWithFallback(spec.chatUrls, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        ...spec.headers,
      },
      body: JSON.stringify(payload),
    });

    if (stream && upstream.ok) {
      await pipeStream(upstream, res);
      return;
    }

    // Ni el error ni la respuesta corta se reinterpretan: el cliente ve lo que
    // dijo el proveedor, que es lo único que explica de verdad un 429 o un 402.
    const data = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.send(data);
  } catch (error) {
    console.error("[ai-chat]", spec.id, describe(error));
    res.status(502).json({ error: "provider_unreachable", message: describe(error) });
  }
};

export default handler;
