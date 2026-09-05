import { createStore } from "../store.ts";

/**
 * La intención que la persona escribió en la pantalla de entrada.
 *
 * `main.js` ya emitía `intent:submit` y no había nadie escuchando. Se recoge aquí
 * porque es el contexto que el asistente necesita para poder preguntar por algo
 * concreto: sin la intención, la conversación empieza en el vacío.
 *
 * Persistirla en Notion como primer documento del proyecto es la Fase 3; de
 * momento vive en `localStorage`, que es cuanto hace falta para que sobreviva a
 * una recarga.
 */

const KEY = "3i.intent";

export interface Intent {
  text: string;
  /** ISO 8601. */
  at: string;
}

function read(): Intent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Intent>;
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    return { text: parsed.text, at: parsed.at ?? new Date().toISOString() };
  } catch {
    return null;
  }
}

export const intent = createStore<Intent | null>(read());

intent.subscribe((value) => {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // Modo privado: la intención vive en memoria hasta la recarga.
  }
});

export function rememberIntent(text: string, at: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  intent.set({ text: trimmed, at });
}

export function forgetIntent(): void {
  intent.set(null);
}
