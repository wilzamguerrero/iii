import { session } from "../../core/persist/session.ts";
import { writePage } from "../../core/notion/tree.ts";
import { dropDraft, putDraft, runEntries } from "../../core/persist/drafts.ts";
import type { DocRuns } from "../../core/notion/blocks.ts";

/**
 * Guardar mientras se escribe.
 *
 * Nadie debería pulsar «guardar» en 2026, pero tampoco debería mandarse una
 * petición por tecla: Notion admite unas tres por segundo y un documento entero
 * viaja en cada una (un `PATCH` sobre el bloque `code` reemplaza su `rich_text`
 * completo). Así que se espera a que la persona pare de teclear.
 *
 * Dos esperas distintas, y la diferencia importa: el borrador local va a los 500 ms
 * porque es gratis y es la red de seguridad, y Notion a los 1400 ms porque cuesta
 * una petición. Entre las dos hay un segundo en el que lo escrito ya está a salvo
 * en el navegador aunque todavía no esté en Notion.
 *
 * El estado se cuenta siempre en la barra de arriba. Un editor que guarda solo y no
 * dice cuándo obliga a desconfiar de él, y quien desconfía copia el texto a otro
 * sitio «por si acaso»: entonces el editor ya no sirve de nada.
 */

export type SaveState =
  /** Lo que se ve es lo que hay en Notion. */
  | "clean"
  /** Hay cambios sin mandar. */
  | "dirty"
  | "saving"
  /** Notion no lo aceptó. El borrador lo tiene. */
  | "failed"
  /** Sin sesión de Notion: sólo borrador. */
  | "local";

const DRAFT_MS = 500;
const NOTION_MS = 1400;

/** Lo creado acaba de nacer en Notion: estos son sus ids de verdad. */
export type OnBorn = (idMap: ReadonlyMap<string, string>) => void;

export interface Saver {
  /** Empieza a llevar este documento, con lo que Notion tiene ahora. */
  begin(pageId: string, name: string, content: string, runs?: DocRuns): void;
  /** La persona escribió. */
  edit(content: string, runs?: DocRuns): void;
  /** Mandarlo ya: Ctrl+S, o al cerrar. */
  flush(): Promise<void>;
  /** Suelta el documento. Lo que quede sin mandar se manda de camino. */
  end(): void;
  state(): SaveState;
  /** El motivo del último fallo, para poder decirlo. */
  detail(): string;
}

const NO_RUNS: DocRuns = new Map();

/**
 * Una firma corta de la autoría, para saber si cambió.
 *
 * Hace falta porque el color viaja a Notion y puede cambiar **sin que cambie
 * el texto**: tocar una palabra que escribió la IA y dejarla igual la pasa a
 * ser de la persona. Comparar sólo el texto daría ese documento por guardado
 * y el color se quedaría puesto en Notion diciendo algo que ya no es verdad.
 */
function runsKey(runs: DocRuns): string {
  if (runs.size === 0) return "";
  return [...runs]
    .map(([key, list]) => `${key}=${list.map((one) => (one.ai === true ? "1:" : "0:") + one.text.length).join(",")}`)
    .sort()
    .join("|");
}

export function makeSaver(
  onChange: (state: SaveState, detail: string) => void,
  onBorn?: OnBorn,
): Saver {
  let pageId = "";
  let name = "";
  /** Lo último que Notion confirmó. */
  let stored = "";
  let storedKey = "";
  /** Lo que hay en pantalla. */
  let current = "";
  let currentRuns: DocRuns = NO_RUNS;
  let currentKey = "";
  let state: SaveState = "clean";
  let detail = "";

  /** ¿Hay algo sin mandar? Texto o color: las dos cosas viajan a Notion. */
  function dirty(): boolean {
    return current !== stored || currentKey !== storedKey;
  }

  let draftTimer: number | undefined;
  let notionTimer: number | undefined;
  let inFlight = false;
  let guarding = false;

  function announce(next: SaveState, why = ""): void {
    state = next;
    detail = why;
    // «saving» también avisa: mientras la petición viaja, el texto tampoco está
    // todavía en Notion.
    guard(next === "dirty" || next === "failed" || next === "saving"
      || (next === "local" && dirty()));
    onChange(state, detail);
  }

  /**
   * Con cambios sin mandar, cerrar la pestaña pregunta. Es la única vez que la
   * plataforma se pone delante de la persona, y es por lo único que no se puede
   * deshacer: el texto que nunca salió del navegador.
   */
  function guard(on: boolean): void {
    if (on === guarding) return;
    guarding = on;
    if (on) window.addEventListener("beforeunload", onLeave);
    else window.removeEventListener("beforeunload", onLeave);
  }

  function onLeave(event: BeforeUnloadEvent): void {
    event.preventDefault();
  }

  function clearTimers(): void {
    if (draftTimer !== undefined) clearTimeout(draftTimer);
    if (notionTimer !== undefined) clearTimeout(notionTimer);
    draftTimer = undefined;
    notionTimer = undefined;
  }

  async function toDraft(): Promise<void> {
    if (!pageId) return;
    await putDraft({
      pageId,
      name,
      content: current,
      ...(currentRuns.size > 0 ? { runs: runEntries(currentRuns) } : {}),
      at: Date.now(),
    });
  }

  async function push(): Promise<void> {
    if (!pageId || inFlight) return;

    const token = session.get()?.token;
    if (!token) { announce("local"); return; }

    const id = pageId;
    const sent = current;
    const sentRuns = currentRuns;
    const sentKey = currentKey;
    if (sent === stored && sentKey === storedKey) { announce("clean"); return; }

    inFlight = true;
    announce("saving");

    try {
      const born = await writePage(token, id, sent, sentRuns);
      // Mientras viajaba pudo cambiarse de documento: lo que sigue es de otro.
      if (id !== pageId) return;
      // Los bloques que acaban de crearse ya tienen id de Notion: el editor
      // tiene que saberlo antes de volver a guardar.
      if (born.size > 0) onBorn?.(born);
      stored = sent;
      storedKey = sentKey;
      if (!dirty()) {
        announce("clean");
        void dropDraft(id);
      } else {
        // Se siguió escribiendo: el borrador sigue haciendo falta y hay que
        // volver a mandar, pero sin encadenar peticiones sin respirar.
        announce("dirty");
        notionTimer = window.setTimeout(() => { void push(); }, NOTION_MS);
      }
    } catch (cause) {
      if (id !== pageId) return;
      announce("failed", cause instanceof Error ? cause.message : "No se pudo guardar en Notion.");
    } finally {
      inFlight = false;
    }
  }

  return {
    begin(nextId, nextName, content, runs) {
      clearTimers();
      pageId = nextId;
      name = nextName;
      stored = content;
      current = content;
      currentRuns = runs ?? NO_RUNS;
      currentKey = runsKey(currentRuns);
      storedKey = currentKey;
      announce(session.get()?.token ? "clean" : "local");
    },

    edit(content, runs) {
      if (!pageId) return;
      const next = runs ?? NO_RUNS;
      const key = runsKey(next);
      if (content === current && key === currentKey) return;
      current = content;
      currentRuns = next;
      currentKey = key;
      clearTimers();

      if (!dirty()) {
        // Se deshizo hasta lo que Notion ya tiene: no hay nada que guardar.
        announce("clean");
        void dropDraft(pageId);
        return;
      }

      announce(session.get()?.token ? "dirty" : "local");
      draftTimer = window.setTimeout(() => { void toDraft(); }, DRAFT_MS);
      notionTimer = window.setTimeout(() => { void push(); }, NOTION_MS);
    },

    async flush() {
      clearTimers();
      if (!pageId) return;
      await toDraft();
      await push();
    },

    end() {
      clearTimers();
      if (pageId && dirty()) {

        // El aviso de salida se queda puesto hasta que la petición confirme: se
        // cierra el editor, no se abandona el texto.
        void toDraft();
        void push();
        return;
      }
      guard(false);
    },

    state: () => state,
    detail: () => detail,
  };
}
