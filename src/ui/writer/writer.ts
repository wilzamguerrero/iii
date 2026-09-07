import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { mountMic, type Mic } from "../voice/mic.ts";
import { askAssistant } from "../assistant/assistant.ts";
import { setAddTarget } from "../assistant/answer.ts";
import { openMenu } from "../dock/menu.ts";
import { menuItems } from "./contextai.ts";
import { setLiveDocument } from "../../core/ai/conversation.ts";
import { clearSelection, selection, type SelectedPage } from "../../core/state/selection.ts";
import { session } from "../../core/persist/session.ts";
import { readPage, forgetPage } from "../../core/notion/tree.ts";
import { dropDraft, readDraft } from "../../core/persist/drafts.ts";
import { phaseByName, structureInText } from "../../core/method/structures.ts";
import { renderMarkdown } from "./markdown.ts";
import { makeSaver, type SaveState } from "./save.ts";
import { mountOutline, type Outline } from "./outline.ts";
import { mountStructures, type Structures } from "./structure.ts";
import { mountPanel, type Panel } from "./panel.ts";

/**
 * El documento: donde se escribe y donde se lee.
 *
 * Hasta ahora un documento se abría para que el asistente lo viera y se escribía en
 * Notion. Esto es lo que faltaba: la hoja. Ocupa la pantalla entera porque escribir
 * es lo único que se está haciendo cuando se está haciendo, y se coloca **por debajo
 * de la franja (7) y del asistente (8/9)**: la franja se abre encima para ir a otro
 * documento y el avión del asistente se puede dejar sobre el papel, que es
 * exactamente para lo que se hizo movible.
 *
 * Dos modos, un solo texto. Escribiendo se ve Markdown, que es lo que se guarda;
 * leyendo se ve el documento compuesto, que es lo que hay que juzgar. No hay un
 * tercer estado con la mitad de cada cosa: el editor que compone mientras escribes
 * te obliga a pelearte con lo que él cree que querías, y aquí el texto es del que
 * escribe.
 *
 * A la izquierda, los apartados (`outline.ts`); a la derecha, cuando se pide, la
 * revisión (`panel.ts`). En medio, la hoja. Nada de esto guarda una copia del
 * documento: el texto vive en el campo y en Notion, y el borrador local existe sólo
 * mientras no haya llegado allí (`core/persist/drafts.ts`).
 */

/** Lo que hace falta seleccionar para que valga la pena preguntar por ello. */
const MIN_SELECTION = 12;

type Mode = "write" | "read";

let root: HTMLElement | null = null;
let bar: HTMLElement | null = null;
let where: HTMLElement | null = null;
let stateLine: HTMLElement | null = null;
let countLine: HTMLElement | null = null;
let paper: HTMLElement | null = null;
let area: HTMLTextAreaElement | null = null;
let readView: HTMLElement | null = null;
let tools: HTMLElement | null = null;
let modeBtn: HTMLButtonElement | null = null;
let notice: HTMLElement | null = null;

let outline: Outline | null = null;
let structures: Structures | null = null;
let panel: Panel | null = null;
let mic: Mic | null = null;

let page: SelectedPage | null = null;
let mode: Mode = "write";
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
  return area?.value ?? "";
}

/** Todo lo que mira el texto pasa por aquí: apartados, cuenta, guardado. */
function changed(): void {
  const now = text();
  outline?.set(now);
  paintCount(now);
  saver.edit(now);
  if (mode === "read") paintRead(now);
}

function paintRead(now: string): void {
  if (!readView) return;
  const blocks = renderMarkdown(now);
  if (blocks.length === 0) {
    render(readView, el("p", {
      class: "doc__none",
      text: "Todavía no hay nada escrito. Pasa a escribir, o inserta una estructura.",
    }));
    return;
  }
  render(readView, ...blocks);
}

function setMode(next: Mode): void {
  if (!area || !readView || !modeBtn) return;
  mode = next;
  const reading = next === "read";
  area.hidden = reading;
  readView.hidden = !reading;
  paper?.classList.toggle("is-reading", reading);
  modeBtn.textContent = reading ? "Escribir" : "Leer";
  modeBtn.title = reading ? "Volver a escribir" : "Ver el documento compuesto";
  modeBtn.setAttribute("aria-pressed", reading ? "true" : "false");
  hideTools();
  if (reading) paintRead(text());
  else area.focus();
}

/* --- ir a un sitio del documento ------------------------------------------ */

/** En qué línea empieza este carácter. */
function lineAt(at: number): number {
  const before = text().slice(0, at);
  return before.split("\n").length - 1;
}

/** Dónde empieza esta línea. */
function startOfLine(line: number): number {
  const parts = text().split("\n");
  let at = 0;
  for (let index = 0; index < line && index < parts.length; index += 1) {
    at += (parts[index]?.length ?? 0) + 1;
  }
  return at;
}

/**
 * Llevar la vista a una línea.
 *
 * Leyendo es exacto: cada bloque compuesto lleva su `data-line` (`markdown.ts`), así
 * que se busca el último bloque que empiece en esa línea o antes. Escribiendo se
 * selecciona el trozo y se le devuelve el foco al campo: quitar y poner el foco es lo
 * que hace que el navegador traiga el cursor a la vista, y no hay manera de medir un
 * campo de texto por dentro sin espejarlo entero.
 */
function goTo(line: number, from?: number, to?: number): void {
  if (mode === "read") {
    if (!readView) return;
    let target: HTMLElement | null = null;
    for (const node of readView.querySelectorAll<HTMLElement>("[data-line]")) {
      if (Number(node.dataset.line ?? "0") <= line) target = node;
      else break;
    }
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (target) {
      target.classList.add("is-found");
      setTimeout(() => { target?.classList.remove("is-found"); }, 1600);
    }
    return;
  }

  if (!area) return;
  const start = from ?? startOfLine(line);
  const end = to ?? start;
  area.focus();
  area.setSelectionRange(start, end);
  area.blur();
  area.focus();
}

/** Buscar un fragmento tal cual, y si no está, sin acentos ni mayúsculas. */
function findFragment(fragment: string): number {
  const now = text();
  const direct = now.indexOf(fragment);
  if (direct >= 0) return direct;

  const flat = (value: string) => value
    .toLocaleLowerCase("es")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/gu, " ");
  return flat(now).indexOf(flat(fragment));
}

/**
 * Llevar hasta donde dice una observación de la revisión.
 *
 * El modelo devuelve el fragmento copiado del documento, pero copiado por un modelo:
 * puede venir con una tilde de menos. Si aun así no aparece —porque la observación
 * habla de algo que **falta**—, no se hace nada y la observación se lee igual.
 */
function locate(fragment: string): void {
  const clean = fragment.trim();
  if (!clean) return;
  const at = findFragment(clean);
  if (at < 0) return;
  goTo(lineAt(at), at, at + clean.length);
}

/* --- lo seleccionado ------------------------------------------------------- */

function selected(): string {
  if (mode === "write") {
    const now = area;
    if (!now) return "";
    return now.value.slice(now.selectionStart, now.selectionEnd).trim();
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return "";
  // Sólo lo que esté dentro de la hoja: la barra de arriba también es texto.
  if (readView && !readView.contains(sel.anchorNode)) return "";
  return sel.toString().trim();
}

/**
 * El fragmento con el que ya se hizo algo.
 *
 * Retirar la barra no basta: pedir una de las tres acciones lleva el foco a la
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
 * La forma del reglamento entra como texto, no como plantilla cerrada.
 *
 * Se pone al final si ya hay algo escrito y al principio si el documento está vacío,
 * que es el caso normal: se elige la forma antes de escribir. Entra en el campo como
 * la escribiría la persona, así que se puede borrar un apartado que no aplique —hay
 * proyectos que no llevan hipótesis— sin pelearse con nada.
 */
function insertStructure(markdown: string, name: string): void {
  if (!area) return;
  if (mode === "read") setMode("write");

  const now = area.value;
  const tail = now.trim() ? now.trimEnd() + "\n\n" : "";
  const body = tail + markdown;
  area.value = body;
  changed();

  // A donde empieza lo insertado y no al final: lo que hay que ver ahora es el
  // primer apartado, que es por donde se empieza a escribir. Y si no deja rastro
  // en la barra, parece que no pasó nada.
  const at = tail.length;
  area.focus();
  area.setSelectionRange(at, at);
  goTo(lineAt(at), at, at);
  if (stateLine) stateLine.title = "Se insertó «" + name + "».";
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

  modeBtn = el("button", {
    class: "wr__act wr__act--mode",
    text: "Leer",
    attrs: { type: "button", "aria-pressed": "false", title: "Ver el documento compuesto" },
    on: { click: () => { setMode(mode === "read" ? "write" : "read"); } },
  });

  const close = el("button", {
    class: "wr__x",
    attrs: { type: "button", "aria-label": "Cerrar el documento", title: "Cerrar el documento" },
    on: { click: () => { shut(); } },
  }, [icon("back")]);

  return el("header", { class: "wr__bar" }, [
    close, where, stateLine, countLine,
    el("div", { class: "wr__acts" }, [
      modeBtn,
      structures?.button ?? el("span"),
      panel?.button ?? el("span"),
      ...(mic ? [mic.button] : []),
    ]),
    structures?.root ?? el("span"),
  ]);
}

function buildPaper(): HTMLElement {
  readView = el("article", {
    class: "doc",
    attrs: { hidden: true, "aria-label": "Documento compuesto" },
  });

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
    area ?? el("span"), readView, tools,
  ]);
}

function build(): void {
  area = el("textarea", {
    class: "wr__edit",
    attrs: {
      spellcheck: "true",
      placeholder: "Escribe aquí. Los títulos con # y ##; el resto, texto.",
      "aria-label": "Documento",
    },
    on: {
      input: changed,
      select: watchSelection,
      keyup: watchSelection,
      pointerup: watchSelection,
      // El clic derecho con algo marcado abre el menú de la IA: las mismas
      // tres acciones de la barra más las de investigación.
      contextmenu: (event) => {
        const fragment = selected();
        if (!fragment || fragment.length < MIN_SELECTION) return;
        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY, below: 2 }, menuItems(
          fragment, page?.name ?? "el documento",
        ));
      },
      blur: () => {
        // Al pulsar una de las tres acciones se pierde el foco del campo: si la
        // barra se escondiera ahí, no se llegaría nunca a pulsarla.
        setTimeout(() => { if (selected().length < MIN_SELECTION) hideTools(); }, 200);
      },
    },
  });

  outline = mountOutline({ onPick: (line) => { goTo(line); } });
  structures = mountStructures({
    already: () => structureInText(text())?.id ?? null,
    onInsert: insertStructure,
  });
  panel = mountPanel({ now: documentNow, onLocate: locate, onAsk: askAssistant });
  mic = mountMic({ field: area, className: "mic wr__mic", changed });
  // Dictar escribe en el campo, así que el campo tiene que estar a la vista: ver
  // aparecer lo que se dice es la mitad de lo que hace que dictar sirva.
  mic?.button.addEventListener("click", () => { if (mode === "read") setMode("write"); });

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
    el("div", { class: "wr__body" }, [
      outline.root, buildPaper(), panel.root,
    ]),
  ]);

  document.body.append(root);
  document.addEventListener("selectionchange", () => {
    if (mode === "read" && root && !root.hidden) watchSelection();
  });
  // El clic derecho en la vista de lectura: mismo menú que en el editor, con
  // el fragmento que haya marcado en la página compuesta.
  document.addEventListener("contextmenu", (event) => {
    if (mode !== "read" || !root || root.hidden) return;
    if (!(event.target instanceof Node) || !readView?.contains(event.target)) return;
    const fragment = selected();
    if (!fragment || fragment.length < MIN_SELECTION) return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY, below: 2 }, menuItems(
      fragment, page?.name ?? "el documento",
    ));
  });
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
  if (!area) return;
  area.value = draft.content;
  changed();

  tell(`Se recuperó lo que no llegó a Notion (${ago(draft.at)}). Se está guardando.`, [
    el("button", {
      class: "btn btn--quiet",
      text: "Usar lo que hay en Notion",
      attrs: { type: "button" },
      on: { click: () => {
        if (!area) return;
        area.value = stored;
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
  if (!area) return;

  area.value = "";
  area.disabled = true;
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
    // El campo se queda cerrado a propósito: si no se pudo leer el documento,
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

  area.disabled = false;
  area.value = content;
  saver.begin(target.id, name, content);
  changed();
  setMode("write");
  area.setSelectionRange(0, 0);
  area.focus();

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
    area?.focus();
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

  // El asistente añade texto al documento: lo pega al final del cursor, en
  // el modo que toque, y quien escribe decide qué queda. Es la misma costura
  // de siempre —una función que se deja puesta, no un import cruzado—.
  setAddTarget((text) => {
    const clean = text.trim();
    if (!clean || !area || root?.hidden) return;
    if (mode === "read") setMode("write");
    const now = area.value;
    const at = area.selectionStart ?? now.length;
    const before = now.slice(0, at);
    const after = now.slice(at);
    // Con espacio propio: lo que llega es una idea que entra al documento,
    // no una frase que se pega en mitad de una palabra.
    const lead = before && !before.endsWith("\n") ? "\n\n" : "";
    const body = lead + clean + (after && !after.startsWith("\n") ? "\n\n" : "");
    area.value = before + body + after;
    const caret = (before + body).length;
    area.focus();
    area.setSelectionRange(caret, caret);
    changed();
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
