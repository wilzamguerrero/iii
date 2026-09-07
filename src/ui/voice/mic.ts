import { el } from "../dom.ts";
import { icon, setIcon } from "../icons.ts";
import { available, dictation, type Dictation } from "../../core/voice/dictate.ts";

/**
 * El botón de dictar, junto al campo en el que va a caer el texto.
 *
 * Es el mismo objeto en los tres sitios donde se escribe —la intención de la
 * entrada, la pregunta al asistente y el documento— porque es el mismo gesto. Si
 * el navegador no sabe dictar no se pinta: un botón que al pulsarlo explica que
 * no puede es peor que no tenerlo.
 *
 * Lo dictado entra donde está el cursor, no al final: se dicta un párrafo en
 * medio de un documento tanto como se dicta el primero. El espacio de antes y el
 * de después se ponen solos, que es lo que hacía la referencia y lo que se espera
 * al hablar: nadie dice «coma» ni «espacio».
 */

export type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Dónde cae lo dictado. Un campo de formulario, o un editor de documento: el
 * micrófono es el mismo gesto en los dos, y el editor visual no es un campo.
 */
export type Sink =
  | Field
  | { dictate(said: string): void; root: HTMLElement };

export interface MicOptions {
  field: Sink;
  /** Para colgar el botón de otra rejilla: la del asistente, la del documento. */
  className?: string;
  /** Se llama tras insertar, con el campo ya cambiado. */
  changed?: () => void;
  /** Dónde contar lo que pasa —falta de permiso, corte—; si no, va al `title`. */
  say?: (message: string) => void;
}

export interface Mic {
  button: HTMLButtonElement;
  /** Deja de escuchar. Se llama al cerrar lo que contiene el campo. */
  stop: () => void;
}

const LISTEN = "Dictar";
const LISTENING = "Escuchando… pulsa para parar";

/** Signos que no llevan espacio delante. */
const GLUED = /^[,.;:!?)\]}»…]/;

function insert(field: Field, said: string): void {
  const at = field.selectionStart ?? field.value.length;
  const to = field.selectionEnd ?? at;
  const before = field.value.slice(0, at);
  const after = field.value.slice(to);

  const previous = before.slice(-1);
  const lead = previous && !/\s/.test(previous) && !GLUED.test(said) ? " " : "";
  const trail = /\s$/.test(said) || after.startsWith(" ") ? "" : " ";
  const middle = lead + said + trail;

  // `maxlength` no gobierna lo que se escribe por programa, así que se respeta
  // aquí: el campo de la intención tiene tope y dictar no es una vía para saltarlo.
  const room = field.maxLength > 0 ? field.maxLength - before.length - after.length : Infinity;
  if (room <= 0) return;

  field.value = before + middle.slice(0, room) + after;
  const caret = before.length + Math.min(middle.length, room);
  field.setSelectionRange(caret, caret);

  // Quien escuche `input` —el autoguardado, el textarea que crece— tiene que
  // enterarse igual que si se hubiera teclado.
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

export function mountMic(options: MicOptions): Mic | null {
  if (!available()) return null;

  const glyph = icon("mic", "ico ico--small");
  const button = el("button", {
    class: options.className ?? "mic",
    attrs: {
      type: "button", title: LISTEN, "aria-label": LISTEN, "aria-pressed": "false",
    },
  }, [glyph]);

  let voice: Dictation | null = null;

  function paint(on: boolean): void {
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.title = on ? LISTENING : LISTEN;
    button.setAttribute("aria-label", on ? LISTENING : LISTEN);
    setIcon(glyph, on ? "stop" : "mic");
  }

  function stop(): void {
    voice?.stop();
    voice = null;
    paint(false);
  }

  button.addEventListener("click", () => {
    if (voice) { stop(); return; }

    voice = dictation({
      onText: (said) => {
        const field = options.field;
        if ("dictate" in field) field.dictate(said);
        else insert(field, said);
        options.changed?.();
      },
      onStop: (reason) => {
        voice = null;
        paint(false);
        if (!reason) return;
        if (options.say) options.say(reason);
        else button.title = reason;
      },
    });

    if (!voice) return;
    voice.start();
    paint(true);
    // El foco vuelve a donde va a caer lo dicho: al campo, o al documento.
    const field = options.field;
    if ("dictate" in field) field.root.focus();
    else field.focus();
  });

  return { button, stop };
}
