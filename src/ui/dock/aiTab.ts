import { el, render } from "../dom.ts";
import {
  activeProvider, aiConfig, browserKey, chosenModel, clearKey, hasCredential,
  probeServerKeys, serverKeys, setKey, setModel, setProvider,
} from "../../core/ai/config.ts";
import { cachedCatalog, forgetCatalog, listModels } from "../../core/ai/models.ts";
import { startDeviceFlow, waitForDeviceToken, type DeviceStart } from "../../core/ai/device.ts";
import { PROVIDER_IDS, PROVIDERS, type AiModel, type ProviderId } from "../../core/ai/types.ts";
import { openAssistant } from "../assistant/assistant.ts";

/**
 * Pestaña «IA»: qué proveedor, con qué credencial y con qué modelo.
 *
 * Las tres opciones son las del proyecto de referencia —OpenRouter, NVIDIA y
 * Copilot por cuenta de GitHub— y la de GitHub usa el alta por dispositivo, que
 * es la que no pide registrar nada (plan.md D3).
 *
 * La clave se guarda en este navegador. Quien no quiera correr ese riesgo puede
 * dejarla en el entorno del servidor: entonces aquí sólo aparece que ya está
 * configurada, y nunca cuál es.
 */

/** Cuántos modelos se enumeran antes de resumir. OpenRouter devuelve cientos. */
const MANY = 40;

export function mountAiTab(container: HTMLElement): void {
  const status = el("p", { class: "msg" });
  const hint = el("p", { class: "pnl__note" });
  const credBlock = el("div", { class: "pnl__block" });
  const modelBlock = el("div", { class: "pnl__block" });

  /** Se cancela lo que estuviera esperando al cambiar de proveedor. */
  let waiting: AbortController | null = null;
  let shown: ProviderId | null = null;
  let shownKey: string | null = null;

  function say(message: string, bad = false): void {
    status.className = bad ? "msg msg--bad" : "msg";
    status.textContent = message;
  }

  /* --- elegir proveedor --------------------------------------------------- */

  const tabs = new Map<ProviderId, HTMLButtonElement>();
  const seg = el("div", {
    class: "seg",
    attrs: { role: "group", "aria-label": "Proveedor de IA" },
  }, PROVIDER_IDS.map((id) => {
    const button = el("button", {
      class: "seg__btn",
      text: PROVIDERS[id].label,
      attrs: { type: "button", "aria-pressed": "false" },
      on: { click: () => { setProvider(id); } },
    });
    tabs.set(id, button);
    return button;
  }));

  /* --- credencial --------------------------------------------------------- */

  function serverHas(provider: ProviderId): boolean {
    return serverKeys.get()?.[provider] === true;
  }

  function buildKeyForm(provider: ProviderId): void {
    const info = PROVIDERS[provider];
    const saved = browserKey(provider);

    const input = el("input", {
      class: "search__input",
      attrs: {
        type: "password", placeholder: saved ? "Clave guardada en este navegador" : "Pega aquí tu clave",
        autocomplete: "off", spellcheck: false, "aria-label": `Clave de ${info.label}`,
      },
    });

    const save = el("button", {
      class: "btn",
      text: saved ? "Cambiar" : "Guardar",
      attrs: { type: "button" },
      on: {
        click: () => {
          const value = input.value.trim();
          if (!value) { say("Escribe la clave antes de guardarla.", true); return; }
          setKey(provider, value);
          input.value = "";
          say("Clave guardada en este navegador.");
        },
      },
    });

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      save.click();
    });

    const row = el("div", { class: "pnl__row" }, [
      el("div", { class: "search" }, [input]),
      save,
    ]);

    if (saved) {
      row.append(el("button", {
        class: "btn btn--quiet",
        text: "Quitar",
        attrs: { type: "button" },
        on: {
          click: () => {
            clearKey(provider);
            say("Clave borrada de este navegador.");
          },
        },
      }));
    }

    const lines: HTMLElement[] = [row];

    if (serverHas(provider)) {
      lines.push(el("p", { class: "pnl__note", text:
        "Este servidor ya tiene una clave configurada, así que puedes dejarlo " +
        "vacío. Si pones la tuya aquí, se usará la tuya." }));
    }
    if (info.keyUrl) {
      lines.push(el("p", { class: "pnl__note" }, [
        "La clave se saca en ",
        el("a", {
          class: "lnk", text: info.keyUrl,
          attrs: { href: info.keyUrl, target: "_blank", rel: "noopener noreferrer" },
        }),
        ".",
      ]));
    }

    render(credBlock, ...lines);
  }

  /* --- alta por dispositivo (GitHub) -------------------------------------- */

  function buildDeviceForm(): void {
    const saved = browserKey("github");

    if (saved) {
      render(credBlock,
        el("div", { class: "pnl__row" }, [
          el("p", { class: "pnl__note", text: "Cuenta de GitHub conectada en este navegador." }),
          el("button", {
            class: "btn btn--quiet",
            text: "Desconectar",
            attrs: { type: "button" },
            on: {
              click: () => {
                clearKey("github");
                say("Cuenta desconectada de este navegador.");
              },
            },
          }),
        ]),
      );
      if (serverHas("github")) {
        credBlock.append(el("p", { class: "pnl__note", text:
          "El servidor también tiene un token configurado; se usa el tuyo." }));
      }
      return;
    }

    const connect = el("button", {
      class: "btn",
      text: "Conectar con GitHub",
      attrs: { type: "button" },
      on: { click: () => { void begin(); } },
    });

    const lines: HTMLElement[] = [el("div", { class: "pnl__row" }, [connect])];
    if (serverHas("github")) {
      lines.push(el("p", { class: "pnl__note", text:
        "Este servidor ya tiene un token configurado: puedes usar la IA sin conectar tu cuenta." }));
    }
    lines.push(el("p", { class: "pnl__note", text:
      "Aparecerá un código de ocho caracteres para escribirlo en github.com. " +
      "No hay que registrar ninguna aplicación ni pegar ninguna clave." }));

    render(credBlock, ...lines);
  }

  /** El código, el enlace y la espera. Cancelar aborta el sondeo. */
  function showCode(start: DeviceStart, controller: AbortController): void {
    render(credBlock,
      el("p", { class: "pnl__note", text: "Escribe este código en GitHub:" }),
      el("div", { class: "pnl__row" }, [
        el("code", { class: "pin", text: start.userCode }),
        el("button", {
          class: "btn btn--quiet",
          text: "Copiar",
          attrs: { type: "button" },
          on: {
            click: (event) => {
              const button = event.currentTarget as HTMLButtonElement;
              navigator.clipboard?.writeText(start.userCode).then(
                () => { button.textContent = "Copiado"; },
                () => { button.textContent = "Cópialo a mano"; },
              );
            },
          },
        }),
      ]),
      el("div", { class: "pnl__row" }, [
        el("a", {
          class: "btn",
          text: "Abrir github.com/login/device",
          attrs: { href: start.verificationUri, target: "_blank", rel: "noopener noreferrer" },
        }),
        el("button", {
          class: "btn btn--quiet",
          text: "Cancelar",
          attrs: { type: "button" },
          on: { click: () => { controller.abort(); buildDeviceForm(); say("Conexión cancelada."); } },
        }),
      ]),
      el("p", { class: "pnl__note", text: "Esperando a que autorices…" }),
    );
  }

  async function begin(): Promise<void> {
    waiting?.abort();
    const controller = new AbortController();
    waiting = controller;
    say("Pidiendo el código a GitHub…");

    try {
      const start = await startDeviceFlow(controller.signal);
      showCode(start, controller);
      const token = await waitForDeviceToken(start, controller.signal);
      if (controller.signal.aborted) return;
      // Guardarlo dispara `aiConfig`, que repinta esta pestaña ya conectada.
      setKey("github", token);
      say("Cuenta de GitHub conectada.");
    } catch (error) {
      if (controller.signal.aborted) return;
      buildDeviceForm();
      say(error instanceof Error ? error.message : "No se pudo conectar con GitHub.", true);
    }
  }

  /* --- modelo -------------------------------------------------------------- */

  function option(model: AiModel, withPublisher: boolean): HTMLOptionElement {
    const bits = [withPublisher && model.publisher ? `${model.publisher} · ` : "", model.name];
    const label = bits.join("") + (model.tag ? ` — ${model.tag}` : "");
    return el("option", { text: label, attrs: { value: model.id } });
  }

  function byPublisher(models: readonly AiModel[]): Map<string, AiModel[]> {
    const groups = new Map<string, AiModel[]>();
    for (const model of models) {
      const key = model.publisher || "Otros";
      const list = groups.get(key);
      if (list) list.push(model);
      else groups.set(key, [model]);
    }
    return groups;
  }

  /**
   * Llena el desplegable. Con muchos modelos se agrupan por editor —OpenRouter
   * devuelve cientos y una lista plana no se lee—; con pocos, lista corrida.
   */
  function fill(select: HTMLSelectElement, provider: ProviderId, models: readonly AiModel[]): void {
    const chosen = chosenModel(provider);
    render(select);

    if (models.length > MANY) {
      for (const [publisher, list] of byPublisher(models)) {
        const group = el("optgroup", { attrs: { label: publisher } },
          list.map((model) => option(model, false)));
        select.append(group);
      }
    } else {
      for (const model of models) select.append(option(model, true));
    }

    // Un modelo elegido antes puede no estar en el catálogo de hoy. Se conserva
    // como primera opción en vez de cambiárselo a la persona sin avisar.
    if (chosen && !models.some((model) => model.id === chosen)) {
      select.prepend(el("option", { text: `${chosen} (elegido)`, attrs: { value: chosen } }));
    }
    if (chosen) select.value = chosen;
  }

  function buildModelBlock(provider: ProviderId): void {
    const select = el("select", {
      class: "sel",
      attrs: { "aria-label": "Modelo" },
      on: {
        change: () => {
          if (select.value) setModel(provider, select.value);
        },
      },
    });

    const refresh = el("button", {
      class: "btn btn--quiet",
      text: "Actualizar",
      attrs: { type: "button" },
      on: {
        click: () => {
          forgetCatalog(provider);
          void load(true);
        },
      },
    });

    const note = el("p", { class: "pnl__note" });

    async function load(forced: boolean): Promise<void> {
      const cached = forced ? null : cachedCatalog(provider);
      if (cached && cached.models.length > 0) {
        fill(select, provider, cached.models);
        note.textContent = `${cached.models.length} modelos.`;
      } else {
        render(select, el("option", { text: "Cargando…", attrs: { value: "" } }));
        note.textContent = "";
      }

      // Sin credencial no hay catálogo, salvo donde la lista es pública.
      if (!PROVIDERS[provider].publicCatalog && !hasCredential(provider)) {
        const missing = PROVIDERS[provider].auth === "device"
          ? "Conecta la cuenta primero"
          : "Guarda la clave primero";
        render(select, el("option", { text: missing, attrs: { value: "" } }));
        note.textContent = "";
        return;
      }

      select.disabled = true;
      refresh.disabled = true;
      try {
        const catalog = await listModels(provider, { force: forced });
        if (catalog.models.length === 0) {
          render(select, el("option", { text: "Sin modelos", attrs: { value: "" } }));
          note.textContent = "El proveedor no devolvió ningún modelo.";
          return;
        }
        fill(select, provider, catalog.models);
        if (!chosenModel(provider) && catalog.defaultModel) {
          select.value = catalog.defaultModel;
          setModel(provider, catalog.defaultModel);
        }
        note.textContent = `${catalog.models.length} modelos.`;
      } catch (error) {
        if (!cached) render(select, el("option", { text: "No se pudo leer el catálogo", attrs: { value: "" } }));
        note.textContent = error instanceof Error ? error.message : "No se pudo leer el catálogo.";
      } finally {
        select.disabled = false;
        refresh.disabled = false;
      }
    }

    render(modelBlock,
      el("div", { class: "pnl__row" }, [select, refresh]),
      note,
    );
    void load(false);
  }

  /* --- montaje ------------------------------------------------------------- */

  function apply(): void {
    const provider = activeProvider();
    for (const [id, button] of tabs) {
      button.setAttribute("aria-pressed", id === provider ? "true" : "false");
    }

    const key = browserKey(provider);
    if (provider === shown && key === shownKey) return;

    // Cambiar de proveedor abandona una espera de GitHub a medias; guardar la
    // credencial, no: ese repintado es justo el final del flujo.
    if (provider !== shown) waiting?.abort();

    shown = provider;
    shownKey = key;
    hint.textContent = PROVIDERS[provider].hint;

    if (PROVIDERS[provider].auth === "device") buildDeviceForm();
    else buildKeyForm(provider);

    buildModelBlock(provider);
  }

  render(container, el("div", { class: "pnl" }, [
    el("p", { class: "pnl__lead" }, [
      "El asistente ",
      el("em", { text: "pregunta" }),
      ". No redacta el proyecto por ti: te devuelve las decisiones que faltan.",
    ]),
    el("p", { class: "pnl__note", text:
      "Ve la intención que escribiste y el documento que tengas abierto. " +
      "Elige con qué proveedor hablar, guarda su credencial y escoge el modelo." }),
    seg,
    hint,
    credBlock,
    modelBlock,
    el("hr", { class: "pnl__sep" }),
    el("div", { class: "pnl__row" }, [
      el("button", {
        class: "btn",
        text: "Abrir asistente",
        attrs: { type: "button" },
        on: { click: () => { openAssistant(); } },
      }),
    ]),
    status,
  ]));

  apply();
  aiConfig.subscribe(apply);

  // La respuesta de `/api/health` llega después del primer pintado: si el
  // servidor tiene claves, hay que repintar para decirlo.
  serverKeys.subscribe(() => {
    shown = null;
    apply();
  });
  void probeServerKeys();
}
