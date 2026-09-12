import { streamChat } from "./chat.ts";
import { carveJson, oneLine } from "./json.ts";
import { SYSTEM_3I } from "./prompt.ts";
import {
  DIAGNOSIS_RULE,
  NATURES,
  SYNTHESIS,
  natureOf,
  type NatureId,
} from "../method/indagar.ts";
import type { ProviderId } from "./types.ts";

/**
 * Las cuatro cosas que el modelo hace dentro de Indagar.
 *
 * Indagar dejó de ser un documento en blanco con preguntas a un lado: ahora la
 * ruta está dentro del texto y responderla es avanzar. Eso le abre al modelo
 * cuatro sitios donde sirve de verdad, y ninguno es escribir el documento:
 *
 * - `askStep` — preguntar **de este proyecto** dentro de un paso. Las preguntas
 *   del método ya están escritas en `indagar.ts` y valen para cualquiera; éstas
 *   nombran a los actores y los lugares de esta situación, que es lo único que
 *   una lámina no puede traer hecho.
 * - `draftAnswer` — redactar un borrador de respuesta **con lo que ya hay en el
 *   documento**, y decir aparte qué falta averiguar. No es la respuesta: es la
 *   primera versión que alguien va a corregir. Lo que no está en el documento no
 *   se inventa, se declara como hueco.
 * - `diagnose` — leer la evidencia reunida y ordenar las siete naturalezas por
 *   cuál sostiene mejor, citando el fragmento en el que se apoya. Ordena; no
 *   elige. La naturaleza la toma la persona en el mapa, y esto existe para que
 *   la tome mirando evidencia y no intuición, que es literalmente la regla del
 *   método.
 * - `synthesize` — proponer los siete puntos de la síntesis y la intención
 *   situada a partir de lo que está respondido. Es el único sitio donde el
 *   modelo resume, y resume lo que la persona escribió.
 *
 * Los cuatro piden JSON y lo comprueban. Si el modelo contesta otra cosa, esto
 * falla con un aviso en castellano y no entra nada en el documento: es mejor un
 * error claro que una frase inventada dentro de una investigación.
 *
 * Ninguno reintenta. Si un modelo no sabe contestar en formato, repetirlo sale
 * igual y sólo gasta el rato de quien espera.
 */

/** Lo común a los cuatro encargos. */
export interface Ask {
  provider?: ProviderId;
  model?: string | null;
  signal?: AbortSignal;
}

/** Tope de documento que se manda. Un Indagar largo no cabe entero. */
const MAX_CHARS = 16_000;
/** Menos que esto no es un documento del que se pueda decir nada. */
const MIN_CHARS = 60;

const MAX_ASKS = 3;
const MAX_ASK = 240;
const MAX_ANSWER = 900;
const MAX_GAPS = 4;
const MAX_GAP = 180;
const MAX_WHY = 240;
const MAX_EVIDENCE = 180;
const MAX_POINT = 600;
const MAX_SITUATED = 500;

/* --- preguntar dentro de un paso ------------------------------------------ */

/** El paso para el que se piden preguntas. */
export interface StepAsk {
  /** Su título en el documento. */
  head: string;
  /** Qué se hace en él. */
  action: string;
  /** Qué deja hecho cuando está hecho. */
  output: string;
  /** Las preguntas que ya están puestas ahí. No se repiten. */
  already: readonly string[];
}

export interface AskStepOptions extends Ask {
  step: StepAsk;
  content: string;
  intent?: string | null;
  /** El nombre de la naturaleza, si ya se diagnosticó. */
  nature?: string | null;
}

/**
 * Preguntas de este proyecto para este paso.
 *
 * Tres como máximo, y a propósito: el paso ya trae las suyas escritas, y una
 * batería de diez preguntas no se responde, se cierra.
 */
export async function askStep(options: AskStepOptions): Promise<string[]> {
  const { step } = options;
  const order = [
    `Una persona está en el paso «${step.head}» de la fase Indagar del método 3i.`,
    `En este paso se ${step.action}, y sale de él ${step.output}.`,
    "",
    ...intentLines(options.intent),
    ...natureLines(options.nature),
    "Esto es lo que lleva escrito en el documento:",
    "",
    fence(options.content),
    "",
    ...alreadyLines(step.already),
    "Hazle como máximo tres preguntas más para este paso. Devuelve SOLO un objeto",
    "JSON, sin texto alrededor y sin vallas de código:",
    "",
    '{"questions":["...","..."]}',
    "",
    "Cómo tienen que ser —es lo único que importa de este encargo—:",
    "",
    "- **De este proyecto**: nombran a sus actores, sus lugares y su materia tal",
    "  como aparecen en lo escrito. Una pregunta que valiera para cualquier",
    "  proyecto sobra y no entra.",
    "- **Del paso en el que está**: no adelantan el siguiente ni repiten el",
    "  anterior. Si el paso es abrir contexto, preguntan por el contexto.",
    "- **De las que cambian el documento al responderse**. Si respondida no",
    "  cambia nada de lo que el documento dice, no la hagas.",
    "- **Sin jerga de metodología**: ella sabe de su tema, no del oficio.",
    "- Cada una empieza con su signo de apertura y termina con el de cierre.",
    "",
    "Si con lo escrito no hay nada útil que preguntar, devuelve la lista vacía.",
    "En el idioma del documento. Sólo el JSON.",
  ].join("\n");

  const parsed = await askModel(order, options) as { questions?: unknown };
  return list(parsed.questions, MAX_ASK, MAX_ASKS);
}

/* --- redactar un borrador de respuesta ------------------------------------ */

export interface Draft {
  /** El borrador. De quien lo corrija, no del modelo. */
  answer: string;
  /** Lo que no está en el documento y hace falta para responder de verdad. */
  gaps: string[];
}

export interface DraftOptions extends Ask {
  /** La pregunta que hay que responder, literal. */
  question: string;
  /** El apartado donde está. */
  head: string;
  content: string;
  intent?: string | null;
}

/**
 * Un borrador de respuesta hecho sólo con lo que ya hay escrito.
 *
 * Aquí es donde una plataforma así se rompe si se descuida: un modelo que
 * rellena huecos con plausibilidades mete en una investigación afirmaciones que
 * nadie puede defender. Por eso el contrato le prohíbe traer nada de fuera del
 * documento y le obliga a declarar en `gaps` lo que le faltaría. Lo que devuelve
 * entra en el documento sólo cuando la persona lo acepta, y entra como lo que
 * es: un borrador para corregir.
 */
export async function draftAnswer(options: DraftOptions): Promise<Draft> {
  const clean = options.content.trim();
  if (clean.length < MIN_CHARS) {
    throw new Error(
      "Todavía no hay suficiente escrito en el documento para redactar nada con " +
      "fundamento. Responde algo primero, aunque sea en bruto.",
    );
  }

  const order = [
    `En el apartado «${options.head}» de un documento de Indagar hay esta pregunta:`,
    "",
    `«${oneLine(options.question, MAX_ASK)}»`,
    "",
    ...intentLines(options.intent),
    "Y esto es el documento entero, que es todo lo que se sabe de esta situación:",
    "",
    fence(options.content),
    "",
    "Redacta un borrador de respuesta. Devuelve SOLO un objeto JSON, sin texto",
    "alrededor y sin vallas de código:",
    "",
    '{"answer":"...","gaps":["...","..."]}',
    "",
    "- `answer`: la respuesta en uno o dos párrafos, en prosa corrida, sin",
    "  títulos y sin viñetas. Separa los párrafos con una línea en blanco.",
    "- `gaps`: hasta cuatro cosas concretas que no están en el documento y que",
    "  haría falta averiguar para responder esto de verdad. Vacío si no falta nada.",
    "",
    "Las reglas, que no son negociables:",
    "",
    "- **Sólo con lo que hay en el documento.** No traigas datos, cifras, nombres,",
    "  autores ni referencias que no estén ahí escritos. Ni una fecha.",
    "- **Nada de citas ni bibliografía.** Si hace falta respaldo, dilo en `gaps`.",
    "- **Lo que no se sabe va en `gaps`, no en `answer`.** Antes una respuesta",
    "  corta y honesta que una completa y falsa.",
    "- **En primera persona del plural o impersonal**, como el resto del",
    "  documento. Sin dirigirte a nadie y sin hablar de ti.",
    "- **Sin frases de relleno**: nada de «es importante señalar que».",
    "",
    "En el idioma del documento. Sólo el JSON.",
  ].join("\n");

  const parsed = await askModel(order, options) as { answer?: unknown; gaps?: unknown };
  const answer = paragraphs(parsed.answer);
  if (!answer) {
    throw new Error("El modelo contestó JSON pero sin respuesta dentro.");
  }
  return { answer, gaps: list(parsed.gaps, MAX_GAP, MAX_GAPS) };
}

/* --- diagnosticar la naturaleza ------------------------------------------- */

export interface Guess {
  nature: NatureId;
  /** Por qué esta lectura encaja, en una o dos frases. */
  why: string;
  /** El fragmento del documento en que se apoya. Copiado, no parafraseado. */
  evidence: string;
}

export interface Diagnosis {
  /** Las naturalezas que el documento sostiene, de la que más a la que menos. */
  ranked: Guess[];
  /** Qué falta averiguar para poder diagnosticar con seguridad. */
  missing: string[];
}

export interface DiagnoseOptions extends Ask {
  content: string;
  intent?: string | null;
}

/**
 * Las siete naturalezas ordenadas por cuál sostiene la evidencia reunida.
 *
 * Ordena y cita; no decide. La decisión se toma en el mapa, con el dedo de la
 * persona, y esto está para que la tome habiendo leído qué evidencia apunta a
 * dónde. La regla del método —la naturaleza se infiere del contexto, no se elige
 * por intuición— va literal dentro del encargo, porque es exactamente lo que un
 * modelo complaciente se salta si no se lo dices.
 */
export async function diagnose(options: DiagnoseOptions): Promise<Diagnosis> {
  const clean = options.content.trim();
  if (clean.length < MIN_CHARS) {
    throw new Error(
      "Con lo que hay escrito no se puede diagnosticar nada. Abre el contexto " +
      "primero: sin evidencia, elegir naturaleza es adivinar.",
    );
  }

  const table = NATURES.map(
    (one) => `- "${one.id}" (${one.name}): ${one.question}`,
  ).join("\n");

  const order = [
    "Esto es un documento de la fase Indagar del método 3i. La persona ya abrió",
    "el contexto y le toca diagnosticar de qué naturaleza es su situación.",
    "",
    `La regla del método, literal: ${DIAGNOSIS_RULE}`,
    "",
    ...intentLines(options.intent),
    "El documento:",
    "",
    fence(options.content),
    "",
    "Las siete naturalezas posibles y su pregunta central:",
    "",
    table,
    "",
    "Devuelve SOLO un objeto JSON, sin texto alrededor y sin vallas de código:",
    "",
    '{"ranked":[{"nature":"problema","why":"...","evidence":"..."}],"missing":["..."]}',
    "",
    "- `ranked`: de una a tres naturalezas, de la que la evidencia sostiene mejor",
    "  a la que menos. Usa los identificadores de la lista, tal cual.",
    "- `why`: por qué el documento apunta ahí. Una o dos frases.",
    "- `evidence`: un fragmento **copiado literalmente del documento** en el que",
    "  se apoya esa lectura. Si no puedes copiar ninguno, esa naturaleza no entra.",
    "- `missing`: hasta cuatro cosas que habría que averiguar para poder",
    "  diagnosticar con seguridad. Vacío si la evidencia ya alcanza.",
    "",
    "Qué no hacer:",
    "",
    "- **No elijas por ella.** Ordenas lecturas posibles; decide la persona.",
    "- **No confundas el tipo de proyecto con la naturaleza de la situación.**",
    "- **No pongas las siete** para quedar bien: sólo las que el documento",
    "  sostenga. Si sólo sostiene una, devuelve una.",
    "- **Situación mixta no es la salida cómoda**: úsala cuando de verdad haya",
    "  varias naturalezas trenzadas y puedas decir cuáles.",
    "",
    "En el idioma del documento. Sólo el JSON.",
  ].join("\n");

  const parsed = await askModel(order, options) as { ranked?: unknown; missing?: unknown };
  const given = Array.isArray(parsed.ranked) ? parsed.ranked : [];
  const seen = new Set<string>();
  const ranked: Guess[] = [];

  for (const raw of given) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as { nature?: unknown; why?: unknown; evidence?: unknown };
    const nature = natureOf(String(row.nature ?? "").trim().toLowerCase());
    if (!nature || seen.has(nature.id)) continue;
    const why = oneLine(row.why, MAX_WHY);
    if (!why) continue;
    seen.add(nature.id);
    ranked.push({
      nature: nature.id,
      why,
      evidence: oneLine(row.evidence, MAX_EVIDENCE),
    });
    if (ranked.length === 3) break;
  }

  if (ranked.length === 0) {
    throw new Error(
      "El modelo no pudo apoyar ninguna naturaleza en el documento. Puede que " +
      "falte contexto, o que haya contestado mal: prueba con otro modelo.",
    );
  }

  return { ranked, missing: list(parsed.missing, MAX_GAP, MAX_GAPS) };
}

/* --- sintetizar la salida ------------------------------------------------- */

export interface Point {
  question: string;
  answer: string;
}

export interface Synthesis {
  /** Los siete puntos, en el orden del método. */
  points: Point[];
  /** La intención situada con la que Indagar pasa a Idear. */
  situated: string;
}

export interface SynthesizeOptions extends Ask {
  content: string;
  intent?: string | null;
  /** El nombre de la naturaleza diagnosticada. */
  nature?: string | null;
}

/**
 * La síntesis de situación 3i y la intención situada, propuestas.
 *
 * Los siete puntos se recorren desde `SYNTHESIS` y no desde la respuesta del
 * modelo: así el orden es el del método y un punto que el modelo se salte queda
 * vacío en su sitio en vez de desordenar los otros. Es la misma cautela que
 * `proposeProject` tiene con las fases.
 */
export async function synthesize(options: SynthesizeOptions): Promise<Synthesis> {
  const clean = options.content.trim();
  if (clean.length < MIN_CHARS) {
    throw new Error("No hay documento del que sintetizar nada todavía.");
  }

  const asks = SYNTHESIS.map((one, index) => `${index + 1}. ${one}`).join("\n");
  const order = [
    "Esto es un documento de la fase Indagar del método 3i, ya recorrido. Toca",
    "cerrarlo con la síntesis de situación y la intención situada.",
    "",
    ...intentLines(options.intent),
    ...natureLines(options.nature),
    "El documento:",
    "",
    fence(options.content),
    "",
    "Los siete puntos de la síntesis, en este orden:",
    "",
    asks,
    "",
    "Devuelve SOLO un objeto JSON, sin texto alrededor y sin vallas de código:",
    "",
    '{"answers":["...","...","...","...","...","...","..."],"situated":"..."}',
    "",
    "- `answers`: siete entradas, una por punto y en el mismo orden. Cada una en",
    "  prosa, de una a cuatro frases, sin títulos y sin viñetas.",
    "- `situated`: la intención situada. Con base en lo aprendido, dice el foco,",
    "  las personas y el contexto que van a orientar la ideación. Un párrafo.",
    "",
    "Las reglas:",
    "",
    "- **Sólo con lo que está escrito en el documento.** Esto es un resumen de lo",
    "  que la persona averiguó, no una ampliación. Sin datos nuevos y sin citas.",
    "- **Si un punto no está respondido en el documento, dilo en su entrada** en",
    "  una frase, y no lo rellenes.",
    "- **La intención situada no es la intención inicial repetida**: lleva dentro",
    "  lo que se aprendió al indagar.",
    "- Sin frases de relleno y sin halagos.",
    "",
    "En el idioma del documento. Sólo el JSON.",
  ].join("\n");

  const parsed = await askModel(order, options) as { answers?: unknown; situated?: unknown };
  const given = Array.isArray(parsed.answers) ? parsed.answers : [];
  const points = SYNTHESIS.map((question, index) => ({
    question,
    answer: paragraphs(given[index], MAX_POINT),
  }));

  if (points.every((one) => !one.answer)) {
    throw new Error("El modelo contestó JSON pero sin síntesis dentro.");
  }

  return { points, situated: paragraphs(parsed.situated, MAX_SITUATED) };
}

/* --- las tripas ----------------------------------------------------------- */

/** El encargo, con el sistema de siempre delante, y su JSON ya extraído. */
async function askModel(order: string, options: Ask): Promise<unknown> {
  const reply = await streamChat({
    messages: [
      { role: "system", content: SYSTEM_3I },
      { role: "user", content: order },
    ],
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return carveJson(reply);
}

/** La intención, si la hay, como dos líneas del encargo. */
function intentLines(intent: string | null | undefined): string[] {
  const clean = (intent ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return [`La intención declarada del proyecto: «${clean}»`, ""];
}

/** La naturaleza tomada, si la hay. */
function natureLines(nature: string | null | undefined): string[] {
  const clean = (nature ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return [`La naturaleza diagnosticada de la situación: ${clean}.`, ""];
}

/** Las preguntas que ya están puestas, para que no las repita. */
function alreadyLines(already: readonly string[]): string[] {
  const clean = already.map((one) => oneLine(one, MAX_ASK)).filter(Boolean);
  if (clean.length === 0) return [];
  return [
    "Estas preguntas ya están puestas en ese apartado. No las repitas ni las",
    "reformules:",
    "",
    ...clean.map((one) => `- ${one}`),
    "",
  ];
}

/**
 * El documento entre vallas, recortado si no cabe.
 *
 * Se recorta por los dos extremos y no por el final: el principio lleva la
 * intención y los primeros pasos, y el final lleva lo último que se escribió,
 * que es justo donde suele estar la pregunta que se está respondiendo.
 */
function fence(content: string): string {
  const clean = content.trim();
  if (clean.length <= MAX_CHARS) return ["---", clean, "---"].join("\n");
  const head = Math.floor(MAX_CHARS * 0.6);
  const tail = MAX_CHARS - head;
  return [
    "---",
    clean.slice(0, head),
    "",
    "[…recortado…]",
    "",
    clean.slice(-tail),
    "---",
  ].join("\n");
}

/** Una lista de líneas limpia: sin vacías, sin repetidas y con tope. */
function list(value: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const one = oneLine(raw, max).replace(/^[-*\d.\s]+/, "").trim();
    if (!one) continue;
    const key = one.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(one);
    if (out.length === cap) break;
  }
  return out;
}

/**
 * Prosa de varios párrafos, limpia de lo que no sobrevive al viaje a Notion.
 *
 * `oneLine` no sirve aquí porque una respuesta puede tener dos párrafos, pero
 * hay que quitar lo demás: títulos, viñetas y marcas de negrita o cursiva. El
 * traductor de bloques no lleva formato dentro del texto, así que un asterisco
 * que se cuele se guardaría como asterisco y se vería como un error de quien
 * escribe.
 */
function paragraphs(value: unknown, max = MAX_ANSWER): string {
  if (typeof value !== "string") return "";
  const clean = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/\*\*|__|\*|`/g, "")
      .trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut).trim() + "…";
}
