/**
 * El catálogo de modelos del proveedor activo.
 *
 * `GET /api/ai-models?provider=openrouter`
 *
 * La lista se pide siempre al proveedor: aquí no hay ningún archivo con modelos
 * que alguien tenga que ir actualizando. Lo que sí hace falta es traducir, porque
 * cada API contesta con una forma distinta (y GitHub, con dos según el tipo de
 * cuenta); traduciéndolas en el servidor, el cliente tiene una sola forma y el
 * selector de modelo no sabe con quién está hablando.
 *
 * Y hace falta completar. Varios proveedores devuelven identificadores desnudos
 * —NVIDIA, `qwen/qwen3-next-80b-a3b-instruct` y nada más—, así que lo que dicen
 * se cruza con el registro público de `_registry.ts`: de ahí salen el nombre
 * legible, la ventana de contexto, si es gratis y si razona. Cuando un endpoint
 * no ofrece `/models` —le pasa a muchas APIs propias— el registro es la lista.
 */

import type { ApiHandler } from "./_types.ts";
import {
  describe, fetchWithFallback, noStore, readTarget, resolveKey, type Target,
} from "./_ai.ts";
import { registryByApi, registryProvider, type RegistryProvider } from "./_registry.ts";

export interface AiModel {
  id: string;
  name: string;
  publisher: string;
  /** Ventana de contexto en tokens, si se conoce. */
  ctx?: number;
  /** Cierto sólo cuando consta que no cuesta nada. */
  free?: boolean;
  reasoning?: boolean;
}

/** Saca la lista de donde la haya puesto el proveedor. */
function listOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return Object.values(payload as Record<string, unknown>)
    .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function beforeSlash(id: string, fallback: string): string {
  const cut = id.indexOf("/");
  return cut > 0 ? id.slice(0, cut) : fallback;
}

function size(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function mapOpenRouter(entry: Record<string, unknown>): AiModel | null {
  const id = str(entry.id);
  if (!id) return null;
  const pricing = entry.pricing as { prompt?: string; completion?: string } | undefined;
  const free = pricing?.prompt === "0" && pricing?.completion === "0";
  const model: AiModel = {
    id,
    name: str(entry.name) || id,
    publisher: beforeSlash(id, "OpenRouter"),
  };
  const ctx = size(entry.context_length);
  if (ctx) model.ctx = ctx;
  if (free) model.free = true;
  return model;
}

/** La forma corriente de `/v1/models`: NVIDIA, Ollama y casi cualquier API propia. */
function mapOpenAiLike(entry: Record<string, unknown>, fallbackPublisher: string): AiModel | null {
  const id = str(entry.id) || str(entry.name);
  if (!id) return null;
  const model: AiModel = {
    id,
    // Sin nombre legible se deja el identificador: el registro lo mejorará si lo
    // conoce, y si no, más vale el identificador exacto que una invención.
    name: str(entry.display_name) || str(entry.name) || id,
    publisher: str(entry.owned_by) || beforeSlash(id, fallbackPublisher),
  };
  const ctx = size(entry.context_length) ?? size(entry.max_model_len);
  if (ctx) model.ctx = ctx;
  return model;
}

function mapGithub(entry: Record<string, unknown>): AiModel | null {
  const id = str(entry.id) || str(entry.model) || str(entry.name);
  if (!id) return null;

  // Forma de la API de Copilot: dice qué modelos puede elegir la persona.
  if ("model_picker_enabled" in entry || "policy" in entry) {
    const policy = entry.policy as { state?: string } | undefined;
    if (entry.model_picker_enabled === false || policy?.state === "disabled") return null;

    // Copilot enumera también modelos que sólo atienden `/responses` o el
    // formato de Anthropic. Ofrecerlos daría un 404 al primer mensaje.
    const endpoints = entry.supported_endpoints;
    if (Array.isArray(endpoints) && !endpoints.includes("/chat/completions")) return null;

    const capabilities = entry.capabilities as {
      family?: string;
      limits?: { max_context_window_tokens?: unknown };
    } | undefined;
    const model: AiModel = {
      id,
      name: str(entry.name) || id,
      publisher: str(capabilities?.family) || "Copilot",
    };
    const ctx = size(capabilities?.limits?.max_context_window_tokens);
    if (ctx) model.ctx = ctx;
    return model;
  }

  // Forma del catálogo de GitHub Models.
  return {
    id,
    name: str(entry.friendly_name) || str(entry.name) || id,
    publisher: str(entry.publisher) || str(entry.provider) || "GitHub Models",
  };
}

function mapperFor(target: Target): (entry: Record<string, unknown>) => AiModel | null {
  if (target.id === "openrouter") return mapOpenRouter;
  if (target.id === "github") return mapGithub;
  const fallback = target.id === "nvidia" ? "NVIDIA" : target.label;
  return (entry) => mapOpenAiLike(entry, fallback);
}

/** El proveedor del registro que corresponde a este destino, si lo hay. */
async function registryFor(target: Target): Promise<RegistryProvider | null> {
  if (target.registry) {
    const found = await registryProvider(target.registry);
    if (found) return found;
  }
  if (target.custom && target.base) return await registryByApi(target.base);
  return null;
}

/** Añade lo que el proveedor no dijo. Nunca sustituye lo que sí dijo. */
function enrich(model: AiModel, reg: RegistryProvider | null): AiModel {
  if (!reg || !Object.hasOwn(reg.models, model.id)) return model;
  const meta = reg.models[model.id];
  if (!meta) return model;

  const merged: AiModel = { ...model };
  if (merged.name === merged.id && meta.name) merged.name = meta.name;
  if (!merged.ctx && meta.ctx) merged.ctx = meta.ctx;
  if (merged.free === undefined && meta.free) merged.free = true;
  if (meta.reasoning) merged.reasoning = true;
  return merged;
}

/** La lista del registro, cuando el proveedor no da ninguna. */
function fromRegistry(reg: RegistryProvider): AiModel[] {
  return Object.values(reg.models).map((meta) => {
    const model: AiModel = {
      id: meta.id,
      name: meta.name,
      publisher: beforeSlash(meta.id, reg.name),
    };
    if (meta.ctx) model.ctx = meta.ctx;
    if (meta.free) model.free = true;
    if (meta.reasoning) model.reasoning = true;
    return model;
  });
}

function order(models: AiModel[]): AiModel[] {
  const seen = new Set<string>();
  const unique = models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
  unique.sort((a, b) => a.publisher.localeCompare(b.publisher) || a.name.localeCompare(b.name));
  return unique;
}

const handler: ApiHandler = async (req, res) => {
  noStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed", message: "Usa GET." });
    return;
  }

  const found = readTarget(req, req.query.provider);
  if (!found.ok) {
    res.status(400).json({ error: found.code, message: found.message });
    return;
  }
  const target = found.target;

  const key = resolveKey(req, target);
  // Un proveedor propio puede no querer clave —Ollama y LM Studio no la piden—,
  // así que no se le exige aquí: si hace falta, contestará él mismo con un 401.
  if (!key && !target.publicCatalog && !target.custom) {
    res.status(401).json({
      error: "missing_key",
      message: `Falta la credencial de ${target.label}.`,
    });
    return;
  }

  const headers: Record<string, string> = { Accept: "application/json", ...target.headers };
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const upstream = await fetchWithFallback(target.modelUrls, { headers }, {
      noRedirect: target.custom,
    });
    const payload = upstream.ok ? await upstream.json().catch(() => null) : null;

    const map = mapperFor(target);
    const reg = await registryFor(target);
    let models: AiModel[] = [];
    if (payload) {
      for (const entry of listOf(payload)) {
        const model = map(entry);
        if (model) models.push(enrich(model, reg));
      }
    }
    let source = "provider";
    let notice = "";

    // El registro es la red de seguridad, no la primera opción: sólo entra cuando
    // el proveedor no contestó o no dio ningún modelo. Y se dice de dónde salió la
    // lista, porque una lista que el proveedor no reconoce puede dar un 404 al
    // primer mensaje y eso hay que poder entenderlo.
    if (models.length === 0 && reg) {
      models = fromRegistry(reg);
      source = "registry";
      notice = upstream.ok
        ? `${target.label} no devolvió ningún modelo; la lista viene del registro público.`
        : `${target.label} respondió ${upstream.status}; la lista viene del registro público.`;
    }

    if (models.length === 0) {
      if (!upstream.ok) {
        res.status(upstream.status).json({
          error: "provider_error",
          message: `${target.label} respondió ${upstream.status}.`,
          detail: await upstream.text().then((text) => text.slice(0, 600)).catch(() => null),
        });
        return;
      }
      res.status(200).json({ provider: target.id, source, defaultModel: "", models: [] });
      return;
    }

    models = order(models);
    // Un modelo por defecto que no está en el catálogo de hoy sobra: preseleccionarlo
    // haría que el primer mensaje fallara sin motivo aparente.
    const fallback = models.some((model) => model.id === target.defaultModel)
      ? target.defaultModel
      : "";

    res.status(200).json({
      provider: target.id,
      source,
      ...(notice ? { notice } : {}),
      defaultModel: fallback,
      models,
    });
  } catch (error) {
    console.error("[ai-models]", target.id, describe(error));
    res.status(502).json({ error: "provider_unreachable", message: describe(error) });
  }
};

export default handler;
