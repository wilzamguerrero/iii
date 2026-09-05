/**
 * La conversación con el proveedor de IA.
 *
 * `POST /api/ai-chat` con `{provider, model, messages, stream}`. El proveedor se
 * busca en la tabla de `_ai.ts` y la URL de destino no se construye nunca con
 * datos de la petición. La excepción son los proveedores propios, donde la URL
 * base la pone la persona y pasa por la política de `safeBase`.
 *
 * Existe porque las tres APIs quieren la clave en un `Authorization` y ninguna
 * manda cabeceras CORS: el navegador no puede llamarlas de frente. Y porque así
 * la clave puede vivir en el servidor cuando quien despliega pone la suya.
 */

import type { ApiHandler } from "./_types.ts";
import {
  describe, explainBody, fetchWithFallback, noStore, pipeStream, readTarget, resolveKey,
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

  const found = readTarget(req, body.provider);
  if (!found.ok) {
    res.status(400).json({ error: found.code, message: found.message });
    return;
  }
  const target = found.target;

  const messages = checkMessages(body.messages);
  if (typeof messages === "string") {
    res.status(400).json({ error: "bad_messages", message: messages });
    return;
  }

  const key = resolveKey(req, target);
  // Un proveedor propio en la máquina de la persona puede no pedir clave; el
  // resto sí, y decirlo aquí ahorra un 401 que el proveedor explicaría peor.
  if (!key && !target.custom) {
    res.status(401).json({
      error: "missing_key",
      message: `Falta la credencial de ${target.label}. Configúrala en los ajustes del asistente.`,
    });
    return;
  }

  const model = typeof body.model === "string" && body.model.trim() && body.model.length <= MAX_MODEL_LENGTH
    ? body.model.trim()
    : target.defaultModel;
  if (!model) {
    res.status(400).json({
      error: "missing_model",
      message: "Elige un modelo en los ajustes del asistente: este proveedor no tiene uno por defecto.",
    });
    return;
  }
  const stream = body.stream === true;

  const payload: Record<string, unknown> = { model, messages };
  if (stream) payload.stream = true;

  try {
    const upstream = await fetchWithFallback(target.chatUrls, {
      method: "POST",
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        ...target.headers,
      },
      body: JSON.stringify(payload),
    }, { noRedirect: target.custom });

    if (stream && upstream.ok) {
      await pipeStream(upstream, res);
      return;
    }

    const data = await upstream.text();
    const type = upstream.headers.get("content-type");

    // Un fallo en JSON se reenvía tal cual: es lo único que explica de verdad un
    // 429 o un 402. Uno que no es JSON —una página de error de un cortafuegos,
    // por ejemplo— se resume, porque si no acabaría entero en la conversación.
    if (!upstream.ok) {
      const message = explainBody(upstream.status, target.label, type, data);
      if (message) {
        console.error("[ai-chat]", target.id, upstream.status, data.slice(0, 200));
        res.status(upstream.status).json({ error: "provider_error", message });
        return;
      }
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", type ?? "application/json");
    res.send(data);
  } catch (error) {
    console.error("[ai-chat]", target.id, describe(error));
    res.status(502).json({ error: "provider_unreachable", message: describe(error) });
  }
};

export default handler;
