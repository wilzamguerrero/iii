import type { TreeNode } from "../../core/notion/tree.ts";
import type { Crumb } from "./folders.ts";

/**
 * Lo que se crea fuera del explorador, contado al explorador.
 *
 * La pantalla de entrada crea el proyecto y sus tres documentos sin que la franja
 * esté abierta siquiera. Cuando se abre tiene que estar ahí, y sin releer Notion:
 * los bloques acabados de crear ya se conocen, así que se pasan tal cual —igual
 * que `load()` le pasa al árbol lo que acaba de leer la retícula.
 *
 * Es un aviso y no una recarga a propósito. Recargar sería una petición más por
 * cada pestaña abierta para enterarse de algo que ya se sabe, y en Notion las
 * peticiones se cuentan.
 *
 * Existe este módulo, y no una llamada directa, porque quien crea (`ui/start`) y
 * quien pinta (`ui/dock/folders.ts`) no deben conocerse: si `folders.ts` importara
 * la pantalla de entrada y ella a él, cualquiera de los dos que se cargue primero
 * vería al otro a medio construir.
 */

export interface Made {
  /** Dentro de qué carpeta —o página raíz— aparecieron. */
  parentId: string;
  nodes: readonly TreeNode[];
  /**
   * Camino donde dejar al explorador, si lo creado es un sitio al que hay que
   * entrar. Sin esto el aviso sólo añade; con esto además lleva.
   */
  enter?: readonly Crumb[];
}

type Listener = (made: Made) => void;

const listeners = new Set<Listener>();

/** Se llama al montar el explorador; lo devuelto se llama al desmontarlo. */
export function onMade(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function announceMade(made: Made): void {
  // Sobre una copia: un oyente que se desmonte al enterarse —una pestaña que se
  // cierra— no puede alterar el conjunto que se está recorriendo.
  for (const listener of [...listeners]) listener(made);
}
