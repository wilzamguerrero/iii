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

/** Los tres que trae la aplicación. */
export type BuiltinId = "openrouter" | "nvidia" | "github";

export const BUILTIN_IDS: readonly BuiltinId[] = ["openrouter", "nvidia", "github"];

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
}

export interface ProviderInfo {
  id: BuiltinId;
  label: string;
  /**
   * Cómo se obtiene la credencial: `key` es una clave que la persona pega,
   * `device` es el alta por dispositivo de GitHub (aparece un código y se
   * escribe en github.com).
   */
  auth: "key" | "device";
  /** Una frase para los ajustes del asistente: qué es esto y qué cuesta. */
  hint: string;
  /** Dónde se saca la clave, para no obligar a buscarla. */
  keyUrl?: string;
  /**
   * Cierto cuando el catálogo de modelos se puede leer sin credencial. Lo sabe
   * el cliente para no pedir una lista que va a volver como 401.
   */
  publicCatalog?: boolean;
}

export const PROVIDERS: Readonly<Record<BuiltinId, ProviderInfo>> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    auth: "key",
    hint: "Una clave sirve para muchos modelos. Varios son gratuitos.",
    keyUrl: "https://openrouter.ai/keys",
    publicCatalog: true,
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA",
    auth: "key",
    hint: "Modelos abiertos alojados por NVIDIA, con crédito gratuito de prueba.",
    keyUrl: "https://build.nvidia.com",
  },
  github: {
    id: "github",
    label: "GitHub Copilot",
    auth: "device",
    hint: "Usa tu cuenta de GitHub. Sin Copilot activo queda el catálogo de GitHub Models.",
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
