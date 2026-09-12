import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { askAssistant } from "../assistant/assistant.ts";
import { setAddTarget } from "../assistant/answer.ts";
import { openMenu } from "../dock/menu.ts";
import { askFragment, menuItems } from "./contextai.ts";
import { mountVisual, type Visual } from "./visual.ts";
import { mountSlash, type Slash } from "./slash.ts";
import { mountUploadPanel, type UploadPanel } from "./upload.ts";
import type { UploadedFile } from "../../core/notion/upload.ts";
import { setLiveDocument } from "../../core/ai/conversation.ts";
import { clearSelection, selection, type SelectedPage } from "../../core/state/selection.ts";
import { session } from "../../core/persist/session.ts";
import { readPage, forgetPage } from "../../core/notion/tree.ts";
import { dropDraft, readDraft } from "../../core/persist/drafts.ts";
import { phaseByName, structureInText } from "../../core/method/structures.ts";
import { makeSaver, type SaveState } from "./save.ts";
import { mountOutline, type Outline } from "./outline.ts";
import { mountStructures, type Structures } from "./structure.ts";
import { mountPanel, type Panel } from "./panel.ts";
import { mountMic, type Mic } from "../voice/mic.ts";
import { mountAsks, type Asks } from "./asks.ts";
import { mountGuide, type Guide } from "./guide.ts";
import { mountMap, type RouteMap } from "./map.ts";
import { mountTools, type Tools } from "./tools.ts";
import { closeProposal, proposalOpen } from "./propose.ts";
import { readRoute, withNature, type Route } from "../../core/method/route.ts";
import { intent } from "../../core/state/intent.ts";
import type { NatureId } from "../../core/method/indagar.ts";
/**
 * El documento: se escribe y se lee a la vez.
 *
 * Un solo modo, como el visual de la referencia y como Notion: lo que se
 * teclea es lo que se ve —títulos, listas, citas compuestos— y el botón
 * «Leer/Escribir» desapareció porque ya no hay dos estados. El Markdown
 * sigue siendo cómo viaja el texto —al guardado, a Notion, al asistente—;
 * lo que cambió es dónde vive mientras se escribe: en un documento de nodos
 * (`visual.ts`) y no en un campo de texto.
 *
 * La hoja ocupa la pantalla entera porque escribir es lo único que se está
 * haciendo cuando se está haciendo, y se coloca **por debajo de la franja
 * (7) y del asistente (8/9)**: la franja se abre encima para ir a otro
 * documento y el avión del asistente se puede dejar sobre el papel.
 *
 * A la izquierda, los apartados (`outline.ts`); a la derecha, cuando se
 * pide, la revisión (`panel.ts`). En medio, la hoja. Nada de esto guarda una
 * copia del documento: el texto vive en el editor y en Notion, y el borrador
 * local existe sólo mientras no haya llegado allí (`core/persist/drafts.ts`).
 */

/** Lo que hace falta seleccionar para que valga la pena preguntar por ello. */
const MIN_SELECTION = 12;

let root: HTMLElement | null = null;
let bar: HTMLElement | null = null;
let where: HTMLElement | null = null;
let stateLine: HTMLElement | null = null;
let countLine: HTMLElement | null = null;
let visual: Visual | null = null;
let tools: Tools | null = null;
let notice: HTMLElement | null = null;

let outline: Outline | null = null;
let structures: Structures | null = null;
let panel: Panel | null = null;
let asks: Asks | null = null;
let guide: Guide | null = null;
let routeMap: RouteMap | null = null;
let mic: Mic | null = null;
let slash: Slash | null = null;
let upload: UploadPanel | null = null;
/** El input de archivo invisible que abre el selector del sistema. */
let picker: HTMLInputElement | null = null;

let page: SelectedPage | null = null;
/** Cada apertura tiene su número: una lectura que llega tarde es de otro documento. */
let seq = 0;

const saver = makeSaver((state, detail) => { paintState(state, detail); });

/* --- lo que dice la barra ------------------------------------------------- */

const STATE_TEXT: Record<SaveState, string> = {
  clean: "Guardado en Notion",
  dirty: "Sin guardar",
  saving: "Guardando…",
  failed: "No se pudo guardar",
  local: "Guardado sólo aquí",
};

function paintState(state: SaveState, detail: string): void {
  if (!stateLine) return;
  stateLine.className = `wr__state wr__state--${state}`;
  stateLine.textContent = STATE_TEXT[state];
  // El motivo del fallo no cabe en la barra, pero tiene que poder leerse.
  stateLine.title = detail || STATE_TEXT[state];
}

/**
 * Palabras y caracteres.
 *
 * El reglamento cuenta páginas —veinte para el anteproyecto, ciento veinte para el
 * informe— y nadie escribe páginas en un campo de texto, así que se cuenta lo que sí
 * se puede contar. Está aquí y no en un panel porque es la única cifra que se mira
 * mientras se escribe.
 */
function paintCount(text: string): void {
  if (!countLine) return;
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  countLine.textContent = `${words.toLocaleString("es")} palabras`;
  countLine.title = `${text.length.toLocaleString("es")} caracteres`;
}

function paintWhere(): void {
  if (!where) return;
  const project = page?.projectName;
  render(where,
    ...(project ? [el("span", { class: "wr__proj", text: project }), el("span", { class: "wr__sep", text: "·" })] : []),
    el("span", { class: "wr__name", text: page?.name ?? "Documento" }),
  );
}

/* --- el texto ------------------------------------------------------------- */

function text(): string {
  return visual?.markdown() ?? "";
}

/** Todo lo que mira el texto pasa por aquí: apartados, cuenta, guardado. */
function changed(): void {
  const now = text();
  outline?.set(now);
  paintCount(now);
  saver.edit(now);
  // La ruta se relee del texto y los mandos se recuelgan donde toca. Los tres
  // son baratos y tienen que ser exactos: si se escribe la respuesta de una
  // pregunta, el icono cambia en ese mismo instante, y el mapa —que se puede
  // dejar abierto al lado mientras se escribe— cuenta el avance de ahora.
  asks?.paint();
  guide?.paint();
  routeMap?.repaint();
}

/* --- la ruta de Indagar ---------------------------------------------------- */

/** Lo último que se leyó y de qué texto: releer once pasos por tecla sobra. */
let routeText: string | null = null;
let routeSeen: Route | null = null;

/**
 * La ruta tal como está el documento ahora.
 *
 * No hay progreso guardado en ninguna parte: esto lee el texto cada vez que el
 * texto cambia, y lo recuerda mientras no cambie. Así lo que la plataforma cree
 * y lo que se ve escrito no pueden separarse, ni siquiera si alguien edita el
 * documento en Notion desde el teléfono.
 */
function routeNow(): Route {
  const now = text();
  if (routeText !== now || !routeSeen) {
    routeText = now;
    routeSeen = readRoute(now);
  }
  return routeSeen;
}

/**
 * Tomar una ruta: la naturaleza entra escrita en el documento.
 *
 * Se reescribe el documento entero porque cambiar de naturaleza mueve
 * apartados de sitio, y `withNature` es quien sabe hacerlo sin perder lo
 * escrito: los apartados de la ruta que se toma vuelven con su contenido y sus
 * marcas de bloque, y los de la anterior se quedan si tienen algo dentro.
 */
function takeNature(id: NatureId): void {
  if (!visual) return;
  const before = text();
  const after = withNature(before, id);
  if (after === before) return;
  visual.set(after);
  changed();
}

/* --- lo seleccionado ------------------------------------------------------- */

function selected(): string {
  return visual?.selected() ?? "";
}

/* --- insertar una estructura ---------------------------------------------- */

/**
 * La forma del reglamento entra como bloques, no como plantilla cerrada.
 *
 * Se pone al final si ya hay algo escrito y al principio si el documento está
 * vacío, que es el caso normal: se elige la forma antes de escribir. Entra en
 * la hoja como la escribiría la persona, así que se puede borrar un apartado
 * que no aplique —hay proyectos que no llevan hipótesis— sin pelearse con nada.
 */
function insertStructure(markdown: string, name: string): void {
  if (!visual) return;

  const now = visual.markdown();
  const tail = now.trim() ? now.trimEnd() + "\n\n" : "";
  visual.set(tail + markdown);
  changed();

  // A donde empieza lo insertado y no al final: lo que hay que ver ahora es el
  // primer apartado, que es por donde se empieza a escribir. Y si no deja
  // rastro en la barra, parece que no pasó nada.
  visual.focusStart();
  if (stateLine) stateLine.title = "Se insertó «" + name + "».";
}

/* --- subir archivos -------------------------------------------------------- */

/**
 * Adjuntar archivos al documento.
 *
 * El ancla se toma **al elegir**: el id del bloque donde estaba el cursor, que
 * es donde la persona los puso. Mientras suben —segundos o minutos con un
 * archivo pesado— la hoja puede moverse; el ancla ya quedó guardada.
 */
function attachFiles(files: readonly File[]): void {
  const current = page;
  if (!current || !upload) return;
  const anchor = visual?.blockBeforeCaret() ?? "";
  upload.start(files, current.id, anchor);
}

/** Lo que el panel hace cuando un archivo llegó: entra donde se pidió. */
function uploadedLines(uploaded: readonly UploadedFile[]): void {
  if (!visual || uploaded.length === 0) return;
  for (const one of uploaded) {
    visual.insertAttachment({
      name: one.name,
      kind: one.blockKind,
      ...(one.url !== undefined ? { url: one.url } : {}),
      ...(one.blockId !== undefined ? { blockId: one.blockId } : {}),
    });
  }
  changed();
}

/** Pedir archivos: el selector del sistema, múltiple. */
function pickFiles(): void {
  if (!picker) return;
  picker.value = "";
  picker.click();
}

/* --- lo que la revisión necesita saber ------------------------------------ */

function documentNow() {
  const content = text();
  const structure = structureInText(content);
  return {
    name: page?.name ?? "sin título",
    content,
    phase: phaseByName(page?.name ?? ""),
    structure: structure?.id ?? null,
  };
}

/* --- construcción --------------------------------------------------------- */

function buildBar(): HTMLElement {
  where = el("span", { class: "wr__crumb" });
  stateLine = el("span", { class: "wr__state", attrs: { role: "status", "aria-live": "polite" } });
  countLine = el("span", { class: "wr__count" });

  const close = el("button", {
    class: "wr__x",
    attrs: { type: "button", "aria-label": "Cerrar el documento", title: "Cerrar el documento" },
    on: { click: () => { shut(); } },
  }, [icon("back")]);

  // Adjuntar: el selector de archivos del sistema, escondido. El botón es el
  // mismo gesto que dictar —un botón de la barra que alimenta la hoja— y
  // arrastrarlos encima hace lo mismo sin pasar por la barra.
  const attach = el("button", {
    class: "wr__act",
    text: "Adjuntar",
    attrs: { type: "button", title: "Subir archivos a este documento" },
    on: { click: () => { pickFiles(); } },
  });

  return el("header", { class: "wr__bar" }, [
    close, where, stateLine, countLine,
    el("div", { class: "wr__acts" }, [
      attach,
      guide?.button ?? el("span"),
      routeMap?.button ?? el("span"),
      structures?.button ?? el("span"),
      panel?.button ?? el("span"),
      ...(mic ? [mic.button] : []),
    ]),
    structures?.root ?? el("span"),
  ]);
}

function buildPaper(): HTMLElement {
  return el("div", { class: "wr__paper" }, [visual?.root ?? el("span")]);
}

function build(): void {
  visual = mountVisual();
  visual.onEdit(() => { changed(); });

  // Los archivos arrastrados sobre la hoja suben como los elegidos en la
  // barra: mismo motor, mismo panel, misma página abierta.
  visual.onDropFiles((files) => { attachFiles(files); });

  // El menú «/»: la tecla en un bloque vacío lo pide; elegir un bloque lo pone.
  // El editor se entera de las dos cosas —abrir y cerrar— para prestarle el
  // teclado mientras está abierto.
  slash = mountSlash();
  visual.onSlash((at) => {
    visual?.setSlashOpen(true);
    slash?.open(at);
  });
  slash.onPick((id) => {
    visual?.setSlashOpen(false);
    if (id === "attachment") {
      // El archivo no se escribe: se elige del equipo y sube.
      pickFiles();
      visual?.root.focus();
      return;
    }
    visual?.applyBlock(id);
    visual?.root.focus();
  });
  slash.onClose(() => { visual?.setSlashOpen(false); visual?.root.focus(); });

  // La barra de selección y el clic derecho: ambos miran lo marcado en el
  // documento compuesto, que ahora es el mismo que el editable.
  // Los iconos sobre lo marcado, colgados del renglón donde está la selección.
  tools = mountTools({
    root: () => visual?.root ?? null,
    selected,
    onAct: (action, fragment) => {
      askFragment(action, fragment, page?.name ?? "el documento");
    },
  });
  const watching = (): void => { tools?.watch(); };
  visual.root.addEventListener("select", watching);
  visual.root.addEventListener("keyup", watching);
  visual.root.addEventListener("pointerup", watching);
  visual.root.addEventListener("contextmenu", (event) => {
    const fragment = selected();
    if (!fragment || fragment.length < MIN_SELECTION) return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY, below: 2 }, menuItems(
      fragment, page?.name ?? "el documento",
    ));
  });

  outline = mountOutline({ onPick: (line) => { visual?.goToLine(line); } });
  structures = mountStructures({
    already: () => structureInText(text())?.id ?? null,
    onInsert: insertStructure,
  });
  panel = mountPanel({
    now: documentNow,
    onLocate: (fragment) => { visual?.locate(fragment); },
    onAsk: askAssistant,
  });

  // La ruta de Indagar, en sus tres caras: dentro del documento (los mandos de
  // cada pregunta), al lado (qué toca ahora) y en el mapa (por dónde va y a
  // dónde podría ir). Las tres leen la misma ruta del mismo texto.
  routeMap = mountMap({
    route: routeNow,
    content: text,
    intent: () => intent.get()?.text ?? null,
    onTake: takeNature,
    onGo: (step) => { asks?.goToStep(step); },
    onAsk: askAssistant,
  });
  asks = mountAsks({
    visual,
    route: routeNow,
    content: text,
    intent: () => intent.get()?.text ?? null,
    changed,
    onMap: () => { routeMap?.open(); },
    onAsk: askAssistant,
  });
  guide = mountGuide({
    route: routeNow,
    onAskFor: (stepId) => { asks?.askFor(stepId); },
    onGoTo: (ask) => { asks?.goTo(ask); },
    onGoStep: (step) => { asks?.goToStep(step); },
    onMap: () => { routeMap?.open(); },
    onCloseOut: () => { asks?.closeOut(); },
  });

  // Dictar escribe en el documento: el botón de siempre, hablándole al editor.
  mic = visual ? mountMic({ field: visual, className: "mic wr__mic", changed }) : null;

  // Subir archivos: la hoja de progreso y el selector del sistema. El panel
  // vive colgado del documento —como el asistente vive colgado de la
  // plataforma— y se ve mientras sube.
  upload = mountUploadPanel(uploadedLines);
  picker = el("input", {
    class: "wr__picker",
    attrs: { type: "file", multiple: true, "aria-hidden": "true", tabindex: "-1" },
    on: { change: () => {
      const files = picker?.files;
      if (files && files.length > 0) attachFiles([...files]);
    } },
  });

  notice = el("div", { class: "wr__note", attrs: { hidden: true, role: "status" } });
  bar = buildBar();

  root = el("section", {
    class: "wr",
    attrs: { hidden: true, "aria-label": "Documento" },
    on: {
      keydown: (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saver.flush();
          return;
        }
        if (event.key !== "Escape") return;
        // Lo de encima primero: la barra de selección, luego las columnas, y sólo
        // al final el documento. Cerrarlo de golpe con algo abierto sorprende.
        event.stopPropagation();
        if (proposalOpen()) { closeProposal(); return; }
        if (routeMap && !routeMap.root.hidden) { routeMap.close(); return; }
        if (tools?.visible()) { tools.hide(); return; }
        if (structures && !structures.root.hidden) { structures.close(); return; }
        if (guide && !guide.root.hidden) { guide.close(); return; }
        if (panel && !panel.root.hidden) { panel.close(); return; }
        shut();
      },
    },
  }, [
    bar, notice,
    upload?.root ?? el("span"),
    el("div", { class: "wr__body" }, [
      outline.root, buildPaper(), guide.root, panel.root,
    ]),
    routeMap.root,
    tools.root,
    picker ?? el("span"),
  ]);

  document.body.append(root);
}

/* --- abrir un documento --------------------------------------------------- */

function tell(message: string, actions: readonly HTMLElement[] = [], bad = false): void {
  if (!notice) return;
  if (!message) {
    notice.hidden = true;
    render(notice);
    return;
  }
  notice.className = `wr__note${bad ? " wr__note--bad" : ""}`;
  notice.hidden = false;
  render(notice, el("span", { class: "wr__note__say", text: message }), ...actions);
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

/**
 * Lo que se escribió y no llegó a Notion.
 *
 * Se pone en la hoja, no se pregunta antes: el borrador existe **sólo** cuando algo se
 * escribió y la petición no confirmó, así que es trabajo de la persona y perderlo por
 * un diálogo mal contestado sería lo peor que puede hacer un editor. Queda como sin
 * guardar y se manda solo, como cualquier otro cambio; lo que se ofrece es lo
 * contrario: volver a lo que hay en Notion.
 */
function recover(draft: { content: string; at: number }, stored: string): void {
  if (!visual) return;
  visual.set(draft.content);
  changed();

  tell(`Se recuperó lo que no llegó a Notion (${ago(draft.at)}). Se está guardando.`, [
    el("button", {
      class: "btn btn--quiet",
      text: "Usar lo que hay en Notion",
      attrs: { type: "button" },
      on: { click: () => {
        if (!visual) return;
        visual.set(stored);
        changed();
        void saver.flush();
        tell("");
      } },
    }),
    el("button", {
      class: "wr__note__x",
      attrs: { type: "button", "aria-label": "Entendido" },
      on: { click: () => { tell(""); } },
    }, [icon("cross", "ico ico--small")]),
  ]);
}

async function load(target: SelectedPage): Promise<void> {
  const mine = ++seq;
  if (!visual) return;

  visual.set("");
  outline?.set("");
  paintCount("");
  tell("");
  if (stateLine) {
    stateLine.className = "wr__state";
    stateLine.textContent = "Leyendo…";
  }

  const token = session.get()?.token;
  if (!token) {
    if (stateLine) stateLine.textContent = "";
    tell("Sin sesión de Notion no hay documento que leer. Conéctate desde la franja.", [], true);
    return;
  }

  let content = "";
  let name = target.name;
  let clipUrls = new Map<string, string>();
  try {
    const got = await readPage(token, target.id);
    if (mine !== seq) return;
    content = got.content;
    name = got.name || target.name;
    clipUrls = got.clipUrls;
  } catch (error) {
    if (mine !== seq) return;
    // La hoja se queda cerrada a propósito: si no se pudo leer el documento,
    // escribir encima sería escribir en un sitio del que no se sabe qué tiene.
    if (stateLine) stateLine.textContent = "";
    tell(error instanceof Error ? error.message : "No se pudo leer el documento.", [
      el("button", {
        class: "btn btn--quiet",
        text: "Volver a intentarlo",
        attrs: { type: "button" },
        on: { click: () => { void load(target); } },
      }),
    ], true);
    return;
  }

  const draft = await readDraft(target.id);
  if (mine !== seq) return;

  visual.set(content, clipUrls);
  saver.begin(target.id, name, content);
  changed();
  // La columna se abre sola cuando el documento lleva la ruta escrita: es el
  // documento de Indagar, y lo primero que hace falta saber es en qué paso va.
  if (routeNow().steps.some((one) => one.present)) guide?.open();
  visual.focusStart();

  if (draft && draft.content.trim() && draft.content !== content) recover(draft, content);
  else if (draft) void dropDraft(target.id);
}

/* --- abrir, cerrar -------------------------------------------------------- */

function show(target: SelectedPage): void {
  if (!root) return;
  const already = page?.id === target.id && !root.hidden;
  page = target;
  paintWhere();
  root.hidden = false;
  document.body.classList.add("is-writing");
  // Volver a pulsar la misma página no vuelve a leerla de Notion: sería tirar lo
  // escrito desde entonces. Sólo la trae al frente.
  if (already) {
    visual?.root.focus();
    return;
  }
  structures?.close();
  routeMap?.close();
  panel?.close();
  panel?.reset();
  void load(target);
}

/**
 * Cerrar es soltar el documento, no abandonarlo: `saver.end()` manda lo que quede sin
 * mandar y mantiene el aviso de salida puesto hasta que la petición confirme.
 */
function shut(): void {
  if (!root || root.hidden) return;
  mic?.stop();
  structures?.close();
  routeMap?.close();
  guide?.close();
  panel?.close();
  tools?.hide();
  closeProposal(false);
  // Los mandos son de este documento: dejarlos puestos los colgaría del texto
  // del siguiente, que no tiene por qué llevar la misma ruta.
  asks?.clear();
  routeText = null;
  routeSeen = null;
  saver.end();
  // El estado de bloques confirmados de esta página ya no hace falta: si se
  // vuelve a abrir, se lee otra vez. Sin esto, una sesión larga escribiría
  // documentos enteros en memoria para siempre.
  if (page) forgetPage(page.id);
  root.hidden = true;
  document.body.classList.remove("is-writing");
  // La página abierta se olvida para que el asistente deje de decir que la ve.
  page = null;
  seq += 1;
  if (selection.get()) clearSelection();
}

/**
 * Monta el documento y lo deja escuchando qué página está abierta.
 *
 * Es lo único que hace falta llamar desde `app.ts`: abrir un documento es elegir una
 * página en la franja, y eso ya pasa por `selection`. Así el árbol no necesita saber
 * que existe un editor —ni el editor cómo se llega a él—, que es la misma costura por
 * la que el asistente ve lo que hay abierto.
 */
export function mountWriter(): void {
  if (root) return;
  build();

  // El asistente añade texto al documento: lo pega donde esté el cursor y
  // quien escribe decide qué queda. Es la misma costura de siempre —una
  // función que se deja puesta, no un import cruzado—.
  setAddTarget((text) => {
    const clean = text.trim();
    if (!clean || !visual || root?.hidden) return;
    visual.insertAtCaret(clean);
  });

  // El asistente pregunta por lo que hay en la hoja, no por lo que llegó a Notion.
  setLiveDocument((pageId) => (page && page.id === pageId && root && !root.hidden ? text() : null));

  selection.subscribe((now) => {
    if (now) show(now);
    else shut();
  });
  const now = selection.get();
  if (now) show(now);
}
