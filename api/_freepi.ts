/**
 * La identidad que free-pi exige antes de contestar.
 *
 * `https://api.freepi.ai/v1` es compatible con OpenAI en el cuerpo —mismos
 * `messages`, mismo `/chat/completions`, mismo flujo SSE—, así que casi todo lo
 * hace el camino normal. Lo que no es normal es **quién llama**:
 *
 * - `Authorization: Bearer <JWT>`: no es una clave de API, es el token del login
 *   por dispositivo de GitHub del CLI de free-pi. Caduca a los ~90 días y cuando
 *   eso pasa el backend contesta 401 y hay que volver a iniciar sesión. Aquí
 *   viaja como la clave del proveedor, que es exactamente lo que es.
 * - `x-session-id`: un uuid **estable**. El backend cuenta las sesiones
 *   concurrentes y corta con `409 concurrent_session` a partir de la cuarta. Una
 *   sesión nueva por petición agota el cupo en cuatro mensajes, así que se fija
 *   por clave y sobrevive a los reinicios de la función.
 * - `x-client-version`: la versión del CLI que se anuncia. Es **opcional** —
 *   medida contra el backend: sin la cabecera responde 200—, pero si se manda y
 *   está por debajo del mínimo contesta `426 upgrade_required` y no deja
 *   trabajar. Por eso el valor se puede apagar (ver [`freepiHeaders`]) y se
 *   autorrepara cuando el backend pide una más nueva.
 *
 * Y dos cosas del cuerpo, que se arreglan en la respuesta y no en la petición:
 * `/v1/models` da 404 (el catálogo sale de `/client-version`) y los modelos de
 * razonamiento mandan el pensamiento en `reasoning_content`, un campo que no
 * está en el estándar y que, si el presupuesto se agota pensando, deja
 * `content` vacío.
 *
 * Todo esto está medido contra el backend real (portal `justdowork/v3`,
 * `portal_app/freepi.py`, 2026-11-01).
 */

/** La versión que se anuncia cuando nadie dice otra cosa. */
const DEFAULT_CLIENT_VERSION = "0.6.10";

/** El host sin `/v1`: ahí viven `/auth/*`, `/me` y `/client-version`. */
export const FREEPI_ROOT = "https://api.freepi.ai";

/** Cierto cuando esta URL base es la de free-pi. */
export function isFreePi(url: string): boolean {
  try {
    return new URL(url).hostname === "api.freepi.ai";
  } catch {
    return false;
  }
}

/**
 * Un uuid **estable** derivado de la clave.
 *
 * No se manda uno aleatorio por petición: el backend cuenta las sesiones
 * simultáneas (cuatro) y una sesión nueva cada vez gasta el cupo en cuatro
 * mensajes. Derivándolo de la clave, la misma credencial cae siempre en el mismo
 * hueco, y dos claves distintas no se pisan. Es uuid5 —el de la norma— y no un
 * número inventado: el backend valida la forma.
 *
 * Se calcula con `crypto.subtle` de Node, que no necesita dependencias.
 */
const sessionCache = new Map<string, string>();

export async function sessionIdFor(key: string | null): Promise<string> {
  // Sin clave (el nivel anónimo, si existiera) se usa una sesión fija por día.
  const seed = key?.trim() || `freepi:anon:${new Date().toISOString().slice(0, 10)}`;

  const cached = sessionCache.get(seed);
  if (cached) return cached;

  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(`freepi:${seed}`),
  );
  const bytes = new Uint8Array(digest);
  // uuid5 = SHA-1 con los cuatro bits de versión y dos de variante forzados.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  sessionCache.set(seed, id);
  return id;
}

/** Se olvida la sesión de esa clave: tras un 409 conviene empezar en otro hueco. */
export function resetSession(key: string | null): void {
  sessionCache.delete(key?.trim() || `freepi:anon:${new Date().toISOString().slice(0, 10)}`);
}

/** La versión de cliente que se va a anunciar. */
let clientVersion = DEFAULT_CLIENT_VERSION;

/**
 * Fija la versión anunciada, o la apaga con `null`.
 *
 * Se apaga con `-` en el valor, igual que el portal: el backend acepta la
 * cabecera a faltar y así un mínimo más nuevo nunca bloquea con un 426
 * mientras se actualiza esto.
 */
export function setClientVersion(version: string | null): void {
  clientVersion = version && version.trim() ? version.trim() : "";
}

/** Las cabeceras propias de free-pi, ya con la sesión resuelta. */
export async function freepiHeaders(key: string | null): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "x-session-id": await sessionIdFor(key) };
  if (clientVersion && !["-", "none", "sin"].includes(clientVersion.toLowerCase())) {
    headers["x-client-version"] = clientVersion;
  }
  return headers;
}

/**
 * El catálogo de modelos, de `/client-version`.
 *
 * `/v1/models` da 404 en free-pi; el CLI pinta su selector con este endpoint, que
 * devuelve `{ min, latest, notice, models: [...] }`. Se devuelven los modelos y,
 * de paso, se corrige la versión anunciada si la nuestra se quedó corta: es un
 * requisito, no una preferencia, y hacerlo aquí evita el 426 de la siguiente
 * petición.
 */
export interface FreePiCatalog {
  models: { id: string; name: string; free: boolean; vision: boolean }[];
  /** La versión que se acaba de anunciar tras leer el catálogo. */
  clientVersion: string;
}

export async function freepiCatalog(key: string | null): Promise<FreePiCatalog | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (clientVersion) headers["x-client-version"] = clientVersion;

  try {
    const response = await fetch(`${FREEPI_ROOT}/client-version`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as Record<string, unknown>;

    // La versión se autorrepara: si estamos por debajo del mínimo, se sube a
    // `latest`. Nunca se baja sola, para no pelear con una versión puesta a mano.
    const latest = typeof payload.latest === "string" ? payload.latest.trim() : "";
    const min = typeof payload.min === "string" ? payload.min.trim() : "";
    if (latest && comparesLower(clientVersion, min)) clientVersion = latest;

    const raw = Array.isArray(payload.models) ? payload.models : [];
    const models = raw.map((entry) => {
      if (typeof entry === "string") return { id: entry, name: entry, free: false, vision: false };
      const model = entry as Record<string, unknown>;
      const id = typeof model.id === "string" ? model.id : "";
      const label = typeof model.name === "string" ? model.name : id;
      const input = Array.isArray(model.input) ? model.input : [];
      return {
        id,
        name: label,
        // `usage` en 0 es «gratis»; los de pago traen un multiplicador (~3x).
        free: model.free === true || model.usage === 0,
        vision: input.includes("image") || model.vision === true,
      };
    }).filter((model) => model.id);

    return { models, clientVersion };
  } catch {
    return null;
  }
}

/** ¿`a` es una versión menor que `b`? Compara por partes numéricas. */
function comparesLower(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Los días que le quedan al JWT, si se pueden leer. `null` si no. */
export function tokenDaysLeft(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))) as {
      exp?: unknown;
    };
    if (typeof json.exp !== "number") return null;
    return Math.max(0, Math.floor((json.exp * 1000 - Date.now()) / 86_400_000));
  } catch {
    return null;
  }
}

/* --- `reasoning_content`: el pensamiento cuando `content` viene vacío ------ */

/**
 * Saca el texto de un mensaje, contando con `reasoning_content`.
 *
 * Los modelos de razonamiento de free-pi devuelven la cadena de pensamiento en
 * `reasoning_content` —campo no estándar— y, si el presupuesto se agota
 * pensando, `content` llega vacío. Devolver la respuesta en blanco sería peor
 * que devolver el razonamiento, así que se usa como respaldo.
 *
 * Cierto sólo cuando el respaldo hace falta: si hay `content`, manda.
 */
export function replyText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  const reasoning = message.reasoning_content;
  if (typeof reasoning === "string" && reasoning.trim()) return reasoning;
  return typeof content === "string" ? content : "";
}

/**
 * Vuelca el flujo de free-pi, con el razonamiento como respaldo.
 *
 * En el flujo el pensamiento llega en trozos de `reasoning_content` y el texto
 * final en trozos de `content`, en el mismo delta o en deltas distintos. No se
 * pueden mezclar a ciegas —acabaría el razonamiento pegado al principio de cada
 * respuesta—, así que:
 *
 * 1. Cada línea `data:` se parsea y se reescribe dejando en `content` lo que
 *    traía (o nada, si sólo venía razonamiento).
 * 2. El razonamiento se acumula aparte.
 * 3. Sólo si el flujo termina **sin un solo carácter de `content`** se emite el
 *    razonamiento como un delta final. Es el caso en que el presupuesto se
 *    agotó pensando: entregar la respuesta en blanco no explicaría nada.
 *
 * El `[DONE]` se retiene hasta el final, porque puede que haya que añadir un
 * delta después de él.
 */
export async function pipeFreePiStream(
  upstream: Response,
  res: { setHeader(name: string, value: string): void; write(chunk: string): void; end(): void },
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const body = upstream.body;
  if (!body) {
    res.end();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let thought = "";
  let answered = false;
  let done = false;
  const flush = (): void => {
    const maybe = res as unknown as { flush?: () => void };
    try { maybe.flush?.(); } catch { /* sin compresión no hay nada que vaciar */ }
  };

  const handle = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) { res.write(line); return; }

    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") { done = true; return; }
    if (!payload) { res.write(line); return; }

    let parsed: { choices?: { delta?: Record<string, unknown> }[] };
    try {
      parsed = JSON.parse(payload) as typeof parsed;
    } catch {
      res.write(line);
      return;
    }

    const delta = parsed.choices?.[0]?.delta;
    if (delta && typeof delta === "object") {
      const content = typeof delta.content === "string" ? delta.content : "";
      const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
      if (content) answered = true;
      if (reasoning && !content) thought += reasoning;
      // El razonamiento no se cuela en `content`: quien pintó la respuesta no
      // pidió ver el pensamiento trozo a trozo, y mezclarlo rompería el texto.
      if (reasoning) delete delta.reasoning_content;
    }

    res.write(`data: ${JSON.stringify(parsed)}\n`);
  };

  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    pending += decoder.decode(value, { stream: true });
    const cut = pending.lastIndexOf("\n");
    if (cut === -1) continue;
    const whole = pending.slice(0, cut + 1);
    pending = pending.slice(cut + 1);
    for (const line of whole.split("\n")) if (line.trim()) handle(line);
    flush();
  }
  if (pending.trim()) handle(pending);

  // Sin respuesta y con razonamiento: se entrega el pensamiento, que es todo lo
  // que hay. Se manda como un delta normal para que el cliente no tenga un caso
  // especial que conocer.
  if (!answered && thought.trim()) {
    res.write(`data: ${JSON.stringify({
      choices: [{ index: 0, delta: { content: thought }, finish_reason: null }],
    })}\n`);
  }

  if (done) res.write("data: [DONE]\n");
  res.end();
}
