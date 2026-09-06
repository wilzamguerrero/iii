/**
 * Cómo se abre la pantalla de arranque, sin que nadie tenga que importarla.
 *
 * La abren dos sitios: la intención recién escrita (`entry.ts`) y el explorador,
 * que ofrece «Crear desde la intención» cuando hay una anotada y se está en la
 * raíz. El explorador no puede importar `begin.ts` —`begin.ts` llega hasta
 * `workspace.ts`, que monta el explorador, y el círculo dejaría a uno de los dos a
 * medio construir—, así que aquí sólo queda guardado cómo se abre.
 *
 * Es el mismo arreglo que `openAiSettings` en la bandeja, y por la misma razón.
 */

let opener: (() => void) | null = null;

/** La llama `mountBegin`, una vez. */
export function setBeginOpener(open: () => void): void {
  opener = open;
}

export function openBegin(): void {
  opener?.();
}
