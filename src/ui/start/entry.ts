import { openBegin } from "./open.ts";
import { mountMic } from "../voice/mic.ts";
import { rememberIntent } from "../../core/state/intent.ts";

/**
 * La pantalla de entrada: el campo donde se escribe la intención.
 *
 * El campo, su avión y su animación son de `main.js`, que está calibrado y no se
 * toca (plan.md §2). Aquí se le añaden las dos cosas que no puede saber: que la
 * intención se puede dictar, y que al enviarla empieza un proyecto.
 *
 * Se engancha al evento `intent:submit` que `main.js` ya emitía —el comentario del
 * propio archivo lo llama «punto de enganche»— en vez de tocar su formulario.
 */

/**
 * Lo que tarda el avión en irse volando (780 ms en `main.js`) y un poco más. La
 * hoja espera a que termine: el gesto es que el papel se lleva la intención y lo
 * que vuelve es el proyecto.
 */
const FLY_MS = 820;

export function mountEntry(): void {
  const field = document.querySelector<HTMLElement>("#intent-form .field");
  const input = document.querySelector<HTMLInputElement>("#intent-input");
  const send = document.querySelector<HTMLElement>("#send");

  if (field && input) {
    const mic = mountMic({ field: input });
    // Antes del avión: el orden es el del gesto —se dicta, luego se envía— y el
    // avión tiene que quedar el último de la fila.
    if (mic) {
      if (send) field.insertBefore(mic.button, send);
      else field.append(mic.button);
      // Enviar con el dictado abierto dejaría el micrófono encendido escuchando
      // una intención que ya se fue.
      document.addEventListener("intent:submit", () => { mic.stop(); });
    }
  }

  document.addEventListener("intent:submit", (event) => {
    const { intent, at } = event.detail;
    rememberIntent(intent, at);
    setTimeout(() => { openBegin(); }, FLY_MS);
  });
}
