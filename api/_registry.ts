/**
 * El registro público de modelos: `models.dev/api.json`.
 *
 * Existe para no tener en el repositorio una lista de modelos que alguien tenga
 * que actualizar a mano. Cada proveedor ya publica su catálogo en `/v1/models`,
 * pero esa lista suele ser sólo identificadores: NVIDIA, por ejemplo, devuelve
 * `qwen/qwen3-next-80b-a3b-instruct` y nada más. El registro añade lo que falta
 * —nombre legible, ventana de contexto, precio, si razona— y sirve además de
 * catálogo cuando un endpoint no ofrece `/models`.
 *
 * Es el mismo registro que usa `reference/opencode-dev`
 * (`packages/core/src/models-dev.ts`), con la misma idea: una sola descarga,
 * caché con caducidad y refresco perezoso. Aquí la caché es de memoria y no de
 * disco porque en Vercel el sistema de archivos de una función es efímero.
 *
 * El JSON son 4,5 MB y 213 proveedores. Al leerlo se recorta de inmediato a lo
 * que esta aplicación usa; lo demás se descarta y no se retiene.
 *
 * Salidas de emergencia, como en el original:
 *   AI_MODELS_URL   otro origen (un espejo, o un archivo servido en la red local)
 *   AI_MODELS_OFF=1 no consultar el registro; se usa sólo lo que diga el proveedor
 *
 * Vercel no despliega como función los archivos de `api/` que empiezan por `_`.
 */

const DEFAULT_URL = "https://models.dev/api.json";
/** Seis horas: el registro cambia cuando sale un modelo, no cada minuto. */
const TTL_MS = 6 * 60 * 60 * 1000;
/** Tras un fallo se espera esto antes de volver a intentarlo. */
const RETRY_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface RegistryModel {
  id: string;
  name: string;
  /** Ventana de contexto en tokens. 0 si el registro no la dice. */
  ctx: number;
  /** Cierto sólo cuando el proveedor publica precios y este modelo es 0. */
  free: boolean;
  reasoning: boolean;
}

export interface RegistryProvider {
  id: string;
  name: string;
  /** URL base de la API, o "" si el registro no la trae. */
  api: string;
  /** Documentación del proveedor, para enlazarla en la pestaña IA. */
  doc: string;
  /** Cierto cuando habla el formato de OpenAI, que es el que sabemos usar. */
  compatible: boolean;
  models: Record<string, RegistryModel>;
}

type Snapshot = Record<string, RegistryProvider>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Recorta un proveedor del registro a lo que aquí se usa. */
function projectProvider(id: string, raw: unknown): RegistryProvider | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const models: Record<string, RegistryModel> = {};

  const rawModels = entry.models;
  if (typeof rawModels === "object" && rawModels !== null) {
    // Un coste de 0 significa «gratis» sólo si el proveedor publica precios: hay
    // proveedores que dejan el coste en 0 porque no lo declaran, y entonces
    // marcar todo como gratuito sería mentir en cada línea de la lista.
    let priced = false;
    for (const value of Object.values(rawModels as Record<string, unknown>)) {
      const cost = (value as { cost?: { input?: unknown; output?: unknown } } | null)?.cost;
      if (num(cost?.input) > 0 || num(cost?.output) > 0) { priced = true; break; }
    }

    for (const [modelId, value] of Object.entries(rawModels as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const model = value as Record<string, unknown>;
      const realId = str(model.id) || modelId;
      const cost = model.cost as { input?: unknown; output?: unknown } | undefined;
      const limit = model.limit as { context?: unknown } | undefined;
      models[realId] = {
        id: realId,
        name: str(model.name) || realId,
        ctx: num(limit?.context),
        free: priced && num(cost?.input) === 0 && num(cost?.output) === 0,
        reasoning: model.reasoning === true,
      };
    }
  }

  return {
    id: str(entry.id) || id,
    name: str(entry.name) || id,
    api: str(entry.api),
    doc: str(entry.doc),
    // `@ai-sdk/openai-compatible` es la etiqueta con la que el registro marca los
    // 173 proveedores que hablan el formato de OpenAI. Los demás —Anthropic,
    // Google, Bedrock— tienen otra API y no valen para `/chat/completions`.
    compatible: str(entry.npm) === "@ai-sdk/openai-compatible",
    models,
  };
}

function project(raw: unknown): Snapshot {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Snapshot = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const provider = projectProvider(id, value);
    if (provider) out[id] = provider;
  }
  return out;
}

let cache: { at: number; data: Snapshot } | null = null;
let failedAt = 0;
/** La descarga en curso, para que diez peticiones a la vez no bajen diez veces. */
let inflight: Promise<Snapshot | null> | null = null;

async function download(): Promise<Snapshot | null> {
  const url = process.env.AI_MODELS_URL?.trim() || DEFAULT_URL;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`models.dev respondió ${response.status}`);
    const data = project(await response.json());
    if (Object.keys(data).length === 0) throw new Error("registro vacío");
    cache = { at: Date.now(), data };
    failedAt = 0;
    return data;
  } catch (error) {
    failedAt = Date.now();
    // No es un fallo de la aplicación: sin registro, la lista de modelos sigue
    // saliendo del proveedor. Se anota una vez y se sigue.
    console.warn("[ai-registry]", error instanceof Error ? error.message : "no se pudo leer");
    return cache?.data ?? null;
  }
}

/**
 * El registro entero, de la caché o de la red. `null` si está desactivado o si
 * no se pudo leer y no había nada guardado.
 */
export async function registry(): Promise<Snapshot | null> {
  if (process.env.AI_MODELS_OFF === "1") return null;

  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  if (!cache && failedAt && now - failedAt < RETRY_MS) return null;

  inflight ??= download().finally(() => { inflight = null; });
  return await inflight;
}

export async function registryProvider(id: string): Promise<RegistryProvider | null> {
  const all = await registry();
  if (!all || !Object.hasOwn(all, id)) return null;
  return all[id] ?? null;
}

/** Compara URLs base ignorando la barra final y un `/v1` de más o de menos. */
function sameApi(a: string, b: string): boolean {
  const trim = (value: string): string =>
    value.toLowerCase().replace(/\/+$/, "").replace(/\/v\d+$/, "");
  return Boolean(a) && trim(a) === trim(b);
}

/** El proveedor del registro que atiende esa URL base, si lo hay. */
export async function registryByApi(base: string): Promise<RegistryProvider | null> {
  const all = await registry();
  if (!all) return null;
  for (const provider of Object.values(all)) {
    if (sameApi(provider.api, base)) return provider;
  }
  return null;
}

export interface DirectoryEntry {
  id: string;
  name: string;
  /** URL base ya rellenada cuando el registro la conoce. */
  api: string;
  doc: string;
  models: number;
}

/**
 * El listado para «añadir un proveedor». Sólo los que hablan el formato de
 * OpenAI: los demás no funcionarían y ofrecerlos sería una trampa.
 */
export async function registryDirectory(exclude: readonly string[]): Promise<DirectoryEntry[]> {
  const all = await registry();
  if (!all) return [];
  const skip = new Set(exclude);
  const out: DirectoryEntry[] = [];
  for (const provider of Object.values(all)) {
    if (skip.has(provider.id) || !provider.compatible) continue;
    out.push({
      id: provider.id,
      name: provider.name,
      api: provider.api,
      doc: provider.doc,
      models: Object.keys(provider.models).length,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
