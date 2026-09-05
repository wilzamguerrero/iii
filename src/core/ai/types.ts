/**
 * Lo que el cliente necesita saber de los proveedores de IA: nada más que su
 * identificador y cómo se consigue su credencial.
 *
 * Las URLs, las cabeceras y las formas de cada API viven sólo en `api/_ai.ts`.
 * Si el navegador conociera los destinos, la clave tendría que viajar desde aquí
 * a un tercero y el servidor dejaría de poder poner la suya.
 */

export type ProviderId = "openrouter" | "nvidia" | "github";

export const PROVIDER_IDS: readonly ProviderId[] = ["openrouter", "nvidia", "github"];

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /**
   * Cómo se obtiene la credencial: `key` es una clave que la persona pega,
   * `device` es el alta por dispositivo de GitHub (aparece un código y se
   * escribe en github.com).
   */
  auth: "key" | "device";
  /** Una frase para la pestaña IA: qué es esto y qué cuesta. */
  hint: string;
  /** Dónde se saca la clave, para no obligar a buscarla. */
  keyUrl?: string;
  /**
   * Cierto cuando el catálogo de modelos se puede leer sin credencial. Lo sabe
   * el cliente para no pedir una lista que va a volver como 401.
   */
  publicCatalog?: boolean;
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderInfo>> = {
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

/** Un modelo tal y como lo normaliza `/api/ai-models`. */
export interface AiModel {
  id: string;
  name: string;
  publisher: string;
  /** Pista corta: «gratis», «ctx 128k»… Puede venir vacía. */
  tag: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}
