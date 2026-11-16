/**
 * El alta en free-pi sin instalar su CLI: el flujo de dispositivo de GitHub.
 *
 * ## Por qué esto existe
 *
 * `api/_freepi.ts` sabe consumir un token (`FREEPI_TOKEN`), pero no había forma
 * de conseguirlo desde la aplicación. La única vía era ejecutar el CLI
 * `npx free-pi-cli`, iniciar sesión y copiar a mano el JWT que deja en
 * `~/.free-pi/agent/credentials.json`. Pedirle eso a quien sólo quiere probar el
 * asistente es pedirle que instale Node, un paquete global y sepa dónde vive un
 * archivo oculto.
 *
 * La alternativa no hay que inventarla: free-pi expone su propia versión del
 * flujo de dispositivo OAuth de GitHub en su host raíz, y es la que usa su CLI.
 * Tres peticiones y el token sale por HTTP normal:
 *
 *   1. `POST /auth/github/device`  `{}`                       → código + enlaces
 *   2. `POST /auth/consent`        `{session_id, version}`    → registra el sí
 *   3. `POST /auth/token`          `{session_id}`             → pending | token
 *
 * Medido contra el backend real (2026-11-16) y calcado del portal de casa
 * (`justdowork/v3`, `portal_app/freepi.py`), que es donde está medido primero.
 *
 * ## El consentimiento no es un trámite
 *
 * El paso 2 no se puede saltar: sin él, el paso 3 contesta `consent_required`
 * para siempre. Y lo que se acepta ahí no es inocuo —anuncios y entrenamiento
 * con los datos—, así que el texto viaja al navegador para que la persona lo lea
 * antes de decir que sí. `consent_version` es la que acepta el CLI actual; si el
 * backend la sube, el error lo dirá.
 *
 * ## Lo que este módulo NO hace
 *
 * No guarda el token en ningún sitio del servidor. Lo devuelve una vez y el
 * navegador decide (hoy: la clave del proveedor en este navegador). Guardarlo
 * aquí obligaría a elegir de quién es, y eso es una decisión de producto que
 * este módulo no tiene por qué tomar.
 */

import { FREEPI_ROOT } from "./_freepi.ts";

/** La versión de consentimiento que acepta el CLI actual. */
export const CONSENT_VERSION = "4";

/**
 * El texto que la persona acepta. No se resume: es lo que firma.
 *
 * Se manda al navegador tal cual para que aparezca antes del botón de aceptar.
 */
export const CONSENT_TEXT =
  "free-pi es gratis. A cambio, muestra anuncios y puede entrenar con tus " +
  "datos. Si quieres usarlo, aceptas eso. Si no, no lo uses.\n" +
  "Debes tener al menos 13 años en EE. UU., 16 en EEE/RU, o 18 en el resto.\n" +
  "Términos: https://freepi.ai/terms   Privacidad: https://freepi.ai/privacy";

/** Lo que devuelve el paso 1, ya normalizado para el cliente. */
export interface DeviceStart {
  sessionId: string;
  /** El código corto que se teclea en GitHub. */
  userCode: string;
  verificationUri: string;
  /** El enlace con el código ya puesto, cuando el backend lo da. */
  verificationUriComplete: string;
  /** Segundos entre sondeos. Nunca menos de 5. */
  interval: number;
  /** Segundos hasta que el código caduca. */
  expiresIn: number;
}

/** El resultado de un sondeo del paso 3. */
export type DevicePoll =
  | { kind: "token"; token: string; days: number | null }
  | { kind: "pending"; retryAfter: number | null }
  | { kind: "consent"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "error"; message: string };

/** Un uuid de sesión de login. El backend lo valida por forma. */
const SESSION_RE = /^[0-9a-fA-F-]{16,64}$/;

export function validSession(sessionId: string): boolean {
  return SESSION_RE.test(sessionId.trim());
}

/** POST JSON al host raíz. Devuelve el estado y el cuerpo ya parseado. */
async function postRoot(
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const response = await fetch(`${FREEPI_ROOT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      // Un cuerpo que no es JSON se queda vacío; el estado ya lo dice todo.
    }
    return { status: response.status, data };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "free-pi no responde.");
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function positive(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Paso 1: pide el código de dispositivo.
 *
 * Lanza si el backend no lo da: sin `session_id` no hay nada que sondear y
 * seguir adelante sólo serviría para fallar más tarde con peor mensaje.
 */
export async function deviceStart(): Promise<DeviceStart> {
  const { status, data } = await postRoot("/auth/github/device", {});

  const sessionId = str(data.session_id).trim();
  const userCode = str(data.user_code).trim();
  if (status !== 200 || !sessionId || !userCode) {
    const message = str(data.message) || str(data.error);
    throw new Error(`free-pi no dio código de dispositivo (HTTP ${status}${message ? `: ${message}` : ""}).`);
  }

  return {
    sessionId,
    userCode,
    verificationUri: str(data.verification_uri) || "https://github.com/login/device",
    verificationUriComplete:
      str(data.verification_uri_complete) || str(data.verification_uri) || "https://github.com/login/device",
    // El backend pide 5; menos de 3 sería maleducado con su límite.
    interval: Math.max(3, positive(data.interval, 5)),
    expiresIn: positive(data.expires_in, 900),
  };
}

/** Paso 2: registra el consentimiento. Lanza si el backend lo rechaza. */
export async function deviceConsent(sessionId: string): Promise<void> {
  if (!validSession(sessionId)) throw new Error("La sesión de login no es válida.");

  const { status, data } = await postRoot("/auth/consent", {
    session_id: sessionId.trim(),
    consent_version: CONSENT_VERSION,
  });

  if (status !== 200) {
    const message = str(data.message) || str(data.error);
    throw new Error(`El consentimiento fue rechazado (HTTP ${status}${message ? `: ${message}` : ""}).`);
  }
}

/**
 * Paso 3: ¿ya autorizó?
 *
 * Devuelve un veredicto en vez de lanzar en los casos esperados —pendiente,
 * caducado, falta consentimiento—, porque el sondeo los recibe muchas veces y
 * lanzar por «todavía no» convertiría el caso normal en una excepción.
 */
export async function devicePoll(sessionId: string): Promise<DevicePoll> {
  if (!validSession(sessionId)) {
    return { kind: "error", message: "La sesión de login no es válida." };
  }

  let status: number;
  let data: Record<string, unknown>;
  try {
    ({ status, data } = await postRoot("/auth/token", { session_id: sessionId.trim() }));
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "Sin respuesta." };
  }

  const token = str(data.token);
  if (token) {
    return { kind: "token", token, days: daysLeft(token) };
  }

  if (str(data.code) === "consent_required") {
    return { kind: "consent", message: str(data.message) || "Falta aceptar el consentimiento." };
  }

  if (status === 410 || str(data.message) === "expired_token") {
    return { kind: "expired", message: "El código caducó. Empieza otra vez." };
  }

  if (status === 200 && str(data.status) === "pending") {
    const retry = Number(data.retry_after);
    return { kind: "pending", retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null };
  }

  return { kind: "error", message: `HTTP ${status}: ${JSON.stringify(data).slice(0, 160)}` };
}

/** Los días que le quedan al JWT. `null` si no se puede leer. */
function daysLeft(token: string): number | null {
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

/* --- quién ha iniciado sesión ------------------------------------------- */

/**
 * La cuenta detrás de un token, para poder decir con cuál estás conectado.
 *
 * `GET /me` es el mismo endpoint que usa el CLI para pintar su panel: devuelve
 * el `handle` de GitHub, el `tier` y el saldo del día. Sin esto, «conectado» no
 * decía a quién, y con varias cuentas de GitHub eso es una pregunta real.
 *
 * No lanza: si el backend no contesta, se devuelve `null` y la ventana sigue
 * funcionando sin el dato. Saber el nombre es una comodidad, no un requisito.
 */
export interface FreePiMe {
  /** El usuario de GitHub, sin la arroba. */
  handle: string;
  /** `established`, `new`… según free-pi. */
  tier: string;
  /** Créditos que quedan hoy, si el backend los dice. */
  remainingCredits: number | null;
  /** Créditos del día completo, para poder enseñar «14843 de 15000». */
  allowanceCredits: number | null;
  /** Días que le quedan al token. */
  days: number | null;
}

export async function freepiMe(token: string | null): Promise<FreePiMe | null> {
  const key = (token ?? "").trim();
  if (!key) return null;

  try {
    const response = await fetch(`${FREEPI_ROOT}/me`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const num = (value: unknown): number | null => {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    };

    return {
      handle: str(data.handle),
      tier: str(data.tier),
      remainingCredits: num(data.remaining_credits_today),
      allowanceCredits: num(data.allowance_credits),
      days: daysLeft(key),
    };
  } catch {
    return null;
  }
}
