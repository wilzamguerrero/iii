import { createStore } from "../store.ts";

/**
 * La página abierta.
 *
 * No se persiste a propósito: al recargar, la plataforma vuelve a la pregunta
 * inicial, que es la pantalla de entrada. Lo que sí sobrevive es la sesión de
 * Notion y la página raíz (`core/persist/session.ts`).
 *
 * Existe para que el asistente pueda ver lo que hay abierto sin que el árbol de
 * proyectos y el asistente se conozcan entre ellos. El editor de la Fase 3
 * escribirá aquí también.
 */

export interface SelectedPage {
  /** Id del bloque `code` que hace de página. */
  id: string;
  name: string;
  /** Id del `toggle` que hace de proyecto, o de la raíz si está al primer nivel. */
  parentId: string;
  /** Nombre del proyecto que la contiene, cuando se conoce. */
  projectName?: string;
}

export const selection = createStore<SelectedPage | null>(null);

export function selectPage(page: SelectedPage): void {
  selection.set(page);
}

export function clearSelection(): void {
  selection.set(null);
}
