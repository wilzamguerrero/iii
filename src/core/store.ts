/**
 * El almacén más pequeño que sirve: un valor y quien quiera enterarse cuando
 * cambia. Es el patrón que ya usa `reference/services/documentStore.ts`, sin la
 * parte que dependía de React.
 *
 * No hay framework en este proyecto (plan.md D1), así que el contrato de
 * reactividad tiene que ser explícito: la vista se suscribe y se vuelve a pintar
 * sola. Todo lo compartido de las fases siguientes —sesión, proyectos, ajustes
 * de IA— vive detrás de esta interfaz.
 */

export type Listener<T> = (value: T) => void;

export interface Store<T> {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => value,

    set(next) {
      const resolved = typeof next === "function"
        ? (next as (previous: T) => T)(value)
        : next;

      if (Object.is(resolved, value)) return;
      value = resolved;

      // Se copia antes de recorrer: un oyente puede darse de baja —o dar de alta
      // a otro— mientras se le está avisando.
      for (const listener of [...listeners]) listener(value);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
