/**
 * Sacar el JSON de lo que contesta un modelo.
 *
 * Casi todo lo que se le pide al asistente es prosa, pero dos cosas no lo son: el
 * armazón de un proyecto nuevo (`scaffold.ts`) y la revisión de un documento
 * (`review.ts`). Las dos se le piden en JSON porque la plataforma tiene que
 * *usarlas* —crear páginas, señalar apartados—, no mostrarlas.
 *
 * Un modelo que devuelve JSON casi nunca devuelve sólo JSON: lo envuelve en un
 * bloque de código, lo precede de «Aquí tienes…» o lo remata con una explicación.
 * Nada de eso es un error del que haya que quejarse a la persona, así que se
 * recorta y se sigue. Lo que sí es un error es que no haya JSON dentro o que esté
 * roto, y entonces se dice con claridad y en castellano: el aviso lo va a leer
 * quien escribe un proyecto, no quien programa.
 *
 * Vive aparte de sus dos usos porque son dos y porque la mitad de lo que hace es
 * defensa: el sitio donde se defiende algo se lee mejor si es uno solo.
 */

/** El JSON que venga dentro, sea objeto o lista. */
export function carveJson(reply: string): unknown {
  const text = reply.trim();
  // Dentro de un bloque de código, si lo hay: es lo más fiable que trae la
  // respuesta, porque el modelo lo abrió y lo cerró a propósito.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fence?.[1]?.trim() ?? text;

  const slice = between(body, "{", "}") ?? between(body, "[", "]");
  if (!slice) {
    throw new Error("El modelo no devolvió JSON. Prueba con otro modelo.");
  }

  try {
    return JSON.parse(slice);
  } catch {
    throw new Error("El JSON del modelo venía roto. Prueba a repetirlo o con otro modelo.");
  }
}

/** Del primer signo de apertura al último de cierre. */
function between(body: string, open: string, close: string): string | null {
  const from = body.indexOf(open);
  const to = body.lastIndexOf(close);
  if (from < 0 || to <= from) return null;
  return body.slice(from, to + 1);
}

/**
 * Un texto de una línea, con tope.
 *
 * Lo que llega puede ser cualquier cosa: un número, un objeto, una frase de tres
 * párrafos o la misma frase entre comillas de imprenta. Aquí se convierte en algo
 * que quepa en una línea de la interfaz, y el recorte no parte una palabra por la
 * mitad ni deja una coma colgando antes de los puntos suspensivos.
 */
export function oneLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/g, " ").trim().replace(/^[«"']+|[»"']+$/g, "").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return kept.replace(/[,;:\s]+$/, "") + "…";
}
