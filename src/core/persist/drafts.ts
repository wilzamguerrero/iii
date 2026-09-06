/**
 * El borrador que no llegó a Notion.
 *
 * Escribir es una cosa y guardar es otra: entre las dos hay una petición que
 * puede fallar —la red se cae, el token caduca, Notion contesta 429— y el texto
 * que se acaba de escribir no puede depender de que esa petición salga bien. Así
 * que cada cambio se deja aquí, en el navegador, y sólo se borra de aquí cuando
 * Notion confirma que lo tiene.
 *
 * Un borrador es, por tanto, *trabajo sin guardar* y no una copia de lo que hay
 * en Notion. Que exista uno significa algo: al abrir el documento se dice y se
 * ofrece recuperarlo. Que no exista significa que lo de Notion es lo último.
 *
 * IndexedDB y no `localStorage` porque un informe final son cientos de miles de
 * caracteres y `localStorage` tiene unos cinco megas para toda la plataforma
 * —donde ya viven la sesión, los ajustes de IA y los catálogos de modelos— y
 * además escribe de forma síncrona, bloqueando el hilo mientras se teclea.
 *
 * Todo lo de aquí falla en silencio: en navegación privada IndexedDB puede no
 * existir y el editor tiene que funcionar igual, sólo sin red de seguridad.
 */

const DB_NAME = "3i";
const DB_VERSION = 1;
const STORE = "drafts";

export interface Draft {
  /** Id del bloque `code` de Notion. Es la clave. */
  pageId: string;
  /** El nombre que tenía el documento, para poder nombrarlo sin pedirlo a Notion. */
  name: string;
  content: string;
  /** Cuándo se escribió, en milisegundos. */
  at: number;
}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;

  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "pageId" });
      }
    };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { resolve(null); };
    // Otra pestaña con una versión distinta abierta: mejor sin borradores que
    // colgado esperando a que la cierren.
    request.onblocked = () => { resolve(null); };
  });

  return opening;
}

/** Una operación sobre el almacén, con el fallo tragado. */
async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await open();
  if (!db) return null;

  return new Promise((resolve) => {
    let request: IDBRequest;
    try {
      request = work(db.transaction(STORE, mode).objectStore(STORE));
    } catch {
      resolve(null);
      return;
    }
    request.onsuccess = () => { resolve(request.result as T); };
    request.onerror = () => { resolve(null); };
  });
}

export async function putDraft(draft: Draft): Promise<void> {
  await run("readwrite", (store) => store.put(draft));
}

export async function readDraft(pageId: string): Promise<Draft | null> {
  const found = await run<Draft | undefined>("readonly", (store) => store.get(pageId));
  if (!found || typeof found.content !== "string") return null;
  return found;
}

/** Notion ya lo tiene: el borrador sobra. */
export async function dropDraft(pageId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(pageId));
}
