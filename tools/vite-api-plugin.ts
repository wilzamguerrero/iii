/**
 * Plugin de desarrollo: sirve `api/*.ts` dentro del propio servidor de Vite.
 *
 * Por qué así y no con un proceso aparte en otro puerto (lo que hace
 * `reference/`): Vite ya sabe transpilar TypeScript y recargar módulos, de modo
 * que `ssrLoadModule` ejecuta el mismo archivo que se desplegará como función
 * sin build intermedio, sin dependencias extra y sin coordinar dos procesos.
 *
 * El adaptador añade a `req`/`res` lo que Vercel añade —`query`, `body`,
 * `status()`, `json()`, `send()`— para que los handlers de `api/` se escriban
 * una sola vez y funcionen en los dos entornos.
 */

import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";

import type { ApiHandler, ApiRequest, ApiResponse } from "../api/_types.ts";

/** Tope del cuerpo de una petición. Suficiente para guardar un documento largo. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Sólo un segmento, sin barras ni puntos: cierra la puerta a `../`. */
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/i;

export function apiDev({ dir = "api" }: { dir?: string } = {}): Plugin {
  let root = process.cwd();

  return {
    name: "plataforma-3i:api-dev",
    apply: "serve",

    configResolved(config) {
      root = config.root;
      // Vite sólo expone al cliente las variables VITE_*. Los handlers leen
      // `process.env`, igual que en Vercel, así que se cargan aquí sin prefijo.
      // El entorno real manda: nunca se sobrescribe una variable ya presente.
      for (const [key, value] of Object.entries(loadEnv(config.mode, root, ""))) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      // La señal de que esto es una máquina de desarrollo y no un despliegue. La
      // lee `basePolicy()` en `api/_ai.ts` para permitir Ollama y LM Studio en
      // `http://localhost`. Se pone aquí —el único sitio por el que pasa el
      // servidor de desarrollo— y no se deduce de la ausencia de las variables de
      // Vercel o Cloudflare: en un despliegue que no se reconozca, suponer «local»
      // abriría la red interna del servidor.
      process.env.PLATAFORMA_3I_DEV = "1";
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        const name = url.pathname.slice("/api/".length);
        if (!SAFE_NAME.test(name)) {
          return sendJson(res, 404, { error: "Endpoint no encontrado." });
        }

        const file = resolve(root, dir, `${name}.ts`);
        if (!existsSync(file)) {
          return sendJson(res, 404, { error: `No existe ${dir}/${name}.ts` });
        }

        try {
          const apiReq = req as ApiRequest;
          apiReq.query = parseQuery(url);
          // Las subidas de archivos viajan como multipart y el handler las
          // reenvía como stream: leerlas aquí primero sería bufferizarlas —el
          // tope de `MAX_BODY_BYTES` rompería los chunks de 4 MiB con su
          // boundary— y destruir la petición a mitad de subida. El resto de
          // endpoints esperan JSON, y se parsea como siempre.
          const isStream = isStreamBody(name, req);
          if (!isStream) apiReq.body = await parseBody(req);

          const module = await server.ssrLoadModule(`/${dir}/${name}.ts`);
          const handler = (module.default ?? module.handler) as ApiHandler | undefined;
          if (typeof handler !== "function") {
            return sendJson(res, 500, {
              error: `${dir}/${name}.ts no exporta un handler por defecto.`,
            });
          }

          await handler(apiReq, adaptResponse(res));
          if (!res.writableEnded) res.end();
        } catch (error) {
          if (error instanceof Error) server.ssrFixStacktrace(error);
          console.error(`[api] ${name}:`, error);
          if (!res.headersSent) {
            sendJson(res, 500, { error: describe(error) });
          } else if (!res.writableEnded) {
            res.end();
          }
        }
      });
    },
  };
}

/* ------------------------------------------------------------------ adaptador */

/** Cierto cuando este handler lee el cuerpo como stream, no como JSON. */
function isStreamBody(name: string, req: IncomingMessage): boolean {
  const type = req.headers["content-type"] ?? "";
  // Sólo la subida: el multipart que lleva un chunk de archivo. Los demás
  // cuerpos multipart, si los hubiera, se leen igual que siempre.
  return name === "notion-upload" && type.includes("multipart/form-data");
}

function adaptResponse(res: ServerResponse): ApiResponse {
  const api = res as ApiResponse;

  api.status = (code) => {
    res.statusCode = code;
    return api;
  };

  api.json = (payload) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  };

  api.send = (payload) => {
    if (payload === undefined || payload === null) return res.end();
    if (typeof payload === "string" || Buffer.isBuffer(payload)) return res.end(payload);
    api.json(payload);
  };

  return api;
}

function parseQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0]!;
  }
  return query;
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  if (!req.method || req.method === "GET" || req.method === "HEAD") return undefined;

  const raw = await readRaw(req);
  if (!raw) return undefined;

  const type = req.headers["content-type"] ?? "";
  if (!type.includes("application/json")) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("El cuerpo no es JSON válido.");
  }
}

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        fail(new Error("Cuerpo demasiado grande."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Error interno del servidor.";
}
