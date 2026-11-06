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
  authHeaders, describe, explainBody, fetchWithFallback, noStore, readTarget, resolveKey,
  type Target,
} from "./_ai.ts";
import { registryByApi, registryProvider, type RegistryProvider } from "./_registry.ts";
import { isOpenCode, openCodeHeaders, resolveOrgId, stripForwardHeaders } from "./_opencode.ts";
import { freepiCatalog, freepiHeaders, isFreePi } from "./_freepi.ts";
import { autoOnlyModels, copilotPlan, usableModels } from "./_copilot.ts";

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

  // En OpenCode el catálogo lleva las mismas cabeceras de identidad que el chat:
  // su cortafuegos bloquea los UA genéricos —el `undici` que pone Node por
  // defecto entre ellos— y el camino `/zen` pide además la sesión. Sin esto, el
  // selector de modelos se queda vacío aunque la clave sea buena.
  const opencode = isOpenCode(target.modelUrls[0] ?? "");
  // GitHub Copilot anuncia en `/models` todo lo que existe, no lo que el plan
  // incluye: mandar uno de pago contesta `model_not_supported`. El plan, y el
  // host que atiende a esta cuenta, se preguntan antes de creerse la lista.
  const copilot = target.id === "github" ? await copilotPlan(key ?? "") : null;
  // free-pi no tiene `/v1/models` —da 404—: su catálogo sale de `/client-version`,
  // el mismo que usa el CLI para pintar el selector. Además hay que anunciar la
  // identidad, como en el chat (`_freepi.ts`).
  const freepi = isFreePi(target.chatUrls[0] ?? "");
  // El workspace, si la clave lo tiene. Sin él el catálogo de OpenCode puede
  // contestar 401 aunque la clave valga: se resuelve igual que en el chat.
  const org = opencode && key ? await resolveOrgId(key) : null;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...authHeaders(key, target),
    ...target.headers,
    ...(opencode ? stripForwardHeaders({ ...target.extra }) : target.extra),
    ...(opencode ? openCodeHeaders(target.modelUrls[0] ?? "", key, org) : {}),
    ...(freepi ? await freepiHeaders(key) : {}),
  };

  try {
    // `autoOnly` se deja para el final, no para aquí. Un plan sin elección lo
    // parece por su nombre, pero quien decide de verdad es el integrador: esta
    // cuenta informa un plan gratuito y aun así tiene cuatro modelos usables.
    // Cortar por el nombre dejaba el selector en «auto» cuando había más.

    const upstream = await fetchWithFallback(target.modelUrls, { headers }, {
      noRedirect: target.custom,
      // Quince segundos por destino: es un catálogo, y quien está mirando los
      // ajustes no puede quedarse con «Cargando…» hasta que la plataforma corte.
      timeoutMs: 15_000,
    });
    const payload = upstream.ok ? await upstream.json().catch(() => null) : null;

    const map = mapperFor(target);
    const reg = await registryFor(target);
    let models: AiModel[] = [];
    if (freepi) {
      // No se usa `listOf` sobre la respuesta en bruto porque `/client-version`
      // trae `{ min, latest, notice, models: [...] }` y cada modelo declara `input`
      // y su coste de uso, que es de donde salen `vision` y `free`.
      const catalog = await freepiCatalog(key);
      if (catalog) {
        models = catalog.models.map((model) => ({
          id: model.id,
          name: model.name,
          publisher: "",
          ...(model.free ? { free: true } : {}),
        }));
      }
    } else if (payload) {
      for (const entry of listOf(payload)) {
        const model = map(entry);
        if (model) models.push(enrich(model, reg));
      }
    }

    // Copilot anuncia en `/models` todo lo que existe, pero el integrador de esta
    // cuenta sólo atiende a una parte, y cualquiera fuera de ella contesta `400`
    // al primer mensaje. Se comprueba de verdad cuáles funcionan: la lista del
    // selector pasa a ser la de los que responden, no la de los que se anuncian.
    let dropped = 0;
    let probe = "no se preguntó";
    if (copilot && key && models.length > 0) {
      const probed = await usableModels(
        key,
        copilot.host,
        models.map((model) => model.id),
      );
      // `null` es «no se supo»: se deja el catálogo como estaba en vez de
      // vaciarlo por un fallo de red o de cuota.
      if (probed) {
        const usable = new Set(probed);
        dropped = models.filter((model) => !usable.has(model.id)).length;
        models = models.filter((model) => usable.has(model.id));
        probe = `dijo ${probed.length}`;
      } else {
        probe = "sin lista";
      }
    }

    // Un catálogo vacío no es un catálogo: Copilot contesta 200 con `data: []` a
    // las cuentas cuyo integrador no anuncia nada, y entonces la única lista que
    // existe es la que la sonda saca del error. Se usa esa, que es la de verdad.
    if (copilot && key && models.length === 0) {
      const probed = await usableModels(key, copilot.host, []);
      probe = probed ? `rescató ${probed.length}` : "sin lista";
      if (probed) {
        models = probed.map((id) => enrich({ id, name: id, publisher: "Copilot" }, reg));
      }
    }
    let source = "provider";
    let notice = dropped > 0
      ? `${dropped} modelo${dropped === 1 ? "" : "s"} no están disponibles para tu sesión de Copilot y se han ocultado.`
      : "";

    // Si tras probarlos no queda ninguno, es que este integrador no tiene nada
    // que ofrecer a `/chat/completions` salvo su propia elección. Ahí sí se cae a
    // `auto`, que es lo único que puede funcionar.
    if (copilot && models.length === 0) {
      const only = autoOnlyModels();
      res.status(200).json({
        provider: target.id,
        source: "provider",
        defaultModel: only[0]?.id ?? "auto",
        models: only,
        // El diagnóstico se cuenta: sin él, «sólo hay uno» puede ser que el
        // catálogo venga vacío, que la sonda no devuelva lista o que el plan
        // venga marcado como sin elección. Son tres problemas distintos y desde
        // fuera se ven igual.
        notice: `Tu sesión de Copilot elige el modelo por ti, así que sólo hay uno.`
          + ` (plan=${copilot.plan || "?"}, catálogo=${upstream.status},`
          + ` leídos=${listOf(payload).length}, sonda=${probe})`,
      });
      return;
    }

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
        const body = await upstream.text().catch(() => "");
        const type = upstream.headers.get("content-type");
        // Si el cuerpo no es de la API —una página de error de un cortafuegos—, se
        // resume en una línea en vez de mandarle 600 caracteres de HTML.
        const plain = explainBody(upstream.status, target.label, type, body);
        res.status(upstream.status).json({
          error: "provider_error",
          message: plain ?? `${target.label} respondió ${upstream.status}.`,
          ...(plain ? {} : { detail: body.slice(0, 600) }),
        });
        return;
      }
      res.status(200).json({ provider: target.id, source, defaultModel: "", models: [] });
      return;
    }

    models = order(models);
    // Un modelo por defecto que no está en el catálogo de hoy sobra: preseleccionarlo
    // haría que el primer mensaje fallara sin motivo aparente.
    //
    // Si no está, se ofrece el primero de la lista en vez de nada. Hay proveedores
    // —OpenCode— donde el modelo favorito cambia con el tiempo, y dejar el
    // selector vacío obliga a elegir a mano algo que la lista ya resuelve. Un
    // modelo que el catálogo acaba de devolver es, por definición, uno que existe.
    const fallback = models.some((model) => model.id === target.defaultModel)
      ? target.defaultModel
      : (models[0]?.id ?? "");

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
