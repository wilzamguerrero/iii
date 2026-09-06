import { streamChat } from "./chat.ts";
import { carveJson, oneLine } from "./json.ts";
import { SYSTEM_3I } from "./prompt.ts";
import { phaseOf, structureOf, type PhaseId } from "../method/structures.ts";
import type { ProviderId } from "./types.ts";

/**
 * La revisión del documento entero.
 *
 * Es lo que las plataformas de escritura académica hacen bien y por lo que se
 * pagan: alguien que lee lo escrito y dice qué falta. Aquí se toma esa idea y se
 * le quita lo que sobra —el botón que reescribe el párrafo por ti—, porque el
 * documento es el argumento de quien lo firma y un párrafo que uno no escribió no
 * se puede defender delante de un jurado.
 *
 * Así que esto devuelve **observaciones, nunca texto de reemplazo**: qué apartado
 * está flojo, qué afirmación no se sostiene, qué falta para que la fase esté
 * cumplida. Cada una viene anclada a un fragmento literal del documento para que
 * el editor pueda llevar a la persona hasta ahí; el resto lo decide ella.
 *
 * Se revisa contra dos cosas a la vez: lo que la fase tiene que decidir según el
 * método (`structures.ts`) y, si la persona eligió una de las formas del
 * reglamento, sus apartados. Un documento de Indagar al que le falta la naturaleza
 * de la situación está incompleto aunque tenga veinte páginas, y eso no lo dice un
 * corrector de estilo.
 *
 * No inventa fuentes: `SYSTEM_3I` ya lo prohíbe y el contrato de aquí lo repite,
 * porque el sitio donde una plataforma así se rompe es en la cita que nadie
 * comprobó. Cuando hace falta respaldo, la observación dice qué habría que buscar
 * —y buscarlo con DOI es la Fase 7, no esto.
 */

export type ObservationKind = "falta" | "flojo" | "impreciso" | "sobra" | "respaldo";

const KINDS: readonly ObservationKind[] = ["falta", "flojo", "impreciso", "sobra", "respaldo"];

/** Lo que cada tipo quiere decir en la interfaz. */
export const KIND_LABEL: Record<ObservationKind, string> = {
  falta: "Falta",
  flojo: "Flojo",
  impreciso: "Impreciso",
  sobra: "Sobra",
  respaldo: "Sin respaldo",
};

export interface Observation {
  kind: ObservationKind;
  /**
   * El apartado o el fragmento al que se refiere, copiado del documento. El editor
   * lo busca en el texto para poder llevar hasta ahí; si no lo encuentra, la
   * observación se lee igual.
   */
  where: string;
  /** Qué pasa y por qué. Una o dos frases. */
  note: string;
}

export interface Review {
  /** El documento en una línea: en qué punto está de verdad. */
  verdict: string;
  observations: Observation[];
}

/** Tope de lo que se manda a revisar. Un informe final no cabe entero. */
const MAX_CHARS = 24_000;
/** Menos que esto no es un documento, es un título. */
const MIN_CHARS = 120;

const MAX_OBSERVATIONS = 12;
const MAX_WHERE = 120;
const MAX_NOTE = 300;
const MAX_VERDICT = 220;

export interface ReviewOptions {
  name: string;
  content: string;
  intent?: string | null;
  /** La fase a la que pertenece el documento, cuando se sabe. */
  phase?: PhaseId | null;
  /** El id de la estructura del reglamento contra la que revisar, si se eligió una. */
  structure?: string | null;
  provider?: ProviderId;
  model?: string | null;
  signal?: AbortSignal;
  /** Para que el editor pueda decir «está leyendo» con algo detrás. */
  onDelta?: (chunk: string) => void;
}

function order(options: ReviewOptions): string {
  const content = options.content.trim();
  const clipped = content.length > MAX_CHARS;

  const lines: string[] = [
    "Revisa el documento de abajo. No lo reescribas: dime qué le falta y qué no se",
    "sostiene.",
    "",
    `Documento: «${options.name.trim() || "sin título"}».`,
  ];

  const intent = options.intent?.trim();
  if (intent) lines.push(`Intención del proyecto: «${intent}».`);

  if (options.phase) {
    const phase = phaseOf(options.phase);
    lines.push(
      "",
      `Este documento es el de ${phase.name}, y lo que esa fase tiene que decidir es:`,
      phase.decides,
    );
  }

  const structure = options.structure ? structureOf(options.structure) : null;
  if (structure) {
    lines.push(
      "",
      `Además sigue la forma «${structure.name}» (${structure.source}), cuyos apartados son:`,
      structure.items.map((item) => `${"  ".repeat(item.level - 1)}- ${item.text}`).join("\n"),
      "Di qué apartado está vacío o no cumple lo que su título promete.",
    );
  }

  lines.push(
    "",
    "Contesta sólo con este JSON, sin nada alrededor:",
    "",
    "{ \"verdict\": \"…\", \"observations\": [ { \"kind\": \"…\", \"where\": \"…\", \"note\": \"…\" } ] }",
    "",
    "- «verdict»: una línea sobre en qué punto está el documento. Sin halagos.",
    `- «kind»: uno de ${KINDS.join(", ")}.`,
    "  falta = no está y hace falta · flojo = está pero no sostiene lo que afirma ·",
    "  impreciso = se puede leer de dos maneras · sobra = repite algo o no aporta ·",
    "  respaldo = afirma algo que necesita evidencia y no la trae.",
    "- «where»: un fragmento **copiado literal** del documento —un título o media",
    "  frase— para poder localizarlo. Si es algo que falta del todo, el título del",
    "  apartado donde debería estar.",
    "- «note»: qué pasa y por qué, en una o dos frases. Sin texto de reemplazo: no",
    "  escribas el párrafo corregido.",
    "",
    `Como máximo ${MAX_OBSERVATIONS} observaciones, las que de verdad cambian el documento,`,
    "de la más importante a la menos. Si algo está bien, no lo digas. Si el documento",
    "sólo tiene el armazón vacío, la observación es eso y no doce apartados vacíos.",
    "No inventes autores, años ni DOI: si hace falta respaldo, di qué habría que buscar.",
    "",
    "En el idioma del documento. Sólo el JSON.",
    "",
    `--- documento${clipped ? " (recortado)" : ""} ---`,
    clipped ? `${content.slice(0, MAX_CHARS)}\n[…]` : content,
  );

  return lines.join("\n");
}

function kindOf(value: unknown): ObservationKind {
  const raw = typeof value === "string" ? value.trim().toLocaleLowerCase("es") : "";
  return KINDS.find((kind) => kind === raw) ?? "flojo";
}

function observationsOf(value: unknown): Observation[] {
  if (!Array.isArray(value)) return [];
  const out: Observation[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const one = raw as { kind?: unknown; where?: unknown; note?: unknown };
    const note = oneLine(one.note, MAX_NOTE);
    if (!note) continue;

    // Dos observaciones con el mismo texto son una: hay modelos que repiten la
    // misma pega en dos apartados distintos y leerla dos veces no añade nada.
    const key = note.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ kind: kindOf(one.kind), where: oneLine(one.where, MAX_WHERE), note });
    if (out.length === MAX_OBSERVATIONS) break;
  }

  return out;
}

/**
 * Pide la revisión y devuelve lo que se pueda usar.
 *
 * Va en flujo como todo lo demás —el mismo camino que una pregunta normal, porque
 * una pasarela puede contestar a un camino y no al otro— aunque aquí los trozos no
 * se muestren: sirven para que el editor sepa que algo está pasando.
 */
export async function reviewDocument(options: ReviewOptions): Promise<Review> {
  const content = options.content.trim();
  if (content.length < MIN_CHARS) {
    throw new Error(
      "El documento está casi vacío. Escribe un poco y vuelve a pedir la revisión.",
    );
  }

  const reply = await streamChat({
    messages: [
      { role: "system", content: SYSTEM_3I },
      { role: "user", content: order({ ...options, content }) },
    ],
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.onDelta !== undefined ? { onDelta: options.onDelta } : {}),
  });

  const parsed = carveJson(reply) as { verdict?: unknown; observations?: unknown };
  const observations = observationsOf(parsed.observations);
  const verdict = oneLine(parsed.verdict, MAX_VERDICT);

  if (!verdict && observations.length === 0) {
    throw new Error(
      "El modelo contestó JSON pero sin observaciones dentro. Prueba con otro modelo.",
    );
  }

  return { verdict, observations };
}
