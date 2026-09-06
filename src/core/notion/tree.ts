import { notionRequest } from "./client.ts";
import type { RichText } from "./types.ts";

/**
 * El árbol del espacio de trabajo, sobre bloques de Notion.
 *
 * Decisión D2 (plan.md §12), cerrada así:
 *
 *   proyecto = bloque `toggle`   ·   página = bloque `code` en Markdown
 *
 * Un `toggle` es el desplegable que pidió la instrucción: agrupa y se abre. Una
 * página es un bloque `code` con `language: "markdown"`, el nombre en el
 * `caption` y el documento en el `rich_text`.
 *
 * Por qué un bloque `code` y no bloques nativos de Notion: el documento va y
 * vuelve sin pérdida. Convertir Markdown a bloques nativos obliga a una
 * traducción en los dos sentidos que se come lo que Notion no tiene —tablas
 * complejas, notas al pie, matemáticas, las citas con su DOI— y cada guardado
 * degradaría un poco más el texto. El precio es que en Notion el contenido se lee
 * dentro de un recuadro de código en vez de como prosa; se acepta porque la
 * plataforma es quien lo edita y Notion es el almacén.
 *
 * `child_page` no se lista: el árbol es la estructura de la plataforma, no un
 * navegador de todo el Notion de la persona. Lo que no creó la plataforma no
 * aparece aquí.
 */

export type NodeKind = "project" | "page";

export interface TreeNode {
  /** Id del bloque en Notion. */
  id: string;
  name: string;
  kind: NodeKind;
  /** Id del bloque o página que lo contiene. */
  parentId: string;
  /** Sólo en páginas: el lenguaje del bloque `code`. */
  language?: string;
  /** Notion dice si el bloque tiene hijos; ahorra una petición para saberlo. */
  hasChildren?: boolean;
}

/** El trozo de un bloque de Notion que este árbol mira. */
interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  toggle?: { rich_text?: RichText[] };
  code?: { rich_text?: RichText[]; caption?: RichText[]; language?: string };
}

interface ChildrenResponse {
  results: Block[];
  next_cursor: string | null;
  has_more: boolean;
}

/** El nombre por defecto de una página nueva, y el respaldo cuando no hay caption. */
export const UNTITLED_PAGE = "Sin título";
export const UNTITLED_PROJECT = "Proyecto sin nombre";

/** Notion parte el texto en fragmentos con formato; el contenido es la suma. */
function joinText(spans: RichText[] | undefined): string {
  if (!spans || spans.length === 0) return "";
  return spans.map((span) => span.plain_text ?? "").join("");
}

/** Para nombres: lo mismo, sin espacios de sobra a los lados. */
function plain(spans: RichText[] | undefined): string {
  return joinText(spans).trim();
}

function text(content: string): { text: { content: string } } {
  return { text: { content } };
}

/**
 * Notion parte el texto en fragmentos de 2000 caracteres como máximo, así que un
 * documento largo no es un fragmento sino varios. Se corta por tamaño y no por
 * párrafos a propósito: `readPage` los vuelve a unir con `join("")` y el texto
 * que sale es exactamente el que entró, sin un salto de línea de más.
 *
 * Cien fragmentos son 180 000 caracteres, unas sesenta páginas. Pasado eso Notion
 * rechazaría el bloque entero, así que se dice aquí y no allí.
 */
const SPAN_CHARS = 1800;
const MAX_SPANS = 100;

function spans(content: string): { text: { content: string } }[] {
  if (!content) return [text("")];
  const parts: { text: { content: string } }[] = [];
  for (let at = 0; at < content.length; at += SPAN_CHARS) {
    parts.push(text(content.slice(at, at + SPAN_CHARS)));
  }
  if (parts.length > MAX_SPANS) {
    throw new Error(
      `El documento pasa de ${(SPAN_CHARS * MAX_SPANS).toLocaleString("es")} caracteres, ` +
      "que es lo que cabe en un bloque de Notion. Divídelo en dos documentos.",
    );
  }
  return parts;
}

/**
 * Todos los hijos de un bloque o página. Notion pagina de cien en cien; un
 * proyecto con más de cien páginas es raro pero el bucle cuesta cinco líneas.
 */
export async function fetchBlocks(
  token: string,
  parentId: string,
  signal?: AbortSignal,
): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | null = null;

  do {
    const query = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
    const page: ChildrenResponse = await notionRequest<ChildrenResponse>(
      token,
      `/blocks/${parentId}/children${query}`,
      { signal },
    );
    blocks.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  return blocks;
}

/**
 * Traduce bloques a nodos. Notion puede repetir un bloque en respuestas
 * consecutivas de la paginación, así que se deduplica por id.
 */
export function extractTree(blocks: readonly Block[], parentId: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (seen.has(block.id)) continue;

    if (block.type === "toggle") {
      seen.add(block.id);
      nodes.push({
        id: block.id,
        name: plain(block.toggle?.rich_text) || UNTITLED_PROJECT,
        kind: "project",
        parentId,
        hasChildren: block.has_children ?? false,
      });
      continue;
    }

    if (block.type === "code") {
      seen.add(block.id);
      const language = block.code?.language ?? "markdown";
      nodes.push({
        id: block.id,
        name: plain(block.code?.caption) || UNTITLED_PAGE,
        kind: "page",
        parentId,
        language,
      });
    }
  }

  return nodes;
}

/** Los hijos de un nodo, ya traducidos: proyectos primero, luego páginas. */
export async function readChildren(
  token: string,
  parentId: string,
  signal?: AbortSignal,
): Promise<TreeNode[]> {
  return extractTree(await fetchBlocks(token, parentId, signal), parentId);
}

async function append(token: string, parentId: string, child: unknown): Promise<Block> {
  const created = await notionRequest<{ results: Block[] }>(
    token,
    `/blocks/${parentId}/children`,
    { method: "PATCH", body: { children: [child] } },
  );
  const block = created.results?.[0];
  if (!block) throw new Error("Notion no devolvió el bloque que acaba de crear.");
  return block;
}

/** Un proyecto nuevo: el desplegable vacío. */
export async function createProject(
  token: string,
  parentId: string,
  name: string,
): Promise<TreeNode> {
  const clean = name.trim() || UNTITLED_PROJECT;
  const block = await append(token, parentId, {
    object: "block",
    type: "toggle",
    toggle: { rich_text: [text(clean)] },
  });
  return { id: block.id, name: clean, kind: "project", parentId, hasChildren: false };
}

/**
 * Una página nueva. El nombre va en el `caption` porque un bloque `code` no tiene
 * título, y el `caption` es lo que Notion muestra debajo del recuadro.
 *
 * Puede nacer con texto dentro: es lo que hace falta para que un proyecto se cree
 * con sus tres documentos ya enmarcados en un solo viaje por documento.
 */
export async function createPage(
  token: string,
  parentId: string,
  name: string,
  content = "",
): Promise<TreeNode> {
  const clean = name.trim() || UNTITLED_PAGE;
  const block = await append(token, parentId, {
    object: "block",
    type: "code",
    code: {
      rich_text: spans(content),
      language: "markdown",
      caption: [text(clean)],
    },
  });
  return { id: block.id, name: clean, kind: "page", parentId, language: "markdown" };
}

/** Renombrar es cambiar el `rich_text` del toggle o el `caption` del code. */
export async function renameNode(token: string, node: TreeNode, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  const body = node.kind === "project"
    ? { toggle: { rich_text: [text(clean)] } }
    : { code: { caption: [text(clean)] } };
  await notionRequest(token, `/blocks/${node.id}`, { method: "PATCH", body });
}

/**
 * Borrar manda el bloque a la papelera de Notion, de donde se puede recuperar.
 * Con un proyecto se va también todo lo que tenga dentro.
 */
export async function deleteNode(token: string, nodeId: string): Promise<void> {
  await notionRequest(token, `/blocks/${nodeId}`, { method: "DELETE" });
}

/** El texto de una página. Es lo que el asistente lee para poder cuestionarlo. */
export async function readPage(
  token: string,
  pageId: string,
  signal?: AbortSignal,
): Promise<{ name: string; content: string; language: string }> {
  const block = await notionRequest<Block>(token, `/blocks/${pageId}`, { signal });
  return {
    name: plain(block.code?.caption) || UNTITLED_PAGE,
    content: joinText(block.code?.rich_text),
    language: block.code?.language ?? "markdown",
  };
}

/**
 * Guardar el texto de una página.
 *
 * Un `PATCH` sobre el bloque `code` reemplaza su `rich_text` entero, así que
 * guardar es mandar el documento completo. Es una petición por guardado y por eso
 * quien escribe espera a que la persona deje de teclear antes de llamar aquí:
 * Notion admite unas tres peticiones por segundo.
 */
export async function writePage(
  token: string,
  pageId: string,
  content: string,
): Promise<void> {
  await notionRequest(token, `/blocks/${pageId}`, {
    method: "PATCH",
    body: { code: { rich_text: spans(content) } },
  });
}
