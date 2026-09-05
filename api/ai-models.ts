/**
 * El catálogo de modelos del proveedor activo.
 *
 * `GET /api/ai-models?provider=openrouter`
 *
 * La normalización se hace aquí y no en el navegador: las tres APIs devuelven
 * tres formas distintas (y GitHub, dos según el tipo de cuenta). Traduciéndolas
 * en el servidor, el cliente tiene una sola forma y el selector de modelo no
 * sabe con quién está hablando.
 */

import type { ApiHandler } from "./_types.ts";
import {
  describe, fetchWithFallback, noStore, readProvider, resolveKey, type ProviderId,
} from "./_ai.ts";

export interface AiModel {
  id: string;
  name: string;
  publisher: string;
  /** Una pista corta: «gratis», «ctx 128k»… Vale vacía. */
  tag: string;
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

function contextTag(value: unknown): string {
  const size = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";
  return `ctx ${Math.round(size / 1024)}k`;
}

function mapOpenRouter(entry: Record<string, unknown>): AiModel | null {
  const id = str(entry.id);
  if (!id) return null;
  const pricing = entry.pricing as { prompt?: string; completion?: string } | undefined;
  const free = pricing?.prompt === "0" && pricing?.completion === "0";
  return {
    id,
    name: str(entry.name) || id,
    publisher: beforeSlash(id, "OpenRouter"),
    tag: free ? "gratis" : contextTag(entry.context_length),
  };
}

function mapNvidia(entry: Record<string, unknown>): AiModel | null {
  const id = str(entry.id);
  if (!id) return null;
  return {
    id,
    name: id,
    publisher: str(entry.owned_by) || beforeSlash(id, "NVIDIA"),
    tag: "",
  };
}

function mapGithub(entry: Record<string, unknown>): AiModel | null {
  const id = str(entry.id) || str(entry.model) || str(entry.name);
  if (!id) return null;

  // Forma de la API de Copilot: dice qué modelos puede elegir la persona.
  if ("model_picker_enabled" in entry || "policy" in entry) {
    const policy = entry.policy as { state?: string } | undefined;
    if (entry.model_picker_enabled === false || policy?.state === "disabled") return null;
    const capabilities = entry.capabilities as { family?: string } | undefined;
    return {
      id,
      name: str(entry.name) || id,
      publisher: str(capabilities?.family) || "Copilot",
      tag: "",
    };
  }

  // Forma del catálogo de GitHub Models.
  return {
    id,
    name: str(entry.friendly_name) || str(entry.name) || id,
    publisher: str(entry.publisher) || str(entry.provider) || "GitHub Models",
    tag: "",
  };
}

const MAPPERS: Record<ProviderId, (entry: Record<string, unknown>) => AiModel | null> = {
  openrouter: mapOpenRouter,
  nvidia: mapNvidia,
  github: mapGithub,
};

const handler: ApiHandler = async (req, res) => {
  noStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed", message: "Usa GET." });
    return;
  }

  const spec = readProvider(req.query.provider);
  if (!spec) {
    res.status(400).json({ error: "unknown_provider", message: "Proveedor no reconocido." });
    return;
  }

  const key = resolveKey(req, spec);
  if (!key && !spec.publicCatalog) {
    res.status(401).json({
      error: "missing_key",
      message: `Falta la credencial de ${spec.label}.`,
    });
    return;
  }

  const headers: Record<string, string> = { Accept: "application/json", ...spec.headers };
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const upstream = await fetchWithFallback(spec.modelUrls, { headers });
    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: "provider_error",
        message: `${spec.label} respondió ${upstream.status}.`,
        detail: payload,
      });
      return;
    }

    const map = MAPPERS[spec.id];
    const seen = new Set<string>();
    const models: AiModel[] = [];
    for (const entry of listOf(payload)) {
      const model = map(entry);
      if (!model || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
    models.sort((a, b) => a.publisher.localeCompare(b.publisher) || a.name.localeCompare(b.name));

    res.status(200).json({ provider: spec.id, defaultModel: spec.defaultModel, models });
  } catch (error) {
    console.error("[ai-models]", spec.id, describe(error));
    res.status(502).json({ error: "provider_unreachable", message: describe(error) });
  }
};

export default handler;
