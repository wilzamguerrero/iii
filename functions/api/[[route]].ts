/**
 * Adaptador de Cloudflare Pages para los handlers de `api/`.
 *
 * Por qué un solo archivo y no once: los handlers ya están escritos contra una
 * firma propia (`api/_types.ts`) precisamente para no atarse a un proveedor. Un
 * `functions/api/notion.ts` por cada uno —como en
 * `reference/wzglexical-dev_mimem`— duplicaría la lógica y dejaría dos copias
 * que se separan con el primer arreglo. Aquí la ruta comodín `[[route]]` recoge
 * todo `/api/*`, busca el handler en la tabla y le pone el `req`/`res` que
 * espera. El mismo archivo de `api/` corre en tres sitios sin cambios: el plugin
 * de Vite en desarrollo, Vercel y esto.
 *
 * Tres cosas que este entorno no da y hay que poner:
 *
 * 1. **`process.env`.** Los handlers lo leen, igual que en Vercel. En Workers las
 *    variables llegan en `context.env`, así que se copian antes de llamar. Lo que
 *    ya esté en el entorno manda, como en el plugin de desarrollo.
 * 2. **La respuesta por partes.** `res.write()` no existe: Workers devuelve un
 *    `Response`. El truco es resolver ese `Response` con un `TransformStream` en
 *    el primer `write()` —de ahí en adelante el flujo va saliendo mientras el
 *    handler sigue escribiendo—, y con el cuerpo entero si el handler acaba sin
 *    haber escrito nada. Es lo que mantiene vivo el streaming del asistente.
 * 3. **La tabla de handlers es estática.** Un `import()` con la ruta en una
 *    variable no lo puede empaquetar el compilador, y aquí no hay un sistema de
 *    archivos que recorrer como en el plugin de desarrollo.
 *
 * No hay cabeceras CORS a propósito, igual que en `api/`: el cliente se sirve del
 * mismo origen. El `Access-Control-Allow-Origin: *` de la referencia convertía
 * cada endpoint en un proxy de IA y un intercambiador de códigos al servicio de
 * cualquier página.
 */

import type { ApiHandler, ApiRequest, ApiResponse } from "../../api/_types.ts";

import aiChat from "../../api/ai-chat.ts";
import aiModels from "../../api/ai-models.ts";
import aiRegistry from "../../api/ai-registry.ts";
import githubDevice from "../../api/github-device.ts";
import health from "../../api/health.ts";
import notion from "../../api/notion.ts";
import notionOauth from "../../api/notion-oauth.ts";
import notionUpload from "../../api/notion-upload.ts";

/** Los endpoints, por el nombre con el que los pide el cliente. */
const HANDLERS: Readonly<Record<string, ApiHandler>> = {
  "ai-chat": aiChat,
  "ai-models": aiModels,
  "ai-registry": aiRegistry,
  "github-device": githubDevice,
  health,
  notion,
  "notion-oauth": notionOauth,
  "notion-upload": notionUpload,
};

/** Tope del cuerpo, el mismo que el plugin de desarrollo. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Vuelca `context.env` en `process.env` para que los handlers no tengan que saber
 * dónde corren. Se crea el objeto si no existe: así esto funciona aunque el
 * proyecto no active `nodejs_compat` (por eso tampoco se usa `Buffer` en ningún
 * handler).
 */
function exposeEnv(env: unknown): void {
  const global = globalThis as { process?: { env: Record<string, string | undefined> } };
  global.process ??= { env: {} };
  if (typeof env !== "object" || env === null) return;
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    // Sólo texto: un binding de KV o de R2 no es una variable de entorno.
    if (typeof value === "string" && global.process.env[key] === undefined) {
      global.process.env[key] = value;
    }
  }
}

function parseQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0]!;
  }
  return query;
}

async function parseBody(request: Request): Promise<unknown> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  // Las subidas de archivos viajan como multipart y su handler reenvía el
  // cuerpo como stream: leerlas aquí primero sería bufferizarlas y el tope
  // rompería los chunks. El handler lee `request` directo, igual que en el
  // plugin de desarrollo.
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) return undefined;

  const raw = await request.text();
  if (!raw) return undefined;
  if (raw.length > MAX_BODY_BYTES) throw new Error("Cuerpo demasiado grande.");

  if (!type.includes("application/json")) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("El cuerpo no es JSON válido.");
  }
}

/**
 * El `res` que esperan los handlers, sobre un `Response` de Workers.
 *
 * `response` se resuelve en cuanto se sabe qué devolver: en el primer `write()`
 * si la respuesta va por partes, o en el `end()` si viene de una pieza. Las
 * escrituras se encadenan en `tail` porque un `writer` sólo admite una a la vez y
 * los handlers escriben sin esperar, como en Node.
 */
function makeResponse(): { res: ApiResponse; response: Promise<Response> } {
  let status = 200;
  const headers = new Headers();
  const encoder = new TextEncoder();

  let settle: (value: Response) => void = () => {};
  const response = new Promise<Response>((resolve) => { settle = resolve; });

  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let finished = false;
  const chunks: string[] = [];

  const openStream = (): WritableStreamDefaultWriter<Uint8Array> => {
    if (writer) return writer;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    writer = writable.getWriter();
    settle(new Response(readable, { status, headers }));
    return writer;
  };

  const api = {
    /** Lo mira el código que decide si aún puede tocar cabeceras. */
    get headersSent(): boolean { return writer !== null; },
    get writableEnded(): boolean { return finished; },

    setHeader(name: string, value: string | number | readonly string[]): unknown {
      if (writer) return api;
      // En try porque los handlers ponen cabeceras que aquí no pintan nada:
      // `Connection: keep-alive` y `X-Accel-Buffering` son para el Node de
      // Vercel, y el aislado gobierna la conexión él mismo. Que las ignore es lo
      // correcto; que reviente por ellas, no.
      try {
        if (Array.isArray(value)) {
          headers.delete(name);
          for (const item of value) headers.append(name, String(item));
        } else {
          headers.set(name, String(value));
        }
      } catch { /* cabecera que este entorno no deja poner */ }
      return api;
    },

    getHeader(name: string): string | undefined {
      return headers.get(name) ?? undefined;
    },

    removeHeader(name: string): void {
      if (!writer) headers.delete(name);
    },

    status(code: number): unknown {
      if (!writer) status = code;
      return api;
    },

    write(chunk: string | Uint8Array): boolean {
      if (finished) return false;
      const writable = openStream();
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      tail = tail.then(() => writable.write(bytes)).catch(() => {
        // El cliente cerró la pestaña a media respuesta. No es un fallo nuestro.
        finished = true;
      });
      return true;
    },

    end(payload?: unknown): unknown {
      if (finished) return api;
      finished = true;

      if (writer) {
        const writable = writer;
        if (typeof payload === "string") {
          tail = tail.then(() => writable.write(encoder.encode(payload)));
        }
        tail = tail.then(() => writable.close()).catch(() => {});
        return api;
      }

      if (typeof payload === "string") chunks.push(payload);
      const body = chunks.join("");
      // Un 204 o un 304 con cuerpo es un error de protocolo.
      const empty = status === 204 || status === 304;
      settle(new Response(empty || !body ? null : body, { status, headers }));
      return api;
    },

    json(payload: unknown): void {
      if (!writer && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json; charset=utf-8");
      }
      api.end(JSON.stringify(payload));
    },

    send(payload?: unknown): void {
      if (payload === undefined || payload === null) return void api.end();
      if (typeof payload === "string") return void api.end(payload);
      api.json(payload);
    },
  };

  return { res: api as unknown as ApiResponse, response };
}

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const name = url.pathname.replace(/^\/api\//, "").replace(/\/+$/, "");

  if (!Object.hasOwn(HANDLERS, name)) {
    return json(404, { error: "not_found", message: `No existe /api/${name}` });
  }
  const handler = HANDLERS[name]!;

  exposeEnv(context.env);

  let body: unknown;
  try {
    body = await parseBody(context.request);
  } catch (error) {
    return json(400, {
      error: "bad_body",
      message: error instanceof Error ? error.message : "Cuerpo no válido.",
    });
  }

  const req = {
    method: context.request.method.toUpperCase(),
    // Los handlers leen `req.headers["x-notion-token"]`, en minúsculas y como en
    // Node: un objeto llano. `Headers` ya normaliza el nombre al guardarlo.
    headers: Object.fromEntries(context.request.headers) as Record<string, string>,
    url: url.pathname + url.search,
    query: parseQuery(url),
    body,
    // El cuerpo sin parsear —las subidas multipart—: el handler lo reenvía
    // como stream y aquí está el `Request` de verdad que sabe hacerlo. En los
    // otros entornos el `req` de Node ya es el stream por derecho propio.
    rawRequest: context.request,
  } as unknown as ApiRequest;

  const { res, response } = makeResponse();

  // El handler sigue corriendo después de que se devuelva el `Response`: eso es lo
  // que permite el flujo. Si revienta antes de contestar nada, se contesta aquí.
  const running = (async () => {
    try {
      await handler(req, res);
      // Un handler que acaba sin cerrar dejaría la petición colgada.
      if (!(res as unknown as { writableEnded: boolean }).writableEnded) res.end();
    } catch (error) {
      console.error(`[api] ${name}:`, error);
      if (!(res as unknown as { headersSent: boolean }).headersSent) {
        res.status(500).json({
          error: "internal_error",
          message: error instanceof Error ? error.message : "Error interno del servidor.",
        });
      } else {
        res.end();
      }
    }
  })();

  // Que el aislado no se apague en cuanto salga la cabecera del flujo.
  context.waitUntil(running);
  return await response;
};
