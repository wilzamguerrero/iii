import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { origamiSvg } from "../origami.ts";
import { closeSession, session } from "../../core/persist/session.ts";
import { beginNotion, chooseRoot } from "./workspace.ts";
import { mountAiSettings } from "../assistant/settings.ts";
import { setTheme, theme, type ThemeChoice } from "../../core/state/theme.ts";

/**
 * La bandeja: el extremo derecho de la franja.
 *
 * Tres cosas que no son el espacio de trabajo pero se gobiernan desde el mismo
 * borde: de quién es este Notion, con qué modelo habla el asistente y cómo se ve
 * la plataforma. Van aquí porque son de la aplicación entera y no de la carpeta
 * que se esté mirando, y porque este borde es lo único que queda a la vista
 * cuando la franja está plegada: se llega a los ajustes sin abrirla.
 *
 * Las ventanitas cuelgan del `<body>` y no de la franja. La franja recorta lo que
 * se sale de ella —es lo que le da las esquinas redondeadas— y estas ventanitas
 * tienen que crecer hacia arriba, por encima de ella. Es la misma razón por la
 * que el menú de una baldosa vive fuera (`menu.ts`).
 *
 * Son el mismo objeto que la ventana del asistente: un panel suelto sobre la
 * página, con su borde de 1 px y su sombra. Se declara una vez en los tokens
 * (`--r-panel`, `--shadow`) y aquí sólo se usa.
 */

/** Se ancla por abajo y por la derecha: crece hacia arriba y hacia dentro. */
const GAP = 10;

export interface TrayOptions {
  /** Abrir la franja. Alguna acción de aquí termina dentro de ella. */
  openDock: () => void;
}

export interface Tray {
  root: HTMLElement;
  /** Cierra lo que esté abierto. La franja la llama al plegarse. */
  close: () => void;
}

interface Pop {
  root: HTMLElement;
  body: HTMLElement;
  button: HTMLButtonElement;
  /** Se llama justo antes de mostrarla, para que traiga el estado de ahora. */
  fill?: () => void;
}

/**
 * Abrir los ajustes de IA desde fuera de la bandeja.
 *
 * La ventana del asistente ya no los lleva dentro —se pidió quitar ese botón de su
 * cabecera, porque estaban en dos sitios— pero su pie sí tiene que poder llevar
 * hasta aquí cuando falta la credencial. La bandeja se monta una vez, así que basta
 * con guardar cómo se abre la suya.
 */
let openAi: (() => void) | null = null;

export function openAiSettings(): void {
  openAi?.();
}

export function mountTray(options: TrayOptions): Tray {
  const root = el("div", { class: "tray" });
  const pops: Pop[] = [];
  let open: Pop | null = null;

  /* --- una ventanita ------------------------------------------------------- */

  function make(id: string, title: string, glyph: Node, wide = false): Pop {
    const button = el("button", {
      class: "tray__btn",
      attrs: {
        type: "button", title, "aria-label": title,
        "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": id,
      },
    }, [glyph]);

    const body = el("div", { class: "tray-pop__body" });
    const popRoot = el("div", {
      class: `tray-pop${wide ? " tray-pop--wide" : ""}`,
      attrs: { id, role: "dialog", "aria-label": title, hidden: true },
    }, [
      el("div", { class: "tray-pop__head" }, [
        el("span", { class: "tray-pop__title", text: title }),
        el("button", {
          class: "tray-pop__x",
          attrs: { type: "button", "aria-label": "Cerrar" },
          on: { click: () => { close(); } },
        }, [icon("cross", "ico ico--small")]),
      ]),
      body,
    ]);

    const pop: Pop = { root: popRoot, body, button };
    button.addEventListener("click", () => { toggle(pop); });

    root.append(button);
    document.body.append(popRoot);
    pops.push(pop);
    return pop;
  }

  function toggle(pop: Pop): void {
    if (open === pop) { close(); return; }
    close();
    open = pop;
    pop.fill?.();
    pop.root.hidden = false;
    pop.button.setAttribute("aria-expanded", "true");
    place(pop);
    listen(true);
    // El foco al primer control de dentro, que es lo que se venía a usar; si no
    // hay ninguno, a la propia ventanita para que Escape la cierre.
    const first = pop.body.querySelector<HTMLElement>(
      "button, [href], input, select, textarea",
    );
    first?.focus();
  }

  function close(): void {
    if (!open) return;
    const pop = open;
    open = null;
    pop.root.hidden = true;
    pop.button.setAttribute("aria-expanded", "false");
    listen(false);
  }

  /**
   * Anclada por abajo y por la derecha, no por arriba: crece hacia arriba y su
   * alto cambia con lo que tenga dentro —los ajustes de IA cambian de forma al
   * elegir proveedor—, así que si se fijara el borde de arriba se movería sola.
   */
  function place(pop: Pop): void {
    const box = pop.button.getBoundingClientRect();
    pop.root.style.bottom = `${Math.round(window.innerHeight - box.top + GAP)}px`;

    const wanted = window.innerWidth - box.right;
    const room = window.innerWidth - pop.root.offsetWidth - GAP;
    pop.root.style.right = `${Math.round(Math.max(GAP, Math.min(wanted, room)))}px`;
  }

  function onDown(event: Event): void {
    const target = event.target;
    if (!open || !(target instanceof Node)) return;
    if (open.root.contains(target) || open.button.contains(target)) return;
    // Un menú abierto desde dentro de la ventanita vive fuera de ella.
    if (target instanceof Element && target.closest(".menu-pop")) return;
    close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !open) return;
    const target = event.target;
    // En un campo, Escape es del campo.
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    // En captura y con parada: si llegara al documento cerraría también la
    // franja, y lo que se quería cerrar era esto.
    event.stopPropagation();
    close();
  }

  function onResize(): void {
    if (open) place(open);
  }

  function listen(on: boolean): void {
    if (on) {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", onResize);
      return;
    }
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
  }

  /* --- de quién es este Notion --------------------------------------------- */

  const face = el("span", { class: "tray__face" });
  const notion = make("tray-notion", "Cuenta de Notion", face);

  /** El icono del espacio si lo hay; si no, la silueta. */
  function paintFace(): void {
    const now = session.get();
    const url = now?.workspaceIcon ?? "";
    // Un icono de espacio puede ser un emoji, y entonces no es una URL.
    if (/^https?:\/\//.test(url)) {
      render(face, el("img", {
        class: "tray__pic",
        attrs: { src: url, alt: "", width: "18", height: "18", referrerpolicy: "no-referrer" },
      }));
    } else if (now && url) {
      render(face, el("span", { class: "tray__emoji", text: url }));
    } else {
      render(face, icon("person"));
    }

    const label = now
      ? `Notion · ${now.workspaceName ?? "conectado"}`
      : "Conectar con Notion";
    notion.button.title = label;
    notion.button.setAttribute("aria-label", label);
    notion.button.classList.toggle("is-off", !now);
  }

  function notionRows(): HTMLElement[] {
    const now = session.get();
    if (!now) return offerNotion();

    const where = now.rootPageTitle
      ? `Los proyectos van bajo «${now.rootPageTitle}».`
      : "Todavía sin página raíz: elige una para poder crear proyectos.";

    return [
      el("p", { class: "pnl__lead", text: now.workspaceName ?? "Espacio de Notion" }),
      el("p", { class: "pnl__note", text: where }),
      el("div", { class: "pnl__row" }, [
        el("button", {
          class: "btn btn--quiet",
          text: "Cambiar raíz",
          attrs: { type: "button" },
          // Elegir raíz se hace dentro de la franja, no aquí: hay que ver la
          // lista de páginas. Esta ventanita sólo lleva hasta ahí.
          on: { click: () => { close(); chooseRoot(true); options.openDock(); } },
        }),
        el("button", {
          class: "btn btn--quiet",
          text: "Desconectar",
          attrs: { type: "button" },
          on: { click: () => { closeSession(); } },
        }),
      ]),
      el("p", {
        class: "pnl__note",
        text: "Desconectar sólo olvida la sesión de este navegador; lo escrito se queda en Notion.",
      }),
    ];
  }

  /** Sin sesión: la misma invitación que la franja, en pequeño. */
  function offerNotion(): HTMLElement[] {
    const say = el("p", { class: "msg", attrs: { role: "status" } });
    const go = el("button", {
      class: "btn",
      text: "Conectar con Notion",
      attrs: { type: "button" },
    });

    go.addEventListener("click", () => {
      void (async () => {
        go.disabled = true;
        say.className = "msg";
        say.textContent = "Abriendo la autorización de Notion…";
        const failed = await beginNotion();
        // `null` es que la página ya se está yendo a Notion; no hay nada que decir.
        if (!failed) return;
        go.disabled = false;
        say.className = "msg msg--bad";
        say.textContent = failed;
      })();
    });

    return [
      el("p", { class: "pnl__lead", text: "Sin conectar" }),
      el("p", {
        class: "pnl__note",
        text: "Los proyectos viven en tu Notion y la plataforma no guarda copia. " +
          "Conecta para verlos aquí.",
      }),
      el("div", { class: "pnl__row" }, [go]),
      say,
    ];
  }

  notion.fill = () => { render(notion.body, ...notionRows()); };
  paintFace();
  session.subscribe(() => {
    paintFace();
    // Si está abierta cuando cambia la sesión —desconectar se pulsa ahí dentro—,
    // se rehace en el sitio en vez de quedarse contando algo que ya no es.
    if (open === notion) notion.fill?.();
  });

  /* --- con qué modelo habla el asistente ----------------------------------- */

  const ai = make("tray-ai", "Ajustes de IA", origamiSvg("tray__ori"), true);
  let aiMounted = false;

  /**
   * Una sola vez, no en cada apertura: `mountAiSettings` se suscribe a `aiConfig`,
   * así que remontarlo dejaría una suscripción viva por cada vez que se abre. Y
   * como se suscribe, esta copia y la de la ventana del asistente van a la par:
   * lo que se cambie aquí ya está cambiado allí.
   */
  ai.fill = () => {
    if (aiMounted) return;
    aiMounted = true;
    mountAiSettings(ai.body);
  };

  openAi = () => { if (open !== ai) toggle(ai); };

  /* --- cómo se ve la plataforma -------------------------------------------- */

  const sys = make("tray-system", "Ajustes del sistema", icon("tune"));

  const CHOICES: readonly { id: ThemeChoice; label: string }[] = [
    { id: "light", label: "Claro" },
    { id: "dark", label: "Oscuro" },
    { id: "auto", label: "Automático" },
  ];

  const seg = el(
    "div",
    { class: "seg", attrs: { role: "group", "aria-label": "Tema" } },
    CHOICES.map(({ id, label }) => el("button", {
      class: "seg__btn",
      text: label,
      attrs: { type: "button", "aria-pressed": "false", "data-id": id },
      on: { click: () => { setTheme(id); } },
    })),
  );

  function markSeg(): void {
    const now = theme.get();
    for (const button of seg.querySelectorAll<HTMLButtonElement>(".seg__btn")) {
      button.setAttribute("aria-pressed", button.dataset.id === now ? "true" : "false");
    }
  }

  markSeg();
  theme.subscribe(markSeg);

  // Se arma una vez: no depende de nada que cambie por debajo, y el subrayado lo
  // lleva `markSeg` desde el propio `theme`.
  render(sys.body,
    el("p", { class: "pnl__lead", text: "Tema" }),
    seg,
    el("p", {
      class: "pnl__note",
      text: "«Automático» sigue al del sistema y cambia con él sin recargar.",
    }),
    el("p", {
      class: "pnl__note pnl__note--sep",
      text: "Aquí irán los ajustes de la plataforma a medida que existan.",
    }),
  );

  return { root, close };
}
