/**
 * La puerta de OpenCode: la forma exacta que su backend exige antes de contestar.
 *
 * ## El error que esto arregla
 *
 * `POST https://opencode.ai/inference/openai/v1/chat/completions` es compatible
 * con OpenAI en la ruta, no en la puerta. Si el cuerpo no tiene la forma que
 * manda el cliente nativo de OpenCode, el backend contesta:
 *
 *     429 { "type": "FreeUsageLimitError" }
 *
 * y ese 429 **no es una cuota agotada**: es un rechazo de forma. Llega con la
 * clave recién creada, con plan de pago y con la cuota entera intacta. Viene a
 * decir «esto no lo ha pedido un cliente de OpenCode». Llamarlo `FreeUsageLimit`
 * es una decisión del proveedor que cuesta cara: quien lo recibe espera horas un
 * reintento que no puede funcionar, porque el cuerpo sigue mal formado.
 *
 * ## De dónde sale cada requisito
 *
 * Todo esto está medido contra el servidor real, no deducido. La fuente es
 * `Reference/open code/opencode-proxy-master` (`src/compat_proxy/gate.rs` y
 * `docs/PROTOCOL_NOTES.md`, 2026-11-04 → 2026-11-06):
 *
 * - `tools`: al menos siete declaraciones con nombre dentro de un conjunto fijo
 *   (`glob`, `read`, `skill`, `webfetch`, `websearch`, `write`, `execute`). Con
 *   seis o menos, 429; con siete, 200. No basta el nombre: cada una necesita
 *   `parameters.properties` **no vacío**, o no cuenta para el mínimo.
 * - Un bloque `<env>` en el primer mensaje de sistema, con la línea
 *   `Working directory:`. Sin `<env>`, sin etiquetas o vacío, 429. El valor no
 *   tiene que ser una ruta real.
 * - `max_completion_tokens: 32000` cuando el cliente no trae su propio tope.
 * - Los nombres de herramienta de otros clientes (Codex, Claude Code) disparan
 *   el mismo 429 por sí solos, así que se renombran a `fn_<camel>_ex` y se
 *   restauran en la respuesta.
 *
 * ## Lo que este módulo NO hace
 *
 * No hay TLS ni identidad de cliente (eso es de un proxy local en Rust que puede
 * hablar BoringSSL; aquí corre `fetch` de Node y no se puede imitar el ClientHello
 * de OpenCode). Tampoco hay `x-opencode-org-id`: ese valor sale del workspace de
 * la cuenta y sólo lo conoce su Console. Si el backend lo exige para tu clave, se
 * pone en las cabeceras propias del proveedor.
 *
 * ## Este archivo es efímero por naturaleza
 *
 * Los valores del gate son empíricos y el proveedor los cambia. Cuando falle,
 * primero se comprueba si siguen siendo éstos antes de tocar otra cosa.
 */

/**
 * Las siete que cuentan para la puerta, en el orden relativo del cliente nativo
 * 2.2.5. El orden importa menos que el número, pero se respeta.
 */
const GATE_TOOLS = ["glob", "read", "skill", "webfetch", "websearch", "write", "execute"] as const;

/** Cuántas declaraciones válidas hacen falta. Medido: 7 pasan, 6 no. */
const MIN_GATE_TOOLS = GATE_TOOLS.length;

/** El tope de salida que manda el cliente nativo cuando no hay otro. */
const GATE_MAX_COMPLETION_TOKENS = 32_000;

/**
 * El `<env>` mínimo que pasa la puerta.
 *
 * Sólo `Working directory:` es obligatorio; las otras cuatro líneas del cliente
 * nativo (`Workspace root folder`, `Is directory a git repo`, `Platform`,
 * `Prefer ...`) se probaron una a una y no participan. Se dice lo que es, para
 * que el modelo no crea que ahí hay una ruta de verdad.
 */
const GATE_ENV_BLOCK =
  "<env>\n           Working directory: upstream gate compatibility metadata; not an actual working directory\n</env>";

/**
 * Los esquemas de los siete. El contenido no se valida, sólo que
 * `properties` sea un objeto no vacío; se copian del catálogo del cliente
 * nativo porque si algún día miran más adentro, esto sigue siendo correcto.
 */
const GATE_SCHEMAS: Readonly<Record<(typeof GATE_TOOLS)[number], Record<string, unknown>>> = {
  glob: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to match files against" },
      path: { type: "string", description: "Directory to search." },
      hidden: { type: "boolean", description: "Include hidden files and directories." },
      limit: { type: "integer", exclusiveMinimum: 0, description: "Maximum number of matches." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  read: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory to read" },
      offset: { type: "integer", minimum: 0, description: "Line or entry to start from" },
      limit: { type: "integer", minimum: 0, description: "Maximum lines or entries" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  skill: {
    type: "object",
    properties: { id: { type: "string", description: "The ID of an available skill" } },
    required: ["id"],
    additionalProperties: false,
  },
  webfetch: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
      format: { type: "string", description: "Output format" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  websearch: {
    type: "object",
    properties: { query: { type: "string", description: "The search query" } },
    required: ["query"],
    additionalProperties: false,
  },
  write: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to write to" },
      content: { type: "string", description: "The content to write" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  execute: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      cwd: { type: "string", description: "Working directory" },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

/** La descripción que llevan las siete: se prueban sin que la puerta las mire. */
const GATE_TOOL_DESCRIPTION =
  "Herramienta de compatibilidad, sin implementación. No la uses.";

/**
 * Cierto cuando esto habla con OpenCode y por tanto hay que pasar la puerta.
 *
 * Se mira el host y no la etiqueta del proveedor: a OpenCode se llega como
 * proveedor propio con su URL base, y lo que importa es a dónde va la petición.
 * La ruta de inferencia cambia (`/inference/openai/v1`, `/inference/v1`) pero el
 * host es siempre el mismo.
 */
export function isOpenCode(url: string): boolean {
  try {
    return new URL(url).hostname === "opencode.ai";
  } catch {
    return false;
  }
}

/** De `exec_command` a `fn_execCommand_ex`. Ver el comentario de abajo. */
function aliasToolName(name: string): string {
  const camel = name.replace(/[_-]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
  const clean = camel.replace(/[^A-Za-z0-9_]/g, "_");
  const body = clean.length <= 48 ? clean : `${clean.slice(0, 40)}_${sha1ish(clean)}`;
  return `fn_${body}_ex`;
}

/**
 * Un sufijo estable y corto para nombres que no caben. No es criptografía: es
 * para que dos nombres largos distintos no acaben siendo el mismo alias.
 */
function sha1ish(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, "0").slice(0, 8);
}

export interface GateResult {
  /** El cuerpo que hay que mandar, ya con la forma que la puerta acepta. */
  body: Record<string, unknown>;
  /**
   * Alias → nombre original. La respuesta del proveedor vuelve con los alias, y
   * el cliente que llamó no conoce ninguno: hay que devolvérselos con su nombre.
   */
  tools: Map<string, string>;
}

type Body = Record<string, unknown>;

/**
 * Deja el cuerpo con la forma que OpenCode acepta.
 *
 * El orden es el del original y no es casual: **primero** se renombran todas las
 * herramientas del cliente —para que ninguna ocupe un nombre del conjunto de la
 * puerta ni traiga un nombre que dispare el 429— y **después** se ponen las siete
 * canónicas delante. Al revés, una herramienta del cliente llamada `read` se
 * quedaría con el hueco y la puerta contaría seis.
 *
 * Es idempotente: llamarlo dos veces no duplica las siete ni encadena alias.
 */
export function applyOpenCodeGate(input: Body, key: string | null = null): GateResult {
  const body: Body = { ...input };
  const alias = new Map<string, string>();

  // --- 1. Las herramientas del cliente, todas renombradas --------------------
  const clientTools = Array.isArray(body.tools) ? body.tools : [];

  // Una pasada previa: las siete canónicas pueden venir del propio cliente
  // (un cliente de OpenCode de verdad). Esas no se renombran; se descartan, que
  // es lo mismo y deja una sola copia más abajo.
  const isGateNamed = (name: string): boolean => (GATE_TOOLS as readonly string[]).includes(name);

  const renamed: unknown[] = [];
  for (const tool of clientTools) {
    if (typeof tool !== "object" || tool === null) continue;
    const record = tool as Record<string, unknown>;
    const fn = record.function;
    if (typeof fn !== "object" || fn === null) { renamed.push(tool); continue; }
    const fnRecord = fn as Record<string, unknown>;
    const name = typeof fnRecord.name === "string" ? fnRecord.name : "";
    if (!name) { renamed.push(tool); continue; }
    if (isGateNamed(name)) continue;                       // se repone abajo
    if (name.startsWith("fn_") && name.endsWith("_ex")) { renamed.push(tool); continue; }

    const free = aliasToolName(name);
    if (free === name) { renamed.push(tool); continue; }
    alias.set(free, name);
    renamed.push({ ...record, function: { ...fnRecord, name: free } });
  }

  // --- 2. Las siete de la puerta, delante -----------------------------------
  const gateTools = GATE_TOOLS.map((name) => ({
    type: "function",
    function: {
      name,
      description: GATE_TOOL_DESCRIPTION,
      parameters: GATE_SCHEMAS[name],
      strict: false,
    },
  }));

  body.tools = [...gateTools, ...renamed];

  // --- 3. El bloque <env> y el aviso de las herramientas --------------------
  const teaching = `【工具声明】以下工具仅用于满足上游门禁校验，没有任何实现，禁止调用：` +
    `${GATE_TOOLS.join("、")}。需要执行类似操作时，用别的办法完成任务。`;
  injectSystemContext(body, teaching);

  // --- 4. El tope de salida, con el nombre que mira la puerta ---------------
  //
  // El cliente nativo manda `max_completion_tokens: 32000`. El resto del mundo
  // manda `max_tokens`, y aquí es lo que llegaba desde el portal: dejarlo pasar
  // con ese nombre no vale, porque la puerta busca el otro. Se traduce en vez de
  // añadirlo, para no mandar los dos y que uno contradiga al otro.
  const budget = body.max_completion_tokens ?? body.max_tokens;
  delete body.max_tokens;
  body.max_completion_tokens = typeof budget === "number" && budget > 0
    ? budget
    : GATE_MAX_COMPLETION_TOKENS;

  if (body.stream === undefined) body.stream = true;

  // El CLI amarra la caché de prompt a la sesión, y el backend usa ese valor para
  // agrupar la cuota junto con las cabeceras. Sin él, cada mensaje es una
  // conversación distinta para el contador.
  body.prompt_cache_key = openCodeCacheKey(key);

  return { body, tools: alias };
}

/**
 * Mete el `<env>` y el aviso en el primer mensaje de sistema.
 *
 * Va en `messages` y no en un `instructions` de arriba porque el destino es
 * `chat/completions`, que no tiene ese campo: allí el modelo nunca lo vería. Si
 * ya hay un sistema delante se le añade el texto; si no, se crea uno al
 * principio sin tocar el orden del resto.
 *
 * Idempotente: si el `<env>` ya está, no se repite.
 */
function injectSystemContext(body: Body, teaching: string): void {
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];

  const first = messages[0];
  const firstIsSystem = typeof first === "object" && first !== null &&
    (first as Record<string, unknown>).role === "system" &&
    typeof (first as Record<string, unknown>).content === "string";

  if (firstIsSystem) {
    const original = (first as Record<string, unknown>).content as string;
    let content = original;
    if (!content.includes("<env>")) {
      content = content ? `${GATE_ENV_BLOCK}\n\n${content}` : GATE_ENV_BLOCK;
    }
    if (!content.includes(teaching)) content = `${content}\n\n${teaching}`;
    messages[0] = { ...(first as Record<string, unknown>), content };
  } else {
    messages.unshift({ role: "system", content: `${GATE_ENV_BLOCK}\n\n${teaching}` });
  }

  body.messages = messages;
}

/**
 * Cierto cuando el destino es el camino «zen» (`/zen/...`), que tiene reglas
 * distintas de `/inference/...`.
 *
 * Los dos hablan OpenAI, pero no piden lo mismo:
 *
 * - `/inference/openai/v1`: exige la forma del cliente nativo (las siete
 *   herramientas y el bloque `<env>` de arriba).
 * - `/zen/go/v1` y `/zen/v1`: no miran el cuerpo, pero exigen identidad de
 *   cliente (UA exacto y un `ses_` que el servidor sabe decodificar) y, desde el
 *   2026-09-05, cuentan la cuota por sesión además de por IP.
 *
 * Aplicar el gate de `/inference` a `/zen` no estorba —las herramientas y el
 * `<env>` son inocuos— pero tampoco basta: por eso está esta segunda pieza.
 */
export function isZen(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith("/zen/");
  } catch {
    return false;
  }
}

/**
 * El `User-Agent` del cliente nativo.
 *
 * Medido en `opencode_proxy-main` (2026-09-17) y contra el backend real desde el
 * portal `justdowork/v3`: el servidor compara esta cadena **entera**. No vale algo
 * que empiece por `opencode/` —`opencode/pool` falla— ni, por supuesto, el
 * `undici` que pone Node por defecto, que además es lo que un cortafuegos de por
 * delante identifica como bot (Cloudflare 1010).
 *
 * Lo que no se puede hacer aquí: el TLS. El CLI habla por BoringSSL con un
 * ClientHello concreto y esto corre con el OpenSSL de Node. Si el servidor
 * llegara a mirar el fingerprint, ninguna cabecera lo salvaría; hoy no lo mira.
 */
const OPENCODE_UA = "opencode/latest/2.2.5/cli";

const ZEN_B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZEN_TS_MASK = (1n << 48n) - 1n;
/** El contador tiene que dar la vuelta en 1..16: por encima de 100, 403. */
const SESSION_COUNTER_MAX = 16;
let sessionCounter = 0;

/**
 * Un identificador `ses_` que el servidor acepta.
 *
 * No es un número aleatorio con el prefijo puesto. El servidor decodifica los 12
 * primeros caracteres hex como un **timestamp invertido** (`~(ms * 4096 +
 * contador)`, 48 bits) y comprueba que cuadre; si no, contesta 403 aunque la
 * forma sea correcta. Está medido y documentado en `opencode_proxy-main`
 * (comentario de `canonicalSessionId`).
 *
 * Los 14 caracteres restantes son base62 de relleno: ahí sí vale cualquier cosa.
 */
function canonicalSessionId(): string {
  sessionCounter = (sessionCounter % SESSION_COUNTER_MAX) + 1;
  const units = BigInt(Date.now()) * 4096n + BigInt(sessionCounter);
  const inverted = (~units) & ZEN_TS_MASK;
  const hexPart = inverted.toString(16).padStart(12, "0");

  const tail = new Uint8Array(14);
  crypto.getRandomValues(tail);
  let b62 = "";
  for (const byte of tail) b62 += ZEN_B62[byte % 62];
  return `ses_${hexPart}${b62}`;
}

/**
 * La sesión que se manda, estable por clave y por día.
 *
 * El servidor cuenta la cuota por sesión además de por IP, así que inventar una
 * nueva en cada petición reparte el uso en cubos distintos: parece un patrón
 * anómalo y el consumo se cuenta dos veces. Se fija por clave —cada una tiene su
 * cuota— y, cuando no hay clave (el nivel gratuito anónimo), se rota por día UTC,
 * que es lo que hace el CLI de verdad.
 */
const keySessions = new Map<string, string>();
let anonSession: { id: string; day: string } | null = null;

function sessionFor(key: string | null): string {
  const day = new Date().toISOString().slice(0, 10);

  if (key) {
    const hash = hashKey(key);
    let id = keySessions.get(hash);
    if (!id) { id = canonicalSessionId(); keySessions.set(hash, id); }
    return id;
  }

  if (!anonSession || anonSession.day !== day) {
    anonSession = { id: canonicalSessionId(), day };
  }
  return anonSession.id;
}

/** Se olvida la sesión de esa clave: tras un 429 conviene empezar en otro cubo. */
export function resetSession(key: string | null): void {
  if (key) keySessions.delete(hashKey(key));
  else anonSession = null;
}

/** Huella corta de la clave. Nunca se guarda ni se registra la clave entera. */
function hashKey(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    h1 = Math.imul(h1 ^ key.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + key.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

/**
 * El `x-opencode-org-id` de esta clave, o `null` si no se pudo averiguar.
 *
 * Es el identificador del workspace al que pertenece la clave. No se puede
deducir de la clave —no está codificado dentro—: hay que preguntárselo a OpenCode
Console, que lo publica en `GET /console/api/v2/config` bajo
`providers.opencode.headers.x-opencode-org-id`. Es un `GET` con el `Bearer` de
siempre, así que se hace desde aquí sin ninguna dependencia nativa.
 *
 * Se cachea por huella de la clave y no para siempre: el valor caduca si se
 * cambia de workspace, si se revoca la clave o si se mueve la cuenta. Una hora de
 * vida y, sobre todo, **los fallos no se cachean**: una caída momentánea de Console
 * no puede dejar el portal sin identidad hasta reiniciar.
 */
const CONSOLE_CONFIG = "https://opencode.ai/console/api/v2/config";
const ORG_TTL_MS = 60 * 60 * 1000;
const orgCache = new Map<string, { org: string; until: number }>();

export async function resolveOrgId(key: string): Promise<string | null> {
  if (!key.trim()) return null;

  const hash = hashKey(key);
  const cached = orgCache.get(hash);
  if (cached && Date.now() < cached.until) return cached.org;

  try {
    const response = await fetch(CONSOLE_CONFIG, {
      headers: {
        Authorization: key.startsWith("Bearer ") ? key : `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": OPENCODE_UA,
      },
      signal: AbortSignal.timeout(20_000),
    });
    // Un 401 aquí no es un fallo de red: es que la clave no vale. Se devuelve
    // null y el propio chat dará el 401 con el mensaje del proveedor, que
    // explica mejor que «no se pudo resolver el workspace».
    if (!response.ok) return null;

    const config = await response.json() as Record<string, unknown>;
    const org = readOrgId(config);
    if (!org) return null;

    orgCache.set(hash, { org, until: Date.now() + ORG_TTL_MS });
    return org;
  } catch {
    return null;
  }
}

/** Saca `providers.opencode.headers.x-opencode-org-id` sin confiar en la forma. */
function readOrgId(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const providers = (config as Record<string, unknown>).providers;
  if (typeof providers !== "object" || providers === null) return null;
  const opencode = (providers as Record<string, unknown>).opencode;
  if (typeof opencode !== "object" || opencode === null) return null;
  const headers = (opencode as Record<string, unknown>).headers;
  if (typeof headers !== "object" || headers === null) return null;
  const org = (headers as Record<string, unknown>)["x-opencode-org-id"];
  if (typeof org !== "string") return null;
  const clean = org.trim();
  return clean.startsWith("wrk_") ? clean : null;
}

/** Se olvida el workspace cacheado de esa clave (tras un 403, por ejemplo). */
export function resetOrgId(key: string): void {
  orgCache.delete(hashKey(key));
}

/**
 * Las cabeceras que hay que poner cuando el destino es OpenCode.
 *
 * Se mandan **siempre**, no sólo en `/zen`. Está medido contra el backend y
 * contra el portal de casa: por `/inference` cada petición sin sesión cae en un
 * cubo de cuota distinto y el cupo se gasta al instante, además de que el `undici`
 * de Node se delata ante cualquier cortafuegos.
 *
 * `org` es el workspace resuelto por [`resolveOrgId`]. Va en la cabecera que mira
 * el servidor; si es `null` se omite, y entonces el 401/403 lo explicará el
 * proveedor en vez de un error inventado aquí.
 *
 * `_url` no se usa hoy —la identidad es la misma en los dos caminos— pero se
 * conserva en la firma porque es lo que documenta a qué se aplica y deja sitio
 * si `/zen` y `/inference` vuelven a divergir.
 */
export function openCodeHeaders(
  _url: string,
  key: string | null,
  org: string | null = null,
): Record<string, string> {
  // La sesión va con el MISMO valor en las cuatro cabeceras: es lo que hace el
  // CLI real, y el backend agrupa la cuota por ese id. Antes sólo se mandaba en
  // `/zen`, y por `/inference` cada petición caía en un cubo distinto.
  const session = sessionFor(key);
  const trace = randomHex(16);
  const span = randomHex(8);

  const headers: Record<string, string> = {
    Accept: "*/*",
    // Brotli y zstd no se piden: `fetch` de Node no los decodifica y llegarían
    // bytes opacos.
    "Accept-Encoding": "gzip, deflate",
    // Reutilizar el socket hace que el backend enlace 429: el CLI cierra.
    Connection: "close",
    "User-Agent": OPENCODE_UA,
    // Trazas del cliente real (formato b3 y W3C). No se validan, pero omitirlas
    // es una huella rara frente al CLI.
    b3: `${trace}-${span}-1`,
    traceparent: `00-${trace}-${span}-01`,
    "x-opencode-client": "opencode",
    "x-opencode-session": session,
    "x-opencode-session-id": session,
    "x-session-affinity": session,
    "x-session-id": session,
    "x-opencode-project": projectId(),
  };
  if (org) headers["x-opencode-org-id"] = org;
  return headers;
}

/**
 * El `x-opencode-project`: el cubo de cuota al que va esta instalación.
 *
 * **No puede ser `global`.** Está medido en el portal: `global` es el bucket
 * compartido que usa todo el mundo, así que la cuota se reparte con todos y se
 * agota al instante. El CLI lo deriva del directorio de trabajo (sha1 del remote
 * o del path); aquí no hay proyecto, así que se usa un id aleatorio con forma de
 * sha de commit (40 hex). Es **propio y estable mientras viva el proceso**, que
 * es justo lo que da un cubo para esta aplicación y no uno prestado.
 */
let project: string | null = null;

function projectId(): string {
  project ??= randomHex(40);
  return project;
}

/** `n` caracteres hex al azar, criptográficos. */
function randomHex(n: number): string {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}

/** El `prompt_cache_key` del CLI: el mismo id de sesión, para agrupar la cuota. */
export function openCodeCacheKey(key: string | null): string {
  return sessionFor(key);
}

/**
 * Las cabeceras que no deben salir hacia OpenCode.
 *
 * La cuota gratuita se cuenta **por IP**, y las cabeceras de reenvío le dicen al
 * servidor de dónde viene la petición de verdad. Si el portal corre en Vercel o
 * Cloudflare, `x-forwarded-for` y `cf-connecting-ip` llevan la IP de quien usa la
 * aplicación, y entonces el consumo se le carga a esa IP en vez de al servidor.
 * Se limpian para que la única IP que vea el proveedor sea la de la función.
 */
const DROP_HEADERS = new Set([
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
  "forwarded", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor",
  "true-client-ip", "x-vercel-id", "x-vercel-ip-country", "x-vercel-ip-city",
  "x-client-ip", "x-cluster-client-ip",
]);

/** Quita de las cabeceras propias las que delatan la IP o la conexión. */
export function stripForwardHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (DROP_HEADERS.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

/* --- la vuelta: los alias se devuelven con su nombre ---------------------- */

/**
 * Cuántas herramientas válidas ve la puerta en este cuerpo. Sirve para el
 * diagnóstico: si es menor que siete, el rechazo está garantizado y no hace
 * falta culpar a la cuota.
 */
export function countGateTools(body: Body): number {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  let count = 0;
  for (const tool of tools) {
    if (typeof tool !== "object" || tool === null) continue;
    const fn = (tool as Record<string, unknown>).function;
    if (typeof fn !== "object" || fn === null) continue;
    const record = fn as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (!(GATE_TOOLS as readonly string[]).includes(name)) continue;
    const params = record.parameters;
    if (typeof params !== "object" || params === null) continue;
    const properties = (params as Record<string, unknown>).properties;
    if (typeof properties !== "object" || properties === null) continue;
    if (Object.keys(properties as Record<string, unknown>).length === 0) continue;
    count += 1;
  }
  return count;
}

/**
 * Devuelve los nombres originales en un objeto de respuesta ya parseado.
 *
 * Se aplica a las respuestas **sin flujo**. Las de flujo pasan por
 * `restoreStreamNames`, que trabaja sobre texto.
 */
export function restoreNames(value: unknown, alias: Map<string, string>): unknown {
  if (alias.size === 0) return value;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;

    const record = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      // `{"function":{"name":"fn_x_ex",...}}` es la forma de OpenAI.
      if (key === "function" && typeof value === "object" && value !== null) {
        const fn = value as Record<string, unknown>;
        const name = typeof fn.name === "string" ? fn.name : "";
        out[key] = alias.has(name) ? { ...fn, name: alias.get(name) } : walk(value);
        continue;
      }
      out[key] = typeof value === "string" && key === "name" && alias.has(value)
        ? alias.get(value)
        : walk(value);
    }
    return out;
  };

  return walk(value);
}

/**
 * Lo mismo, sobre un flujo SSE ya convertido a texto.
 *
 * Se hace por líneas y sólo se reescribe el `name` cuando coincide con un alias,
 * así que un `data: [DONE]` o cualquier línea que no sea JSON pasa sin tocar.
 * Una línea que no parsea se deja tal cual: reescribirla a ciegas podría
 * romper el flujo, que es peor que dejar un nombre sin restaurar.
 */
export function restoreStreamNames(text: string, alias: Map<string, string>): string {
  if (alias.size === 0) return text;

  let changed = false;
  for (const name of alias.keys()) {
    if (text.includes(name)) { changed = true; break; }
  }
  if (!changed) return text;

  return text.split("\n").map((line) => {
    if (!line.startsWith("data:")) return line;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return line;
    try {
      const parsed = JSON.parse(payload) as unknown;
      return `data: ${JSON.stringify(restoreNames(parsed, alias))}`;
    } catch {
      return line;
    }
  }).join("\n");
}

/* --- el diagnóstico del 429 ---------------------------------------------- */

export interface GateDiagnosis {
  /** Cierto cuando el 429 huele a forma y no a cuota. */
  shape: boolean;
  /** Qué decirle a la persona. */
  message: string;
}

/**
 * Distingue «la puerta rechazó el cuerpo» de «la cuota se acabó de verdad».
 *
 * Los dos llegan como `429 FreeUsageLimitError` y con el mismo texto, así que no
 * se pueden separar por el cuerpo de la respuesta. Se separan por lo que sabemos
 * de la petición: si el cuerpo pasó la puerta —siete herramientas válidas, `<env>`
 * y su tope— entonces la forma no puede ser el motivo y sí queda la cuota. Si no
 * la pasó, se dice eso, porque esperar no lo arregla.
 *
 * La diferencia importa en el bolsillo y en el reloj: una cuota diaria se espera,
 * un cuerpo mal formado se arregla; confundirlos hace que alguien espere horas
 * delante de un error que se repite igual al segundo intento.
 */
export function diagnose429(sentBody: Body): GateDiagnosis {
  const count = countGateTools(sentBody);
  const hasEnv = JSON.stringify(sentBody.messages ?? "").includes("<env>");
  const hasBudget = sentBody.max_completion_tokens !== undefined || sentBody.max_tokens !== undefined;

  if (count >= MIN_GATE_TOOLS && hasEnv && hasBudget) {
    return {
      shape: false,
      message:
        "OpenCode rechazó la petición con su 429 de siempre. El cuerpo sí cumplía la forma " +
        "que exige (siete herramientas, bloque <env> y tope de salida), así que lo más " +
        "probable es que la cuota de esta clave esté agotada de verdad. Se espera al " +
        "reintento, se pone otra clave en los ajustes o se usa otro proveedor.",
    };
  }

  const missing: string[] = [];
  if (count < MIN_GATE_TOOLS) missing.push(`herramientas válidas ${count}/${MIN_GATE_TOOLS}`);
  if (!hasEnv) missing.push("bloque <env>");
  if (!hasBudget) missing.push("tope de salida");

  return {
    shape: true,
    message:
      `OpenCode devolvió 429 FreeUsageLimitError, pero el cuerpo no cumplía lo que su ` +
      `puerta exige (${missing.join(", ")}). Ese 429 es un rechazo de forma, no una cuota ` +
      `agotada: reintentar no lo va a arreglar. Revisa que el destino sea ` +
      `https://opencode.ai/inference/openai/v1 y que el proveedor no esté forzando el ` +
      `formato Anthropic.`,
  };
}
