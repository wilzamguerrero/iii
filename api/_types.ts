/**
 * Firma mínima compatible con `VercelRequest` / `VercelResponse`.
 *
 * Se define aquí en vez de depender de `@vercel/node` para no atar el proyecto
 * a un proveedor: los handlers de `api/` corren igual bajo el plugin de
 * desarrollo (tools/vite-api-plugin.ts) y bajo Vercel en producción.
 *
 * Vercel no despliega como función los archivos de `api/` que empiezan por `_`,
 * así que este archivo es sólo tipos compartidos.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export interface ApiRequest extends IncomingMessage {
  /** Parámetros de la query string ya parseados. */
  query: Record<string, string | string[]>;
  /** Cuerpo parseado como JSON cuando el `Content-Type` lo indica. */
  body?: unknown;
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  send(body?: unknown): void;
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => void | Promise<void>;
