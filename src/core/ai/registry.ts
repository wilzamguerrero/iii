import { apiError } from "./wire.ts";

/**
 * El directorio de proveedores conocidos, para el formulario de «añadir el tuyo».
 *
 * Lo sirve `api/ai-registry` desde el registro público de models.dev, así que no
 * hay ninguna lista en el repositorio: son los proveedores que hablan el formato
 * de OpenAI, con su URL base ya rellenada cuando el registro la conoce.
 *
 * Se pide una vez por sesión. La respuesta ya viene con una hora de caché en el
 * navegador; esto evita incluso esa comprobación al abrir y cerrar el formulario.
 */

export interface DirectoryEntry {
  id: string;
  name: string;
  /** URL base, o "" cuando el registro no la trae y hay que escribirla. */
  api: string;
  doc: string;
  /** Cuántos modelos conoce el registro de este proveedor. */
  models: number;
}

export interface Directory {
  /** Hasta dónde admite el servidor las URLs propias. */
  policy: "off" | "public" | "local";
  providers: DirectoryEntry[];
}

let cached: Directory | null = null;
let inflight: Promise<Directory> | null = null;

async function load(): Promise<Directory> {
  const response = await fetch("/api/ai-registry", { headers: { Accept: "application/json" } });
  if (!response.ok) throw await apiError(response);

  const data = await response.json() as { policy?: unknown; providers?: unknown };
  const policy = data.policy;
  const directory: Directory = {
    policy: policy === "off" || policy === "local" ? policy : "public",
    providers: Array.isArray(data.providers) ? data.providers as DirectoryEntry[] : [],
  };
  cached = directory;
  return directory;
}

export async function loadDirectory(): Promise<Directory> {
  if (cached) return cached;
  inflight ??= load().finally(() => { inflight = null; });
  return await inflight;
}
