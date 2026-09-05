/**
 * El directorio de proveedores conocidos, para «añadir el tuyo».
 *
 * `GET /api/ai-registry`
 *
 * Sale del registro público (`_registry.ts`), así que no hay aquí ninguna lista
 * que mantener: si mañana aparece un proveedor nuevo compatible con el formato de
 * OpenAI, aparece en este desplegable sin tocar el código.
 *
 * Se devuelve sólo lo que el formulario necesita —nombre, URL base y enlace a la
 * documentación—, no el catálogo de modelos de cada uno: son 4,5 MB y el
 * navegador no tiene por qué verlos. Los modelos se piden luego, uno a uno, por
 * `/api/ai-models`.
 *
 * Los tres proveedores de casa se excluyen: ya tienen su propia pestaña.
 */

import type { ApiHandler } from "./_types.ts";
import { basePolicy, describe } from "./_ai.ts";
import { registryDirectory } from "./_registry.ts";

/** Los que ya están arriba en la pestaña IA, con sus identificadores del registro. */
const MINE = ["openrouter", "nvidia", "github-copilot"] as const;

const handler: ApiHandler = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed", message: "Usa GET." });
    return;
  }

  try {
    const providers = await registryDirectory(MINE);
    // Es una lista pública y lenta de cambiar: una hora en el navegador ahorra
    // una descarga por cada vez que se abre el formulario. `private` porque la
    // respuesta depende de la política del servidor.
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).json({ policy: basePolicy(), providers });
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "registry_unreachable", message: describe(error) });
  }
};

export default handler;
