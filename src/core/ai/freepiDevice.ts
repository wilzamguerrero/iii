import { apiError } from "./wire.ts";

/**
 * El alta en free-pi, vista desde el navegador.
 *
 * Es el flujo de dispositivo de GitHub tal como lo orquesta free-pi: su backend
 * da un código, la persona lo teclea en github.com, acepta el aviso de anuncios
 * y entrenamiento, y aquí se recoge el JWT. No hace falta instalar el CLI ni
 * pegar nada a mano, que era la única vía antes de esto.
 *
 * La lógica de los tres pasos vive en el servidor (`api/_freepi_device.ts`); aquí
 * sólo se ordena la conversación: pedir código, pedir consentimiento, sondear.
 */

const ENDPOINT = "/api/freepi-device";
const DEFAULT_INTERVAL_S = 5;
/** Margen sobre cada espera, como en el alta de GitHub: la red adelanta. */
const MARGIN_MS = 1_500;

export interface FreePiStart {
  sessionId: string;
  /** El código corto que se teclea en GitHub. */
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** Segundos hasta que caduca el código. */
  expiresIn: number;
  /** Segundos que pide esperar entre sondeos. */
  interval: number;
  /** El aviso que hay que aceptar, para enseñarlo antes del botón. */
  consentText: string;
}

async function post(body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await apiError(response);
  return await response.json() as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function seconds(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Paso 1: el código y el aviso que hay que aceptar. */
export async function startFreePiFlow(signal?: AbortSignal): Promise<FreePiStart> {
  const data = await post({ step: "start" }, signal);

  const sessionId = text(data.session_id);
  const userCode = text(data.user_code);
  if (!sessionId || !userCode) {
    throw new Error(text(data.message) || "free-pi no devolvió ningún código.");
  }

  return {
    sessionId,
    userCode,
    verificationUri: text(data.verification_uri) || "https://github.com/login/device",
    verificationUriComplete: text(data.verification_uri_complete) || text(data.verification_uri),
    expiresIn: seconds(data.expires_in, 900),
    interval: Math.max(3, seconds(data.interval, DEFAULT_INTERVAL_S)),
    consentText: text(data.consent_text),
  };
}

/** Paso 2: registrar el consentimiento. Sin esto el sondeo nunca da token. */
export async function consentFreePi(sessionId: string, signal?: AbortSignal): Promise<void> {
  await post({ step: "consent", session_id: sessionId }, signal);
}

export interface FreePiToken {
  token: string;
  /** Días que le quedan al JWT, si se puede leer su `exp`. */
  days: number | null;
}

/**
 * Paso 3: esperar a que autorice. Resuelve con el token o lanza.
 *
 * El consentimiento se manda antes de empezar a sondear, que es el orden que
 * pide el backend: si se sondea sin él, se recibe `consent_required` en bucle.
 */
export async function waitForFreePiToken(
  start: FreePiStart,
  signal?: AbortSignal,
): Promise<FreePiToken> {
  await consentFreePi(start.sessionId, signal);

  const deadline = Date.now() + start.expiresIn * 1000;
  let wait = start.interval;

  for (;;) {
    await sleep(wait * 1000 + MARGIN_MS, signal);
    if (Date.now() > deadline) throw new Error("El código caducó. Empieza otra vez.");

    const data = await post({ step: "token", session_id: start.sessionId }, signal);
    const status = text(data.status);

    if (status === "token") {
      const token = text(data.token);
      if (!token) throw new Error("free-pi no devolvió ningún token.");
      const days = data.days;
      return { token, days: typeof days === "number" ? days : null };
    }

    if (status === "pending") {
      const asked = seconds(data.retry_after, 0);
      if (asked) wait = Math.max(wait, asked);
      continue;
    }

    if (status === "expired") throw new Error("El código caducó. Empieza otra vez.");
    if (status === "consent") {
      throw new Error(text(data.message) || "free-pi no registró el consentimiento.");
    }
    throw new Error(text(data.message) || "free-pi no devolvió ningún token.");
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Espera cancelada.", "AbortError"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Espera cancelada.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
/* --- quién está conectado ------------------------------------------------- */

/**
 * Qué cuenta hay detrás de un token: usuario de GitHub, nivel y saldo del día.
 *
 * Sin esto, «conectado» no decía a quién. Con varias cuentas de GitHub abiertas
 * en el mismo navegador eso es una pregunta real, y con una sola sigue siendo
 * útil para saber que el token es el que crees.
 */
export interface FreePiAccount {
  /** El usuario de GitHub, sin la arroba. */
  handle: string;
  /** `established`, `new`… según free-pi. */
  tier: string;
  /** Créditos que quedan hoy. */
  remainingCredits: number | null;
  /** Créditos del día completo, para «14843 de 15000». */
  allowanceCredits: number | null;
  /** Días que le quedan al token. */
  days: number | null;
}

/** `null` si free-pi no contesta: la ventana sigue sin el nombre, no se rompe. */
export async function freePiAccount(
  token: string,
  signal?: AbortSignal,
): Promise<FreePiAccount | null> {
  if (!token.trim()) return null;
  try {
    const data = await post({ step: "me", token }, signal);
    const num = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      handle: text(data.handle),
      tier: text(data.tier),
      remainingCredits: num(data.remainingCredits),
      allowanceCredits: num(data.allowanceCredits),
      days: num(data.days),
    };
  } catch {
    return null;
  }
}
