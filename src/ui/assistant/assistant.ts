import { el, render } from "../dom.ts";
import { makeMovable, type Movable } from "../drag.ts";
import { origamiSvg } from "../origami.ts";
import { onMenuVisible } from "../afterIntro.ts";
import {
  activeProvider, aiConfig, chosenModel, hasCredential, providerLabel, serverKeys,
} from "../../core/ai/config.ts";
import { ask, conversation, isAsking, resetConversation, stopAsking } from "../../core/ai/conversation.ts";
import { intent } from "../../core/state/intent.ts";
import { selection } from "../../core/state/selection.ts";

/**
 * El asistente: un papel que se coloca donde se quiera y, al pulsarlo, abre una
 * ventana de conversación que también se coloca donde se quiera.
 *
 * La forma es la del botón de enviar de la pantalla de entrada —el mismo avión
 * de cinco caras, sin nada alrededor— porque es el gesto que la persona ya
 * conoce: el papel es lo que lleva y trae lo que se escribe. `origami.ts` es el
 * único sitio donde vive esa figura, así que evoluciona en los dos lados a la
 * vez.
 *
 * Ni el asa ni la ventana están ancladas: `drag.ts` guarda su posición y la
 * respeta al recargar. Es la instrucción explícita —«así lo podré mover o
 * posicionar donde desee»— y también lo que hace que el asistente pueda mirar
 * el documento sin taparlo.
 *
 * Lo que ve, lo ve `conversation.ts`; aquí sólo se dice.
 */

/** Preguntas de arranque. Son del método, no de cortesía. */
const SEEDS: readonly string[] = [
  "¿Qué le falta a mi intención para poder indagarla?",
  "¿Cuál es la naturaleza de la situación que describo?",
  "¿Qué debería indagar primero, y con qué?",
];

/** Tope de altura del campo: a partir de ahí, se desplaza dentro. */
const FIELD_MAX = 150;
/** Margen para decidir si el registro estaba abajo antes de crecer. */
const NEAR_BOTTOM = 80;

let handle: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let log: HTMLElement | null = null;
let field: HTMLTextAreaElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let ctxLine: HTMLElement | null = null;
let footLine: HTMLElement | null = null;
let panelMove: Movable | null = null;
let handleMove: Movable | null = null;

/* --- lo que se dice ------------------------------------------------------- */

function turnLine(role: "user" | "assistant" | "system", text: string): HTMLElement {
  const kind = role === "user" ? " ai-turn--mine" : "";
  return el("div", { class: `ai-turn${kind}`, text });
}

function emptyState(): HTMLElement {
  return el("div", { class: "ai-empty" }, [
    el("p", { class: "ai-empty__lead", text:
      "Pregunta lo que quieras del proyecto. No lo va a escribir por ti: " +
      "te va a devolver lo que falta por decidir." }),
    el("div", { class: "ai-seeds" }, SEEDS.map((seed) => el("button", {
      class: "ai-seed",
      text: seed,
      attrs: { type: "button" },
      on: { click: () => { void submit(seed); } },
    }))),
  ]);
}

function paintLog(): void {
  if (!log) return;
  const turns = conversation();
  if (turns.length === 0) {
    render(log, emptyState());
    return;
  }
  render(log, ...turns.map((turn) => turnLine(turn.role, turn.content)));
  log.scrollTop = log.scrollHeight;
}

/** Qué está viendo el asistente, dicho en la cabecera para que no sea magia. */
function paintContext(): void {
  if (!ctxLine) return;
  const seen: string[] = [];
  if (intent.get()?.text) seen.push("tu intención");
  const page = selection.get();
  if (page) seen.push(`«${page.name}»`);
  ctxLine.textContent = seen.length > 0
    ? `Ve ${seen.join(" y ")}`
    : "Todavía no ve nada: abre una página";
}

/** Proveedor y modelo, o el aviso de que falta la credencial. */
function paintFoot(): void {
  if (!footLine) return;
  const provider = activeProvider();
  // Por nombre y no por la tabla: los proveedores propios no están en ella.
  const label = providerLabel(provider);

  if (!hasCredential(provider)) {
    render(footLine,
      `${label}: falta la credencial. `,
      el("button", {
        class: "ai-link",
        text: "Configúrala en IA",
        attrs: { type: "button" },
        on: {
          click: () => {
            // La franja de abajo se abre por evento: el asistente no tiene por
            // qué conocerla, y así no se importan en círculo.
            document.dispatchEvent(new CustomEvent("dock:open", { detail: "ia" }));
          },
        },
      }),
    );
    return;
  }

  const model = chosenModel(provider);
  footLine.textContent = model ? `${label} · ${model}` : label;
}

/* --- preguntar ------------------------------------------------------------ */

function busy(on: boolean): void {
  if (!sendBtn) return;
  sendBtn.classList.toggle("is-busy", on);
  const label = on ? "Detener la respuesta" : "Preguntar";
  sendBtn.setAttribute("aria-label", label);
  sendBtn.title = label;
}

/** El campo crece con lo escrito hasta un tope; luego se desplaza dentro. */
function grow(): void {
  if (!field) return;
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, FIELD_MAX)}px`;
}

async function submit(text: string): Promise<void> {
  const box = log;
  if (!box) return;

  const question = text.trim();
  if (!question || isAsking()) return;

  if (field) {
    field.value = "";
    grow();
  }

  // El estado vacío desaparece con la primera pregunta, no antes.
  if (conversation().length === 0) render(box);
  box.append(turnLine("user", question));

  const answer = el("div", { class: "ai-turn ai-turn--wait", text: "…" });
  box.append(answer);
  box.scrollTop = box.scrollHeight;
  busy(true);

  let full = "";
  try {
    await ask(question, {
      onDelta: (chunk) => {
        // Se mira antes de crecer: si la persona había subido a leer algo, no
        // se le arrastra la vista hacia abajo con cada trozo.
        const near = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM;
        full += chunk;
        answer.className = "ai-turn";
        answer.textContent = full;
        if (near) box.scrollTop = box.scrollHeight;
      },
    });

    if (!full.trim()) {
      answer.className = "ai-turn ai-turn--bad";
      answer.textContent = "El proveedor no devolvió texto. Prueba con otro modelo.";
    }
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === "AbortError";
    answer.className = "ai-turn ai-turn--bad";
    answer.textContent = stopped
      ? (full.trim() ? full : "Detenido.")
      : (error instanceof Error ? error.message : "No se pudo preguntar.");
    if (stopped && full.trim()) answer.className = "ai-turn";
  } finally {
    busy(false);
  }
}

/* --- construcción --------------------------------------------------------- */

let panelGrip: HTMLElement | null = null;

function buildHandle(): HTMLButtonElement {
  return el("button", {
    class: "ai-handle",
    attrs: {
      type: "button", hidden: true,
      "aria-label": "Asistente", "aria-expanded": "false", "aria-controls": "ai-pop",
      title: "Asistente · arrástralo donde quieras",
    },
    on: {
      click: () => {
        // Si se acaba de arrastrar, esto es el clic del arrastre y no una orden.
        if (handleMove?.dragged()) return;
        toggle();
      },
    },
  }, [origamiSvg("ai-handle__ori")]);
}

function buildPanel(): HTMLElement {
  ctxLine = el("span", { class: "ai-pop__ctx" });

  const grip = el("header", {
    class: "ai-pop__grip",
    attrs: { tabindex: "0", "aria-label": "Mover el asistente con las flechas del teclado" },
  }, [
    el("span", { class: "ai-pop__title", text: "Asistente" }),
    ctxLine,
    el("button", {
      class: "ai-pop__act",
      text: "Nueva",
      attrs: { type: "button", title: "Empezar otra conversación" },
      on: { click: () => { resetConversation(); paintLog(); busy(false); field?.focus(); } },
    }),
    el("button", {
      class: "ai-pop__act ai-pop__x",
      text: "×",
      attrs: { type: "button", "aria-label": "Cerrar el asistente" },
      on: { click: () => { close(); handle?.focus(); } },
    }),
  ]);
  panelGrip = grip;

  log = el("div", {
    class: "ai-pop__log",
    attrs: { role: "log", "aria-live": "polite", "aria-label": "Conversación" },
  });

  const area = el("textarea", {
    class: "ai-pop__field",
    attrs: { rows: 1, placeholder: "Pregúntale, o cuéntale en qué estás…", "aria-label": "Tu pregunta" },
    on: {
      input: grow,
      keydown: (event) => {
        // Enter pregunta; Mayús+Enter hace párrafo. Es lo que ya hace la entrada.
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        void submit(area.value);
      },
    },
  });
  field = area;

  sendBtn = el("button", {
    class: "ai-pop__send",
    attrs: { type: "submit", "aria-label": "Preguntar", title: "Preguntar" },
  }, [origamiSvg("ai-pop__ori")]);

  const form = el("form", {
    class: "ai-pop__ask",
    on: {
      submit: (event) => {
        event.preventDefault();
        if (isAsking()) { stopAsking(); return; }
        void submit(area.value);
      },
    },
  }, [area, sendBtn]);

  footLine = el("p", { class: "ai-pop__foot" });

  const box = el("section", {
    class: "ai-pop",
    attrs: { id: "ai-pop", hidden: true, "aria-label": "Asistente 3i" },
    on: {
      keydown: (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
        handle?.focus();
      },
    },
  }, [grip, log, form, footLine]);

  return box;
}

/* --- abrir, cerrar, aparecer ---------------------------------------------- */

function ensure(): void {
  if (panel) return;

  handle = buildHandle();
  panel = buildPanel();
  document.body.append(handle, panel);

  handleMove = makeMovable(handle, {
    name: "assistant.handle",
    // Abajo a la derecha, por encima del asa de la franja de trabajo.
    initial: (viewport, size) => ({ x: viewport.x - size.x - 22, y: viewport.y - size.y - 64 }),
  });
  panelMove = makeMovable(panel, {
    name: "assistant.panel",
    grip: panelGrip ?? panel,
    initial: (viewport, size) => ({
      x: viewport.x - size.x - 22,
      y: Math.max(16, viewport.y - size.y - 110),
    }),
  });

  paintLog();
  paintContext();
  paintFoot();

  intent.subscribe(paintContext);
  selection.subscribe(paintContext);
  aiConfig.subscribe(paintFoot);
  serverKeys.subscribe(paintFoot);
}

function open(): void {
  ensure();
  if (!handle || !panel) return;

  handle.hidden = false;
  handleMove?.place();
  panel.hidden = false;
  // Se coloca ya visible: oculto no tiene medidas y no se podría encajar.
  panelMove?.place();
  handle.setAttribute("aria-expanded", "true");
  handle.classList.add("is-on");
  field?.focus();
}

function close(): void {
  if (!panel || !handle) return;
  panel.hidden = true;
  handle.setAttribute("aria-expanded", "false");
  handle.classList.remove("is-on");
}

function toggle(): void {
  if (panel && !panel.hidden) close();
  else open();
}

/** Desde la pestaña IA de la franja de abajo. */
export function openAssistant(): void {
  open();
}

export function closeAssistant(): void {
  close();
}

/**
 * Monta el asa y la deja aparecer cuando termine la intro, con la misma cortesía
 * que la franja de trabajo. La ventana no se abre sola: aparece el papel.
 */
export function mountAssistant(): void {
  ensure();
  onMenuVisible(() => {
    if (!handle) return;
    handle.hidden = false;
    handleMove?.place();
    handle.classList.add("is-in");
    handle.addEventListener("animationend", () => { handle?.classList.remove("is-in"); }, { once: true });
  });
}
