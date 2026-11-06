import { createStore } from "../store.ts";

/**
 * El estilo: **sobrio** o **vivo**. Es un eje aparte de claro/oscuro, no una
 * cuarta opción dentro de él.
 *
 * Que sean dos ejes y no cuatro temas en una lista es lo que hace que esto
 * quepa: `data-theme` sigue significando exactamente lo que significaba —claro
 * u oscuro— así que las reglas que ya existen siguen valiendo sin tocarse, y el
 * estilo se cruza encima. Dos elecciones de dos valores dan cuatro temas y
 * «automático» sigue funcionando en los cuatro, que es lo que se perdería si
 * fueran una sola lista: no hay forma de decir «sigue al sistema» cuando el
 * valor guardado también lleva dentro la familia tipográfica.
 *
 * - **sobrio**: el papel editorial con el que se diseñó la plataforma. Serif
 *   para los títulos, nada de acentos, ninguna esquina redonda. Es el que sale
 *   sin haber elegido: la plataforma se diseñó así y así tiene que aparecer la
 *   primera vez.
 * - **vivo**: geométrico y con color. Cada fase del método tiene su gama, las
 *   esquinas se redondean y hay formas de fondo que cambian con la fase.
 *
 * Se guarda por lo mismo que el tema —es una preferencia, no un estado de la
 * sesión— y con la misma forma: la elección en `localStorage`, el resultado en
 * un atributo del <html>, y la primera pintada la hace el script suelto de
 * `index.html` porque un módulo llegaría tarde y se vería el cambio.
 */

export type SkinChoice = "sobrio" | "vivo";

const KEY = "3i.skin";

function recall(): SkinChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "sobrio" || raw === "vivo") return raw;
  } catch { /* modo privado: se queda en sobrio */ }
  return "sobrio";
}

export const skin = createStore<SkinChoice>(recall());

function paint(): void {
  document.documentElement.dataset.skin = skin.get();
}

export function setSkin(choice: SkinChoice): void {
  skin.set(choice);
  try { localStorage.setItem(KEY, choice); } catch { /* da igual */ }
}

/** Se llama una vez, lo antes posible. Repetirla no hace daño. */
export function startSkin(): void {
  paint();
  skin.subscribe(paint);
}
