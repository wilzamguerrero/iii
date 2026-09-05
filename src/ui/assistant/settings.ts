import { el, render } from "../dom.ts";
import {
  activeProvider, addCustomProvider, aiConfig, browserKey, chosenModel, clearKey,
  customPolicy, customProvider, hasCredential, HEADER_NAME, HEADER_VALUE, probeServerKeys,
  providerIds, providerLabel, removeCustomProvider, serverKeys, setKey, setModel, setProvider,
  updateCustomProvider,
} from "../../core/ai/config.ts";
import { cachedCatalog, forgetCatalog, listModels } from "../../core/ai/models.ts";
import { probeChat } from "../../core/ai/chat.ts";
import { startDeviceFlow, waitForDeviceToken, type DeviceStart } from "../../core/ai/device.ts";
import { loadDirectory, type DirectoryEntry } from "../../core/ai/registry.ts";
import {
  builtinInfo, isBuiltin, isCustom, type AiModel, type CustomProvider, type ProviderId,
} from "../../core/ai/types.ts";

/**
 * Los ajustes del asistente: qué proveedor, con qué credencial y con qué modelo.
 *
 * Viven dentro de la ventana del asistente y no en la franja de abajo, porque
 * son de la conversación: elegir el modelo es parte de preguntar, y tener que
 * cerrar el asistente para cambiarlo era pedir un viaje de ida y vuelta a otro
 * sitio de la pantalla para volver al mismo punto.
 *
 * Los tres primeros son los del proyecto de referencia —OpenRouter, NVIDIA y
 * Copilot por cuenta de GitHub— y el de GitHub usa el alta por dispositivo, que
 * es la que no pide registrar nada (plan.md D3). Detrás de ellos, «＋ Otro»
 * añade cualquier API que hable el formato de OpenAI: un nombre, una URL base y
 * su clave. El directorio de ese formulario sale del registro público de
 * models.dev, así que no hay aquí ninguna lista que mantener.
 *
 * La clave se guarda en este navegador. Quien no quiera correr ese riesgo puede
 * dejarla en el entorno del servidor: entonces aquí sólo aparece que ya está
 * configurada, y nunca cuál es. Los proveedores propios no tienen esa segunda
 * vía.
 */

/** Cuántos modelos se enumeran antes de agrupar por editor. */
const MANY = 40;
/** Desde cuántos modelos aparece el filtro de texto. */
const FILTER_FROM = 12;
/** Cuántas cabeceras propias se admiten. El mismo tope que `safeHeaders` en el servidor. */
const MAX_HEADERS = 8;
/** Cuánto se espera a que el proveedor conteste a la prueba de conexión. */
const PROBE_MS = 45_000;

export function mountAiSettings(container: HTMLElement): void {
  const status = el("p", { class: "msg" });
  const hint = el("p", { class: "pnl__note" });
  const credBlock = el("div", { class: "pnl__block" });
  const modelBlock = el("div", { class: "pnl__block" });

  /** Se cancela lo que estuviera esperando al cambiar de proveedor. */
  let waiting: AbortController | null = null;
  /** `add` mientras se está dando de alta un proveedor propio. */
  let mode: "provider" | "add" = "provider";
  /** Si el pliegue de autenticación y cabeceras está abierto. */
  let advanced = false;
  let shown = "";

  function say(message: string, bad = false): void {
    status.className = bad ? "msg msg--bad" : "msg";
    status.textContent = message;
  }

  /* --- elegir proveedor --------------------------------------------------- */

  const seg = el("div", {
    class: "seg",
    attrs: { role: "group", "aria-label": "Proveedor de IA" },
  });

  /** Qué proveedores está mostrando la fila, para no repintarla sin motivo. */
  let segIds = "";

  function buildSeg(): void {
    const ids = providerIds();
    const signature = ids.join(",");
    if (signature === segIds) { markSeg(); return; }
    segIds = signature;

    render(seg, ...ids.map((id) => el("button", {
      class: "seg__btn",
      text: providerLabel(id),
      attrs: { type: "button", "aria-pressed": "false", "data-id": id },
      on: { click: () => { mode = "provider"; setProvider(id); apply(); } },
    })));

    seg.append(el("button", {
      class: "seg__btn",
      text: "＋ Otro",
      attrs: { type: "button", "aria-pressed": "false", "data-id": "+", title: "Añadir un proveedor" },
      on: { click: () => { mode = "add"; apply(); } },
    }));

    markSeg();
  }

  /** Subraya el activo. `＋` cuenta como activo mientras se rellena el alta. */
  function markSeg(): void {
    const active = mode === "add" ? "+" : activeProvider();
    for (const button of seg.querySelectorAll<HTMLButtonElement>(".seg__btn")) {
      const id = button.dataset.id ?? "";
      button.setAttribute("aria-pressed", id === active ? "true" : "false");
    }
  }

  /* --- credencial --------------------------------------------------------- */

  function serverHas(provider: ProviderId): boolean {
    return isBuiltin(provider) && serverKeys.get()?.[provider] === true;
  }

  /** El campo de la clave y sus botones. Vale para los de casa y para los propios. */
  function keyRow(provider: ProviderId): HTMLElement {
    const saved = browserKey(provider);
    const label = providerLabel(provider);

    const input = el("input", {
      class: "search__input",
      attrs: {
        type: "password",
        placeholder: saved ? "Clave guardada en este navegador" : "Pega aquí tu clave",
        autocomplete: "off", spellcheck: false, "aria-label": `Clave de ${label}`,
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

    return row;
  }

  function buildKeyForm(provider: ProviderId): void {
    const info = builtinInfo(provider);
    const lines: HTMLElement[] = [keyRow(provider)];

    if (serverHas(provider)) {
      lines.push(el("p", { class: "pnl__note", text:
        "Este servidor ya tiene una clave configurada, así que puedes dejarlo " +
        "vacío. Si pones la tuya aquí, se usará la tuya." }));
    }
    if (info?.keyUrl) {
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

  /* --- proveedor propio: clave, URL y baja -------------------------------- */

  /* --- autenticación y cabeceras de un proveedor propio -------------------- */

  /**
   * Los sitios donde una API espera la clave. El `Bearer` es lo normal y lo que
   * hablan casi todas las compatibles con OpenAI; las otras dos están porque son
   * las que se encuentran de verdad, y la última deja escribir cualquiera.
   *
   * `OTHER` es `*` a propósito: no es un nombre de cabecera válido, así que no
   * puede confundirse nunca con uno escrito a mano.
   */
  const OTHER = "*";
  const KEY_HEADERS: readonly { value: string; text: string }[] = [
    { value: "", text: "Authorization: Bearer — lo normal" },
    { value: "api-key", text: "api-key — Azure OpenAI" },
    { value: "x-api-key", text: "x-api-key — formato Anthropic" },
    { value: OTHER, text: "otra cabecera…" },
  ];

  function printHeaders(entry: CustomProvider): string {
    return Object.entries(entry.headers ?? {})
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
  }

  /** Las cabeceras escritas, o la primera línea que no vale y por qué. */
  function parseHeaders(text: string): Record<string, string> | string {
    const out: Record<string, string> = {};

    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;

      const cut = line.indexOf(":");
      if (cut < 1) return `«${line.slice(0, 30)}» no tiene la forma «Nombre: valor».`;
      const name = line.slice(0, cut).trim();
      const value = line.slice(cut + 1).trim();

      if (!HEADER_NAME.test(name)) return `«${name.slice(0, 30)}» no es un nombre de cabecera.`;
      if (!value) return `Falta el valor de «${name}».`;
      if (!HEADER_VALUE.test(value)) {
        return `El valor de «${name}» lleva caracteres que no caben en una cabecera.`;
      }
      out[name] = value;
    }

    if (Object.keys(out).length > MAX_HEADERS) return `Como máximo ${MAX_HEADERS} cabeceras.`;
    return out;
  }

  /**
   * Cómo pide la clave esa API y qué cabeceras más quiere.
   *
   * Va detrás de un pliegue porque casi nadie lo necesita: con nombre, URL y clave
   * se añade el 90 % de las APIs. El 10 % restante —Azure, el formato de
   * Anthropic, una pasarela que enruta por una cabecera propia— era, hasta ahora,
   * imposible de añadir. Es lo que `reference/kilocode-main` resuelve con un
   * `options.headers` libre en su proveedor propio.
   *
   * El pliegue empieza abierto si ya hay algo puesto: si no, lo que se configuró
   * una vez quedaría escondido.
   */
  /**
   * Qué formato habla esa API. Está fuera del pliegue de autenticación porque no es
   * un detalle de la clave: cambia la ruta a la que se pregunta y la forma del
   * cuerpo. Se descubrió haciendo falta con una pasarela que devuelve 403 desde
   * Cloudflare en `/chat/completions` y contesta 200 en `/messages`.
   */
  function buildFormat(entry: CustomProvider): HTMLElement {
    const choice = el("select", {
      class: "sel",
      attrs: { "aria-label": "Formato de la API" },
      on: {
        change: () => {
          const value = choice.value === "anthropic" ? "anthropic" : "openai";
          updateCustomProvider(entry.id, { format: value });
          // La lista de modelos se pide por otra cabecera de clave según el
          // formato, así que la guardada puede no valer.
          forgetCatalog(entry.id);
          say(value === "anthropic"
            ? "Formato Anthropic: se preguntará a /messages."
            : "Formato OpenAI: se preguntará a /chat/completions.");
        },
      },
    }, [
      el("option", { text: "Formato OpenAI · /chat/completions", attrs: { value: "openai" } }),
      el("option", { text: "Formato Anthropic · /messages", attrs: { value: "anthropic" } }),
    ]);
    choice.value = entry.format === "anthropic" ? "anthropic" : "openai";

    return el("div", { class: "pnl__block" }, [
      el("div", { class: "pnl__row" }, [choice]),
      el("p", { class: "pnl__note" }, [
        "El de OpenAI es el normal. Elige el de Anthropic si esa API sólo sirve ",
        el("code", { text: "/v1/messages" }),
        ": el servidor traduce la conversación en los dos sentidos y la clave viaja en ",
        el("code", { text: "x-api-key" }), " sin tocar nada más.",
      ]),
    ]);
  }

  function buildAdvanced(entry: CustomProvider): HTMLElement {
    if (entry.keyHeader || Object.keys(entry.headers ?? {}).length > 0) advanced = true;

    const holder = el("div", { class: "pnl__block" });
    const toggle = el("button", {
      class: "btn btn--quiet",
      attrs: { type: "button", "aria-expanded": "false" },
      on: { click: () => { advanced = !advanced; paint(); } },
    });

    function paint(): void {
      toggle.textContent = (advanced ? "− " : "＋ ") + "Autenticación y cabeceras";
      toggle.setAttribute("aria-expanded", advanced ? "true" : "false");
      // `pnl__block` es `display: flex`, que gana a `[hidden]`: el pliegue se
      // cierra vaciando el contenedor, no ocultándolo.
      if (advanced) render(holder, ...inside());
      else render(holder);
    }

    function inside(): HTMLElement[] {
      const known = KEY_HEADERS.some((option) => option.value === entry.keyHeader);
      const current = entry.keyHeader ? (known ? entry.keyHeader : OTHER) : "";

      const named = el("input", {
        class: "search__input",
        attrs: {
          type: "text", value: known ? "" : entry.keyHeader ?? "", placeholder: "x-mi-clave",
          autocomplete: "off", spellcheck: false, "aria-label": "Nombre de la cabecera de la clave",
        },
      });
      const namedHolder = el("div");
      const namedRow = el("div", { class: "pnl__row" }, [
        el("div", { class: "search" }, [named]),
        el("button", {
          class: "btn btn--quiet", text: "Guardar", attrs: { type: "button" },
          on: { click: () => { saveKeyHeader(named.value.trim()); } },
        }),
      ]);

      const choice = el("select", {
        class: "sel",
        attrs: { "aria-label": "Dónde va la clave" },
        on: {
          change: () => {
            if (choice.value === OTHER) render(namedHolder, namedRow);
            else { render(namedHolder); saveKeyHeader(choice.value); }
          },
        },
      }, KEY_HEADERS.map((option) => el("option", {
        text: option.text, attrs: { value: option.value },
      })));
      choice.value = current;

      if (current === OTHER) render(namedHolder, namedRow);

      const text = el("textarea", {
        class: "tarea",
        text: printHeaders(entry),
        attrs: {
          rows: 3, spellcheck: false, placeholder: "x-proyecto: 3i",
          "aria-label": "Cabeceras extra",
        },
      });

      return [
        el("p", { class: "pnl__note" }, [
          "Sólo hace falta si esa API no usa el ", el("code", { text: "Bearer" }),
          " de siempre o pide alguna cabecera suya.",
        ]),
        el("div", { class: "pnl__row" }, [choice]),
        namedHolder,
        el("p", { class: "pnl__note" }, [
          "Cabeceras extra, una por línea, como ", el("code", { text: "Nombre: valor" }), ".",
        ]),
        text,
        el("div", { class: "pnl__row" }, [
          el("button", {
            class: "btn btn--quiet", text: "Guardar cabeceras", attrs: { type: "button" },
            on: { click: () => { saveHeaders(text.value); } },
          }),
        ]),
      ];
    }

    function saveKeyHeader(name: string): void {
      if (name && !HEADER_NAME.test(name)) {
        say(`«${name.slice(0, 30)}» no es un nombre de cabecera.`, true);
        return;
      }
      updateCustomProvider(entry.id, { keyHeader: name });
      // El catálogo guardado se leyó con la autenticación anterior.
      forgetCatalog(entry.id);
      say(name ? `La clave irá en «${name}».` : "La clave irá en Authorization: Bearer.");
    }

    function saveHeaders(raw: string): void {
      const parsed = parseHeaders(raw);
      if (typeof parsed === "string") { say(parsed, true); return; }
      updateCustomProvider(entry.id, { headers: parsed });
      forgetCatalog(entry.id);
      const count = Object.keys(parsed).length;
      say(count === 0
        ? "Sin cabeceras extra."
        : `${count} ${count === 1 ? "cabecera" : "cabeceras"} guardadas.`);
    }

    paint();
    return el("div", { class: "pnl__block" }, [
      el("div", { class: "pnl__row" }, [toggle]),
      holder,
    ]);
  }

  /** Falso si el proveedor ya no existe: otra ventana pudo haberlo quitado. */
  function buildCustomForm(provider: ProviderId): boolean {
    const entry = customProvider(provider);
    if (!entry) { mode = "provider"; setProvider("openrouter"); return false; }

    const url = el("input", {
      class: "search__input",
      attrs: {
        type: "url", value: entry.baseUrl, placeholder: "https://…/v1",
        autocomplete: "off", spellcheck: false, "aria-label": "URL base",
      },
    });

    const saveUrl = el("button", {
      class: "btn btn--quiet",
      text: "Guardar URL",
      attrs: { type: "button" },
      on: {
        click: () => {
          const value = cleanBase(url.value);
          if (!value) { say("Escribe una URL válida, con https://", true); return; }
          url.value = value;
          updateCustomProvider(entry.id, { baseUrl: value });
          // El catálogo guardado era el de la URL anterior.
          forgetCatalog(entry.id);
          say("URL guardada.");
        },
      },
    });

    render(credBlock,
      keyRow(provider),
      el("p", { class: "pnl__note", text:
        "Si tu servidor no pide clave —Ollama, LM Studio— déjala vacía." }),
      el("div", { class: "pnl__row" }, [
        el("div", { class: "search" }, [url]),
        saveUrl,
      ]),
      buildFormat(entry),
      buildAdvanced(entry),
      el("div", { class: "pnl__row" }, [
        el("button", {
          class: "btn btn--quiet",
          text: "Quitar este proveedor",
          attrs: { type: "button" },
          on: {
            click: () => {
              removeCustomProvider(entry.id);
              forgetCatalog(entry.id);
              mode = "provider";
              say(`«${entry.label}» quitado, con su clave.`);
            },
          },
        }),
      ]),
    );

    return true;
  }

  /* --- añadir un proveedor ------------------------------------------------- */

  function shortUrl(url: string): string {
    return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  /**
   * Lo que se guarda: sin barra final y sin el `/chat/completions` que suele
   * venir pegado en la documentación de cada API. `null` si no es una dirección.
   */
  function cleanBase(raw: string): string | null {
    const text = raw.trim()
      .replace(/\/+$/, "")
      .replace(/\/chat\/completions$/i, "")
      .replace(/\/+$/, "");
    try {
      return new URL(text).toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  function buildAddForm(): void {
    let directory: readonly DirectoryEntry[] = [];
    let chosen: DirectoryEntry | null = null;
    /** Cierto en cuanto la persona escribe la URL a mano: no se le sobreescribe. */
    let typedUrl = false;

    const list = el("datalist", { attrs: { id: "ai-directory" } });

    const name = el("input", {
      class: "search__input",
      attrs: {
        type: "text", list: "ai-directory", placeholder: "Nombre: DeepSeek, mi servidor…",
        autocomplete: "off", spellcheck: false, "aria-label": "Nombre del proveedor",
      },
    });

    const url = el("input", {
      class: "search__input",
      attrs: {
        type: "url", placeholder: "https://api.deepseek.com/v1",
        autocomplete: "off", spellcheck: false, "aria-label": "URL base de la API",
      },
      on: { input: () => { typedUrl = true; } },
    });

    const key = el("input", {
      class: "search__input",
      attrs: {
        type: "password", placeholder: "Clave (si la pide)",
        autocomplete: "off", spellcheck: false, "aria-label": "Clave del proveedor",
      },
    });

    const found = el("p", { class: "pnl__note" });

    /** Al escribir un nombre del directorio, la URL se rellena sola. */
    function matchDirectory(): void {
      const wanted = name.value.trim().toLowerCase();
      chosen = directory.find((entry) =>
        entry.name.toLowerCase() === wanted || entry.id === wanted) ?? null;

      if (!chosen) { render(found); return; }
      if (chosen.api && !typedUrl) url.value = chosen.api;

      const parts: (string | HTMLElement)[] = chosen.api
        ? [`${chosen.name}: ${chosen.models} modelos en el registro.`]
        : [`${chosen.name}: el registro no trae su URL, escríbela tú.`];
      if (chosen.doc) {
        parts.push(" ", el("a", {
          class: "lnk", text: "Documentación",
          attrs: { href: chosen.doc, target: "_blank", rel: "noopener noreferrer" },
        }));
      }
      render(found, ...parts);
    }

    name.addEventListener("input", matchDirectory);
    name.addEventListener("change", matchDirectory);

    const add = el("button", {
      class: "btn",
      text: "Añadir",
      attrs: { type: "button" },
      on: { click: () => { submit(); } },
    });

    function submit(): void {
      // El botón ya está apagado, pero Enter no pasa por él.
      if (customPolicy.get() === "off") {
        say("Este servidor no admite proveedores propios.", true);
        return;
      }

      const label = name.value.trim();
      const base = url.value.trim();
      if (!label) { say("Ponle un nombre.", true); return; }
      if (!base) { say("Falta la URL base de la API.", true); return; }

      // Se normaliza aquí para que la cabecera `X-Ai-Base` sea siempre ASCII y
      // para que un dominio con acentos no rompa la petición.
      const normal = cleanBase(base);
      if (!normal) {
        say("Esa URL no se entiende. Tiene que empezar por https://", true);
        return;
      }

      const registry = chosen?.id;
      // El alta deja el proveedor activo, lo que repinta este panel: hay que
      // salir del modo «añadir» antes de guardar.
      mode = "provider";
      const id = addCustomProvider({ label, baseUrl: normal, ...(registry ? { registry } : {}) });
      const secret = key.value.trim();
      if (secret) setKey(id, secret);
      say(`«${label}» añadido.`);
    }

    for (const field of [name, url, key]) {
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        // Con el nombre puesto y la URL vacía, Enter lleva a la URL en vez de
        // dar un error que la persona ya sabe.
        if (field === name && !url.value.trim()) { url.focus(); return; }
        submit();
      });
    }

    const policyNote = el("p", { class: "pnl__note" });

    function showPolicy(): void {
      const policy = customPolicy.get();
      if (policy === "off") {
        add.disabled = true;
        policyNote.className = "msg msg--bad";
        policyNote.textContent =
          "Este servidor no admite proveedores propios. Se habilitan con " +
          "AI_CUSTOM_PROVIDERS=public en su entorno.";
        return;
      }
      add.disabled = false;
      policyNote.className = "pnl__note";
      policyNote.textContent = policy === "local"
        ? "En local también valen direcciones de tu máquina: http://localhost:11434/v1 para Ollama."
        : "Tiene que ser https y una dirección pública: el servidor no llama a redes privadas.";
    }

    showPolicy();

    render(credBlock,
      el("p", { class: "pnl__lead", text: "Añade una API que hable el formato de OpenAI." }),
      el("div", { class: "pnl__row" }, [el("div", { class: "search" }, [name]), list]),
      found,
      el("div", { class: "pnl__row" }, [el("div", { class: "search" }, [url])]),
      el("div", { class: "pnl__row" }, [el("div", { class: "search" }, [key])]),
      policyNote,
      el("div", { class: "pnl__row" }, [
        add,
        el("button", {
          class: "btn btn--quiet",
          text: "Cancelar",
          attrs: { type: "button" },
          on: { click: () => { mode = "provider"; apply(); } },
        }),
      ]),
    );

    render(modelBlock);
    say("");

    // El directorio llega después; el formulario ya se puede usar sin él.
    void loadDirectory().then((dir) => {
      if (mode !== "add") return;
      directory = dir.providers;
      customPolicy.set(dir.policy);
      showPolicy();
      render(list, ...dir.providers.map((entry) => el("option", {
        attrs: {
          value: entry.name,
          label: entry.api ? shortUrl(entry.api) : "escribe tú la URL",
        },
      })));
      matchDirectory();
    }).catch(() => {
      // Sin registro no hay sugerencias, pero el alta a mano sigue funcionando.
      render(found, "El directorio de models.dev no responde; escribe el nombre y la URL a mano.");
    });
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
      // Guardarlo dispara `aiConfig`, que repinta este panel ya conectado.
      setKey("github", token);
      say("Cuenta de GitHub conectada.");
    } catch (error) {
      if (controller.signal.aborted) return;
      buildDeviceForm();
      say(error instanceof Error ? error.message : "No se pudo conectar con GitHub.", true);
    }
  }

  /* --- modelo -------------------------------------------------------------- */

  /**
   * Lo que se sabe del modelo, en tres palabras. Sale del propio proveedor o del
   * registro de models.dev, nunca de una lista escrita a mano: «gratis» sólo
   * aparece cuando el proveedor publica precios y ése vale cero.
   */
  function tagOf(model: AiModel): string {
    const bits: string[] = [];
    if (model.free) bits.push("gratis");
    if (model.ctx && model.ctx > 0) bits.push(`${Math.round(model.ctx / 1000)}k`);
    if (model.reasoning) bits.push("razona");
    return bits.join(" · ");
  }

  function option(model: AiModel, withPublisher: boolean): HTMLOptionElement {
    const head = withPublisher && model.publisher ? `${model.publisher} · ` : "";
    const tag = tagOf(model);
    return el("option", {
      text: head + model.name + (tag ? ` — ${tag}` : ""),
      attrs: { value: model.id },
    });
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
        select.append(el("optgroup", { attrs: { label: publisher } },
          list.map((model) => option(model, false))));
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

  function matches(model: AiModel, needle: string): boolean {
    if (!needle) return true;
    return `${model.id} ${model.name} ${model.publisher}`.toLowerCase().includes(needle);
  }

  function buildModelBlock(provider: ProviderId): void {
    /** El catálogo entero; el desplegable puede estar mostrando un filtro. */
    let all: readonly AiModel[] = [];
    /** De dónde salió la lista, para decirlo debajo. */
    let origin = "";

    const select = el("select", {
      class: "sel",
      attrs: { "aria-label": "Modelo" },
      on: { change: () => { if (select.value) setModel(provider, select.value); } },
    });

    const note = el("p", { class: "pnl__note" });

    const filter = el("input", {
      class: "search__input",
      attrs: {
        type: "search", placeholder: "Filtrar modelos", autocomplete: "off",
        spellcheck: false, "aria-label": "Filtrar modelos",
      },
      on: { input: () => { show(); } },
    });

    // El filtro se pone y se quita metiendo la fila o vaciándola: `pnl__row` es
    // `display: flex`, que gana a `[hidden]`.
    const filterHolder = el("div");

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


    /**
     * El identificador escrito a mano.
     *
     * El desplegable sale de lo que el proveedor publique en `/models`, y hay
     * pasarelas que no publican nada o publican una lista que no sirve. Hasta
     * ahora eso dejaba el proveedor inservible aunque funcionara: sin modelo no se
     * puede preguntar. `reference/kilocode-main` lo tiene al revés —los modelos los
     * escribe la persona y el descubrimiento es sólo una ayuda—, y esa es la parte
     * que faltaba aquí. Lo que se manda es esto; el desplegable es la comodidad.
     */
    const manual = el("input", {
      class: "search__input",
      attrs: {
        type: "text", placeholder: "o escríbelo: deepseek-chat",
        autocomplete: "off", spellcheck: false, "aria-label": "Identificador del modelo",
      },
      on: {
        keydown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          use();
        },
      },
    });

    function use(): void {
      const id = manual.value.trim();
      if (!id) { say("Escribe el identificador del modelo.", true); return; }
      setModel(provider, id);
      manual.value = "";
      // El repintado no llega —el modelo no está en la firma—, así que el
      // desplegable se refresca aquí: `fill` pone delante el modelo elegido.
      show();
      say(`Modelo «${id}» elegido.`);
    }

    const probe = el("button", {
      class: "btn btn--quiet",
      text: "Probar conexión",
      attrs: { type: "button" },
      on: {
        click: () => {
          void test();
        },
      },
    });

    /**
     * Una pregunta mínima de verdad. Comprueba lo que el catálogo no comprueba: un
     * `GET /models` que funciona no dice nada de que el `POST` del chat funcione
     * —pasó con una pasarela detrás de Cloudflare, que contestaba 403 sólo al
     * segundo—, y ese fallo aparecía al preguntar lo primero, no al configurar.
     */
    async function test(): Promise<void> {
      const model = chosenModel(provider) || select.value;
      if (!model) { say("Elige o escribe un modelo primero.", true); return; }

      probe.disabled = true;
      say(`Probando ${model}…`);
      try {
        const reply = await probeChat({ provider, model, signal: AbortSignal.timeout(PROBE_MS) });
        say(reply ? `Contesta. Dijo: «${reply}»` : "Contesta, pero con un mensaje vacío.");
      } catch (error) {
        say(error instanceof DOMException && error.name === "TimeoutError"
          ? "No contestó a tiempo."
          : error instanceof Error ? error.message : "No se pudo probar.", true);
      } finally {
        probe.disabled = false;
      }
    }

    function show(): void {
      const needle = filter.value.trim().toLowerCase();
      const visible = all.filter((model) => matches(model, needle));

      const chosen = chosenModel(provider);
      if (visible.length === 0 && all.length === 0 && chosen) {
        render(select, el("option", { text: `${chosen} (escrito)`, attrs: { value: chosen } }));
      } else if (visible.length === 0) {
        render(select, el("option", { text: "Nada coincide", attrs: { value: "" } }));
      } else {
        fill(select, provider, visible);
      }

      // Sin catálogo, el aviso que ya hay puesto explica más que «0 modelos».
      if (all.length === 0) return;

      note.textContent = needle
        ? `${visible.length} de ${all.length} modelos.`
        : `${all.length} modelos.` + origin;
    }

    function ready(models: readonly AiModel[], extra: string): void {
      all = models;
      origin = extra;
      render(filterHolder, ...(models.length >= FILTER_FROM
        ? [el("div", { class: "pnl__row" }, [el("div", { class: "search" }, [filter])])]
        : []));
      show();
    }

    async function load(forced: boolean): Promise<void> {
      const cached = forced ? null : cachedCatalog(provider);
      if (cached && cached.models.length > 0) {
        ready(cached.models, "");
      } else {
        render(select, el("option", { text: "Cargando…", attrs: { value: "" } }));
        note.textContent = "";
      }

      // Sin credencial no hay catálogo, salvo donde la lista es pública.
      const info = builtinInfo(provider);
      if (!info?.publicCatalog && !hasCredential(provider)) {
        render(select, el("option", {
          text: info?.auth === "device" ? "Conecta la cuenta primero" : "Guarda la clave primero",
          attrs: { value: "" },
        }));
        render(filterHolder);
        note.textContent = "";
        return;
      }

      select.disabled = true;
      refresh.disabled = true;
      try {
        const catalog = await listModels(provider, { force: forced });
        if (catalog.models.length === 0) {
          render(select, el("option", { text: "Sin modelos", attrs: { value: "" } }));
          render(filterHolder);
          note.textContent = catalog.notice ?? "El proveedor no devolvió ningún modelo.";
          return;
        }

        // `registry` significa que la lista no la dio el proveedor: puede tener
        // modelos que esta cuenta no tenga contratados. Se dice.
        const extra = catalog.source === "registry"
          ? " Lista tomada del registro público de models.dev, no del proveedor: " +
            "puede incluir modelos que tu cuenta no tenga."
          : "";
        ready(catalog.models, extra + (catalog.notice ? ` ${catalog.notice}` : ""));

        if (!chosenModel(provider) && catalog.defaultModel) {
          select.value = catalog.defaultModel;
          setModel(provider, catalog.defaultModel);
        }
      } catch (error) {
        if (!cached) {
          render(select, el("option", { text: "No se pudo leer el catálogo", attrs: { value: "" } }));
        }
        note.textContent = error instanceof Error ? error.message : "No se pudo leer el catálogo.";
      } finally {
        select.disabled = false;
        refresh.disabled = false;
      }
    }

    render(modelBlock,
      el("div", { class: "pnl__row" }, [select, refresh]),
      filterHolder,
      note,
      ...(isCustom(provider)
        ? [
          el("div", { class: "pnl__row" }, [
            el("div", { class: "search" }, [manual]),
            el("button", {
              class: "btn btn--quiet", text: "Usar", attrs: { type: "button" },
              on: { click: () => { use(); } },
            }),
            probe,
          ]),
          el("p", { class: "pnl__note", text:
            "Si tu API no publica su lista, o publica una que no sirve, escribe el " +
            "identificador tal como lo pida su documentación: es lo que se manda." }),
        ]
        : []),
    );
    void load(false);
  }

  /* --- montaje ------------------------------------------------------------- */

  /** El proveedor del último pintado, para saber si hay que abortar la espera. */
  let shownProvider = "";

  function apply(): void {
    buildSeg();

    const provider = activeProvider();
    const entry = isCustom(provider) ? customProvider(provider) : null;

    // Lo que cambia el pintado: el modo, el proveedor, si hay clave, su URL y cómo
    // se autentica. Sin esta firma, guardar la clave repintaría el catálogo entero.
    // El modelo elegido no está a propósito: escribirlo a mano no debe repintar.
    const signature = [
      mode, provider, browserKey(provider) ?? "", entry?.baseUrl ?? "",
      entry?.keyHeader ?? "", JSON.stringify(entry?.headers ?? {}), entry?.format ?? "",
    ].join("|");
    if (signature === shown) { markSeg(); return; }

    // Cambiar de proveedor abandona una espera de GitHub a medias; guardar la
    // credencial, no: ese repintado es justo el final del flujo.
    if (provider !== shownProvider) {
      waiting?.abort();
      advanced = false;
    }

    shown = signature;
    shownProvider = provider;
    markSeg();

    if (mode === "add") {
      hint.textContent = "Un nombre, la URL base de la API y, si la pide, su clave.";
      buildAddForm();
      return;
    }

    const info = builtinInfo(provider);
    hint.textContent = info
      ? info.hint
      : `API con el formato de OpenAI en ${entry ? shortUrl(entry.baseUrl) : "…"}.`;

    if (info?.auth === "device") buildDeviceForm();
    else if (info) buildKeyForm(provider);
    // Al no existir, `buildCustomForm` ya ha cambiado de proveedor y este
    // pintado sobra: seguir dejaría el catálogo del que se acaba de quitar.
    else if (!buildCustomForm(provider)) return;

    buildModelBlock(provider);
  }

  render(container, el("div", { class: "pnl" }, [
    el("p", { class: "pnl__note", text:
      "Con quién habla el asistente. Elige el proveedor, guarda su credencial y " +
      "escoge el modelo; se recuerda uno por proveedor." }),
    seg,
    hint,
    credBlock,
    modelBlock,
    status,
  ]));

  apply();
  aiConfig.subscribe(apply);

  // La respuesta de `/api/health` llega después del primer pintado: si el
  // servidor tiene claves, hay que repintar para decirlo.
  serverKeys.subscribe(() => {
    shown = "";
    apply();
  });
  void probeServerKeys();
}
