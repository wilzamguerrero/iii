/**
 * «Cuando termine la intro».
 *
 * `main.js` no anuncia nada: se limita a quitarle el atributo `hidden` a `#menu`.
 * Así que se observa ese atributo. Es la alternativa a tocar `main.js`, que está
 * calibrado y no se toca (plan.md §2).
 *
 * Lo usan la franja de abajo y el asa del asistente, que aparecen las dos con el
 * menú y con la misma cortesía: medio segundo después, para no moverse a la vez
 * que la entrada escalonada del formulario.
 */

const COURTESY_MS = 520;

export function onMenuVisible(run: () => void, delay = COURTESY_MS): void {
  const menu = document.getElementById("menu");

  // Sin menú no hay intro que esperar (una página de prueba, por ejemplo).
  if (!menu) {
    run();
    return;
  }

  if (!menu.hidden) {
    run();
    return;
  }

  const observer = new MutationObserver(() => {
    if (menu.hidden) return;
    observer.disconnect();
    setTimeout(run, delay);
  });
  observer.observe(menu, { attributes: true, attributeFilter: ["hidden"] });
}
