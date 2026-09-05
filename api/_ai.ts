/**
 * Lo compartido de los endpoints de IA.
 *
 * Un solo sitio con la tabla de proveedores, porque el endurecimiento importante
 * está justo ahí: la URL de destino de los proveedores de casa **nunca** se
 * construye con nada que venga de la petición. El cliente manda un identificador
 * de proveedor, se busca en esta tabla y si no está, 400. Sin eso,
 * `/api/ai-chat` sería un proxy abierto a cualquier host de internet con la IP
 * del servidor.
 *
 * Los proveedores propios —«pon aquí la API que quieras»— son la excepción
 * necesaria: ahí la URL base sí la elige la persona, y por eso pasa por una
 * política (`safeBase`) antes de usarse. Se exige `https`, se prohíben las
 * credenciales incrustadas y se rechazan las direcciones privadas, de bucle
 * local y de metadatos de la nube, que son el objetivo de un SSRF. En la máquina
 * de quien desarrolla se permite además `http` y `localhost`, que es lo que hace
 * falta para hablar con Ollama o LM Studio.
 *
 * Diferencias deliberadas con `reference/` (ver plan.md §D3):
 *
 * - No hay `Access-Control-Allow-Origin: *`. Los endpoints los llama esta página
 *   y nadie más; el comodín convertía el despliegue en un proxy de IA público
 *   pagado por quien despliega.
 * - El `client_id` del flujo de dispositivo de GitHub lo pone el servidor. En el
 *   original venía en el cuerpo, y eso hacía del endpoint un relé al alta de
 *   dispositivos de GitHub para cualquier aplicación.
 * - Las claves no se registran nunca, ni completas ni recortadas.
 *
 * Vercel no despliega como función los archivos de `api/` que empiezan por `_`.
 */

import type { ApiRequest, ApiResponse } from "./_types.ts";

/** Los proveedores que trae la aplicación. Los demás los añade la persona. */
export type BuiltinId = "openrouter" | "nvidia" | "github";

export interface ProviderSpec {
  id: BuiltinId;
  label: string;
  /**
   * Destinos de la conversación, en orden. Si el primero contesta 401 o 403 se
   * prueba el siguiente: es el caso de una cuenta de GitHub sin Copilot, que
   * puede seguir usando el catálogo gratuito de GitHub Models.
   */
  chatUrls: readonly string[];
  /** Destinos del catálogo de modelos, con la misma regla de cascada. */
  modelUrls: readonly string[];
  defaultModel: string;
  /** Variable de entorno con la que quien despliega puede poner su propia clave. */
  envKey: string;
  /** Cabeceras fijas que el proveedor pide además del `Bearer`. */
  headers?: Readonly<Record<string, string>>;
  /** Cierto cuando el catálogo de modelos es público (OpenRouter). */
  publicCatalog?: boolean;
  /** Identificador en models.dev, para completar lo que el proveedor no dice. */
  registry: string;
}

export const PROVIDERS: Readonly<Record<BuiltinId, ProviderSpec>> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    chatUrls: ["https://openrouter.ai/api/v1/chat/completions"],
    modelUrls: ["https://openrouter.ai/api/v1/models"],
    defaultModel: "openai/gpt-4o-mini",
    envKey: "OPENROUTER_API_KEY",
    headers: { "X-Title": "Plataforma 3i" },
    publicCatalog: true,
    registry: "openrouter",
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA",
    chatUrls: ["https://integrate.api.nvidia.com/v1/chat/completions"],
    modelUrls: ["https://integrate.api.nvidia.com/v1/models"],
    defaultModel: "nvidia/llama-3.3-nemotron-super-49b-v1",
    envKey: "NVIDIA_API_KEY",
    registry: "nvidia",
  },
  github: {
    id: "github",
    label: "GitHub Copilot",
    chatUrls: [
      "https://api.githubcopilot.com/chat/completions",
      "https://models.github.ai/inference/v1/chat/completions",
    ],
    modelUrls: [
      "https://api.githubcopilot.com/models",
      "https://models.github.ai/catalog/models",
      "https://models.github.ai/inference/v1/models",
    ],
    defaultModel: "gpt-4o-mini",
    envKey: "GITHUB_AI_TOKEN",
    // Las cabeceras que manda hoy `reference/opencode-dev`
    // (`plugin/github-copilot/copilot.ts`). `X-GitHub-Api-Version` fija el
    // contrato de la API en vez de aceptar el que Copilot tenga por defecto, y
    // `x-initiator` dice si detrás hay una persona o un agente.
    headers: {
      "User-Agent": "plataforma-3i/1.0",
      "X-GitHub-Api-Version": "2026-06-01",
      "x-initiator": "user",
      "Openai-Intent": "conversation-edits",
    },
    registry: "github-copilot",
  },
};

/** Lo que hace falta para hablar con un destino, sea de casa o de la persona. */
export interface Target {
  /** `"custom"` en los proveedores propios; el mapeador de modelos lo mira. */
  id: BuiltinId | "custom";
  label: string;
  chatUrls: readonly string[];
  modelUrls: readonly string[];
  defaultModel: string;
  headers?: Readonly<Record<string, string>>;
  publicCatalog: boolean;
  /** Variable de entorno con la clave del servidor, si el destino tiene una. */
  envKey?: string;
  /** Identificador en models.dev, si se conoce. */
  registry: string;
  /** URL base, sólo en los proveedores propios. */
  base: string;
  /** Cierto cuando la URL la eligió la persona: no se siguen redirecciones. */
  custom: boolean;
  /** Cabecera por la que viaja la clave. Vacío: `Authorization: Bearer`. */
  keyHeader: string;
  /** Cabeceras que pidió la persona. Sólo en los proveedores propios. */
  extra?: Readonly<Record<string, string>>;
}

export type TargetResult =
  | { ok: true; target: Target }
  | { ok: false; code: string; message: string };

/* --- proveedores propios -------------------------------------------------- */

/**
 * Cuánto se permite en las URLs que escribe la persona:
 *
 * - `local`: también `http` y direcciones de la máquina o de la red local. Es lo
 *   que hace falta para Ollama, LM Studio o un servidor propio en casa.
 * - `public`: sólo `https` hacia hosts públicos.
 * - `off`: ningún proveedor propio.
 *
 * Sin configurar: `local` en desarrollo y `public` desplegado. Desplegado se
 * cierra la red interna porque ahí el servidor está en la infraestructura de
 * alguien, y una URL con `169.254.169.254` es el camino clásico a sus
 * credenciales.
 */
export type BasePolicy = "off" | "public" | "local";

export function basePolicy(): BasePolicy {
  const raw = process.env.AI_CUSTOM_PROVIDERS?.trim().toLowerCase();
  if (raw === "off" || raw === "public" || raw === "local") return raw;
  return process.env.VERCEL ? "public" : "local";
}

const LOCAL_SUFFIX = /(^|\.)(localhost|local|internal|home\.arpa)$/i;

/** Cierto si el host es una dirección que no debería alcanzarse desde fuera. */
function isPrivateHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!name || LOCAL_SUFFIX.test(name)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;      // este host, privada, bucle, multicast
    if (a === 169 && b === 254) return true;                            // enlace local y metadatos de la nube
    if (a === 172 && b >= 16 && b <= 31) return true;                   // privada
    if (a === 192 && (b === 168 || b === 0)) return true;               // privada y protocolos
    if (a === 100 && b >= 64 && b <= 127) return true;                  // NAT del operador
    if (a === 198 && (b === 18 || b === 19)) return true;               // pruebas de red
    return false;
  }

  if (name.includes(":")) {
    if (name === "::1" || name === "::") return true;
    if (/^f[cd]/.test(name)) return true;                               // fc00::/7, local única
    if (/^fe[89ab]/.test(name)) return true;                            // fe80::/10, enlace local
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(name);
    if (mapped?.[1]) return isPrivateHost(mapped[1]);
    return false;
  }

  return false;
}

const MAX_BASE_LENGTH = 300;

/**
 * La URL base, limpia y aprobada, o el motivo por el que no vale.
 *
 * Límite conocido: con la política `public` un nombre de dominio que resuelva a
 * una dirección privada pasaría el filtro, porque aquí sólo se mira el texto del
 * host. Cerrarlo del todo exige resolver el nombre y fijar la IP en la conexión,
 * que Node no permite sin un agente propio. Se anota porque callarlo sería peor.
 */
export function safeBase(raw: unknown, policy: BasePolicy): { base: string } | { error: string } {
  if (policy === "off") {
    return { error: "Este servidor no admite proveedores propios (AI_CUSTOM_PROVIDERS)." };
  }
  if (typeof raw !== "string" || !raw.trim()) return { error: "Falta la URL base del proveedor." };
  if (raw.length > MAX_BASE_LENGTH) return { error: "La URL base es demasiado larga." };

  // Se acepta que la persona pegue el endpoint entero, que es lo que suele estar
  // en la documentación de cada API.
  const text = raw.trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/+$/, "");

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: "La URL base no es una dirección válida." };
  }

  if (url.protocol !== "https:" && !(policy === "local" && url.protocol === "http:")) {
    return { error: "La URL base tiene que empezar por https://" };
  }
  if (url.username || url.password) {
    return { error: "La URL base no puede llevar usuario ni contraseña." };
  }
  if (url.search || url.hash) {
    return { error: "La URL base no puede llevar parámetros." };
  }
  if (policy !== "local" && isPrivateHost(url.hostname)) {
    return { error: "Esa dirección es de una red interna y este servidor no la permite." };
  }

  return { base: url.origin + url.pathname.replace(/\/+$/, "") };
}

/** Nombre para los mensajes de error. Nunca lleva la clave ni la ruta completa. */
function baseLabel(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return "proveedor propio";
  }
}

/** Un solo valor de cabecera, aunque llegue repetida. */
function header(req: ApiRequest, name: string): string {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

/* --- cabeceras propias ------------------------------------------------------ */

/**
 * No todas las APIs ponen la clave en `Authorization: Bearer`: Azure OpenAI la
 * pide en `api-key`, el formato de Anthropic en `x-api-key`, y hay pasarelas que
 * además quieren una cabecera para enrutar o para identificar el proyecto. Sin
 * poder decir eso, esas APIs no se pueden añadir. Es lo que
 * `reference/kilocode-main` cubre en su proveedor propio con un `options.headers`
 * libre (`packages/kilo-vscode/src/shared/custom-provider.ts`), y es la pieza que
 * aquí faltaba.
 *
 * Se admiten sólo en los proveedores propios y con la misma desconfianza que la
 * URL: es texto que viene de la petición y va a acabar en una cabecera HTTP hacia
 * fuera.
 *
 * - El nombre, sólo caracteres de «token» de HTTP. Un espacio o un `:` dentro del
 *   nombre es la forma de partir una cabecera en dos.
 * - Prohibidas las que gobiernan la conexión o el cuerpo —`Host`,
 *   `Content-Length`, `Transfer-Encoding`, `Content-Type`—: cambiarlas no
 *   configura ningún proveedor, engaña al intermediario que haya delante o rompe
 *   el cuerpo que este endpoint acaba de armar.
 * - Ni `\r` ni `\n` ni nada fuera del ASCII imprimible en el valor. Eso es
 *   inyección de cabeceras de manual.
 */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "proxy-connection", "proxy-authorization", "content-length",
  "content-type", "content-encoding", "transfer-encoding", "te", "trailer", "upgrade",
  "keep-alive", "expect", "cookie", "cookie2", "set-cookie",
]);

const MAX_HEADERS = 8;
const MAX_HEADER_VALUE = 1024;
const MAX_HEADERS_TOTAL = 3072;

/** Para citar en un error sin reenviar lo que llegó tal cual. */
function quote(raw: string): string {
  return `«${raw.replace(/[^\x20-\x7e]/g, "").slice(0, 40)}»`;
}

/** El nombre de cabecera aprobado, `""` si no venía ninguno, o el motivo. */
export function safeHeaderName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { name: "" };
  const name = raw.trim();
  if (!HEADER_NAME.test(name)) {
    return { error: `${quote(name)} no es un nombre de cabecera válido.` };
  }
  if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
    return { error: `La cabecera ${quote(name)} la pone este servidor y no se puede cambiar.` };
  }
  return { name };
}

/** Las cabeceras propias, aprobadas, o el motivo por el que no valen. */
export function safeHeaders(raw: unknown): { headers: Record<string, string> } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { headers: {} };
  if (raw.length > MAX_HEADERS_TOTAL) return { error: "Las cabeceras propias son demasiadas." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "No se entendieron las cabeceras propias." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "Las cabeceras propias tienen que ser pares de nombre y valor." };
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) {
    return { error: `Como máximo ${MAX_HEADERS} cabeceras propias.` };
  }

  const headers: Record<string, string> = {};
  for (const [rawName, value] of entries) {
    const checked = safeHeaderName(rawName);
    if ("error" in checked) return checked;
    if (!checked.name) continue;
    if (typeof value !== "string") return { error: `El valor de ${quote(rawName)} no es texto.` };
    if (value.length > MAX_HEADER_VALUE) {
      return { error: `El valor de ${quote(rawName)} es demasiado largo.` };
    }
    if (!/^[\t\x20-\x7e]*$/.test(value)) {
      return { error: `El valor de ${quote(rawName)} lleva caracteres que no caben en una cabecera.` };
    }
    headers[checked.name] = value;
  }

  return { headers };
}

/**
 * Dónde va la clave. Por defecto `Authorization: Bearer`, que es lo que hablan
 * los tres proveedores de casa y casi todo lo compatible con OpenAI. Un proveedor
 * propio puede pedir otra cabecera, y entonces la clave va ahí a secas: quien
 * pide `api-key` no espera un `Bearer` delante.
 */
export function authHeaders(key: string | null, target: Target): Record<string, string> {
  if (!key) return {};
  if (target.keyHeader) return { [target.keyHeader]: key };
  return { Authorization: `Bearer ${key}` };
}

const REGISTRY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * El destino de esta petición: un proveedor de la tabla, o el propio de la
 * persona descrito en cuatro cabeceras: `X-Ai-Base` (obligatoria),
 * `X-Ai-Registry` (de dónde sacar los nombres de los modelos),
 * `X-Ai-Key-Header` (por dónde va la clave, si no es `Authorization: Bearer`) y
 * `X-Ai-Headers` (las demás cabeceras que pida esa API, en JSON).
 *
 * En los proveedores de casa las cuatro se ignoran a propósito: si `X-Ai-Base`
 * pudiera cambiar el destino de `openrouter`, la tabla no protegería nada, y una
 * cabecera propia sobre un destino de casa sólo serviría para hacerle llegar algo
 * que la tabla no ha decidido.
 */
export function readTarget(req: ApiRequest, provider: unknown): TargetResult {
  if (typeof provider !== "string") {
    return { ok: false, code: "unknown_provider", message: "Proveedor no reconocido." };
  }

  if (provider === "custom") {
    const checked = safeBase(header(req, "x-ai-base"), basePolicy());
    if ("error" in checked) return { ok: false, code: "bad_base", message: checked.error };

    const named = safeHeaderName(header(req, "x-ai-key-header"));
    if ("error" in named) return { ok: false, code: "bad_headers", message: named.error };

    const extra = safeHeaders(header(req, "x-ai-headers"));
    if ("error" in extra) return { ok: false, code: "bad_headers", message: extra.error };

    const hint = header(req, "x-ai-registry");
    return {
      ok: true,
      target: {
        id: "custom",
        label: baseLabel(checked.base),
        chatUrls: [`${checked.base}/chat/completions`],
        modelUrls: [`${checked.base}/models`],
        // Sin modelo elegido no se inventa ninguno: en un proveedor propio no hay
        // forma de acertar, y mandar uno que no existe da un error confuso.
        defaultModel: "",
        publicCatalog: false,
        registry: REGISTRY_ID.test(hint) ? hint : "",
        base: checked.base,
        custom: true,
        keyHeader: named.name,
        ...(Object.keys(extra.headers).length > 0 ? { extra: extra.headers } : {}),
      },
    };
  }

  // `hasOwn` y no un acceso directo: `PROVIDERS["constructor"]` devolvería algo
  // heredado del prototipo y pasaría por proveedor válido.
  if (!Object.hasOwn(PROVIDERS, provider)) {
    return { ok: false, code: "unknown_provider", message: "Proveedor no reconocido." };
  }
  const spec = PROVIDERS[provider as BuiltinId];

  return {
    ok: true,
    target: {
      id: spec.id,
      label: spec.label,
      chatUrls: spec.chatUrls,
      modelUrls: spec.modelUrls,
      defaultModel: spec.defaultModel,
      headers: spec.headers,
      publicCatalog: spec.publicCatalog === true,
      envKey: spec.envKey,
      registry: spec.registry,
      base: "",
      custom: false,
      keyHeader: "",
    },
  };
}

/**
 * La clave que se usará: la que manda el navegador o, si no la manda, la que
 * haya en el entorno del servidor. Las dos vías existen a propósito —la persona
 * pega su clave en los ajustes del asistente, y quien despliega puede poner una para
 * todos—
 * y el navegador nunca ve la del entorno. Un proveedor propio no tiene variable
 * de entorno: su clave viene siempre del navegador.
 */
export function resolveKey(req: ApiRequest, target: Target): string | null {
  const sent = header(req, "x-ai-key");
  if (sent) return sent;
  const fromEnv = target.envKey ? process.env[target.envKey]?.trim() : "";
  return fromEnv ? fromEnv : null;
}

export function noStore(res: ApiResponse): void {
  res.setHeader("Cache-Control", "no-store");
}

/** Qué claves tiene puestas el servidor. Se dice si hay, nunca cuál. */
export function configuredProviders(): Record<BuiltinId, boolean> {
  return {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    nvidia: Boolean(process.env.NVIDIA_API_KEY),
    github: Boolean(process.env.GITHUB_AI_TOKEN),
  };
}

export interface FetchOptions {
  /**
   * Con `true` una redirección se trata como error en vez de seguirse. Se usa en
   * los proveedores propios: un `302` es la forma de saltarse el filtro de
   * `safeBase` y acabar llamando a una dirección interna.
   */
  noRedirect?: boolean;
  /**
   * Corta a los N milisegundos si el proveedor no contesta. Sin esto, una
   * dirección que acepta la conexión y se calla deja la petición esperando hasta
   * que la plataforma la mate, y quien acaba de escribir esa URL no ve nada. No
   * se usa en la conversación en flujo: ahí el silencio largo es normal y el
   * corte se llevaría por delante una respuesta que estaba llegando. Se aplica a
   * cada destino de la cascada, no al total.
   */
  timeoutMs?: number;
}

/**
 * Llama a los destinos en cascada. Devuelve la primera respuesta que no sea un
 * rechazo de credenciales, o la última si todas lo son.
 */
export async function fetchWithFallback(
  urls: readonly string[],
  init: RequestInit,
  options: FetchOptions = {},
): Promise<Response> {
  let last: Response | null = null;

  for (const url of urls) {
    const response = await fetch(url, {
      ...init,
      ...(options.noRedirect ? { redirect: "manual" as const } : {}),
      ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    });
    if (options.noRedirect && response.status >= 300 && response.status < 400) {
      throw new Error("El proveedor redirige a otra dirección. Usa la URL final.");
    }
    if (response.status !== 401 && response.status !== 403) return response;
    last = response;
  }

  // Todos rechazaron: se devuelve el último para que el cliente vea el motivo
  // real del proveedor en vez de un error inventado por nosotros.
  return last as Response;
}

/** Vuelca el flujo del proveedor tal cual. Es texto SSE y se pasa sin tocar. */
export async function pipeStream(upstream: Response, res: ApiResponse): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Sin esto, algunos intermediarios acumulan el flujo y la respuesta llega de
  // golpe al final, que es justo lo que el streaming evita.
  res.setHeader("X-Accel-Buffering", "no");

  const body = upstream.body;
  if (!body) {
    res.end();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const flush = (): void => {
    const maybe = res as unknown as { flush?: () => void };
    try { maybe.flush?.(); } catch { /* sin compresión no hay nada que vaciar */ }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(decoder.decode(value, { stream: true }));
    flush();
  }
  res.end();
}

/** Mensaje de error legible sin filtrar cabeceras ni claves. */
export function describe(error: unknown): string {
  if (!(error instanceof Error)) return "Error interno del servidor.";
  if (error.name === "TimeoutError") {
    return "El proveedor no respondió a tiempo. Comprueba la URL y que el servidor esté escuchando.";
  }
  // `fetch failed` no le dice nada a quien acaba de escribir la URL de su propio
  // servidor: casi siempre es que no hay nadie escuchando ahí.
  if (error.message === "fetch failed") {
    return "No se pudo conectar con esa dirección. Comprueba la URL y que el servidor esté encendido.";
  }
  return error.message;
}

/**
 * Qué decirle a la persona cuando el proveedor contesta con un fallo que no es
 * JSON.
 *
 * Pasó de verdad: una pasarela detrás de Cloudflare respondía 403 con 4,5 KB de
 * HTML al `POST` del chat —el `GET` de los modelos sí pasaba—, y esa página
 * entera aparecía como respuesta del asistente. Un cortafuegos delante del
 * proveedor no se arregla desde aquí, pero sí se puede decir en una línea en vez
 * de en una página.
 *
 * Devuelve `null` si el cuerpo es JSON: eso se reenvía tal cual, porque un 429 o
 * un 402 sólo los explica bien el proveedor.
 */
export function explainBody(
  status: number,
  label: string,
  contentType: string | null,
  text: string,
): string | null {
  if ((contentType ?? "").includes("json")) return null;
  try {
    JSON.parse(text);
    return null;
  } catch { /* no era JSON aunque no lo dijera */ }

  const blocked = /Attention Required|cf-error|Cloudflare Ray ID|have been blocked/i.test(text);
  if (blocked) {
    return `${label} devolvió ${status}: su cortafuegos (Cloudflare) bloqueó la petición ` +
      "antes de que llegara a la API. No es la clave ni el modelo. Si el catálogo de " +
      "modelos sí carga, lo que está cerrado es sólo el camino del chat, y eso lo abre " +
      "quien administra esa pasarela: desde aquí no hay nada que cambiar.";
  }

  // Sin marcas reconocibles: se dice el estado y, si el cuerpo era texto corto y
  // legible, se cita. Una página de HTML no se cita: no explica nada.
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const quoted = plain && plain.length <= 200 && !/^</.test(text.trim()) ? ` Dijo: «${plain}»` : "";
  return `${label} devolvió ${status} y no una respuesta de la API.${quoted}`;
}
