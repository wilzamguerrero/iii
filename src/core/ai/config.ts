import { createStore } from "../store.ts";
import {
  BUILTIN_IDS, CUSTOM_PREFIX, isBuiltin, isCustom, PROVIDERS,
  type BuiltinId, type CustomProvider, type ProviderId,
} from "./types.ts";

/**
 * Los ajustes de IA: qué proveedor está activo, qué modelo se eligió en cada uno,
 * la credencial de cada uno y los proveedores que la persona haya añadido.
 * Sobreviven a la recarga en `localStorage`.
 *
 * El modelo se guarda por proveedor a propósito: cambiar de proveedor para mirar
 * su catálogo y volver no debe perder la elección anterior.
 *
 * Sobre guardar la clave en el navegador: vale la misma advertencia que para el
 * token de Notion (`core/persist/session.ts`). Queda expuesta a un XSS. Quien
 * prefiera no correr ese riesgo puede no ponerla aquí y dejarla en el entorno del
 * servidor (`OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `GITHUB_AI_TOKEN`): entonces
 * el navegador nunca la ve y `/api/health` sólo dice que existe. Los proveedores
 * propios no tienen esa segunda vía: su clave vive aquí o no hay clave.
 */

const KEY = "3i.ai.config";

export interface AiConfig {
  provider: ProviderId;
  /** Modelo elegido, por proveedor. */
  models: Record<string, string>;
  /** Credencial pegada en el navegador, por proveedor. */
  keys: Record<string, string>;
  /** Los proveedores que añadió la persona. */
  custom: CustomProvider[];
}

const EMPTY: AiConfig = { provider: "openrouter", models: {}, keys: {}, custom: [] };

/** Un identificador aceptable: uno de los de casa o `custom:` y un nombre corto. */
function isProvider(value: unknown): value is ProviderId {
  if (typeof value !== "string") return false;
  if (isBuiltin(value)) return true;
  return /^custom:[a-z0-9][a-z0-9-]{0,39}$/.test(value);
}

/** Se queda con las entradas que son de un proveedor conocido y traen texto. */
function pick(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isProvider(id) && typeof raw === "string" && raw) out[id] = raw;
  }
  return out;
}

/**
 * Un nombre de cabecera que se puede guardar. Quien decide de verdad es
 * `safeHeaderName` en el servidor —y ahí está también la lista de las prohibidas—;
 * esto sólo evita guardar algo que nunca va a poder viajar.
 */
export const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

/**
 * Las cabeceras que se pueden guardar, sin las que no.
 *
 * El valor tiene que ser ASCII imprimible, y no por gusto: es lo que garantiza
 * que `X-Ai-Headers` viaje como JSON plano sin tener que escapar nada. Una
 * comilla curva pegada de una documentación se rechaza aquí, donde se puede
 * explicar, en vez de convertirse en una cabecera ilegal más adelante.
 */
export const HEADER_VALUE = /^[\t\x20-\x7e]+$/;

function pickHeaders(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!HEADER_NAME.test(name)) continue;
    if (typeof raw !== "string" || !HEADER_VALUE.test(raw.trim())) continue;
    out[name] = raw.trim();
  }
  return out;
}

function pickCustom(value: unknown): CustomProvider[] {
  if (!Array.isArray(value)) return [];
  const out: CustomProvider[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const { id, label, baseUrl, registry, keyHeader, headers } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !isCustom(id) || !isProvider(id) || seen.has(id)) continue;
    if (typeof baseUrl !== "string" || !baseUrl.trim()) continue;
    seen.add(id);
    const entry: CustomProvider = {
      id,
      label: typeof label === "string" && label.trim() ? label.trim() : id.slice(CUSTOM_PREFIX.length),
      baseUrl: baseUrl.trim(),
    };
    if (typeof registry === "string" && registry) entry.registry = registry;
    if (typeof keyHeader === "string" && HEADER_NAME.test(keyHeader)) entry.keyHeader = keyHeader;
    const extra = pickHeaders(headers);
    if (Object.keys(extra).length > 0) entry.headers = extra;
    out.push(entry);
  }
  return out;
}

function read(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    const custom = pickCustom(parsed.custom);
    const provider = isProvider(parsed.provider) ? parsed.provider : EMPTY.provider;
    return {
      // Si el proveedor activo era uno propio que ya no está, se vuelve al primero
      // de casa en vez de quedarse apuntando a nada.
      provider: isCustom(provider) && !custom.some((entry) => entry.id === provider)
        ? EMPTY.provider
        : provider,
      models: pick(parsed.models),
      keys: pick(parsed.keys),
      custom,
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

/* --- proveedores propios --------------------------------------------------- */

export function customProviders(): readonly CustomProvider[] {
  return aiConfig.get().custom;
}

export function customProvider(id: ProviderId): CustomProvider | null {
  return aiConfig.get().custom.find((entry) => entry.id === id) ?? null;
}

/** Todos los identificadores en el orden en que se pintan. */
export function providerIds(): ProviderId[] {
  return [...BUILTIN_IDS, ...customProviders().map((entry) => entry.id)];
}

export function providerLabel(id: ProviderId = activeProvider()): string {
  if (isBuiltin(id)) return PROVIDERS[id].label;
  return customProvider(id)?.label ?? id.replace(CUSTOM_PREFIX, "");
}

/** De un nombre cualquiera, un identificador que quepa en `custom:<slug>`. */
function slugify(label: string): string {
  const slug = label.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return slug || "api";
}

export interface NewProvider {
  label: string;
  baseUrl: string;
  /** Identificador en models.dev, si se eligió del directorio. */
  registry?: string;
  /** Cabecera por la que va la clave, si no es `Authorization: Bearer`. */
  keyHeader?: string;
  /** Cabeceras extra que pide esa API. */
  headers?: Record<string, string>;
}

/**
 * Añade un proveedor y lo deja activo. Devuelve su identificador.
 *
 * La URL no se valida aquí más que por encima: quien decide si vale es
 * `safeBase` en el servidor, y duplicar esa política en el navegador sería
 * tenerla en dos sitios y que se separen.
 */
export function addCustomProvider(entry: NewProvider): string {
  const base = slugify(entry.label || entry.registry || "api");
  const taken = new Set(customProviders().map((provider) => provider.id));
  let id = CUSTOM_PREFIX + base;
  for (let n = 2; taken.has(id); n += 1) id = `${CUSTOM_PREFIX}${base}-${n}`;

  const provider: CustomProvider = {
    id,
    label: entry.label.trim() || base,
    baseUrl: entry.baseUrl.trim(),
  };
  if (entry.registry) provider.registry = entry.registry;
  if (entry.keyHeader) provider.keyHeader = entry.keyHeader;
  if (entry.headers && Object.keys(entry.headers).length > 0) provider.headers = entry.headers;

  aiConfig.set((current) => ({ ...current, custom: [...current.custom, provider], provider: id }));
  return id;
}

export function updateCustomProvider(id: string, patch: Partial<NewProvider>): void {
  aiConfig.set((current) => ({
    ...current,
    custom: current.custom.map((entry) => entry.id !== id ? entry : {
      ...entry,
      ...(patch.label !== undefined ? { label: patch.label.trim() || entry.label } : {}),
      ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl.trim() || entry.baseUrl } : {}),
      ...(patch.registry !== undefined ? { registry: patch.registry } : {}),
      ...(patch.keyHeader !== undefined ? { keyHeader: patch.keyHeader } : {}),
      ...(patch.headers !== undefined ? { headers: patch.headers } : {}),
    }),
  }));
}

/** Lo quita con su clave y su modelo: dejarlos sería guardar una clave huérfana. */
export function removeCustomProvider(id: string): void {
  aiConfig.set((current) => {
    const keys = { ...current.keys };
    const models = { ...current.models };
    delete keys[id];
    delete models[id];
    return {
      provider: current.provider === id ? "openrouter" : current.provider,
      models,
      keys,
      custom: current.custom.filter((entry) => entry.id !== id),
    };
  });
}

/* --- lo que dice el servidor ----------------------------------------------- */

/**
 * Qué proveedores tienen clave en el entorno del servidor. Lo dice
 * `/api/health`; `null` mientras no se ha preguntado.
 */
export const serverKeys = createStore<Partial<Record<BuiltinId, boolean>> | null>(null);

/**
 * Hasta dónde admite el servidor los proveedores propios: `local` (también los de
 * la máquina), `public` (sólo https hacia fuera) u `off`. `null` mientras no se ha
 * preguntado; se supone que sí hasta saberlo.
 */
export const customPolicy = createStore<"off" | "public" | "local" | null>(null);

let probed = false;

/** Pregunta una vez por sesión. Si falla, se queda en `null` y no se insiste. */
export async function probeServerKeys(): Promise<void> {
  if (probed) return;
  probed = true;
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json() as { config?: { ai?: unknown; aiCustom?: unknown } };
    serverKeys.set(pickFlags(data.config?.ai));
    const policy = data.config?.aiCustom;
    if (policy === "off" || policy === "public" || policy === "local") customPolicy.set(policy);
  } catch {
    // Sin health no se puede afirmar nada; los ajustes pedirán la clave.
  }
}

function pickFlags(value: unknown): Partial<Record<BuiltinId, boolean>> {
  if (typeof value !== "object" || value === null) return {};
  const out: Partial<Record<BuiltinId, boolean>> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isBuiltin(id) && typeof raw === "boolean") out[id] = raw;
  }
  return out;
}

/**
 * Cierto si la petición va a poder autenticarse: clave aquí o en el servidor. Un
 * proveedor propio puede no necesitar ninguna —Ollama o LM Studio no la piden—,
 * así que basta con tenerlo dado de alta.
 */
export function hasCredential(provider: ProviderId = activeProvider()): boolean {
  if (isCustom(provider)) return customProvider(provider) !== null;
  return Boolean(browserKey(provider) ?? (isBuiltin(provider) && serverKeys.get()?.[provider]));
}

/** Si el usuario cambia los ajustes en otra pestaña, esta se entera. */
window.addEventListener("storage", (event) => {
  if (event.key === KEY) aiConfig.set(read());
});
