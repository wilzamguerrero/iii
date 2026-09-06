import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { setBeginOpener } from "./open.ts";
import { announceMade } from "../dock/reload.ts";
import { beginNotion, chooseRoot } from "../dock/workspace.ts";
import { openAiSettings } from "../dock/tray.ts";
import { session } from "../../core/persist/session.ts";
import { intent } from "../../core/state/intent.ts";
import { selectPage } from "../../core/state/selection.ts";
import {
  activeProvider, aiConfig, hasCredential, probeServerKeys, providerLabel, serverKeys,
} from "../../core/ai/config.ts";
import { fallbackTitle, proposeProject, type Seed } from "../../core/ai/scaffold.ts";
import { createFromIntent, type Step } from "../../core/project/create.ts";
import { PHASES } from "../../core/method/structures.ts";
import type { TreeNode } from "../../core/notion/tree.ts";

/**
 * De la intención al proyecto.
 *
 * Es el único sitio de la plataforma donde la IA *hace* algo en vez de preguntar, y
 * lo que hace es acotado a propósito: propone un nombre y las preguntas con las que
 * arranca cada fase. No redacta el proyecto. Las preguntas no están escritas en
 * ningún archivo de este repositorio —salen de esta intención y de ninguna otra—,
 * porque un cuestionario igual para todos es exactamente lo que la metodología no
 * quiere: la naturaleza de la situación se identifica, no se rellena.
 *
 * Lo que se crea en Notion es la carpeta del proyecto y tres documentos: Indagar,
 * Idear, Implementar. Las estructuras de la universidad —idea, anteproyecto,
 * informe— no se crean aquí: se insertan después, dentro del documento, cuando la
 * persona sabe qué está entregando (`core/method/structures.ts`).
 *
 * Se puede crear sin IA y sin esperarla. Si no hay modelo conectado, o contesta
 * mal, el proyecto se crea igual con el nombre que la persona escriba y los
 * documentos quedan enmarcados pero sin preguntas, y el documento lo dice en vez de
 * disimularlo. Nada de esto bloquea a nadie.
 *
 * Vive en el `<body>`, sobre todo lo demás (z 13 el fondo, 14 la hoja): sale de la
 * pantalla de entrada, que no es un panel del que pueda colgar.
 */

/** Los pasos que se cuentan mientras se crea: la carpeta y un documento por fase. */
const STEPS = 1 + PHASES.length;

type State = "off" | "pick" | "ready" | "busy" | "done";

interface Made {
  project: TreeNode;
  pages: TreeNode[];
}

export interface BeginOptions {
  /** Abrir la franja. Elegir raíz y abrir el documento ocurren dentro de ella. */
  openDock: () => void;
}

export function mountBegin(options: BeginOptions): void {
  /** Lo que la persona haya escrito en el nombre; se conserva entre repintados. */
  let name = "";
  /** Cierto en cuanto toca el campo: desde entonces el modelo no lo pisa. */
  let touched = false;
  let asking: AbortController | null = null;
  /** Cierto cuando ya se le pidió al modelo en esta apertura, con o sin suerte. */
  let tried = false;
  let seeds: readonly Seed[] = [];
  let note = "";
  let aiSaid = "";
  let aiBad = false;
  /** Lo que hay que contar de esta pantalla: conectar, o crear, cuando fallan. */
  let said = "";
  let saidBad = false;
  let step: Step | null = null;
  let made: Made | null = null;
  let creating = false;
  /** A dónde devolver el foco al cerrar. */
  let cameFrom: Element | null = null;

  const heading = el("h2", { class: "begin__title", attrs: { id: "begin-title" } });
  const body = el("div", { class: "begin__body" });

  const shut = el("button", {
    class: "begin__x",
    attrs: { type: "button", "aria-label": "Cerrar" },
    on: { click: () => { close(); } },
  }, [icon("cross", "ico ico--small")]);

  const sheet = el("div", {
    class: "begin__sheet",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "begin-title" },
  }, [
    el("header", { class: "begin__head" }, [heading, shut]),
    body,
  ]);

  const root = el("div", { class: "begin", attrs: { hidden: true } }, [sheet]);
  document.body.append(root);

  function state(): State {
    if (made) return "done";
    if (creating) return "busy";
    const now = session.get();
    if (!now) return "off";
    if (!now.rootPageId) return "pick";
    return "ready";
  }

  /* --- abrir y cerrar ------------------------------------------------------ */

  function open(): void {
    if (!root.hidden) return;
    cameFrom = document.activeElement;
    made = null;
    step = null;
    said = "";
    saidBad = false;
    aiSaid = "";
    aiBad = false;
    tried = false;
    seeds = [];
    note = "";
    touched = false;
    name = fallbackTitle(intent.get()?.text ?? "");
    root.hidden = false;
    listen(true);
    // El servidor puede tener la clave del proveedor de casa; sin preguntarlo,
    // `hasCredential` diría que no y esto ofrecería configurar lo que ya está.
    void probeServerKeys();
    paint();
    maybeAsk();
  }

  function close(): void {
    if (root.hidden) return;
    // Cerrar en mitad de la creación no la detiene —los bloques ya se están
    // escribiendo en Notion— pero sí deja de esperarla: el aviso al explorador
    // llega igual y el proyecto aparece donde tiene que aparecer.
    asking?.abort();
    asking = null;
    root.hidden = true;
    listen(false);
    if (cameFrom instanceof HTMLElement) cameFrom.focus();
    cameFrom = null;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || root.hidden) return;
    if (creating) return;   // no se cierra lo que está escribiendo en Notion
    event.stopPropagation();
    event.preventDefault();
    close();
  }

  function onDown(event: PointerEvent): void {
    if (creating || event.target !== root) return;
    close();
  }

  function listen(on: boolean): void {
    if (on) {
      document.addEventListener("keydown", onKey, true);
      root.addEventListener("pointerdown", onDown);
      return;
    }
    document.removeEventListener("keydown", onKey, true);
    root.removeEventListener("pointerdown", onDown);
  }

  /* --- pedirle el armazón al modelo ---------------------------------------- */

  /**
   * Se pide una sola vez por apertura y sólo si hay credencial. No se reintenta
   * solo: un modelo que no sabe contestar JSON no aprende al segundo intento, y
   * mientras tanto la persona no puede crear nada.
   */
  function maybeAsk(): void {
    const text = intent.get()?.text?.trim();
    if (tried || !text || state() !== "ready") return;
    if (!hasCredential()) return;

    tried = true;
    const mine = new AbortController();
    asking = mine;
    aiSaid = "Leyendo tu intención y preparando las preguntas…";
    aiBad = false;
    paint();

    void (async () => {
      try {
        const proposal = await proposeProject(text, { signal: mine.signal });
        if (asking !== mine) return;
        asking = null;
        seeds = proposal.seeds;
        note = proposal.note ?? "";
        // El nombre propuesto sólo entra si la persona no ha escrito el suyo.
        if (!touched) name = proposal.title;
        aiSaid = "";
        paint();
      } catch (cause) {
        if (asking !== mine) return;
        asking = null;
        if (mine.signal.aborted) return;
        aiSaid = cause instanceof Error
          ? cause.message
          : "No se pudieron preparar las preguntas.";
        aiBad = true;
        paint();
      }
    })();
  }

  /* --- crear --------------------------------------------------------------- */

  async function create(): Promise<void> {
    const now = session.get();
    const root_ = now?.rootPageId;
    const text = intent.get()?.text?.trim() ?? "";
    if (!now || !root_ || creating) return;

    // Lo que pidió el modelo ya no importa: se crea con lo que hay.
    asking?.abort();
    asking = null;
    creating = true;
    step = { done: 0, total: STEPS, label: "Creando el proyecto…" };
    said = "";
    saidBad = false;
    paint();

    try {
      const created = await createFromIntent({
        token: now.token,
        parentId: root_,
        name,
        intent: text,
        seeds,
        onStep: (next) => { step = next; if (creating) paint(); },
      });
      creating = false;
      made = created;
      // Al explorador antes de pintar: si la franja está abierta, el proyecto
      // aparece en ella mientras se lee esta pantalla.
      announceMade({
        parentId: root_,
        nodes: [created.project],
        enter: [
          { id: root_, name: now.rootPageTitle ?? "Proyectos" },
          { id: created.project.id, name: created.project.name },
        ],
      });
      paint();
    } catch (cause) {
      creating = false;
      step = null;
      said = cause instanceof Error
        ? `No se pudo crear el proyecto. ${cause.message}`
        : "No se pudo crear el proyecto.";
      saidBad = true;
      paint();
    }
  }

  /* --- las piezas que no se rehacen ---------------------------------------- */

  /**
   * El campo, la zona del modelo y las líneas de estado se crean una vez y se
   * actualizan. Si se rehicieran en cada repintado, la propuesta del modelo
   * llegando a media escritura le quitaría el foco a quien está escribiendo el
   * nombre —y con él, lo que llevara escrito.
   */
  const nameInput = el("input", {
    class: "search__input",
    attrs: {
      type: "text", maxlength: 90, autocomplete: "off", spellcheck: false,
      placeholder: "Nombre del proyecto", "aria-label": "Nombre del proyecto",
    },
  });

  nameInput.addEventListener("input", () => {
    touched = true;
    name = nameInput.value;
    ready();
  });

  nameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (name.trim()) void create();
  });

  const createBtn = el("button", {
    class: "btn",
    text: "Crear el proyecto",
    attrs: { type: "button" },
    on: { click: () => { void create(); } },
  });

  const aiZone = el("div", { class: "begin__ai" });
  const status = el("p", { class: "msg", attrs: { role: "status" } });
  const stepLine = el("p", { class: "msg", attrs: { role: "status" } });
  const barFill = el("i", { class: "begin__bar__fill" });
  const bar = el("div", {
    class: "begin__bar",
    attrs: { role: "progressbar", "aria-label": "Creando el proyecto" },
  }, [barFill]);

  function ready(): void {
    createBtn.disabled = name.trim().length === 0;
  }

  /* --- pintar --------------------------------------------------------------- */

  let painted: State | null = null;

  function paint(): void {
    const now = state();
    if (now !== painted) {
      painted = now;
      frame(now);
    }
    update(now);
  }

  function quiet(label: string, run: () => void): HTMLButtonElement {
    return el("button", {
      class: "btn btn--quiet",
      text: label,
      attrs: { type: "button" },
      on: { click: run },
    });
  }

  /** La intención, citada: es de lo que se va a hacer el proyecto. */
  function quote(): HTMLElement {
    return el("p", { class: "begin__quote", text: intent.get()?.text ?? "" });
  }

  function frame(now: State): void {
    switch (now) {
      case "off":
        heading.textContent = "Antes hay que conectar Notion";
        render(body,
          quote(),
          el("p", {
            class: "pnl__note",
            text: "El proyecto y sus documentos se crean en tu Notion, no aquí: " +
              "la plataforma no guarda copia de lo que escribas.",
          }),
          el("div", { class: "pnl__row" }, [
            el("button", {
              class: "btn",
              text: "Conectar con Notion",
              attrs: { type: "button" },
              on: { click: (event) => { void connect(event.currentTarget); } },
            }),
            quiet("Ahora no", () => { close(); }),
          ]),
          status,
        );
        return;

      case "pick":
        heading.textContent = "Falta decir dónde";
        render(body,
          quote(),
          el("p", {
            class: "pnl__note",
            text: "Elige la página de Notion bajo la que van a vivir los proyectos. " +
              "Se elige una vez y se puede cambiar después.",
          }),
          el("div", { class: "pnl__row" }, [
            el("button", {
              class: "btn",
              text: "Elegir la página raíz",
              attrs: { type: "button" },
              on: { click: () => { close(); chooseRoot(true); options.openDock(); } },
            }),
            quiet("Ahora no", () => { close(); }),
          ]),
          status,
        );
        return;

      case "ready":
        frameReady();
        return;

      case "busy":
        heading.textContent = "Creándolo en Notion";
        render(body,
          el("p", { class: "pnl__lead", text: name.trim() }),
          bar,
          stepLine,
        );
        return;

      case "done":
        frameDone();
    }
  }

  function frameReady(): void {
    heading.textContent = "Empezar el proyecto";
    render(body,
      quote(),
      el("label", { class: "begin__label" }, [
        el("span", { class: "begin__label__txt", text: "Nombre del proyecto" }),
        el("span", { class: "search" }, [nameInput]),
      ]),
      aiZone,
      el("div", { class: "pnl__row" }, [createBtn, quiet("Ahora no", () => { close(); })]),
      el("p", {
        class: "pnl__note",
        text: "Se crea una carpeta con tres documentos —Indagar, Idear, " +
          "Implementar—, cada uno con sus preguntas. Las estructuras de la " +
          "universidad se insertan después, dentro del documento.",
      }),
      status,
    );
    ready();
  }

  function frameDone(): void {
    const done = made;
    if (!done) return;
    heading.textContent = "Proyecto creado";
    const first = done.pages[0];

    render(body,
      el("p", { class: "pnl__lead", text: done.project.name }),
      el("ul", { class: "begin__made" }, done.pages.map((page) => el("li", {
        class: "begin__made__one",
      }, [icon("page", "ico ico--small"), el("span", { text: page.name })]))),
      el("p", {
        class: "pnl__note",
        text: seeds.some((seed) => seed.questions.length > 0)
          ? "Cada documento empieza con las preguntas de este proyecto. Respóndelas " +
            "escribiendo: eso es el documento."
          : "Los documentos quedaron enmarcados. Las preguntas las irás haciendo con " +
            "el asistente a medida que indagues.",
      }),
      el("div", { class: "pnl__row" }, [
        ...(first
          ? [el("button", {
              class: "btn",
              text: `Abrir ${first.name}`,
              attrs: { type: "button" },
              on: {
                click: () => {
                  selectPage({
                    id: first.id,
                    name: first.name,
                    parentId: done.project.id,
                    projectName: done.project.name,
                  });
                  close();
                  options.openDock();
                },
              },
            })]
          : []),
        quiet("Cerrar", () => { close(); }),
      ]),
      status,
    );
  }

  /* --- lo que cambia sin rehacer el marco ---------------------------------- */

  function update(now: State): void {
    status.className = saidBad ? "msg msg--bad" : "msg";
    status.textContent = said;

    if (now === "ready") {
      if (!touched && nameInput.value !== name) nameInput.value = name;
      paintAi();
      ready();
      return;
    }

    if (now === "busy" && step) {
      const pct = Math.round((step.done / step.total) * 100);
      barFill.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", String(step.done));
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(step.total));
      stepLine.textContent = step.label;
    }
  }

  /** Las preguntas propuestas, o por qué todavía no hay ninguna. */
  function paintAi(): void {
    if (asking) {
      render(aiZone, el("p", { class: "msg", text: aiSaid }));
      return;
    }

    if (!hasCredential()) {
      render(aiZone,
        el("p", {
          class: "pnl__note",
          text: `Las preguntas de arranque las hace el modelo que conectes; ` +
            `${providerLabel(activeProvider())} no tiene credencial. El proyecto se ` +
            `crea igual: los documentos quedan enmarcados y sin preguntas.`,
        }),
        el("div", { class: "pnl__row" }, [
          // Los ajustes son una ventanita de la bandeja y viven por debajo de
          // esta hoja: hay que dejarle la pantalla. Al volver, el explorador
          // ofrece «Crear desde la intención» y se sigue por donde iba.
          quiet("Configurar la IA", () => { close(); openAiSettings(); }),
        ]),
      );
      return;
    }

    if (aiSaid) {
      render(aiZone,
        el("p", { class: aiBad ? "msg msg--bad" : "msg", text: aiSaid }),
        el("div", { class: "pnl__row" }, [
          quiet("Probar otra vez", () => { tried = false; aiSaid = ""; maybeAsk(); }),
        ]),
      );
      return;
    }

    const asked = seeds.filter((seed) => seed.questions.length > 0);
    if (asked.length === 0) {
      render(aiZone, el("p", {
        class: "pnl__note",
        text: "Los documentos se crearán enmarcados; las preguntas las irás " +
          "haciendo con el asistente.",
      }));
      return;
    }

    render(aiZone,
      ...(note ? [el("p", { class: "begin__note", text: note })] : []),
      ...asked.map((seed) => {
        const phase = PHASES.find((one) => one.id === seed.phase);
        return el("section", { class: "begin__phase" }, [
          el("h3", { class: "begin__phase__name", text: phase?.name ?? seed.phase }),
          el("ul", { class: "begin__qs" }, seed.questions.map(
            (question) => el("li", { class: "begin__q", text: question }),
          )),
        ]);
      }),
    );
  }

  /* --- conectar desde aquí -------------------------------------------------- */

  /**
   * El mismo viaje de OAuth que la franja y la bandeja: la página se va a Notion y
   * vuelve. La intención sobrevive porque está en `localStorage`, así que al volver
   * se puede seguir por donde se iba.
   */
  async function connect(source: EventTarget | null): Promise<void> {
    const button = source instanceof HTMLButtonElement ? source : null;
    if (button) button.disabled = true;
    said = "Abriendo la autorización de Notion…";
    saidBad = false;
    paint();

    const failed = await beginNotion();
    if (!failed) return;   // la página ya se está yendo
    if (button) button.disabled = false;
    said = failed;
    saidBad = true;
    paint();
  }

  /* --- puesta en marcha ----------------------------------------------------- */

  ready();
  setBeginOpener(open);

  /**
   * Conectar y elegir raíz ocurren fuera de esta hoja —en la franja, o volviendo de
   * Notion— y cambian a qué estado toca. Se repinta mientras esté abierta, y de paso
   * se le pide al modelo lo que no se le pudo pedir antes por no haber sitio donde
   * crear.
   */
  session.subscribe(() => {
    if (root.hidden) return;
    said = "";
    saidBad = false;
    paint();
    maybeAsk();
  });

  /**
   * La clave del servidor se conoce después de abrir. Si aparece una, esto deja de
   * ofrecer configurarla y pide las preguntas.
   */
  serverKeys.subscribe(() => {
    if (root.hidden) return;
    paint();
    maybeAsk();
  });

  aiConfig.subscribe(() => {
    if (root.hidden) return;
    paint();
    maybeAsk();
  });
}
