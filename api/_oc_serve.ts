/**
 * OpenCode por su binario real: la única vía que su nivel gratuito acepta.
 *
 * ## Por qué no basta con imitar cabeceras
 *
 * Desde ~2026-09-17 el backend de `opencode.ai` rechaza con
 * `429 FreeUsageLimitError` a cualquier cliente que no sea el binario
 * `opencode`. La puerta ya no mira el cuerpo ni las cabeceras: mira el
 * **fingerprint TLS** (el ClientHello). Node habla por OpenSSL y el CLI por
 * BoringSSL, y eso no se disfraza desde `fetch`.
 *
 * Está comprobado con las cabeceras completas del CLI v2 —sesión, proyecto
 * propio, trazas b3— y aun así contesta 429. `_opencode.ts` sigue valiendo para
 * `/zen` y para un cliente que ya pase la puerta, pero por `/inference` no hay
 * forma directa.
 *
 * ## Lo que se hace en su lugar
 *
 * Se levanta `opencode serve` en `127.0.0.1` y se le habla por su API local. El
 * tráfico a `opencode.ai` lo genera el propio binario, con su TLS y su
 * identidad, así que la puerta lo acepta. Cuesta un proceso, y se paga una vez:
 * el proceso se reutiliza mientras viva la función.
 *
 * ## Por qué esto no es lo mismo en todas partes
 *
 * `opencode serve` necesita el binario instalado (`opencode` en el PATH o en
 * `~/.opencode/bin`). En la máquina de quien desarrolla lo normal es tenerlo; en
 * un despliegue serverless no hay binario ni procesos hijos que duren. Cuando no
 * está, [`ocServeAvailable`] lo dice y el chat cae a la vía directa, que
 * contestará 429 y se explicará como tal. No se finge que funciona.
 *
 * El diseño está calcado del portal de casa (`justdowork/v3`,
 * `portal_app/oc_serve.py`), que es donde está medido.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Cuánto puede tardar en arrancar. Medido: entre 2 y 20 s en frío. */
const START_TIMEOUT_MS = 45_000;
/** La generación en sí. Es un agente: puede pensar despacio. */
const REPLY_TIMEOUT_MS = 600_000;
/** Peticiones cortas (crear sesión, mandar prompt, leer mensajes). */
const CALL_TIMEOUT_MS = 60_000;

interface Server {
  child: ChildProcess;
  base: string;
  auth: string;
}

let server: Server | null = null;
let starting: Promise<Server | null> | null = null;
/** Se apaga al terminar el proceso: en serverless no hay hijos que sobrevivan. */
let shuttingDown = false;

/**
 * Cierto cuando este entorno puede levantar el binario.
 *
 * En Vercel y Cloudflare no hay binario ni sitio donde ponerlo, y lanzar un
 * proceso hijo desde una función no está permitido. Se dice que no en vez de
 * intentar y fallar con un error de sistema que no explica nada.
 */
export function ocServeAvailable(): boolean {
  if (process.env.OPENCODE_NO_SERVE === "1") return false;
  if (process.env.VERCEL || process.env.CF_PAGES) return false;
  return true;
}

/** El binario, si está donde suele estar. */
function findBinary(): string | null {
  const explicit = process.env.OC_BIN?.trim();
  if (explicit) return explicit;

  const names = process.platform === "win32"
    ? ["opencode.cmd", "opencode.exe", "opencode", "opencode2.cmd", "opencode2"]
    : ["opencode", "opencode2"];

  const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  // El instalador lo deja aquí y en Linux/macOS no siempre está en el PATH.
  dirs.push(join(homedir(), ".opencode", "bin"));

  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { /* no está, se sigue */ }
    }
  }
  return null;
}

/** Un puerto libre, preguntándoselo al sistema. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("sin puerto libre"))));
    });
  });
}

/** Una petición a la API local del binario. Loopback, sin TLS. */
async function local(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const current = server;
  if (!current) throw new Error("opencode serve no está levantado");

  const response = await fetch(`${current.base}${path}`, {
    ...init,
    headers: {
      Authorization: current.auth,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? CALL_TIMEOUT_MS),
  });
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no era JSON */ }
  return { status: response.status, json, text };
}

/** Levanta el binario, una sola vez, y lo reutiliza. */
async function ensureServer(): Promise<Server> {
  if (server && server.child.exitCode === null) return server;
  if (starting) {
    const ready = await starting;
    if (ready) return ready;
    throw new Error("opencode serve no arrancó");
  }

  starting = (async (): Promise<Server | null> => {
    const binary = findBinary();
    if (!binary) return null;

    const port = await freePort();
    // El servidor exige Basic auth en cada llamada; la contraseña se inventa
    // por arranque y no sale de aquí.
    const password = crypto.randomUUID().replace(/-/g, "");
    const auth = `Basic ${btoa(`opencode:${password}`)}`;

    const workdir = process.env.OC_WORKDIR?.trim() || join(homedir(), ".portal-oc-workspace");
    try { mkdirSync(workdir, { recursive: true }); } catch { /* se usa la cwd */ }

    const useShell = /\.(cmd|bat)$/i.test(binary);
    const child = spawn(binary, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: workdir,
      shell: useShell,
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
      stdio: "ignore",
      windowsHide: true,
    });

    const candidate: Server = { child, base: `http://127.0.0.1:${port}`, auth };
    server = candidate;

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        server = null;
        return null;
      }
      try {
        const info = await local("/api/info", { timeoutMs: 2_000 });
        if (info.status === 200) {
          const version = (info.json as { version?: unknown } | null)?.version;
          console.warn(`[opencode] serve listo (v${String(version ?? "?")}) en ${candidate.base}`);
          return candidate;
        }
      } catch { /* todavía no escucha */ }
      await new Promise((done) => setTimeout(done, 400));
    }

    child.kill();
    server = null;
    return null;
  })().finally(() => { starting = null; });

  const ready = await starting;
  if (!ready) throw new Error("opencode serve no está disponible");
  return ready;
}

/** Cierra el proceso. Se llama al terminar la función, si hay sitio. */
export function stopOcServe(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server?.child.exitCode === null) {
    try { server.child.kill(); } catch { /* ya estaba muerto */ }
  }
  server = null;
}

export interface OcReply {
  text: string;
  reasoning: string;
  model: string;
}

/** Un error del binario, con el estado HTTP que le corresponde. */
export class OcError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** El texto de un contenido, sea cadena o lista de partes. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const part of content) {
    if (typeof part === "string") { out.push(part); continue; }
    if (typeof part !== "object" || part === null) continue;
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") out.push(record.text);
  }
  return out.join("\n");
}

/**
 * La conversación, convertida al prompt que el agente entiende.
 *
 * El binario **es un agente**: no acepta `messages`, acepta un prompt. Se manda
 * el system aparte y la conversación como transcripción, que es lo que hace el
 * portal y lo que el agente sabe leer.
 */
function toPrompt(messages: readonly { role: string; content: unknown }[]): {
  system: string;
  transcript: string;
} {
  const system: string[] = [];
  const turns: string[] = [];
  for (const message of messages) {
    const text = textOf(message.content).trim();
    if (!text) continue;
    if (message.role === "system") { system.push(text); continue; }
    if (message.role === "user") turns.push(`User: ${text}`);
    else if (message.role === "assistant") turns.push(`Assistant: ${text}`);
  }
  return { system: system.join("\n\n"), transcript: turns.join("\n\n") };
}

/** Una vuelta completa: sesión nueva, prompt, espera y lectura. */
export async function ocServeChat(
  model: string,
  messages: readonly { role: string; content: unknown }[],
): Promise<OcReply> {
  await ensureServer();
  const { system, transcript } = toPrompt(messages);
  const text = system ? `${system}\n\n${transcript}` : transcript;

  // El `providerID` es el del proveedor dentro del binario, no el nuestro.
  const created = await local("/api/session", {
    method: "POST",
    body: JSON.stringify({ model: { providerID: "opencode", id: model } }),
  });
  const session = (created.json as { data?: { id?: unknown } } | null)?.data?.id;
  if (created.status !== 200 || typeof session !== "string") {
    throw new OcError(mapStatus(created.status), describe(created, "crear la sesión"));
  }

  try {
    const sent = await local(`/api/session/${session}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (sent.status !== 200) {
      throw new OcError(mapStatus(sent.status), describe(sent, "mandar el prompt"));
    }

    // Se espera a que el agente quede ocioso: es una generación entera.
    const waited = await local(`/api/experimental/session/${session}/wait`, {
      method: "POST",
      timeoutMs: REPLY_TIMEOUT_MS,
    });
    if (waited.status !== 200 && waited.status !== 204) {
      throw new OcError(mapStatus(waited.status), describe(waited, "esperar la respuesta"));
    }

    const read = await local(`/api/session/${session}/message?order=desc&limit=8`);
    const list = (read.json as { data?: unknown } | null)?.data;
    if (!Array.isArray(list)) {
      throw new OcError(502, describe(read, "leer los mensajes"));
    }

    const idle = list.find((entry) => (entry as { type?: unknown }).type === "idle") as
      | { outcome?: unknown; error?: { status?: unknown; message?: unknown } }
      | undefined;
    if (idle?.outcome === "failed") {
      const status = idle.error?.status === 429 ? 429 : 502;
      throw new OcError(status, String(idle.error?.message ?? "el agente falló"));
    }

    const assistant = list.find(
      (entry) => (entry as { type?: unknown }).type === "assistant",
    ) as { content?: unknown } | undefined;
    if (!assistant) throw new OcError(502, "opencode devolvió una respuesta vacía");

    let answer = "";
    let reasoning = "";
    for (const part of Array.isArray(assistant.content) ? assistant.content : []) {
      const record = part as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") answer += record.text;
      else if (record.type === "reasoning" && typeof record.text === "string") reasoning += record.text;
    }

    return { text: answer || reasoning, reasoning, model };
  } finally {
    // Borrar la sesión es cortesía; no debe romper una respuesta ya obtenida.
    try { await local(`/api/session/${session}`, { method: "DELETE", timeoutMs: 10_000 }); }
    catch { /* se queda huérfana en el binario, sin más */ }
  }
}

/** El estado que se le devuelve a quien llamó. */
function mapStatus(status: number): number {
  if (status === 400 || status === 401 || status === 429) return status;
  return 502;
}

/** Un mensaje legible de la respuesta de error del binario. */
function describe(
  response: { status: number; json: unknown; text: string },
  what: string,
): string {
  const record = response.json as
    | { data?: { message?: unknown }; error?: { message?: unknown }; message?: unknown }
    | null;
  const message = record?.data?.message ?? record?.error?.message ?? record?.message;
  if (typeof message === "string" && message.trim()) return message;
  return `opencode falló al ${what} (HTTP ${response.status})`;
}

/** El binario está y se puede usar en este entorno. */
export function ocServeUsable(): boolean {
  return ocServeAvailable() && findBinary() !== null;
}
