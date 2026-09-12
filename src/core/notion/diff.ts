import { notionRequest } from "./client.ts";
import { notionBodyOf, runsOf, type DocBlock } from "./blocks.ts";

/**
 * El diff de bloques: qué cambió entre el documento confirmado y el borrador.
 *
 * Guardar no reescribe la página entera. Se compara el estado que Notion
 * confirmó la última vez con lo que hay en el editor, y sólo viaja la
 * diferencia: los bloques nuevos se crean, los que cambiaron se actualizan y
 * los que ya no están se borran.
 *
 * La pieza fina es el **orden**. Notion no mueve bloques: lo que cambió de
 * sitio se borra y se crea de nuevo, y un algoritmo ingenuo marcaría *todo*
 * como movido en cuanto una línea se inserta en medio. La subsecuencia común
 * más larga (LCS) entre el orden viejo y el nuevo deja quieto lo que no se
 * movió y sólo recrea lo que de verdad cambió de sitio. Mover un párrafo al
 * final de un documento de cien es **una** operación, no cien.
 *
 * Portado de `reference/wzglexical-dev_mimem/services/blockDiff.ts`, que lo
 * sacó a la luz tras ver que sin LCS «mover una línea en un documento de 30
 * bloques generaba 30 delete + 30 create».
 */

/* --- la subsecuencia común más larga -------------------------------------- */

/**
 * Los ids que quedaron en el mismo orden relativo entre viejo y nuevo.
 *
 * Documentos de tesis: cientos de bloques. La tabla LCS es O(n·m), que a
 * 500×500 son 250 000 celdas: cabe. Por encima del corte se conserva todo —
 * el final de un documento enorme casi nunca es lo que se reordenó.
 */
function lcsIds(a: readonly string[], b: readonly string[]): Set<string> {
  const limit = 600;
  const aa = a.length > limit ? a.slice(0, limit) : a;
  const bb = b.length > limit ? b.slice(0, limit) : b;

  const width = bb.length + 1;
  const table = new Uint32Array((aa.length + 1) * width);

  for (let i = aa.length - 1; i >= 0; i -= 1) {
    for (let j = bb.length - 1; j >= 0; j -= 1) {
      const here = i * width + j;
      const diag = (i + 1) * width + (j + 1);
      const down = (i + 1) * width + j;
      const right = here + 1;
      table[here] = aa[i] === bb[j]
        ? table[diag]! + 1
        : Math.max(table[down]!, table[right]!);
    }
  }

  const kept = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < aa.length && j < bb.length) {
    const one = aa[i] ?? "";
    const two = bb[j] ?? "";
    if (one === two) {
      kept.add(one);
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + (j + 1)] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }

  for (const id of a.slice(limit)) kept.add(id);
  return kept;
}

/* --- si un bloque cambió -------------------------------------------------- */

/** Sólo lo que viaja a Notion: forma y texto. El id va aparte. */
function sameBlock(one: DocBlock, two: DocBlock): boolean {
  if (one.type !== two.type) return false;
  // Un adjunto no se re-escribe nunca: lo que Notion devuelve de él —la URL
  // que caduca a la hora, el nombre— ya está y mandarlo de nuevo no crea nada.
  // Basta con que sea adjunto y el mismo nombre: quieto.
  if (one.type === "attachment") {
    return two.type === "attachment" && (one.file?.name ?? one.text) === (two.file?.name ?? two.text);
  }
  if ((one.level ?? 0) !== (two.level ?? 0)) return false;
  if ((one.language ?? "") !== (two.language ?? "")) return false;
  // La URL de una imagen alojada por Notion (`file`) caduca a la hora: no es
  // un cambio de bloque. Lo que sí cambia —la dirección externa, o de imagen a
  // adjunto— sí es un cambio.
  if (stableUrl(one) !== stableUrl(two)) return false;
  if (one.text !== two.text) return false;
  // Y el color: quién escribió cada trozo viaja a Notion como color de texto,
  // así que cambiarlo es un cambio del bloque. Sin esto, tocar una palabra que
  // la IA había escrito —el texto queda igual, el trozo pasa a ser de la
  // persona— no viajaría nunca, y el color se quedaría puesto en Notion
  // diciendo algo que ya no es verdad.
  return sameRuns(one, two);
}

/** ¿Dicen lo mismo sobre quién escribió cada trozo? */
function sameRuns(one: DocBlock, two: DocBlock): boolean {
  const a = runsOf(one);
  const b = runsOf(two);
  if (a.length !== b.length) return false;
  return a.every((run, at) => {
    const other = b[at];
    return other !== undefined
      && run.text === other.text
      && (run.ai === true) === (other.ai === true);
  });
}

/** La URL de un bloque de imagen, sin las firmadas por Notion. */
function stableUrl(block: DocBlock): string {
  const raw = block.url ?? "";
  if (!raw) return "";
  // Las URLs firmadas de Notion viven en `secure.notion-static.com` con una
  // firma distinta cada vez que se leen; su constante es la ruta, no la firma.
  const match = /^https:\/\/[^\/]*secure\.notion-static\.com\/([^?]+)/.exec(raw);
  return match ? `notion:${match[1]}` : raw;
}

/* --- las operaciones ------------------------------------------------------ */

export interface SaveOperation {
  kind: "update" | "create" | "delete";
  block: DocBlock;
  /** Para create: el id del bloque que va justo antes. */
  after?: string | null;
}

export interface Diff {
  operations: SaveOperation[];
  /** Cuántos bloques toca, contando un mover (delete+create) como uno. */
  changes: number;
}

/**
 * El diff completo.
 *
 * Regla única: un bloque del borrador cuyo id existe en la base y sigue en la
 * LCS se queda (se actualiza si cambió su texto); uno cuyo id existe pero
 * cayó fuera del orden LCS se recrea —Notion no mueve— y el original se
 * borra; uno nuevo se crea.
 */
export function diffBlocks(baseline: readonly DocBlock[], draft: readonly DocBlock[]): Diff {
  const oldById = new Map(baseline.map((block) => [block.id, block] as const));
  const newIds = new Set(draft.map((block) => block.id));

  // El orden LCS decide qué se queda en su sitio.
  const kept = lcsIds(
    baseline.map((block) => block.id),
    draft.map((block) => block.id),
  );

  const operations: SaveOperation[] = [];

  // Recorrer el borrador y decidir por bloque, con el ancla del anterior.
  let after: string | null = null;
  for (const block of draft) {
    const known = oldById.get(block.id);
    const inOrder = known !== undefined && kept.has(block.id);

    // Un adjunto con id de Notion es inamovible: Notion no sabe mover un
    // bloque de archivo subido y recrearlo sería perderlo —el create no viaja
    // porque el archivo ya está subido; el delete sí. Se deja en su sitio y
    // listo: la línea puede quedar en otro orden en el editor, y en Notion se
    // lee donde nació.
    if (block.type === "attachment" && known) {
      after = block.id;
      continue;
    }

    if (!inOrder) {
      // Nuevo, o movido: se crea en este sitio.
      operations.push({ kind: "create", block, after });
      // El siguiente cuelga de este, y se le nombra por su id —temporal si
      // acaba de nacer—. Antes aqui iba `null`, que no significa «detras del
      // anterior» sino «sin ancla», y Notion lo traduce a «al final de la
      // pagina»: escribir tres parrafos seguidos en medio del documento dejaba
      // el primero en su sitio y mandaba los otros dos al final.
      after = block.id;
      // Si era un bloque movido, el original se borra más abajo.
    } else {
      if (known && !sameBlock(known, block)) {
        operations.push({ kind: "update", block });
      }
      after = block.id;
    }
  }

  // Los que ya no están, y los que se movieron (recreados arriba).
  for (const block of baseline) {
    // Un adjunto que la persona borra de la línea sí se borra de Notion: es
    // el gesto explícito de quitarlo del documento.
    if (newIds.has(block.id) && kept.has(block.id)) continue;
    if (!newIds.has(block.id) || !kept.has(block.id)) {
      operations.push({ kind: "delete", block });
    }
  }

  // Contar sin duplicar el mover: el mismo id en create y delete es un cambio.
  const touched = new Set(operations.map((op) => op.block.id));
  return { operations, changes: touched.size };
}

/* --- aplicar el lote ------------------------------------------------------ */

/** Notion admite unas tres peticiones por segundo. */
const GAP_MS = 360;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

let lastCall = 0;

/** Espera lo que falta para no pasarse del tope de Notion. */
async function paced(): Promise<void> {
  const since = Date.now() - lastCall;
  if (since < GAP_MS) await wait(GAP_MS - since);
  lastCall = Date.now();
}

/**
 * Aplicar las operaciones, en el orden que Notion necesita:
 *
 * 1. **Updates** — no cambian el orden.
 * 2. **Creates** — con su `after`: el bloque ancla tiene que seguir existiendo.
 *    Los crea seguidos van en un solo `PATCH /children` por lote de cien, y
 *    sólo el primero lleva `after`: los demás quedan detrás por orden de
 *    llegada.
 * 3. **Deletes** — al final, para que un «mover» se vea como aparece el nuevo
 *    y luego se retira el viejo.
 *
 * Un fallo no aborta el lote: se cuenta y se sigue. La pantalla muestra
 * cuántos no llegaron y el borrador local sigue ahí.
 */
export interface ApplyResult {
  /** id temporal → id real de Notion, para re-anclar el borrador. */
  idMap: Map<string, string>;
  errors: string[];
}

export async function applyOperations(
  token: string,
  pageId: string,
  diff: Diff,
  signal?: AbortSignal,
): Promise<ApplyResult> {
  const idMap = new Map<string, string>();
  const errors: string[] = [];
  const { operations } = diff;

  const updates = operations.filter((op) => op.kind === "update");
  const creates = operations.filter((op) => op.kind === "create");
  const deletes = operations.filter((op) => op.kind === "delete");

  /* --- updates: uno por uno, en orden --- */
  for (const op of updates) {
    if (signal?.aborted) break;
    const body = notionBodyOf(op.block);
    if (!body) continue;
    try {
      await paced();
      // Sólo el campo del tipo: un PATCH de bloque lleva la parte, no el
      // `object` ni el `type` de fuera.
      const [type] = Object.keys(body);
      const payload = type ? { [type]: body[type] } : {};
      await notionRequest(token, `/blocks/${op.block.id}`, {
        method: "PATCH",
        body: payload,
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /* --- creates: en lotes por ancla ---

     Un bloque nuevo puede colgar de otro bloque nuevo, y ese todavia no existe
     en Notion: su id es temporal y no sirve como `after`. Pero si cuelga de
     uno que va en este mismo lote, no hace falta nombrarlo —Notion respeta el
     orden de llegada dentro de un `PATCH /children`—, asi que el lote entero
     viaja con el `after` real del primero. Por eso la cadena se sigue hacia
     atras hasta dar con un id que Notion conozca. */
  const madeHere = new Set(creates.map((op) => op.block.id));
  let index = 0;
  while (index < creates.length) {
    if (signal?.aborted) break;
    // El ancla del lote: el primer antecesor que exista de verdad en Notion.
    const after = creates[index]?.after ?? null;
    const anchor = madeHere.has(after ?? "") ? null : after;
    const batch: typeof creates = [];
    while (index < creates.length && batch.length < 100) {
      const one = creates[index]!;
      const mine = one.after ?? null;
      // Entra en el lote si cuelga del mismo sitio de fuera, o de un bloque
      // que ya va dentro de este lote.
      const follows = batch.some((prev) => prev.block.id === mine);
      if (!follows && (madeHere.has(mine ?? "") || mine !== anchor)) break;
      batch.push(one);
      index += 1;
    }
    if (batch.length === 0) { index += 1; continue; }

    const children = batch
      .map((op) => notionBodyOf(op.block))
      .filter((body): body is Record<string, unknown> => body !== null);

    if (children.length === 0) continue;

    try {
      await paced();
      const made = await notionRequest<{ results: { id: string }[] }>(
        token,
        `/blocks/${pageId}/children`,
        {
          method: "PATCH",
          body: { children, ...(anchor ? { after: anchor } : {}) },
          ...(signal !== undefined ? { signal } : {}),
        },
      );
      (made.results ?? []).forEach((one, at) => {
        const op = batch[at];
        if (op) idMap.set(op.block.id, one.id);
      });
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /* --- deletes: idempotentes --- */
  for (const op of deletes) {
    if (signal?.aborted) break;
    try {
      await paced();
      await notionRequest(token, `/blocks/${op.block.id}`, {
        method: "DELETE",
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Borrar es archivar: si ya estaba archivado, está hecho.
      if (!/archived/i.test(message)) errors.push(message);
    }
  }

  return { idMap, errors };
}
