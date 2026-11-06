/**
 * GitHub Copilot: qué modelos puede usar de verdad esta cuenta.
 *
 * El problema que resuelve este archivo es concreto y visible: `/models` de
 * Copilot anuncia **todo** el catálogo, incluidos los modelos de pago, aunque el
 * plan de la cuenta no los incluya. La documentación de GitHub lo dice al revés
 * de como uno lo esperaría:
 *
 *   > A model the plan does not include answers `model_not_supported`, **even
 *   > when `/models` lists it**.
 *
 * Así que una lista sacada de `/models` no es la lista de lo que funciona: es la
 * lista de lo que existe. En un plan sin pago eso se nota el doble, porque ahí
 * **no se elige modelo**: GitHub decide por ti y lo llama «auto model selection».
 * Eso es lo que enseña VS Code —una sola entrada, «Auto»— y lo que esta
 * aplicación tiene que enseñar también.
 *
 * ── Por qué no basta con mirar el nombre del plan ────────────────────────────
 *
 * La primera versión comparaba `copilot_plan === "free"` y no filtraba nada,
 * porque una cuenta sin pago puede informar `individual` en vez de `free`, y
 * entonces la comparación falla en silencio. Aquí se decide por **varios
 * indicios a la vez** y, ante la duda, se prefiere `auto`: ofrecer un modelo que
 * va a contestar `model_not_supported` es peor que ofrecer uno que funciona
 * siempre, porque `auto` lo elige GitHub y nunca falla por plan.
 *
 * Los indicios, de más a menos fiable:
 *
 *   1. `access_type_sku` — lo que la cuenta compró. `free`/`individual` sin
 *      suscripción de pago viene sin el sufijo de plan de pago.
 *   2. `copilot_plan` — el nombre del plan, por si viniera.
 *   3. `limited_user_quotas` — **sólo lo trae el nivel gratuito**. Es el indicio
 *      más directo que hay: si viene, la cuenta es gratuita, se llame como se
 *      llame el plan.
 *   4. `endpoints.api` — el host que atiende a esta cuenta, que no siempre es el
 *      genérico (`api.individual.githubcopilot.com` es habitual).
 */

/** El host de inferencia para una cuenta individual cuando no dice otra cosa. */
export const DEFAULT_COPILOT_HOST = "https://api.githubcopilot.com";

/** Dónde se pregunta el plan. Es lo mismo que consulta VS Code. */
const USER_URL = "https://api.github.com/copilot_internal/user";

/**
 * El identificador de la versión de la API de Copilot.
 *
 * Es el que usa OpenCode (`plugin/provider/github-copilot.ts`) y con el que su
 * cliente funciona sin más ceremonia. Con un valor anterior la API sigue
 * contestando, pero no con el contrato de hoy.
 */
const API_VERSION = "2026-08-01";

/** La versión de la API de GitHub de siempre, la del perfil de la cuenta. */
const USER_API_VERSION = "2025-04-01";

/** El nombre con el que este cliente se presenta a GitHub. */
const GITHUB_USER_AGENT = "plataforma-3i/1.0";

/**
 * Los planes con los que **sí** se puede elegir modelo.
 *
 * Todo lo que no esté aquí se trata como «elige GitHub por ti». Se enumera lo
 * que permite elegir, y no lo que no, porque una lista de planes de pago crece
 * con el tiempo y una cuenta nueva no debería quedar fuera por no estar en ella.
 *
 * Van sin guion ni espacio porque lo que llega se normaliza antes de comparar:
 * GitHub escribe `copilot_pro` en la SKU y `pro` en el plan.
 */
const PAID_PLANS = new Set([
  "pro", "proplus", "max", "business", "enterprise", "team",
]);

/**
 * Las cabeceras con las que se habla con la API de inferencia de Copilot.
 *
 * Están copiadas del cliente de OpenCode, que es el que funciona:
 *
 *     User-Agent            opencode/<canal>/<versión>/<nombre>
 *     Openai-Intent         conversation-edits
 *     X-GitHub-Api-Version  2026-08-01
 *     x-initiator           user
 *
 * Y **no** lleva `Copilot-Integration-Id`. Mandarla fue justo el error: GitHub la
 * obedece, atribuye la cuenta a ese integrador y contesta
 * `The requested model is not available for integrator "vscode-chat"`, porque la
 * lista de modelos de cada integrador es distinta y la de `vscode-chat` no es la
 * de esta cuenta. Sin la cabecera, GitHub usa el integrador que corresponde al
 * token, que es el que sí tiene los modelos.
 *
 * Tampoco se canjea el token: OpenCode manda el `gho_` de GitHub tal cual a
 * `/chat/completions`, sin pasar por `/copilot_internal/v2/token`.
 */
export function copilotHeaders(): Record<string, string> {
  return {
    "User-Agent": GITHUB_USER_AGENT,
    "Openai-Intent": "conversation-edits",
    "X-GitHub-Api-Version": API_VERSION,
    "x-initiator": "user",
  };
}

function githubHeaders(key: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${key}`,
    "X-GitHub-Api-Version": USER_API_VERSION,
    "User-Agent": GITHUB_USER_AGENT,
  };
}

/**
 * Los modelos que el integrador de esta cuenta acepta de verdad.
 *
 * No hay lista que mantener aquí. GitHub la dice en el propio error cuando el
 * modelo pedido no está en el integrador:
 *
 *     The requested model is not available for integrator "opencode".
 *     Available models: [gpt-4.1 claude-opus-4.7 gpt-5-mini gpt-4o-mini]
 *     Verify the correct Copilot-Integration-Id header is being sent.
 *
 * Así que basta con pedir un modelo que no exista —uno inventado— y leer la
 * respuesta: una sola petición devuelve la lista entera de lo que esta cuenta
 * puede usar. Es más rápido y más fiable que probar los candidatos uno a uno,
 * que además gastaba cuota por cada prueba.
 *
 * Ante cualquier otra cosa —red, cuota, un 200 inesperado— se devuelve `null`, y
 * quien llama se queda con el catálogo tal cual: no saberlo no es motivo para
 * esconder modelos.
 */
export async function usableModels(
  key: string,
  host: string,
  _candidates: readonly string[],
): Promise<string[] | null> {
  const bases = [...new Set([host, DEFAULT_COPILOT_HOST])];

  for (const base of bases) {
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { ...githubHeaders(key), ...copilotHeaders(), "Content-Type": "application/json" },
        // Un identificador que no puede existir: lo que interesa no es la
        // respuesta, es el mensaje que la acompaña.
        body: JSON.stringify({
          model: "__sondeo_de_modelos__",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        cache: "no-store",
      });

      const text = await response.text().catch(() => "");
      const allowed = allowedModelsFromError(text);
      if (allowed) return allowed;
    } catch { /* se prueba el siguiente host */ }
  }
  return null;
}

/**
 * Los modelos que el integrador de esta cuenta acepta, si GitHub los enumera.
 *
 * Cuando el integrador no tiene el modelo pedido, GitHub contesta con la lista
 * entera de los que sí tiene:
 *
 *     The requested model is not available for integrator "opencode".
 *     Available models: [gpt-4.1 claude-opus-4.7 gpt-5-mini …]
 *     Verify the correct Copilot-Integration-Id header is being sent.
 *
 * Esa lista es la verdad sobre esta cuenta, y es lo único que la dice: `/models`
 * anuncia el catálogo completo, pero el integrador —que queda decidido por la
 * aplicación de GitHub con la que se autorizó la sesión— sólo atiende a una
 * parte. Leerla del error convierte un rechazo en información.
 */
export function allowedModelsFromError(body: string): string[] | null {
  const match = /Available models:\s*\[([^\]]*)\]/i.exec(body);
  if (!match?.[1]) return null;
  const ids = match[1].split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/**
 * El integrador al que GitHub atribuye esta sesión, si lo dice el error.
 *
 * Sirve para explicarlo: quien autorizó con la aplicación de un cliente queda
 * atado al integrador de ese cliente, y no todos los integradores tienen los
 * mismos modelos.
 */
export function integratorFromError(body: string): string | null {
  const match = /integrator\s+"([^"]+)"/i.exec(body);
  return match?.[1] ?? null;
}

/** Lo que se sabe del plan de quien llama. */
export interface CopilotPlan {
  /** El plan declarado, para poder explicarlo. Vacío si no se supo. */
  plan: string;
  /** El host de inferencia que atiende a esta cuenta, sin barra final. */
  host: string;
  /** Cierto cuando el plan no deja elegir modelo. */
  autoOnly: boolean;
}

/** Lo que llega de `/copilot_internal/user`, en lo que aquí se usa. */
interface UserPayload {
  copilot_plan?: unknown;
  access_type_sku?: unknown;
  endpoints?: { api?: unknown };
  limited_user_quotas?: unknown;
}

/**
 * Cierto cuando la cuenta **no** elige modelo y le toca `auto`.
 *
 * Ante la duda devuelve `true`. El motivo está arriba: un modelo equivocado da
 * `model_not_supported`, y `auto` nunca falla por plan.
 */
function isAutoOnly(data: UserPayload): boolean {
  // Se quitan guiones, guion bajo y espacios, y también el prefijo `copilot`: la
  // SKU dice `copilot_pro` donde el plan dice `pro`, y son el mismo plan.
  const norm = (raw: unknown): string =>
    typeof raw === "string"
      ? raw.trim().toLowerCase().replace(/^copilot/, "").replace(/[\s_-]/g, "")
      : "";
  const plan = norm(data.copilot_plan);
  const sku = norm(data.access_type_sku);

  // Un plan de pago declarado, por cualquiera de los dos campos: elige.
  if (PAID_PLANS.has(plan) || PAID_PLANS.has(sku)) return false;

  // `limited_user_quotas` sólo viene en el nivel gratuito. Es la señal más
  // directa: si está, no se elige modelo, diga lo que diga el nombre del plan.
  if (data.limited_user_quotas && typeof data.limited_user_quotas === "object") return true;

  // Ni plan de pago ni cuotas limitadas: si dijo `free`, o no dijo nada, o trae
  // una SKU desconocida, se prefiere `auto`. Ofrecer la lista entera cuando no se
  // sabe el plan es lo que mostraba treinta modelos de pago que no funcionaban.
  return true;
}

/**
 * El plan de la cuenta, o `null` si no se pudo preguntar.
 *
 * Que falle no es motivo para romper el catálogo: sin esta respuesta se sigue
 * como antes —todo lo que anuncie `/models`— porque un fallo de red no debe
 * vaciar el selector.
 */
export async function copilotPlan(key: string): Promise<CopilotPlan | null> {
  let response: Response;
  try {
    response = await fetch(USER_URL, {
      headers: githubHeaders(key),
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const data = (await response.json().catch(() => null)) as UserPayload | null;
  if (!data) return null;

  const plan = typeof data.copilot_plan === "string" ? data.copilot_plan.trim().toLowerCase() : "";
  const api = typeof data.endpoints?.api === "string" ? data.endpoints.api.trim() : "";

  return {
    plan,
    // El host que declara la cuenta manda; el genérico es sólo el respaldo.
    host: (api || DEFAULT_COPILOT_HOST).replace(/\/+$/, ""),
    autoOnly: isAutoOnly(data),
  };
}

/**
 * La única entrada que un plan sin elección puede usar.
 *
 * No se devuelve vacía a propósito: un selector vacío no explica nada, y `auto`
 * sí funciona en ese plan. Es además lo que enseña VS Code con una cuenta
 * gratuita, así que las dos interfaces dicen lo mismo.
 */
export function autoOnlyModels(): { id: string; name: string; publisher: string }[] {
  return [{ id: "auto", name: "Auto (lo elige Copilot)", publisher: "GitHub" }];
}

/**
 * El modelo de verdad que hay detrás de «Auto».
 *
 * `auto` **no es un modelo de la API**: es una opción del selector de VS Code.
 * Mandarlo tal cual contesta `400 model_not_supported`, que es exactamente el
 * error que se ve al enviar el primer mensaje. Lo confirma el cliente de
 * IntelliJ, que antes de escribir pregunta cuál toca:
 *
 *     [AutoModelService] Fetched auto model for standby in 1734ms: gpt-5-mini
 *
 * Es decir: la elección ocurre en el cliente, no en el servidor. Aquí se hace lo
 * mismo, contra el catálogo de la cuenta, porque elegir un identificador que no
 * existe vuelve a dar el mismo 400.
 *
 * El orden busca primero lo barato y seguro (`gpt-5-mini` es lo que resuelve el
 * cliente oficial para un plan sin pago) y luego cualquier modelo que el
 * catálogo diga que se puede usar por `/chat/completions`.
 */
/**
 * Los candidatos para «Auto», en orden.
 *
 * `gpt-4.1` va primero porque es el único que aparece en **todas** las listas de
 * integradores que se han visto (`vscode-chat`, `opencode`,
 * `copilot-language-server`): es el modelo al que se puede caer sin que la cuenta
 * lo rechace. Los demás amplían la lista cuando el integrador los tiene.
 */
const AUTO_PREFERENCE = ["gpt-4.1", "gpt-5-mini", "gpt-4o", "gpt-4o-mini"];

/**
 * A qué modelo apuntar cuando la persona eligió «Auto».
 *
 * `available` son los identificadores que el catálogo de esta cuenta da por
 * usables. Si no hay ninguno, se devuelve el preferido igualmente: es mejor un
 * identificador plausible que mandar `auto`, que falla siempre.
 */
export function resolveAutoModel(available: readonly string[]): string {
  const usable = new Set(available);
  for (const candidate of AUTO_PREFERENCE) {
    if (usable.has(candidate)) return candidate;
  }
  return available[0] ?? AUTO_PREFERENCE[0]!;
}

/**
 * El modelo que el propio Copilot elige para este mensaje.
 *
 * Esto es lo que hace VS Code al pulsar «Auto», leído de su `getAutoDecision`:
 *
 *     POST /auto  { prompt, has_image? }
 *     → { selected_model: { id: "gpt-5-mini" }, expires_at }
 *
 * La elección depende del texto, así que se le pasa el último mensaje de la
 * persona. Si algo falla se devuelve `null` y quien llama cae a una lista de
 * preferencias: el mensaje tiene que salir igual, aunque sea con otro modelo.
 */
export async function copilotAutoModel(
  key: string,
  host: string,
  prompt: string,
  hasImage: boolean,
): Promise<string | null> {
  const bases = [...new Set([host, DEFAULT_COPILOT_HOST])];
  const body: Record<string, unknown> = { prompt };
  if (hasImage) body.has_image = true;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}/auto`, {
        method: "POST",
        headers: { ...githubHeaders(key), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const data = (await response.json().catch(() => null)) as {
        selected_model?: { id?: unknown };
      } | null;
      const id = data?.selected_model?.id;
      if (typeof id === "string" && id) return id;
    } catch { /* se prueba el siguiente host */ }
  }
  return null;
}
