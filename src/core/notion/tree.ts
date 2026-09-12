import { notionRequest } from "./client.ts";
import { pageTitle, type NotionPage } from "./types.ts";
import {
  appendChildren, blocksToMarkdownWithRuns, createNotionPage, markedMarkdownToBlocks,
  notionBodyOf, readBlocks, type DocBlock, type DocRun, type DocRuns,
} from "./blocks.ts";

import { applyOperations, diffBlocks } from "./diff.ts";

/**
 * El árbol del espacio de trabajo, sobre páginas de Notion.
 *
 * Decisión D2 (plan.md §12), revisada en la rama DEV:
 *
 *   proyecto = página de Notion   ·   página = página hija   ·   contenido = bloques nativos
 *
 * Antes: proyecto = `toggle`, página = bloque `code` con Markdown. Funcionaba
 * como almacén sin pérdida, pero en Notion el documento se leía dentro de un
 * recuadro de código y las imágenes no tenían dónde vivir. Ahora cada
 * documento es una página de verdad con bloques nativos —prosa, títulos,
 * listas, citas, imágenes— y se lee como cualquier página de Notion; el
 * editor de la plataforma sigue siendo Markdown, y `blocks.ts` traduce en los
 * dos sentidos con un diff (`diff.ts`) que no reescribe lo que no cambió.
 *
 * Por qué no `child_page` bajo un `toggle`, como se pensó primero: la API de
 * Notion no permite crear páginas dentro de un bloque; sólo dentro de otra
 * página o de una base de datos. La referencia (`wzglexical-dev_mimem`) llegó
 * al mismo sitio por su propio camino y dejó de usar `code block` como
 * archivo.
 *
 * Lo que no creó la plataforma no se lista: el árbol es la estructura de la
 * plataforma, no un navegador de todo el Notion de la persona. Pero ahora el
 * criterio es natural: se listan las páginas hijas de la raíz y de cada
 * proyecto —si alguien creó a mano una página dentro de un proyecto de la
 * plataforma, aparece; lo que no es página, no.
 */

export type NodeKind = "project" | "page";

export interface TreeNode {
  /** Id de la página en Notion. */
  id: string;
  name: string;
  kind: NodeKind;
  /** Id de la página que lo contiene. */
  parentId: string;
  /** La URL de la página en Notion, para abrirla allí. */
  url?: string;
  /** Notion dice si la página tiene hijos; ahorra una petición. */
  hasChildren?: boolean;
}

/** El nombre por defecto de una página nueva. */
export const UNTITLED_PAGE = "Sin título";
export const UNTITLED_PROJECT = "Proyecto sin nombre";

function text(content: string): { text: { content: string } } {
  return { text: { content } };
}

/* --- leer ------------------------------------------------------------------ */

/**
 * Las páginas hijas de una página. Notion pagina de cien en cien.
 *
 * `/search` no sirve aquí: devuelve todo lo accesible, no los hijos de una
 * página; los hijos se leen como bloques `child_page` de `/children` y cada
 * uno trae su id, su título y si tiene contenido.
 */
interface ChildPageBlock {
  id: string;
  type: string;
  has_children?: boolean;
  child_page?: { title?: string };
  [key: string]: unknown;
}

export async function fetchBlocks(
  token: string,
  parentId: string,
  signal?: AbortSignal,
): Promise<ChildPageBlock[]> {
  const blocks: ChildPageBlock[] = [];
  let cursor: string | null = null;

  do {
    const query: string = cursor
      ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
      : "?page_size=100";
    const page: {
      results: ChildPageBlock[]; next_cursor: string | null; has_more: boolean;
    } = await notionRequest(token, `/blocks/${parentId}/children${query}`, { signal });
    blocks.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  return blocks;
}

/**
 * Traduce bloques `child_page` a nodos.
 *
 * En el modelo de páginas toda página puede tener dentro páginas (carpeta) o
 * bloques (documento), y el bloque `child_page` no dice cuál de las dos es:
 * `has_children` es true en cuanto tiene cualquier contenido. Así que aquí no
 * se decide: todo lo que se lista es una página, y quien la abre —retícula o
 * árbol— entra; si dentro hay páginas se navega entre ellas, y si no, es un
 * documento y se abre el editor (`folders.ts` hace esa pregunta al entrar,
 * que es la misma lectura que la retícula necesita de todos modos).
 */
export async function readChildren(
  token: string,
  parentId: string,
  signal?: AbortSignal,
): Promise<TreeNode[]> {
  const blocks = await fetchBlocks(token, parentId, signal);
  return blocksToNodes(blocks, parentId);
}

/**
 * Los hijos de un nodo, ya traducidos.
 *
 * Una página puede tener dentro tanto páginas como bloques sueltos —la
 * persona escribe en Notion también—. Sólo las páginas entran al árbol; el
 * texto suelto es contenido del documento cuando esa página es un documento.
 */
export function blocksToNodes(blocks: readonly ChildPageBlock[], parentId: string): TreeNode[] {
  const out: TreeNode[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (block.type !== "child_page") continue;
    if (seen.has(block.id)) continue;
    seen.add(block.id);
    out.push({
      id: block.id,
      name: block.child_page?.title?.trim() || UNTITLED_PAGE,
      kind: "page",
      parentId,
      hasChildren: block.has_children ?? false,
    });
  }

  return out;
}

/* --- crear, renombrar, borrar ---------------------------------------------- */

/**
 * Una carpeta nueva: una página de Notion.
 *
 * Con icono de carpeta: dentro de Notion la distinción entre «carpeta» y
 * «documento» no existe —todo es página—, así que el icono es lo que la
 * plataforma usa para reconocer sus proyectos. El emoji 📁 es lo que Notion
 * muestra nativamente; quien no lo quiera lo cambia en Notion y la plataforma
 * lo respeta.
 */
export async function createProject(
  token: string,
  parentId: string,
  name: string,
): Promise<TreeNode> {
  const clean = name.trim() || UNTITLED_PROJECT;
  const made = await notionRequest<NotionPage>(token, "/pages", {
    method: "POST",
    body: {
      parent: { page_id: parentId },
      icon: { type: "emoji", emoji: "📁" },
      properties: { title: { title: [text(clean)] } },
    },
  });
  return {
    id: made.id, name: clean, kind: "project", parentId,
    url: made.url, hasChildren: false,
  };
}

/**
 * Una página nueva, con su contenido inicial traducido a bloques nativos.
 *
 * Puede nacer con texto dentro: es lo que hace falta para que un proyecto se
 * cree con sus tres documentos ya escritos en un solo viaje por documento.
 */
export async function createPage(
  token: string,
  parentId: string,
  name: string,
  content = "",
): Promise<TreeNode> {
  const clean = name.trim() || UNTITLED_PAGE;
  const made = await createNotionPage(token, parentId, clean);
  if (content.trim()) {
    const blocks = markedMarkdownToBlocks(content);
    const children = blocks
      .map((block) => notionBodyOf(block))
      .filter((body): body is Record<string, unknown> => body !== null);
    if (children.length > 0) await appendChildren(token, made.id, children);
  }
  return { id: made.id, name: clean, kind: "page", parentId, url: made.url, hasChildren: true };
}

/** Renombrar es cambiar la propiedad de título de la página. */
export async function renameNode(token: string, node: TreeNode, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await notionRequest(token, `/pages/${node.id}`, {
    method: "PATCH",
    body: { properties: { title: { title: [text(clean)] } } },
  });
}

/**
 * Borrar archiva la página: se recupera de la papelera de Notion. Con una
 * carpeta se va también todo lo que tenga dentro.
 */
export async function deleteNode(token: string, nodeId: string): Promise<void> {
  await notionRequest(token, `/pages/${nodeId}`, { method: "DELETE" });
}

/* --- el contenido de un documento ------------------------------------------ */

/** El estado confirmado de un documento, para el diff del guardado. */
interface PageState {
  blocks: DocBlock[];
}

const pageStates = new Map<string, PageState>();

/**
 * El texto de una página como Markdown para el editor.
 *
 * La primera vez que se abre un documento se leen sus bloques y se traducen a
 * Markdown con las marcas de id (`<!--b:…-->`). Se guarda el estado leído: es
 * la **base del diff** — guardar compara contra esto, no contra lo que diga
 * el texto traducido, así que un bloque que aquí nadie tocó no se reescribe.
 */
export async function readPage(
  token: string,
  pageId: string,
  signal?: AbortSignal,
): Promise<{
  name: string;
  content: string;
  clipUrls: Map<string, string>;
  runs: Map<string, readonly DocRun[]>;
}> {
  const [page, blocks] = await Promise.all([
    notionRequest<NotionPage>(token, `/pages/${pageId}`, { signal }),
    readBlocks(token, pageId, signal),
  ]);
  pageStates.set(pageId, { blocks });
  // Las URLs temporales de los adjuntos, por id de bloque: caducan a la hora,
  // así que se piden en cada apertura y viajan aparte del Markdown.
  const clipUrls = new Map<string, string>();
  for (const block of blocks) {
    if (block.type === "attachment" && block.url) clipUrls.set(block.id, block.url);
  }
  // Y con ellas, quién escribió cada trozo: el color de Notion dice la
  // autoría, y el Markdown no sabe llevarla dentro.
  const { content, runs } = blocksToMarkdownWithRuns(blocks);
  return { name: pageTitle(page, UNTITLED_PAGE), content, clipUrls, runs };
}

/**
 * Guardar el texto de una página: diff contra el estado confirmado y aplicar
 * sólo la diferencia.
 *
 * El Markdown llega con las marcas de id. Los bloques nuevos no tienen id de
 * Notion (`tmp-…`) y el aplicarlos devuelve sus ids reales, que se re-anclan
 * en el estado confirmado para que el guardado siguiente no los vuelva a
 * crear. Si algo falla a medias, lo que llegó ya está en Notion y la base
 * sólo cambia por lo que de verdad se confirmó.
 */
export async function writePage(
  token: string,
  pageId: string,
  content: string,
  runs?: DocRuns,
): Promise<Map<string, string>> {
  const state = pageStates.get(pageId) ?? { blocks: [] };
  const draft = markedMarkdownToBlocks(content, runs);

  const diff = diffBlocks(state.blocks, draft);
  if (diff.changes === 0) return new Map();

  const result = await applyOperations(token, pageId, diff);

  // La nueva base: lo que quedó del borrador, con los ids reales de lo creado.
  const oldById = new Map(state.blocks.map((block) => [block.id, block] as const));
  const next: DocBlock[] = draft.map((block) => {
    const real = result.idMap.get(block.id);
    if (real) return { ...block, id: real };
    return block;
  });

  if (result.errors.length > 0) {
    // Se guarda la base con lo que sí llegó: el borrador local sigue siendo
    // la red de seguridad y lo que falte se reintenta al guardarse otra vez.
    const confirmed = next.filter((block) => oldById.has(block.id) || result.idMap.has(block.id));
    pageStates.set(pageId, {
      blocks: confirmed.map((block) => ({ ...block })),
    });
    throw new Error(`No se pudo guardar todo: ${result.errors.length} bloque(s) no llegaron.`);
  }

  pageStates.set(pageId, { blocks: next.map((block) => ({ ...block })) });
  // Y quien llama se lo lleva: el editor tiene que aprender los ids reales de
  // lo que acaba de crearse. Si no, esos bloques vuelven a nacer temporales en
  // el guardado siguiente y Notion los borra y los recrea otra vez, perdiendo
  // sus comentarios y su historial en cada pulsacion.
  return result.idMap;
}

/** Olvidar el estado confirmado: la página se cerró. */
export function forgetPage(pageId: string): void {
  pageStates.delete(pageId);
}
