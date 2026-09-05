import { createStore } from "../store.ts";

/**
 * Claro u oscuro, y la tercera opción: la que diga el sistema.
 *
 * Se guarda porque es una preferencia y no un estado de la sesión: quien elige
 * oscuro lo elige para siempre, no para este rato. Lo que se guarda es la
 * elección —`auto` incluida— y no el resultado de resolverla, para que quien
 * dejó «automático» siga siguiendo a su sistema cuando éste cambie.
 *
 * Se aplica escribiendo `data-theme` en el <html> con un valor ya resuelto:
 * así el CSS sólo tiene dos estados que atender (`tokens.css`) en vez de repetir
 * la tabla oscura dentro de una media query.
 *
 * La primera pintada no la hace esto: la hace un script clásico en `index.html`,
 * porque un módulo va diferido y la página ya se habría visto blanca. Aquí se
 * repinta cuando cambia la elección y se sigue al sistema en «automático»
 * (`startTheme`, llamada desde `src/app.ts`). La intro también queda en oscuro si
 * eso es lo elegido: sus colores salen de los mismos tokens.
 */

export type ThemeChoice = "auto" | "light" | "dark";
export type ThemeResolved = "light" | "dark";

const KEY = "3i.theme";

function recall(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  } catch { /* modo privado: se queda en automático */ }
  return "auto";
}

const dark = matchMedia("(prefers-color-scheme: dark)");

export const theme = createStore<ThemeChoice>(recall());

export function resolveTheme(choice: ThemeChoice = theme.get()): ThemeResolved {
  if (choice !== "auto") return choice;
  return dark.matches ? "dark" : "light";
}

function paint(): void {
  document.documentElement.dataset.theme = resolveTheme();
}

export function setTheme(choice: ThemeChoice): void {
  theme.set(choice);
  try { localStorage.setItem(KEY, choice); } catch { /* da igual */ }
}

/** Se llama una vez, lo antes posible. Repetirla no hace daño. */
export function startTheme(): void {
  paint();
  theme.subscribe(paint);
  // El sistema puede cambiar de tema mientras la página está abierta; en
  // «automático» eso tiene que verse sin recargar.
  dark.addEventListener("change", () => { if (theme.get() === "auto") paint(); });
}
