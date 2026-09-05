import { apiError } from "./wire.ts";

/**
 * El alta por dispositivo de GitHub, vista desde el navegador.
 *
 * Aparece un código, la persona lo escribe en github.com/login/device y aquí se
 * espera preguntando cada pocos segundos. Es el flujo de las herramientas de
 * consola: no hay que registrar una aplicación ni pegar ninguna clave.
 *
 * El `client_id` lo pone el servidor (`api/github-device.ts`); desde aquí no se
 * manda, para que este camino no pueda usarse contra otra aplicación.
 */

const ENDPOINT = "/api/github-device";
const DEFAULT_INTERVAL_S = 5;
/** Lo que GitHub pide añadir al intervalo cuando responde `slow_down`. */
const SLOW_DOWN_S = 5;
/**
 * Margen sobre cada espera. GitHub cuenta el intervalo desde que él respondió,
 * no desde que nosotros preguntamos: sin este colchón, la red hace que una
 * pregunta llegue un pelo antes de tiempo y se pierde un turno con `slow_down`.
 * Es lo que hace la herramienta de referencia (opencode).
 */
const MARGIN_MS = 3_000;

export interface DeviceStart {
  deviceCode: string;
  /** El código corto que la persona escribe en GitHub. */
  userCode: string;
  verificationUri: string;
  /** Segundos hasta que el código caduca. */
  expiresIn: number;
  /** Segundos que GitHub pide esperar entre preguntas. */
  interval: number;
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

export async function startDeviceFlow(signal?: AbortSignal): Promise<DeviceStart> {
  const data = await post({ step: "code" }, signal);

  const deviceCode = text(data.device_code);
  const userCode = text(data.user_code);
  if (!deviceCode || !userCode) {
    throw new Error(text(data.error_description) || "GitHub no devolvió ningún código.");
  }

  return {
    deviceCode,
    userCode,
    verificationUri: text(data.verification_uri) || "https://github.com/login/device",
    expiresIn: seconds(data.expires_in, 900),
    interval: seconds(data.interval, DEFAULT_INTERVAL_S),
  };
}

/**
 * Pregunta hasta que la persona autoriza. Devuelve el token; lanza si se deniega
 * o si caduca. El `signal` es la forma de cancelar la espera.
 */
export async function waitForDeviceToken(
  start: DeviceStart,
  signal?: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + start.expiresIn * 1000;
  let wait = start.interval;

  for (;;) {
    await sleep(wait * 1000 + MARGIN_MS, signal);
    if (Date.now() > deadline) throw new Error("El código caducó. Empieza otra vez.");

    const data = await post({ step: "token", device_code: start.deviceCode }, signal);

    const token = text(data.access_token);
    if (token) return token;

    const error = text(data.error);
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      // Si GitHub dice cuánto esperar, manda él; si no, los cinco segundos suyos.
      const asked = seconds(data.interval, 0);
      wait = asked > wait ? asked : wait + SLOW_DOWN_S;
      continue;
    }
    if (error === "expired_token") throw new Error("El código caducó. Empieza otra vez.");
    if (error === "access_denied") throw new Error("Cancelaste la autorización en GitHub.");
    throw new Error(text(data.error_description) || error || "GitHub no devolvió ningún token.");
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
