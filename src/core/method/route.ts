/**
 * La ruta de Indagar, leída del documento y escrita en el documento.
 *
 * Aquí no hay estado. Nada de «en qué paso va el usuario» guardado en un lado y
 * el texto en otro: el documento **es** el estado. Los títulos dicen qué pasos
 * hay, las citas que preguntan dicen qué se preguntó, lo escrito debajo
 * de cada una dice qué se respondió, y la línea `> Naturaleza:` dice qué ruta se
 * tomó. Se lee así por la misma razón que `structureInText` lee la estructura
 * del texto: lo que la persona ve escrito y lo que la plataforma cree no pueden
 * ser dos cosas distintas, y menos después de que alguien edite el documento en
 * Notion desde el teléfono.
 *
 * Lo que sale de aquí alimenta tres cosas: la columna de indagación (qué toca
 * ahora), el mapa de nodos (por dónde va la ruta) y las preguntas dentro del
 * documento (cuáles están sin responder).
 */

import {
  COMMON,
  SITUATED_HEAD,
  SITUATED_SAYS,
  SYNTHESIS_HEAD,
  commonHead,
  flat,
  natureByName,
  natureHead,
  natureMarkdown,
  natureOf,
  situatedMarkdown,
  synthesisMarkdown,
  type Nature,
  type NatureId,
} from "./indagar.ts";

/** En qué tramo de Indagar está el documento. */
export type Stage = "comun" | "diagnostico" | "naturaleza" | "salida" | "listo";

/** De qué tramo es un paso. */
export type Part = "comun" | "naturaleza" | "salida";

export interface RouteAsk {
  question: string;
  /** El paso donde está, por su id. */
  step: string;
  /** El título del apartado, para poder decir dónde está. */
  head: string;
  answered: boolean;
  /** Su línea en el documento, base 0: con esto se salta hasta ella. */
  line: number;
}

export interface RouteStep {
  id: string;
  n: number;
  name: string;
  /** El título tal como aparece —o aparecerá— en el documento. */
  head: string;
  part: Part;
  /** Qué deja este paso cuando está hecho. */
  says: string;
  /** Si el apartado existe en el documento. */
  present: boolean;
  /** Palabras escritas dentro, sin contar lo que puso la plataforma. */
  words: number;
  asked: number;
  answered: number;
  done: boolean;
  /** La línea del título, o -1 si el apartado todavía no está. */
  line: number;
}

export interface Route {
  /** La naturaleza diagnosticada, o nada si aún no se ha diagnosticado. */
  nature: Nature | null;
  /** La línea donde se declaró, o -1. */
  natureAt: number;
  steps: readonly RouteStep[];
  questions: readonly RouteAsk[];
  /** Las que siguen sin responder, en el orden en que aparecen. */
  open: readonly RouteAsk[];
  stage: Stage;
  /** El paso que toca. Nada si la ruta está recorrida. */
  next: RouteStep | null;
  done: number;
  /** Siempre 11: cuatro comunes, cinco de la naturaleza y dos de salida. */
  total: number;
}

/** Pasos de cualquier naturaleza: las siete tienen cinco. */
const BRANCH_STEPS = 5;

/**
 * Palabras a partir de las cuales un apartado sin preguntas cuenta como hecho.
 *
 * Hace falta un número porque «hecho» tiene que poder decidirse sin preguntarle
 * a nadie, y veinte palabras es lo mínimo con lo que se dice algo. Los apartados
 * que sí traen preguntas no usan esto: están hechos cuando están respondidas.
 */
const MIN_WORDS = 20;

const MARK = /<!--b:[a-f0-9-]+-->\s*$/;
const HEAD = /^##\s+(.+?)\s*$/;
const QUOTE = /^>\s?(.*)$/;
const NATURE = /^>\s*Naturaleza:\s*(.+?)(?:\s*·|$)/i;
const TOOLS = /^Herramientas sugeridas/i;
const ENDS = /^>\s*Esta ruta termina en:/i;
const PLUMBING = /^(Naturaleza|Avanza cuando|Esta ruta termina en|Estructura|Intención)\s*:/i;
const BRANCH = /^(.+?)\s*·\s*(\d+)\.\s+(.+)$/;

/* --- leer ----------------------------------------------------------------- */

/**
 * La naturaleza declarada en el texto, si hay alguna.
 *
 * Copia exacta de la costura de `structureInText`: una línea de cita que
 * empieza por `Naturaleza:`, el nombre hasta el punto medio, y el nombre se
 * compara sin tildes para que escribirlo a mano no rompa nada.
 */
export function natureInText(text: string): Nature | null {
  for (const raw of text.split(/\r?\n/)) {
    const found = NATURE.exec(bare(raw).trim());
    const name = found?.[1]?.trim();
    if (name) {
      const nature = natureByName(name);
      if (nature) return nature;
    }
  }
  return null;
}

/** La ruta entera, tal como está el documento ahora mismo. */
export function readRoute(text: string): Route {
  const lines = text.split(/\r?\n/);
  const parts = cuts(lines);
  const nature = natureInText(text);
  const natureAt = lines.findIndex((one) => NATURE.test(bare(one).trim()));

  const questions: RouteAsk[] = [];
  const steps: RouteStep[] = [];

  const add = (id: string, n: number, name: string, head: string, part: Part, says: string) => {
    const cut = parts.find((one) => flat(one.head) === flat(head)) ?? null;
    const seen = cut
      ? look(lines, cut.at + 1, cut.end, id, head)
      : { asks: [] as RouteAsk[], words: 0 };
    questions.push(...seen.asks);

    const asked = seen.asks.length;
    const answered = seen.asks.filter((one) => one.answered).length;
    steps.push({
      id, n, name, head, part, says,
      present: cut !== null,
      words: seen.words,
      asked,
      answered,
      done:
        cut !== null &&
        asked === answered &&
        (answered > 0 || seen.words >= MIN_WORDS),
      line: cut?.at ?? -1,
    });
  };

  for (const step of COMMON) {
    add(step.id, step.n, step.name, commonHead(step), "comun", step.output);
  }
  if (nature) {
    for (const step of nature.steps) {
      add(
        `${nature.id}-${step.n}`, step.n, step.name,
        natureHead(nature, step), "naturaleza", step.ask,
      );
    }
  }
  // La salida común se mide siempre, aunque todavía no esté escrita: es parte de
  // la ruta desde el principio y el mapa la dibuja desde el principio.
  add("sintesis", 1, SYNTHESIS_HEAD, SYNTHESIS_HEAD, "salida", "los siete puntos de la situación");
  add("situada", 2, SITUATED_HEAD, SITUATED_HEAD, "salida", "el foco, las personas y el contexto");

  const common = steps.filter((one) => one.part === "comun");
  const branch = steps.filter((one) => one.part === "naturaleza");
  const out = steps.filter((one) => one.part === "salida");
  const before = common.filter((one) => one.id !== "diagnostico");

  let stage: Stage;
  let next: RouteStep | null;
  if (!before.every((one) => one.done)) {
    stage = "comun";
    next = before.find((one) => !one.done) ?? null;
  } else if (!nature) {
    // Los tres primeros pasos están; falta diagnosticar, y hasta que no se
    // diagnostique no hay ruta que seguir. Aquí se abre el mapa.
    stage = "diagnostico";
    next = common.find((one) => one.id === "diagnostico") ?? null;
  } else if (!branch.every((one) => one.done)) {
    stage = "naturaleza";
    next = branch.find((one) => !one.done) ?? null;
  } else if (!out.every((one) => one.done)) {
    stage = "salida";
    next = out.find((one) => !one.done) ?? null;
  } else {
    stage = "listo";
    next = null;
  }

  return {
    nature,
    natureAt,
    steps,
    questions,
    open: questions.filter((one) => !one.answered),
    stage,
    next,
    done: steps.filter((one) => one.done).length,
    total: steps.length + (nature ? 0 : BRANCH_STEPS),
  };
}

/** Las preguntas de un paso, en el orden del documento. */
export function asksOf(route: Route, step: string): readonly RouteAsk[] {
  return route.questions.filter((one) => one.step === step);
}

/** El paso al que pertenece una línea del documento, si pertenece a alguno. */
export function stepAt(route: Route, line: number): RouteStep | null {
  let found: RouteStep | null = null;
  for (const step of route.steps) {
    if (step.line >= 0 && step.line <= line && (!found || step.line > found.line)) {
      found = step;
    }
  }
  return found;
}

/* --- escribir ------------------------------------------------------------- */

/**
 * El documento con la naturaleza tomada.
 *
 * Tres cosas pasan aquí, y en este orden:
 *
 * 1. Se va la declaración anterior con sus dos líneas de acompañamiento. Dos
 *    declaraciones en el mismo documento serían dos verdades a la vez.
 * 2. Los apartados de la naturaleza elegida se recogen **enteros**, con lo que
 *    tuvieran escrito y con sus marcas de bloque, y se vuelven a emitir en
 *    orden: así, volver a una naturaleza que ya se había recorrido la devuelve
 *    tal como estaba. Los de las otras naturalezas se quedan donde están si
 *    tienen algo escrito —cambiar de ruta no borra trabajo— y desaparecen si
 *    están vacíos, que es lo único que sobra.
 * 3. La salida común se repone si falta, mitad por mitad, sin duplicar la que ya
 *    esté escrita.
 */
export function withNature(text: string, id: NatureId): string {
  const nature = natureOf(id);
  if (!nature) return text;

  let lines = text.split(/\r?\n/).filter((one) => {
    const line = bare(one).trim();
    return !NATURE.test(line) && !TOOLS.test(line) && !ENDS.test(line);
  });

  const kept = new Map<number, readonly string[]>();
  const drop: Cut[] = [];
  for (const cut of cuts(lines)) {
    const found = BRANCH.exec(cut.head);
    const owner = found?.[1] ? natureByName(found[1]) : null;
    if (!owner) continue;

    const body = lines.slice(cut.at + 1, cut.end);
    if (owner.id === nature.id) {
      kept.set(Number(found?.[2] ?? 0), edges(body));
      drop.push(cut);
    } else if (look(lines, cut.at + 1, cut.end, "", cut.head).words === 0) {
      drop.push(cut);
    }
  }
  lines = without(lines, drop);

  const diagnosis = COMMON.find((one) => one.id === "diagnostico");
  const head = diagnosis ? commonHead(diagnosis) : "";
  const after = cuts(lines).find((one) => flat(one.head) === flat(head));
  const at = after ? after.end : lines.length;

  const block = natureMarkdown(id, kept).split("\n");
  if (at > 0 && (lines[at - 1] ?? "").trim()) block.unshift("");
  lines.splice(at, 0, ...block);

  const heads = cuts(lines).map((one) => flat(one.head));
  const tail: string[] = [];
  if (!heads.includes(flat(SYNTHESIS_HEAD))) tail.push(...synthesisMarkdown().split("\n"));
  if (!heads.includes(flat(SITUATED_HEAD))) tail.push(...situatedMarkdown().split("\n"));
  if (tail.length > 0) lines.push("", ...tail);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* --- las tripas ----------------------------------------------------------- */

interface Cut {
  head: string;
  /** La línea del título. */
  at: number;
  /** La primera línea que ya no le pertenece. */
  end: number;
}

/** Sin la marca de bloque que viaja al final de la línea. */
function bare(line: string): string {
  return line.replace(MARK, "");
}

/** Los apartados del documento, cada uno con su tramo de líneas. */
function cuts(lines: readonly string[]): Cut[] {
  const out: Cut[] = [];
  lines.forEach((raw, index) => {
    const found = HEAD.exec(bare(raw));
    const head = found?.[1];
    if (head) out.push({ head, at: index, end: lines.length });
  });
  out.forEach((cut, index) => {
    const next = out[index + 1];
    if (next) cut.end = next.at;
  });
  return out;
}

/**
 * Qué hay dentro de un tramo: sus preguntas, cuáles están respondidas y cuánto
 * se escribió.
 *
 * Una pregunta es una cita que empieza por `¿`. El criterio para avanzar, la
 * regla del diagnóstico y el cierre de la ruta también son citas, pero no
 * empiezan así, y por eso pueden convivir con las preguntas en el mismo
 * apartado sin confundirse con ellas.
 *
 * Una pregunta está respondida cuando debajo hay algo escrito que no es otra
 * cita: la respuesta va pegada a su pregunta, que es lo que hace que el
 * documento se lea de corrido y no como un formulario.
 */
function look(
  lines: readonly string[],
  from: number,
  to: number,
  step: string,
  head: string,
): { asks: RouteAsk[]; words: number } {
  const asks: RouteAsk[] = [];
  let open: RouteAsk | null = null;
  let count = 0;

  for (let index = from; index < to && index < lines.length; index += 1) {
    const line = bare(lines[index] ?? "").trim();
    if (!line || line === "---" || line.startsWith("```")) continue;

    const quote = QUOTE.exec(line);
    if (quote) {
      const said = (quote[1] ?? "").trim();
      if (isAsk(said)) {
        open = { question: said, step, head, answered: false, line: index };
        asks.push(open);
      } else {
        // Criterio, regla o cierre: no es pregunta, y corta la respuesta de la
        // pregunta anterior para que un criterio no cuente como respuesta.
        open = null;
      }
      continue;
    }

    if (hint(line)) continue;
    const said = words(line);
    count += said;
    if (open && said > 0) open.answered = true;
  }

  return { asks, words: count };
}

/**
 * Si una cita es una pregunta que hay que responder.
 *
 * No basta con mirar si empieza por `¿`: hay preguntas que arrancan con una
 * condición —«Con lo anterior a la vista, ¿cuál es el problema real?»— y son
 * preguntas igual. Y no basta con mirar la interrogación: la línea que declara
 * la naturaleza lleva dentro la pregunta central de esa naturaleza sin ser una
 * pregunta que responder. Así que la fontanería del documento se excluye por su
 * nombre, que es lo único de ella que no cambia.
 */
function isAsk(said: string): boolean {
  if (PLUMBING.test(said)) return false;
  return said.includes("¿") || said.trimEnd().endsWith("?");
}

/** Las líneas que puso la plataforma y que nadie escribió. No cuentan. */
function hint(line: string): boolean {
  const low = flat(line);
  return low.startsWith("entrada:") || TOOLS.test(line) || low === flat(SITUATED_SAYS);
}

/** Palabras de una línea, sin viñetas, sin numeración y sin adjuntos. */
function words(line: string): number {
  const clean = line
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^#{1,6}\s+/, "")
    .trim();
  if (!clean) return 0;
  return clean.split(/\s+/).filter((one) => /[\p{L}\p{N}]/u.test(one)).length;
}

/** El mismo cuerpo sin las líneas en blanco de los bordes. */
function edges(body: readonly string[]): string[] {
  const out = [...body];
  while (out.length > 0 && !(out[0] ?? "").trim()) out.shift();
  while (out.length > 0 && !(out[out.length - 1] ?? "").trim()) out.pop();
  return out;
}

/** Las líneas, menos los tramos que sobran. */
function without(lines: readonly string[], drop: readonly Cut[]): string[] {
  if (drop.length === 0) return [...lines];
  const gone = new Set<number>();
  for (const cut of drop) {
    for (let index = cut.at; index < cut.end; index += 1) gone.add(index);
  }
  return lines.filter((_, index) => !gone.has(index));
}
