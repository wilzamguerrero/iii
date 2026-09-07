import { streamChat } from "./chat.ts";
import { carveJson, oneLine } from "./json.ts";
import { SYSTEM_3I } from "./prompt.ts";
import { PHASES, type PhaseId } from "../method/structures.ts";
import type { ProviderId } from "./types.ts";

/**
 * Del texto de la intención al armazón del proyecto.
 *
 * La persona escribe lo que quiere transformar y de ahí sale una carpeta con tres
 * documentos —Indagar, Idear, Implementar— que no llegan vacíos: cada uno trae las
 * preguntas que hay que responder *en este* proyecto. Es la única forma de que la
 * plataforma no reparta un cuestionario igual para todos, que es justo lo que la
 * metodología no quiere.
 *
 * Por eso las preguntas las hace el modelo y no están escritas en ningún sitio de
 * este repositorio. Aquí sólo se le pide en un formato que se pueda comprobar, y se
 * comprueba: si contesta cualquier otra cosa, esto falla con un aviso claro en vez
 * de escribir basura dentro de Notion.
 */

/** Lo que se propone para una fase. */
export interface Seed {
  phase: PhaseId;
  questions: string[];
}

export interface Proposal {
  /** Nombre para la carpeta. Corto: es el de un proyecto, no un resumen. */
  title: string;
  /** Una línea del modelo sobre lo que leyó en la intención. Puede no venir. */
  note?: string;
  seeds: Seed[];
}

const MAX_TITLE = 90;
const MAX_QUESTIONS = 5;
const MAX_QUESTION = 240;
const MAX_NOTE = 220;

/**
 * Un nombre sacado de la propia intención, sin preguntar a nadie.
 *
 * Existe para que el campo del nombre nunca esté vacío mientras el modelo piensa, y
 * para que se pueda crear el proyecto aunque no haya IA conectada o conteste mal.
 */
export function fallbackTitle(intent: string): string {
  const flat = intent.replace(/\s+/g, " ").trim();
  if (!flat) return "Proyecto";
  // La primera oración, que en una intención suele ser la intención entera.
  const first = flat.split(/(?<=[.!?])\s/)[0] ?? flat;
  const clean = first.replace(/[.\s]+$/, "");
  if (clean.length <= MAX_TITLE) return clean;
  // Cortar por la última palabra que quepa; una palabra partida se lee como error.
  const cut = clean.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, "") + "…";
}

/** El contrato, aparte del sistema de siempre: qué se pide y en qué forma. */
function order(intent: string): string {
  const phases = PHASES.map((phase) => `- "${phase.id}": ${phase.decides}`).join("\n");
  return [
    "Una persona acaba de declarar esta intención de proyecto:",
    "",
    `«${intent.replace(/\s+/g, " ").trim()}»`,
    "",
    "Prepara el arranque de su proyecto. Devuelve SOLO un objeto JSON, sin texto",
    "alrededor y sin vallas de código, con esta forma exacta:",
    "",
    '{"title":"...","note":"...","seeds":[{"phase":"indagar","questions":["...","..."]},',
    '{"phase":"idear","questions":["..."]},{"phase":"implementar","questions":["..."]}]}',
    "",
    "- `title`: nombre para la carpeta del proyecto. Como máximo 90 caracteres, sin",
    "  punto final y sin comillas. Que se reconozca de un vistazo entre otros.",
    "- `note`: una sola frase sobre qué naturaleza de situación te parece que hay en",
    "  esa intención y qué le falta para estar situada. Sin halagos.",
    "- `seeds`: las tres fases, en este orden, con entre dos y cinco preguntas cada",
    "  una. Las preguntas son para que las responda ella escribiendo el documento.",
    "",
    "Cómo tienen que ser las preguntas —es lo más importante de este encargo—:",
    "",
    "- **Sobre este proyecto y sólo sobre este proyecto**: nombran a sus actores,",
    "  sus lugares, su materia, tal como aparecen en la intención. Una pregunta que",
    "  valiera para cualquier proyecto sobra y no entra.",
    "- **De las que cambian algo si se responden**: cada una, respondida, modifica",
    "  lo que el documento dice o decide. «¿Cuál es el objetivo general?» no cambia",
    "  nada y está prohibida, igual que cualquier pregunta de plantilla.",
    "- **En el vocabulario de la situación**: si la intención habla de señalización",
    "  hospitalaria, las preguntas hablan de señalización y de hospitales, no de",
    "  «el contexto del proyecto».",
    "- **La persona sabe de su tema y no de metodología**: nada de jerga del",
    "  oficio («paradigma», «enfoque cualitativo») salvo que ella la usara.",
    "",
    "Qué decide cada fase:",
    "",
    phases,
    "",
    "En el idioma de la intención. Sólo el JSON.",
  ].join("\n");
}

/** Las preguntas de una fase, ya limpias: sin vacías, sin repetidas y con tope. */
function questionsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const one = oneLine(raw, MAX_QUESTION).replace(/^[-*\d.\s]+/, "").trim();
    if (!one) continue;
    const key = one.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(one);
    if (out.length === MAX_QUESTIONS) break;
  }
  return out;
}

export interface ProposeOptions {
  provider?: ProviderId;
  model?: string | null;
  signal?: AbortSignal;
}

/**
 * Le pide al modelo el armazón y devuelve algo con la forma prometida.
 *
 * No hay reintento: si el modelo no sabe contestar JSON, repetirlo sale igual. La
 * pantalla que llama a esto deja crear el proyecto a mano con `fallbackTitle`, que
 * es la salida honesta —el proyecto se crea igual, sólo sin preguntas.
 */
export async function proposeProject(
  intent: string,
  options: ProposeOptions = {},
): Promise<Proposal> {
  const clean = intent.trim();
  if (!clean) throw new Error("No hay intención escrita todavía.");

  const reply = await streamChat({
    messages: [
      { role: "system", content: SYSTEM_3I },
      { role: "user", content: order(clean) },
    ],
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

  const parsed = carveJson(reply) as { title?: unknown; note?: unknown; seeds?: unknown };
  const title = oneLine(parsed.title, MAX_TITLE) || fallbackTitle(clean);
  const note = oneLine(parsed.note, MAX_NOTE);

  // Las fases se recorren desde el modelo, no desde la respuesta: así el orden es
  // el del método y una fase que el modelo se salte queda con lista vacía en su
  // sitio en vez de desordenar las otras.
  const given = Array.isArray(parsed.seeds) ? parsed.seeds : [];
  const seeds: Seed[] = PHASES.map((phase) => {
    const found = given.find(
      (one) => typeof one === "object" && one !== null
        && (one as { phase?: unknown }).phase === phase.id,
    ) as { questions?: unknown } | undefined;
    return { phase: phase.id, questions: questionsOf(found?.questions) };
  });

  if (seeds.every((seed) => seed.questions.length === 0)) {
    throw new Error(
      "El modelo contestó JSON pero sin preguntas dentro. Prueba con otro modelo.",
    );
  }

  return { title, seeds, ...(note ? { note } : {}) };
}
