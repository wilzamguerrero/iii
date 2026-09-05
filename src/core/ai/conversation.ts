import { session } from "../persist/session.ts";
import { readPage } from "../notion/tree.ts";
import { intent } from "../state/intent.ts";
import { selection } from "../state/selection.ts";
import { buildMessages, type AssistantContext } from "./prompt.ts";
import { streamChat } from "./chat.ts";
import type { ChatMessage } from "./types.ts";

/**
 * La conversación con el asistente: qué se ha dicho y qué ve.
 *
 * Vive fuera de la interfaz porque el asa se puede cerrar y volver a abrir —o
 * moverse a otro sitio— sin que eso deba perder el hilo. El contexto se recoge
 * en cada envío y no se guarda: lo que importa es lo que hay abierto ahora.
 *
 * No se persiste. Guardar la conversación es Fase 5; guardarla en Notion junto
 * al documento, Fase 6.
 */

const turns: ChatMessage[] = [];
let running: AbortController | null = null;

/** Lo dicho hasta ahora, sin el sistema ni el contexto. */
export function conversation(): readonly ChatMessage[] {
  return turns;
}

export function resetConversation(): void {
  running?.abort();
  turns.length = 0;
}

export function isAsking(): boolean {
  return running !== null;
}

export function stopAsking(): void {
  running?.abort();
}

/**
 * Lo que el asistente puede ver: la intención declarada y, si hay una página
 * abierta, su nombre y su texto. Si Notion no contesta se pregunta sin el texto
 * en vez de no preguntar.
 */
export async function gatherContext(signal?: AbortSignal): Promise<AssistantContext> {
  const context: AssistantContext = { intent: intent.get()?.text ?? null };

  const page = selection.get();
  if (!page) return context;

  context.pageName = page.name;
  context.projectName = page.projectName ?? null;

  const token = session.get()?.token;
  if (!token) return context;

  try {
    const read = await readPage(token, page.id, signal);
    if (read.name) context.pageName = read.name;
    context.pageContent = read.content;
  } catch {
    // Sin el texto el asistente aún puede preguntar por el nombre y la intención.
  }

  return context;
}

export interface AskOptions {
  onDelta?: (chunk: string) => void;
}

/**
 * Manda una pregunta y devuelve la respuesta completa. Los trozos se entregan
 * por `onDelta` conforme llegan.
 */
export async function ask(text: string, options: AskOptions = {}): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  running?.abort();
  const controller = new AbortController();
  running = controller;

  turns.push({ role: "user", content: trimmed });

  try {
    const context = await gatherContext(controller.signal);
    const answer = await streamChat({
      messages: buildMessages(turns, context),
      signal: controller.signal,
      onDelta: options.onDelta,
    });

    const clean = answer.trim();
    // Una respuesta vacía no entra en el historial: el turno siguiente iría con
    // un mensaje de asistente en blanco y algunos proveedores lo rechazan.
    if (clean) turns.push({ role: "assistant", content: clean });
    return clean;
  } finally {
    if (running === controller) running = null;
  }
}
