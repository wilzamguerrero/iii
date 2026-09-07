import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { askAssistant } from "../assistant/assistant.ts";
import { setAddTarget } from "../assistant/answer.ts";
import { openMenu } from "../dock/menu.ts";
import { menuItems } from "./contextai.ts";
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
let tools: HTMLElement | null = null;
let notice: HTMLElement | null = null;

let outline: Outline | null = null;
let structures: Structures | null = null;
let panel: Panel | null = null;
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
}

/* --- lo seleccionado ------------------------------------------------------- */

function selected(): string {
  return visual?.selected() ?? "";
}

/**
 * El fragmento con el que ya se hizo algo.
 *
 * Retirar la barra no basta: pedir una de las acciones lleva el foco a la
 * ventana del asistente, y mover el foco avisa de que la selección cambió. Ese
 * aviso volvía a mirar lo marcado —que sigue marcado, porque el texto no se
 * toca— y devolvía la barra a la pantalla un instante después de haberla
 * quitado. Así que se recuerda para qué se quitó: mientras siga marcado eso
 * mismo, la barra no vuelve; en cuanto se marque otra cosa, sí.
 */
let usedOn = "";

function hideTools(): void {
  if (!tools) return;
  tools.hidden = true;
  usedOn = selected();
}

function watchSelection(): void {
  if (!tools) return;
  const now = selected();
  if (now && now === usedOn) {
    tools.hidden = true;
    return;
  }
  usedOn = "";
  tools.hidden = now.length < MIN_SELECTION;
}

/**
 * Las tres cosas que se pueden pedir sobre un fragmento.
 *
 * Ninguna de las tres pide texto de reemplazo, y no es una limitación técnica: es la
 * diferencia entre esto y una plataforma que escribe el párrafo por ti. Cuestionar
 * saca a la luz lo que se dio por supuesto; explicar dice qué papel cumple ese trozo
 * en la fase; precisar señala dónde se puede leer de dos maneras. Las tres contestan
 * en la ventana del asistente, que ya está abierta y se puede mover para no tapar el
 * texto del que se habla.
 *
 * El menú del clic derecho (`contextai.ts`) tiene la versión completa, con las
 * acciones de investigación además de éstas; la barra muestra las tres
 * primeras, que son las del método, porque son las que se piden sobre la
 * marcha mientras se escribe.
 */
const ACTS: readonly { id: string; label: string; title: string; order: string }[] = [
  {
    id: "cuestionar",
    label: "Cuestionar",
    title: "Qué doy por supuesto en este fragmento",
    order: "Cuestiona este fragmento de mi documento: qué doy por supuesto, qué no queda " +
      "dicho y qué tendría que decidir. No lo reescribas.",
  },
  {
    id: "explicar",
    label: "Explicar",
    title: "Qué papel cumple este fragmento en la fase",
    order: "Explícame qué papel cumple este fragmento dentro de la fase en la que estoy y " +
      "qué le falta para cumplirlo. No lo reescribas.",
  },
  {
    id: "precisar",
    label: "Precisar",
    title: "Dónde se puede leer de dos maneras",
    order: "Dime dónde este fragmento se puede leer de dos maneras y qué decisiones me " +
      "faltan para que sólo se lea de una. No lo reescribas: no me devuelvas el párrafo " +
      "corregido.",
  },
];

function act(order: string): void {
  const fragment = selected();
  if (!fragment) return;
  const name = page?.name ?? "el documento";
  askAssistant(`${order}\n\nDocumento «${name}». Fragmento:\n«${fragment}»`);
  hideTools();
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
 * Suben por el motor (`core/notion/upload.ts`) directo a la página abierta y
 * al terminar cada uno deja su línea `📎 nombre` en la hoja, con el id del
 * bloque que Notion creó: así el guardado siguiente no lo ve como nuevo.
 */
function attachFiles(files: readonly File[]): void {
  const current = page;
  if (!current || !upload) return;
  upload.start(files, current.id);
}

/** Lo que hace el panel cuando un archivo llegó: su línea en la hoja. */
function uploadedLines(uploaded: readonly UploadedFile[]): void {
  if (!visual || uploaded.length === 0) return;
  for (const one of uploaded) {
    visual.insertAtCaret(`📎 ${one.name}`);
    // La línea que acaba de entrar lleva id temporal; el bloque de Notion ya
    // existe. Se re-ancla para que el guardado lo deje quieto.
    if (one.blockId) visual.anchorLastClip(one.blockId);
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
      structures?.button ?? el("span"),
      panel?.button ?? el("span"),
      ...(mic ? [mic.button] : []),
    ]),
    structures?.root ?? el("span"),
  ]);
}

function buildPaper(): HTMLElement {
  tools = el("div", {
    class: "wr__tools",
    attrs: { hidden: true, role: "group", "aria-label": "Sobre lo seleccionado" },
  }, [
    el("span", { class: "wr__tools__say", text: "Con lo que has marcado:" }),
    ...ACTS.map((one) => el("button", {
      class: "wr__tool",
      text: one.label,
      attrs: { type: "button", title: one.title, "data-id": one.id },
      on: { click: () => { act(one.order); } },
    })),
  ]);

  return el("div", { class: "wr__paper" }, [
    visual?.root ?? el("span"),
    tools,
  ]);
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
  visual.root.addEventListener("select", watchSelection);
  visual.root.addEventListener("keyup", watchSelection);
  visual.root.addEventListener("pointerup", watchSelection);
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
        if (tools && !tools.hidden) { hideTools(); return; }
        if (structures && !structures.root.hidden) { structures.close(); return; }
        if (panel && !panel.root.hidden) { panel.close(); return; }
        shut();
      },
    },
  }, [
    bar, notice,
    upload?.root ?? el("span"),
    el("div", { class: "wr__body" }, [
      outline.root, buildPaper(), panel.root,
    ]),
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
  try {
    const got = await readPage(token, target.id);
    if (mine !== seq) return;
    content = got.content;
    name = got.name || target.name;
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

  visual.set(content);
  saver.begin(target.id, name, content);
  changed();
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
  panel?.close();
  hideTools();
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
