import { keyHeaders, apiError } from "./wire.ts";
import type { AiModel, ProviderId } from "./types.ts";

/**
 * El catálogo de modelos del proveedor, con memoria.
 *
 * Se guarda una hora: la lista de OpenRouter son cientos de entradas y no cambia
 * de un minuto a otro, y abrir la pestaña IA no debería costar una petición. El
 * botón «Actualizar» fuerza la relectura.
 */

const TTL_MS = 60 * 60 * 1000;
const PREFIX = "3i.ai.models.";

export interface Catalog {
  defaultModel: string;
  models: AiModel[];
}

interface Cached extends Catalog {
  /** Marca de tiempo de cuando se leyó. */
  at: number;
}

const memory = new Map<ProviderId, Cached>();

function fromStorage(provider: ProviderId): Cached | null {
  try {
    const raw = localStorage.getItem(PREFIX + provider);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cached>;
    if (!Array.isArray(parsed.models) || typeof parsed.at !== "number") return null;
    return {
      at: parsed.at,
      defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : "",
      models: parsed.models as AiModel[],
    };
  } catch {
    return null;
  }
}

function save(provider: ProviderId, cached: Cached): void {
  memory.set(provider, cached);
  try {
    localStorage.setItem(PREFIX + provider, JSON.stringify(cached));
  } catch {
    // La cuota puede estar llena por catálogos anteriores; queda la memoria.
  }
}

/** Lo que hay guardado, sin mirar si ha caducado. Sirve para pintar ya. */
export function cachedCatalog(provider: ProviderId): Catalog | null {
  const cached = memory.get(provider) ?? fromStorage(provider);
  if (!cached) return null;
  memory.set(provider, cached);
  return { defaultModel: cached.defaultModel, models: cached.models };
}

export function forgetCatalog(provider: ProviderId): void {
  memory.delete(provider);
  try {
    localStorage.removeItem(PREFIX + provider);
  } catch { /* nada que borrar */ }
}

export interface ListOptions {
  force?: boolean;
  signal?: AbortSignal;
}

export async function listModels(
  provider: ProviderId,
  options: ListOptions = {},
): Promise<Catalog> {
  if (!options.force) {
    const cached = memory.get(provider) ?? fromStorage(provider);
    if (cached && Date.now() - cached.at < TTL_MS) {
      memory.set(provider, cached);
      return { defaultModel: cached.defaultModel, models: cached.models };
    }
  }

  const response = await fetch(`/api/ai-models?provider=${encodeURIComponent(provider)}`, {
    headers: { Accept: "application/json", ...keyHeaders(provider) },
    signal: options.signal,
  });

  if (!response.ok) throw await apiError(response);

  const data = await response.json() as { defaultModel?: unknown; models?: unknown };
  const catalog: Catalog = {
    defaultModel: typeof data.defaultModel === "string" ? data.defaultModel : "",
    models: Array.isArray(data.models) ? data.models as AiModel[] : [],
  };

  // Un catálogo vacío no se guarda: sería una hora sin poder elegir modelo por
  // un fallo momentáneo del proveedor.
  if (catalog.models.length > 0) save(provider, { ...catalog, at: Date.now() });
  return catalog;
}
