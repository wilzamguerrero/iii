/**
 * Tipos mínimos de Cloudflare Pages Functions.
 *
 * `PagesFunction` lo declara `@cloudflare/workers-types`, que traería consigo el
 * entorno entero de Workers y chocaría con los tipos DOM del resto de la
 * aplicación (`tsconfig.json` incluye `DOM` porque `src/` es un navegador).
 * Aquí sólo hacen falta las firmas que consume el adaptador, así que se declaran
 * en local. Es lo mismo que hace `reference/wzglexical-dev_mimem`.
 */

interface EventContext<Env, Params extends string, Data> {
  request: Request;
  env: Env;
  params: Record<Params, string | string[]>;
  data: Data;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
}

type PagesFunction<
  Env = unknown,
  Params extends string = string,
  Data extends Record<string, unknown> = Record<string, unknown>,
> = (context: EventContext<Env, Params, Data>) => Response | Promise<Response>;
