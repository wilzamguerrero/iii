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

import type { ApiHandler, ApiResponse } from "./_types.ts";
import { fromAnthropicReply, pipeAnthropicStream, toAnthropicBody } from "./_anthropic.ts";
import {
  authHeaders, describe, explainBody, fetchWithFallback, noStore, pipeStream, readTarget,
  resolveKey,
} from "./_ai.ts";
import {
  applyOpenCodeGate, diagnose429, isOpenCode, isZen, openCodeHeaders, resetOrgId, resetSession,
  resolveOrgId, restoreNames, restoreStreamNames, stripForwardHeaders,
} from "./_opencode.ts";
import { freepiHeaders, isFreePi, pipeFreePiStream, replyText, resetSession as resetFreePiSession } from "./_freepi.ts";
import { ocServeChat, ocServeUsable, OcError } from "./_oc_serve.ts";
import {
  allowedModelsFromError, copilotAutoModel, copilotHeaders, copilotPlan, DEFAULT_COPILOT_HOST,
  integratorFromError, resolveAutoModel,
} from "./_copilot.ts";

/** Topes de cordura. No son de seguridad de la clave, son de no mandar un libro. */
const MAX_MESSAGES = 80;
const MAX_CHARS = 200_000;
const MAX_MODEL_LENGTH = 200;
/**
 * Sólo para la respuesta de una vez. En flujo no hay tope: el silencio entre
 * trozos es normal y cortarlo mataría una respuesta que estaba llegando.
 */
const REPLY_TIMEOUT_MS = 120_000;
/**
 * Cuántas sesiones nuevas se prueban con OpenCode cuando dice que no hay cuota.
 *
 * Dos, igual que el portal de casa (`_OC_MAX_ROTATIONS`): el CLI abre otra
 * conversación al recibir el 429 y muchas veces recupera margen. Más intentos
 * sólo alargan la espera cuando la cuota del día ya se acabó de verdad.
 */
const OC_MAX_ROTATIONS = 2;

/**
 * El tope de tokens de la respuesta, para que el proveedor no ponga el suyo.
 *
 * Pasó de verdad: sin este campo, GitHub Models y NVIDIA cortaban la respuesta
 * a los ~100 tokens de su tope por defecto —el asistente decía «Haz esto:» y
 * la lista nunca llegaba—. Con 4096 la respuesta completa cabe en todos los
 * modelos de la tabla; pasarse del tope de un modelo concreto es un 400 que el
 * proveedor explica, y ahí se elige otro modelo o se pide algo más corto.
 */
const MAX_TOKENS = 4096;

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

  // «Auto» en Copilot no es un modelo: es el nombre que enseña el selector. La
  // API no lo conoce y contesta `400 model_not_supported` en el primer mensaje.
  // VS Code lo resuelve preguntando a `POST /auto` con el propio mensaje, y eso
  // se hace aquí igual: la elección depende del texto, no del catálogo.
  const copilotBase = target.id === "github" ? await copilotPlan(key ?? "") : null;
  const targetHost = copilotBase?.host ?? DEFAULT_COPILOT_HOST;

  // OpenCode manda el `gho_` de GitHub tal cual a `/chat/completions`, sin
  // canjearlo, y es el cliente que funciona. Canjearlo por `/v2/token` fue el
  // otro error: ese token queda atado al integrador que GitHub decida al
  // emitirlo, y después la cabecera ya no puede corregirlo.
  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const hasImage = messages.some((m) => Array.isArray(m.content));
  const copilotModel = target.id === "github" && model === "auto"
    ? (key ? await copilotAutoModel(key, targetHost, lastUserText, hasImage) : null)
      ?? resolveAutoModel([])
    : model;

  // El cuerpo se traduce aquí cuando el destino habla el formato de Anthropic. El
  // cliente manda siempre el de OpenAI: la diferencia no sube hasta el navegador.
  const payload: Record<string, unknown> = target.format === "anthropic"
    ? toAnthropicBody(copilotModel, messages, stream)
    : { model: copilotModel, messages, max_tokens: MAX_TOKENS, ...(stream ? { stream: true } : {}) };

  // OpenCode no acepta un cuerpo compatible con OpenAI: exige la forma de su
  // propio cliente y, si no la tiene, contesta `429 FreeUsageLimitError` —que no
  // es una cuota agotada—. Se aplica aquí, sobre el cuerpo ya traducido, para que
  // valga igual en flujo y en respuesta de una vez. Ver `_opencode.ts`.
  const targetUrl = target.chatUrls[0] ?? "";
  const opencode = isOpenCode(targetUrl);

  // ── OpenCode: primero el binario, que es la única vía que su puerta acepta ──
  //
  // Desde ~2026-09-17 `opencode.ai` rechaza a todo cliente que no sea su propio
  // binario (lo mira en el fingerprint TLS, que `fetch` no puede imitar). Con el
  // binario delante, el tráfico lo genera él y funciona. Sin binario —o en un
  // despliegue donde no puede haber procesos hijos— se sigue abajo por la vía
  // directa, que contestará 429 y se explicará como tal.
  if (opencode && ocServeUsable()) {
    try {
      const reply = await ocServeChat(model, messages);
      await sendOcReply(res, reply, stream);
      return;
    } catch (error) {
      const status = error instanceof OcError ? error.status : 502;
      const message = describe(error);
      console.error("[ai-chat]", target.id, "binario:", message);
      // Un 429 del binario es la cuota de verdad: reintentar por la vía directa
      // da el mismo 429 con un texto peor, así que se dice lo que pasó.
      if (status === 429) {
        res.status(429).json({
          error: "opencode_quota",
          message:
            "OpenCode agotó su cuota gratuita para esta clave y esta IP. Llega " +
            "con la clave recién creada porque el cupo es por IP, no por cuenta: " +
            "espera a la recarga, usa otra red o pon otra clave en los ajustes.",
        });
        return;
      }
      if (status === 401) {
        res.status(401).json({ error: "opencode_login", message });
        return;
      }
      // 502: el binario falló al arrancar o al hablar. Se intenta la vía directa
      // por si el fallo es del proceso y no del proveedor.
      console.warn("[ai-chat]", target.id, "se intenta la vía directa tras el binario");
    }
  }

  const gated = opencode ? applyOpenCodeGate(payload, key) : null;
  const sent = gated ? gated.body : payload;

  // En OpenCode la identidad importa tanto como el cuerpo: el camino `/zen`
  // rechaza cualquier cosa que no venga de su cliente (UA exacto y un `ses_`
  // decodificable), y cuenta la cuota por sesión además de por IP. Y las
  // cabeceras que llevan la IP de verdad se quitan, para que el gasto de la
  // cuota gratuita no acabe cargado a la IP de quien usa la aplicación.
  //
  // El workspace (`x-opencode-org-id`) se pregunta a Console con la clave: no
  // está codificado dentro de ella. Se cachea una hora, así que sólo la primera
  // petición de cada clave paga ese viaje.
  const org = opencode && key ? await resolveOrgId(key) : null;
  // Las cabeceras de OpenCode dependen de la sesión, y la sesión se rota cuando
  // el backend dice que se agotó: por eso se recalculan en cada intento y no se
  // congelan aquí. Ver el bucle de abajo.
  const openCodeExtras = (): Record<string, string> =>
    opencode
      ? { ...stripForwardHeaders({ ...target.extra }), ...openCodeHeaders(targetUrl, key, org) }
      : { ...target.extra };

  // free-pi no pide otra forma del cuerpo, pero sí saber quién llama: una sesión
  // estable (`x-session-id`, porque sólo admite cuatro a la vez) y la versión del
  // cliente que se anuncia. Ver `_freepi.ts`.
  const freepi = isFreePi(targetUrl);
  const freepiExtra = freepi ? await freepiHeaders(key) : null;

  // Copilot atiende a cada cuenta en el host que declara su plan; el genérico no
  // siempre sirve (una cuenta individual puede vivir en `api.individual…`). Se
  // conserva la ruta de cada URL y sólo se cambia el origen.
  const copilot = copilotBase;
  const chatUrls = copilot && copilot.host !== DEFAULT_COPILOT_HOST
    ? target.chatUrls.map((url) => {
      try {
        const parsed = new URL(url);
        const host = new URL(copilot.host);
        parsed.protocol = host.protocol;
        parsed.host = host.host;
        return parsed.toString();
      } catch { return url; }
    })
    : target.chatUrls;

  // La identidad con la que GitHub reconoce al cliente. Sin ella contesta
  // `The requested model is not available for integrator "opencode"`: no sabe
  // quién llama y deduce un integrador por defecto que no tiene ese modelo. Va
  // al final de las cabeceras para que no la pise la tabla del proveedor, que sí
  // la sobrescribía.
  const copilotExtra = target.id === "github" ? copilotHeaders() : {};

  // Y el token, que también hay que cambiar. El `gho_` de GitHub no es lo que
  // espera la API de inferencia: se canjea por uno corto de Copilot arriba, y es
  // en ese canje donde GitHub fija el integrador. Mandar el `gho_` crudo hace
  // que la cuenta se atribuya a un integrador con menos modelos, y la cabecera de
  // arriba ya no sirve para corregirlo. Ver `_copilot.ts`.


  /** Una llamada al proveedor, con la identidad de ahora mismo. */
  const call = async (body: Record<string, unknown>): Promise<Response> =>
    fetchWithFallback(chatUrls, {
      method: "POST",
      headers: {
        ...authHeaders(key, target),
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        ...target.headers,
        // Las de la persona van al final a propósito: es lo que le deja mandar un
        // `Authorization` distinto —un `Basic`, una pasarela con su propio
        // esquema— sin que este endpoint tenga que conocer cada caso. Lo que
        // gobierna la conexión o el cuerpo no llega hasta aquí: `safeHeaders` lo
        // rechaza antes. En OpenCode van ya limpias y con la identidad puesta.
        ...openCodeExtras(),
        ...freepiExtra,
        ...copilotExtra,
      },
      body: JSON.stringify(body),
    }, {
      noRedirect: target.custom,
      ...(stream ? {} : { timeoutMs: REPLY_TIMEOUT_MS }),
    });

  try {
    let upstream = await call(sent);

    // ── La rotación de sesión de OpenCode ─────────────────────────────────
    //
    // Su nivel gratuito cuenta la cuota por sesión, no sólo por IP. Cuando el
    // backend contesta 429 con la forma correcta, no hay nada que arreglar en
    // el cuerpo: lo que hay que hacer es abrir **otra conversación**, que es lo
    // que hace su propio CLI y lo que hace el portal de casa hasta dos veces.
    //
    // Sin esto, un solo 429 deja el proveedor inservible hasta reiniciar el
    // proceso, porque la sesión agotada se reutiliza en cada reintento.
    if (opencode) {
      for (let rotation = 0; rotation < OC_MAX_ROTATIONS; rotation += 1) {
        const limit = isZen(targetUrl)
          ? upstream.status === 429
          : upstream.status === 429 && !diagnose429(sent).shape;
        // El 403 `FreeTierError` es la puerta rechazando la sesión, no la cuota.
        const rejected = upstream.status === 403;
        if (!limit && !rejected) break;

        resetSession(key);
        // El cuerpo lleva `prompt_cache_key`, que es la sesión: hay que rehacerlo
        // para que el valor nuevo viaje también por dentro.
        const reshaped = applyOpenCodeGate(payload, key).body;
        upstream = await call(reshaped);
        if (upstream.ok) {
          console.warn(
            `[ai-chat] opencode: sesión renovada tras ${upstream.status === 200 ? "429" : "403"} ` +
            `(intento ${rotation + 1}/${OC_MAX_ROTATIONS}); el cuerpo ya cumplía la forma.`,
          );
          break;
        }
      }
    }

    // ── Copilot: el integrador no tiene ese modelo ────────────────────
    //
    // La lista de modelos la decide el integrador al que GitHub atribuye la
    // sesión, y ese integrador lo fija la aplicación con la que se autorizó, no
    // esta petición. Cambiar la cabecera no lo arregla: manda el token.
    //
    // Pero GitHub dice en el propio error qué modelos sí tiene. Cuando eso pasa
    // se reintenta una vez con uno de los suyos, en vez de devolver un 400 que la
    // persona no puede resolver desde los ajustes.
    if (copilot && upstream.status === 400) {
      const text = await upstream.clone().text().catch(() => "");
      const allowed = allowedModelsFromError(text);
      const integrator = integratorFromError(text);
      const replacement = allowed?.find((id) => id !== copilotModel);

      if (allowed && replacement) {
        const second = await call({ ...payload, model: replacement });
        if (second.ok) {
          console.warn(
            `[ai-chat] copilot: «${copilotModel}» no está en el integrador ` +
            `«${integrator ?? "?"}»; se usó «${replacement}» de los ${allowed.length} que sí tiene.`,
          );
          upstream = second;
        }
      }
    }

    // Un 429 de OpenCode se explica antes de reenviarlo: su cuerpo dice «cuota»
    // incluso cuando lo que pasó es que el cuerpo no tenía la forma exigida.
    // Confundirlos cuesta horas de espera a un reintento que no puede funcionar.
    if (opencode && upstream.status === 429) {
      const diagnosis = diagnose429(sent);
      if (diagnosis.shape) {
        // Se deja rastro de lo que el proveedor dijo de verdad, que no se ve
        // desde fuera porque el mensaje se reescribe.
        console.error("[ai-chat]", target.id, "rechazado:", diagnosis.message);
        res.status(429).json({ error: "opencode_gate", message: diagnosis.message });
        return;
      }
    }

    // Un 403 con la clave buena suele ser el workspace: o caducó, o la clave se
    // movió de cuenta. Se olvida el cacheado para que el siguiente intento lo
    // vuelva a preguntar, en vez de arrastrar un valor muerto una hora más.
    if (opencode && upstream.status === 403 && key) {
      resetOrgId(key);
      resetSession(key);
    }

    // free-pi tiene dos fallos con nombre propio y los dos se arreglan desde los
    // ajustes, así que se explican en vez de reenviar `concurrent_session` tal
    // cual. El 409 no gasta cuota: es el cupo de cuatro sesiones simultáneas.
    if (freepi && !upstream.ok && upstream.status === 409) {
      resetFreePiSession(key);
      res.status(409).json({
        error: "freepi_sessions",
        message:
          "free-pi admite cuatro sesiones a la vez y están ocupadas (cuenta también " +
          "el CLI si lo tienes abierto). Se ha pedido un hueco nuevo: reintenta en " +
          "unos segundos o cierra otra sesión. Esto no gasta cuota.",
      });
      return;
    }

    if (freepi && !upstream.ok && upstream.status === 401) {
      res.status(401).json({
        error: "freepi_login",
        message:
          "free-pi rechazó la credencial. No es una clave de API: es el token del " +
          "login con GitHub del CLI de free-pi y caduca a los ~90 días. Vuelve a " +
          "iniciar sesión con el CLI y pega el token nuevo en los ajustes del asistente.",
      });
      return;
    }

    if (gated && stream && upstream.ok) {
      await pipeStream(upstream, res, (text) => restoreStreamNames(text, gated.tools));
      return;
    }

    // free-pi manda el pensamiento en `reasoning_content` y, si el presupuesto se
    // agota pensando, deja `content` vacío. Se devuelve el razonamiento en vez de
    // una respuesta en blanco; el detalle está en `pipeFreePiStream`.
    if (freepi && stream && upstream.ok) {
      await pipeFreePiStream(upstream, res);
      return;
    }

    if (!gated && !freepi && stream && upstream.ok) {
      await (target.format === "anthropic"
        ? pipeAnthropicStream(upstream, res)
        : pipeStream(upstream, res));
      return;
    }

    const data = await upstream.text();
    const type = upstream.headers.get("content-type");

    if (upstream.ok && target.format === "anthropic") {
      try {
        res.status(200).json(fromAnthropicReply(JSON.parse(data)));
        return;
      } catch {
        // Un 200 que no es JSON. Sigue por abajo, que ya sabe contarlo.
      }
    }

    // La respuesta vuelve con los alias `fn_*_ex` que puso la puerta. Quien llamó
    // no conoce ninguno: se le devuelven con su nombre de siempre.
    if (gated && upstream.ok) {
      try {
        res.status(200).json(restoreNames(JSON.parse(data), gated.tools));
        return;
      } catch {
        // No era JSON: lo de abajo lo cuenta sin reinterpretarlo.
      }
    }

    // Una respuesta de free-pi con `content` vacío y `reasoning_content` lleno
    // se entrega con el razonamiento en su sitio: llegar en blanco no explica
    // nada a quien preguntó.
    if (freepi && upstream.ok) {
      try {
        const parsed = JSON.parse(data) as { choices?: { message?: Record<string, unknown> }[] };
        const message = parsed.choices?.[0]?.message;
        if (message) {
          message.content = replyText(message);
          res.status(200).json(parsed);
          return;
        }
      } catch {
        // No era JSON: lo de abajo lo reenvía sin tocarlo.
      }
    }

    // Un fallo en JSON se reenvía tal cual: es lo único que explica de verdad un
    // 429 o un 402. Uno que no es JSON —una página de error de un cortafuegos,
    // por ejemplo— se resume, porque si no acabaría entero en la conversación.
    if (!upstream.ok) {
      const message = explainBody(
        upstream.status, target.label, type, data,
        target.custom && target.format === "openai",
      );
      if (message) {
        // El resumen, no el cuerpo: la página de un cortafuegos son kilobytes de
        // HTML y en la terminal sólo tapan lo que venía antes.
        console.error("[ai-chat]", target.id, message);
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

/**
 * Entrega lo que devolvió el binario de OpenCode.
 *
 * El binario es síncrono —se crea una sesión, se espera a que el agente termine y
 * se lee el mensaje—, así que no hay flujo que reenviar. Se emite un SSE con un
 * solo delta para que el cliente vea lo mismo que con un proveedor que sí
 * transmite: si se devolviera JSON cuando se pidió flujo, el navegador no
 * pintaría nada.
 */
async function sendOcReply(
  res: ApiResponse,
  reply: { text: string; model: string },
  stream: boolean,
): Promise<void> {
  if (!stream) {
    res.status(200).json({
      id: "chatcmpl-opencode",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: reply.model,
      choices: [{ index: 0, message: { role: "assistant", content: reply.text }, finish_reason: "stop" }],
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-opencode",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: reply.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  res.write(chunk({ role: "assistant", content: reply.text }, null));
  res.write(chunk({}, "stop"));
  res.write("data: [DONE]\n\n");
  res.end();
}

export default handler;
