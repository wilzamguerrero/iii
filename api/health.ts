/**
 * Comprobación de vida del backend.
 *
 * Existe para verificar la Fase 0: que el mismo archivo responda en desarrollo
 * (a través del plugin de Vite) y desplegado (como función de Vercel).
 *
 * Informa *si* las credenciales están configuradas, nunca su valor.
 */

import { basePolicy, configuredProviders } from "./_ai.ts";
import type { ApiHandler } from "./_types.ts";

const handler: ApiHandler = (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    service: "plataforma-3i",
    time: new Date().toISOString(),
    config: {
      notionOAuth: Boolean(
        process.env.NOTION_OAUTH_CLIENT_ID && process.env.NOTION_OAUTH_CLIENT_SECRET
      ),
      // Si el servidor tiene clave de un proveedor, la pestaña IA no vuelve a
      // pedirla. Se dice que la hay; nunca cuál es.
      ai: configuredProviders(),
      // Hasta dónde llegan los proveedores propios en este servidor: la pestaña
      // IA lo dice antes de que la persona escriba una URL que va a rechazarse.
      aiCustom: basePolicy(),
    },
  });
};

export default handler;
