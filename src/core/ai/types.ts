/**
 * Lo que el cliente necesita saber de los proveedores de IA: nada más que su
 * identificador y cómo se consigue su credencial.
 *
 * Las URLs, las cabeceras y las formas de cada API viven sólo en `api/_ai.ts`,
 * con una excepción: la URL base de un proveedor propio, que la escribe la
 * persona y por tanto sí vive aquí, en sus ajustes. Si el navegador conociera los
 * destinos de los demás, la clave tendría que viajar desde aquí a un tercero y el
 * servidor dejaría de poder poner la suya.
 */

/** Los proveedores de casa. El orden de `BUILTIN_IDS` es el que se pinta. */
export type BuiltinId =
  "freepi" | "openai" | "anthropic" | "openrouter" | "github" | "nvidia";

/**
 * El orden de la fila de proveedores, y por tanto el del selector.
 *
 * free-pi va primero porque es el único que se conecta en un paso y sin clave;
 * después las dos claves de pago que más se piden (OpenAI y Anthropic); luego
 * OpenRouter y GitHub Copilot, que traen catálogo amplio; y NVIDIA al final.
 */
export const BUILTIN_IDS: readonly BuiltinId[] = [
  "freepi", "openai", "anthropic", "openrouter", "github", "nvidia",
];

/** Los proveedores propios se identifican así, para no chocar con los de casa. */
export const CUSTOM_PREFIX = "custom:";

/**
 * Un proveedor: uno de los tres, o `custom:<nombre>`. Es `string` a propósito —la
 * persona puede añadir los que quiera— y las tres constantes siguen sugiriéndose
 * al escribir gracias a `string & {}`.
 */
export type ProviderId = BuiltinId | (string & {});

export function isBuiltin(id: string): id is BuiltinId {
  return (BUILTIN_IDS as readonly string[]).includes(id);
}

export function isCustom(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

/** Un proveedor añadido por la persona: un nombre, una URL y su clave. */
export interface CustomProvider {
  /** `custom:<slug>`. */
  id: string;
  label: string;
  /** La URL base, tal como la guardó la persona. Ej.: `https://api.deepseek.com/v1`. */
  baseUrl: string;
  /**
   * Identificador en models.dev, cuando se eligió del directorio. Sólo sirve para
   * que los modelos salgan con su nombre y su ventana de contexto.
   */
  registry?: string;
  /**
   * Por qué cabecera viaja la clave, cuando no es `Authorization: Bearer`. Azure
   * OpenAI pide `api-key`; el formato de Anthropic, `x-api-key`. Vacío o ausente:
   * el `Bearer` de siempre.
   */
  keyHeader?: string;
  /**
   * Las demás cabeceras que pida esa API. Es la pieza que faltaba para poder
   * añadir de verdad cualquier proveedor: hay pasarelas que enrutan por una
   * cabecera propia y sin ella no contestan. El servidor las revisa una por una
   * antes de reenviarlas (`safeHeaders` en `api/_ai.ts`).
   */
  headers?: Record<string, string>;
  /**
   * Qué formato habla esa API. `openai` —lo normal— es `/chat/completions` con
   * `messages`. `anthropic` es `/messages`, con el `system` aparte y otro flujo:
   * el servidor traduce en los dos sentidos (`api/_anthropic.ts`), así que desde
   * aquí la conversación es la misma. Ausente: `openai`.
   *
   * Hace falta porque existen pasarelas que sólo sirven ese camino —una de ellas
   * devuelve 403 desde Cloudflare en `/chat/completions` y 200 en `/messages`— y
   * ninguna cabecera arregla un cuerpo distinto.
   */
  format?: "openai" | "anthropic";
}

export interface ProviderInfo {
  id: BuiltinId;
  label: string;
  /**
   * Cómo se obtiene la credencial: `key` es una clave que la persona pega,
   * `device` es el alta por dispositivo de GitHub (aparece un código y se
   * escribe en github.com).
   */
  auth: "key" | "device" | "free";
  /** Una frase para los ajustes del asistente: qué es esto y qué cuesta. */
  hint: string;
  /** Dónde se saca la clave, para no obligar a buscarla. */
  keyUrl?: string;
  /**
   * Cierto cuando el catálogo de modelos se puede leer sin credencial. Lo sabe
   * el cliente para no pedir una lista que va a volver como 401.
   */
  publicCatalog?: boolean;
  /**
   * La clave que se usa si la persona no pone ninguna.
   *
   * Existe porque hay niveles gratuitos que no tienen credencial. Sin esto la
   * aplicación pedía una clave que no existe. Si la persona escribe la suya,
   * manda la suya.
   */
  fallbackKey?: string;
  /**
   * Cierto cuando el nivel gratuito no necesita que nadie inicie sesión. Sirve
   * para no enseñar el campo de la clave como si fuera obligatorio.
   */
  freeTier?: boolean;
}

export const PROVIDERS: Readonly<Record<BuiltinId, ProviderInfo>> = {
  freepi: {
    id: "freepi",
    label: "free-pi",
    // El alta es la de GitHub, pero orquestada por free-pi: su backend da el
    // código y entrega un JWT suyo. No hace falta instalar su CLI; ver
    // `api/_freepi_device.ts` y `src/core/ai/freepiDevice.ts`.
    auth: "device",
    hint: "Modelos gratis con anuncios. Se conecta con GitHub en un paso, sin " +
      "instalar nada; el token dura ~90 días y admite 4 sesiones a la vez.",
    keyUrl: "https://freepi.ai",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    auth: "key",
    hint: "La API de OpenAI: GPT y los modelos de razonamiento. Se paga por uso.",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    auth: "key",
    hint: "La API de Anthropic: la familia Claude. Se paga por uso.",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    auth: "key",
    hint: "Una clave sirve para muchos modelos. Varios son gratuitos.",
    keyUrl: "https://openrouter.ai/keys",
    publicCatalog: true,
  },
  github: {
    id: "github",
    label: "GitHub Copilot",
    auth: "device",
    hint: "Usa tu cuenta de GitHub. Sin Copilot activo queda el catálogo de GitHub Models.",
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA",
    auth: "key",
    hint: "Modelos abiertos alojados por NVIDIA, con crédito gratuito de prueba.",
    keyUrl: "https://build.nvidia.com",
  },
};

/** El de casa que corresponda, o `null` si es uno propio. */
export function builtinInfo(id: ProviderId): ProviderInfo | null {
  return isBuiltin(id) ? PROVIDERS[id] : null;
}

/** Un modelo tal y como lo normaliza `/api/ai-models`. */
export interface AiModel {
  id: string;
  name: string;
  publisher: string;
  /** Ventana de contexto en tokens, si el proveedor o el registro la dicen. */
  ctx?: number;
  /** Cierto sólo cuando consta que no cuesta nada. */
  free?: boolean;
  reasoning?: boolean;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}
