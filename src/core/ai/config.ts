import { createStore } from "../store.ts";
import { PROVIDER_IDS, type ProviderId } from "./types.ts";

/**
 * Los ajustes de IA: qué proveedor está activo, qué modelo se eligió en cada uno
 * y la credencial de cada uno. Sobreviven a la recarga en `localStorage`.
 *
 * El modelo se guarda por proveedor a propósito: cambiar de proveedor para mirar
 * su catálogo y volver no debe perder la elección anterior.
 *
 * Sobre guardar la clave en el navegador: vale la misma advertencia que para el
 * token de Notion (`core/persist/session.ts`). Queda expuesta a un XSS. Quien
 * prefiera no correr ese riesgo puede no ponerla aquí y dejarla en el entorno del
 * servidor (`OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `GITHUB_AI_TOKEN`): entonces
 * el navegador nunca la ve y `/api/health` sólo dice que existe.
 */

const KEY = "3i.ai.config";

export interface AiConfig {
  provider: ProviderId;
  /** Modelo elegido, por proveedor. */
  models: Partial<Record<ProviderId, string>>;
  /** Credencial pegada en el navegador, por proveedor. */
  keys: Partial<Record<ProviderId, string>>;
}

const EMPTY: AiConfig = { provider: "openrouter", models: {}, keys: {} };

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Se queda con las entradas que son de un proveedor conocido y traen texto. */
function pick(value: unknown): Partial<Record<ProviderId, string>> {
  if (typeof value !== "object" || value === null) return {};
  const out: Partial<Record<ProviderId, string>> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isProvider(id) && typeof raw === "string" && raw) out[id] = raw;
  }
  return out;
}

function read(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return {
      provider: isProvider(parsed.provider) ? parsed.provider : EMPTY.provider,
      models: pick(parsed.models),
      keys: pick(parsed.keys),
    };
  } catch {
    return EMPTY;
  }
}

function write(config: AiConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Modo privado o cuota agotada: los ajustes viven en memoria.
  }
}

export const aiConfig = createStore<AiConfig>(read());

aiConfig.subscribe(write);

export function setProvider(provider: ProviderId): void {
  aiConfig.set((current) => ({ ...current, provider }));
}

export function setModel(provider: ProviderId, model: string): void {
  aiConfig.set((current) => ({ ...current, models: { ...current.models, [provider]: model } }));
}

/** Guarda la credencial, o la borra si llega vacía. */
export function setKey(provider: ProviderId, key: string): void {
  const trimmed = key.trim();
  aiConfig.set((current) => {
    const keys = { ...current.keys };
    if (trimmed) keys[provider] = trimmed;
    else delete keys[provider];
    return { ...current, keys };
  });
}

export function clearKey(provider: ProviderId): void {
  setKey(provider, "");
}

export function activeProvider(): ProviderId {
  return aiConfig.get().provider;
}

/** La clave del navegador, si la hay. La del servidor no se ve desde aquí. */
export function browserKey(provider: ProviderId = activeProvider()): string | null {
  return aiConfig.get().keys[provider] ?? null;
}

export function chosenModel(provider: ProviderId = activeProvider()): string | null {
  return aiConfig.get().models[provider] ?? null;
}

/**
 * Qué proveedores tienen clave en el entorno del servidor. Lo dice
 * `/api/health`; `null` mientras no se ha preguntado.
 */
export const serverKeys = createStore<Partial<Record<ProviderId, boolean>> | null>(null);

let probed = false;

/** Pregunta una vez por sesión. Si falla, se queda en `null` y no se insiste. */
export async function probeServerKeys(): Promise<void> {
  if (probed) return;
  probed = true;
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json() as { config?: { ai?: unknown } };
    serverKeys.set(pickFlags(data.config?.ai));
  } catch {
    // Sin health no se puede afirmar nada; la pestaña pedirá la clave.
  }
}

function pickFlags(value: unknown): Partial<Record<ProviderId, boolean>> {
  if (typeof value !== "object" || value === null) return {};
  const out: Partial<Record<ProviderId, boolean>> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isProvider(id) && typeof raw === "boolean") out[id] = raw;
  }
  return out;
}

/** Cierto si la petición va a poder autenticarse: clave aquí o en el servidor. */
export function hasCredential(provider: ProviderId = activeProvider()): boolean {
  return Boolean(browserKey(provider) ?? serverKeys.get()?.[provider]);
}

/** Si el usuario cambia los ajustes en otra pestaña, esta se entera. */
window.addEventListener("storage", (event) => {
  if (event.key === KEY) aiConfig.set(read());
});
