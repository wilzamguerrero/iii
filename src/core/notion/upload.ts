import { session } from "../persist/session.ts";

/**
 * El motor de subida de archivos a Notion (cliente).
 *
 * Portado de `reference/wzpage/services/uploadService.ts` â€”mismo chunking,
 * mismos reintentos con backoff, mismo semÃ¡foro adaptativo (AIMD)â€” con tres
 * diferencias de fondo:
 *
 * 1. **El token es de quien estudia** (`session.ts`), no del servidor: los
 *    archivos aterrizan en su propio Notion, dentro de su proyecto.
 * 2. **No hay vÃ­a de una peticiÃ³n** para los archivos pequeÃ±os: todo va por
 *    partes (Notion acepta `multi_part` desde 1 parte), porque el chunk aquÃ­
 *    es de 4 MiB â€”Vercel limita el cuerpo a 4,5 MBâ€” y una sola vÃ­a es menos
 *    cÃ³digo que dos que divergen.
 * 3. **La compresiÃ³n es del navegador.** Un archivo con extensiÃ³n que Notion
 *    no recibe se envuelve en ZIP con `CompressionStream("deflate-raw")`, que
 *    ya viene en el navegador, en vez de traer JSZip: un archivo que no cabe
 *    en memoria no cabe mejor por comprimirlo a un paquete en memoria. El
 *    envoltorio mÃ­nimo de ZIP se arma aquÃ­ a mano (local file header + central
 *    directory + EOCD); sin cifrado, sin carpetas, sin nada mÃ¡s.
 */

/** Debe coincidir con `api/_upload.ts`. */
const CHUNK_SIZE = 4 * 1024 * 1024;

/** Tope que defiende antes de empezar: lo que Notion admite en planes de pago. */
export const MAX_FILE_SIZE = 1000 * CHUNK_SIZE;

/** MÃ¡ximo de preguntas-carga simultÃ¡neas hacia Notion. */
const START_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 4;
const THROTTLE_COOLDOWN_MS = 1500;

/** Reintentos de una parte: los 429 de Notion se esperan con un pool activo. */
const MAX_PART_RETRIES = 6;

/** Extensiones que Notion sabe recibir (debe coincidir con `api/_upload.ts`). */
const SUPPORTED = new Set([
  "zip", "gz", "gzip", "tar", "7z", "bz2", "rar",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "tif", "ico", "heic", "avif", "apng",
  "aac", "adts", "mid", "midi", "mp3", "mpga", "m4a", "m4b", "oga", "ogg", "opus", "wav", "wma", "weba", "flac",
  "amv", "asf", "wmv", "avi", "f4v", "flv", "m4v", "mp4", "mkv", "webm", "mov", "qt", "mpeg", "ogv", "3gp", "3g2",
  "pdf", "txt", "csv", "json", "js", "ts", "tsx", "py", "doc", "dot", "docx", "dotx", "xls", "xlt", "xla", "xlsx", "xltx",
  "ppt", "pot", "pps", "ppa", "pptx", "potx", "rtf", "md", "markdown", "html", "htm", "epub", "xml", "css",
  "odt", "ods", "odp", "ics", "yaml", "yml", "tsv",
]);

/* --- el estado que la interfaz necesita ----------------------------------- */

/** Un archivo en cola, tal como lo pinta la interfaz. */
export interface UploadItem {
  /** Nombre original, el que eligiÃ³ la persona. */
  name: string;
  /** Nombre con el que viaja a Notion (`.zip` aÃ±adido si hubo compresiÃ³n). */
  finalName: string;
  size: number;
  status: "waiting" | "zipping" | "uploading" | "done" | "failed";
  /** 0-100 mientras `uploading`. */
  percent: number;
  /** La razÃ³n del `failed`. */
  error?: string;
}

/** Lo que el asistente necesita saber de un archivo ya subido. */
export interface UploadedFile {
  name: string;
  finalName: string;
  size: number;
  uploadId: string;
  /** El id del bloque que lo representa en la pÃ¡gina, si ya se adjuntÃ³. */
  blockId?: string;
  /** QuÃ© bloque nativo es en Notion. */
  blockKind: "image" | "video" | "audio" | "pdf" | "file";
  mimeType: string;
  zipped: boolean;
}

export type ProgressCb = (items: readonly UploadItem[]) => void;

/* --- utilidades ------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outcome = "ok" | "throttle" | "error";
const isThrottle = (status: number): boolean => status === 429 || status === 503;

/** SemÃ¡foro con concurrencia adaptativa (AIMD). De wzpage, tal cual. */
class AdaptiveSemaphore {
  private active = 0;
  private limit: number;
  private queue: Array<() => void> = [];
  private credits = 0;
  private cooldownUntil = 0;

  constructor(start: number, private readonly min: number, private readonly max: number) {
    this.limit = start;
  }

  async acquire(): Promise<(outcome?: Outcome) => void> {
    if (this.active < this.limit) {
      this.active++;
      return this.makeRelease();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(this.makeRelease());
      });
    });
  }

  private makeRelease(): (outcome?: Outcome) => void {
    let released = false;
    return (outcome: Outcome = "ok") => {
      if (released) return;
      released = true;
      this.adjust(outcome);
      this.active--;
      this.pump();
    };
  }

  private adjust(outcome: Outcome): void {
    const now = Date.now();
    if (outcome === "throttle") {
      this.limit = Math.max(this.min, Math.floor(this.limit / 2));
      this.credits = 0;
      this.cooldownUntil = now + THROTTLE_COOLDOWN_MS;
    } else if (outcome === "ok") {
      if (now < this.cooldownUntil) return;
      this.credits++;
      if (this.credits >= this.limit) {
        this.credits = 0;
        this.limit = Math.min(this.max, this.limit + 1);
      }
    }
  }

  private pump(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/* --- la respuesta del endpoint, leÃ­da como el cliente la espera ------------ */

interface EndpointError extends Error {
  status: number;
}

async function readError(response: Response): Promise<EndpointError> {
  const data = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  const error = new Error(data?.message ?? data?.error ?? `El servidor respondiÃ³ ${response.status}.`) as EndpointError;
  error.status = response.status;
  return error;
}

/* --- la compresiÃ³n mÃ­nima de ZIP ------------------------------------------- */

/**
 * Un archivo a ZIP: `[local header][datos deflate][central dir][EOCD]`.
 *
 * `CompressionStream` comprime; el envoltorio de ZIP son 30 + 46 + 22 bytes de
 * cabeceras que se escriben aquÃ­. Sin cifrado ni carpetas: un archivo por paquete.
 * Si el navegador no tiene `CompressionStream` â€”viejo para 2026â€” se manda sin
 * comprimir (STORED, CRC suelto): sube igual, sÃ³lo pesa mÃ¡s en la red.
 */
async function zipOf(file: File): Promise<File> {
  const nameBytes = new TextEncoder().encode(file.name);
  if (nameBytes.length > 200) {
    throw new Error(`El nombre Â«${file.name}Â» es demasiado largo.`);
  }

  const useDeflate = typeof CompressionStream !== "undefined";
  const crc = new CRC32();

  let data: Uint8Array;
  let method = 0; // 0 = STORED
  if (useDeflate) {
    const stream = file.stream().pipeThrough(new CompressionStream("deflate-raw"));
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      crc.push(value);
    }
    let total = 0;
    for (const one of chunks) total += one.length;
    data = new Uint8Array(total);
    let at = 0;
    for (const one of chunks) { data.set(one, at); at += one.length; }
    method = 8; // 8 = DEFLATE
  } else {
    data = new Uint8Array(await file.arrayBuffer());
    crc.push(data);
  }

  const zip = new Uint8Array(
    30 + nameBytes.length + data.length + 46 + nameBytes.length + 22,
  );

  const view = new DataView(zip.buffer);
  const stamp = 0; // MS-DOS: sin fecha es vÃ¡lido; Notion no la lee.
  let at = 0;

  // Local file header.
  view.setUint32(at, 0x04034b50, true); at += 4;
  view.setUint16(at, 20, true); at += 2;            // versiÃ³n
  view.setUint16(at, 0x0800, true); at += 2;        // nombre UTF-8
  view.setUint16(at, method, true); at += 2;
  view.setUint16(at, stamp, true); at += 2; view.setUint16(at, 0, true); at += 2; // hora, fecha
  view.setUint32(at, crc.digest, true); at += 4;
  view.setUint32(at, data.length, true); at += 4;
  view.setUint32(at, data.length, true); at += 4;
  view.setUint16(at, nameBytes.length, true); at += 2;
  view.setUint16(at, 0, true); at += 2;
  zip.set(nameBytes, at); at += nameBytes.length;
  zip.set(data, at); at += data.length;

  // Central directory.
  view.setUint32(at, 0x02014b50, true); at += 4;
  view.setUint16(at, 20, true); at += 2;
  view.setUint16(at, 20, true); at += 2;
  view.setUint16(at, 0x0800, true); at += 2;
  view.setUint16(at, method, true); at += 2;
  view.setUint16(at, stamp, true); at += 2; view.setUint16(at, 0, true); at += 2;
  view.setUint32(at, crc.digest, true); at += 4;
  view.setUint32(at, data.length, true); at += 4;
  view.setUint32(at, data.length, true); at += 4;
  view.setUint16(at, nameBytes.length, true); at += 2;
  view.setUint16(at, 0, true); at += 2; view.setUint16(at, 0, true); at += 2;
  view.setUint16(at, 0, true); at += 2; view.setUint16(at, 0, true); at += 2; view.setUint32(at, 0, true); at += 4;
  view.setUint32(at, 0, true); at += 4;             // offset del local header: 0
  zip.set(nameBytes, at); at += nameBytes.length;

  // EOCD.
  view.setUint32(at, 0x06054b50, true); at += 4;
  view.setUint16(at, 0, true); at += 2; view.setUint16(at, 0, true); at += 2;
  view.setUint16(at, 1, true); at += 2; view.setUint16(at, 1, true); at += 2;
  view.setUint32(at, 46 + nameBytes.length, true); at += 4;
  view.setUint32(at, data.length + 30 + nameBytes.length, true); at += 4;
  view.setUint16(at, 0, true); at += 2;

  return new File([zip], file.name.replace(/[\/\\]/g, "_") + ".zip", { type: "application/zip" });
}

/** CRC32 de ZIP, en streaming: sin tabla serÃ­a lento; con tabla, O(n). */
class CRC32 {
  private static table = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  private state = 0xffffffff;

  push(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.state = (this.state >>> 8) ^ CRC32.table[(this.state ^ data[i]!) & 0xff]!;
    }
  }

  get digest(): number {
    return (this.state ^ 0xffffffff) >>> 0;
  }
}

/* --- quÃ© bloque nativo es cada archivo -------------------------------------- */

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "tif", "ico", "heic", "avif", "apng"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v", "ogv", "avi", "wmv", "asf", "flv", "f4v", "amv", "mpeg", "qt", "mkv", "3gp", "3g2"]);
const AUDIO_EXT = new Set(["aac", "adts", "mid", "midi", "mp3", "mpga", "m4a", "m4b", "oga", "ogg", "opus", "wav", "wma", "weba", "flac"]);

function blockKindOf(name: string, mime: string, zipped: boolean): UploadedFile["blockKind"] {
  if (zipped) return "file";
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXT.has(ext)) return "audio";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  return "file";
}

/* --- un archivo ------------------------------------------------------------ */

const needsZip = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return true;
  return !SUPPORTED.has(name.slice(dot + 1).toLowerCase());
};

/**
 * Sube un archivo y devuelve su uploadId.
 *
 * Los pasos: comprimir si hace falta â†’ init â†’ partes en paralelo (con el
 * semÃ¡foro y reintentos) â†’ complete. Los bytes viven en el disco del navegador:
 * `File.slice()` es O(1) y cada chunk se manda como su propio FormData, asÃ­
 * que la memoria del proceso es el chunk, no el archivo.
 */
async function uploadOne(
  file: File,
  onItem: (patch: Partial<UploadItem>) => void,
  sem: AdaptiveSemaphore,
): Promise<UploadedFile> {
  if (file.size === 0) throw new Error(`Â«${file.name}Â» estÃ¡ vacÃ­o.`);
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `Â«${file.name}Â» pesa ${(file.size / 1024 / 1024 / 1024).toFixed(1)} GiB; ` +
      `el tope de esta plataforma es 4 GiB (Notion admite 5 GB en planes de pago).`,
    );
  }

  let send: File = file;
  let zipped = false;
  if (needsZip(file.name)) {
    onItem({ status: "zipping", percent: 0 });
    send = await zipOf(file);
    zipped = true;
  }

  const token = session.get()?.token;
  if (!token) throw new Error("Sin sesiÃ³n de Notion no se puede subir. Conecta Notion primero.");

  /* init */

  const initRes = await fetch("/api/notion-upload?step=init", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Notion-Token": token },
    body: JSON.stringify({ filename: send.name, mimeType: send.type, fileSize: send.size }),
  });
  const init = await initRes.json().catch(() => null) as
    | { success?: boolean; id?: string; numberOfParts?: number }
    | null;
  if (!initRes.ok || !init?.id) throw await readError(initRes);

  const uploadId = init.id;
  const totalParts = init.numberOfParts ?? Math.ceil(send.size / CHUNK_SIZE);
  let doneParts = 0;

  /* las partes */

  const sendPart = (part: number): Promise<void> =>
    (async () => {
      for (let attempt = 1; ; attempt++) {
        const release = await sem.acquire();
        let outcome: Outcome = "error";
        try {
          const start = (part - 1) * CHUNK_SIZE;
          const chunk = send.slice(start, Math.min(start + CHUNK_SIZE, send.size));

          const form = new FormData();
          form.append("part_number", String(part));
          form.append("file", chunk, send.name);

          const res = await fetch(
            `/api/notion-upload?step=part&upload_id=${encodeURIComponent(uploadId)}&part=${part}`,
            { method: "POST", headers: { "X-Notion-Token": token }, body: form },
          );

          if (isThrottle(res.status)) {
            outcome = "throttle";
            throw await readError(res);
          }
          const data = await res.json().catch(() => null) as { success?: boolean } | null;
          if (!res.ok || !data?.success) {
            throw await readError(res);
          }

          outcome = "ok";
          doneParts++;
          onItem({
            status: "uploading",
            percent: Math.min(98, Math.round((doneParts / totalParts) * 100)),
          });
          return;
        } catch (error) {
          if (attempt >= MAX_PART_RETRIES) throw error;
          const backoff = Math.min(5000, 400 * Math.pow(2, attempt - 1)) + Math.random() * 300;
          await sleep(backoff);
        } finally {
          release(outcome);
        }
      }
    })();

  onItem({ status: "uploading", percent: 0 });
  await Promise.all(Array.from({ length: totalParts }, (_, i) => sendPart(i + 1)));

  /* complete */

  const completeRes = await fetch("/api/notion-upload?step=complete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Notion-Token": token },
    body: JSON.stringify({ uploadId }),
  });
  const complete = await completeRes.json().catch(() => null) as { success?: boolean } | null;
  if (!completeRes.ok || !complete?.success) throw await readError(completeRes);

  onItem({ status: "done", percent: 100 });
  return {
    name: file.name,
    finalName: send.name,
    size: file.size,
    uploadId,
    blockKind: blockKindOf(file.name, file.type || "", zipped),
    mimeType: file.type || "application/octet-stream",
    zipped,
  };
}

/* --- la cola entera --------------------------------------------------------- */

/**
 * Sube una lista de archivos y los adjunta a la pÃ¡gina abierta.
 *
 * La cola es de a un archivo a la vez â€”el semÃ¡foro reparte las partesâ€” porque
 * los archivos de un documento se escriben en orden y la barra de progreso
 * dice Â«el segundo va por la mitadÂ», que es lo que se puede mirar.
 */
export async function uploadFiles(
  files: readonly File[],
  pageId: string,
  onProgress?: ProgressCb,
): Promise<UploadedFile[]> {
  const token = session.get()?.token;
  if (!token) throw new Error("Sin sesiÃ³n de Notion no se puede subir. Conecta Notion primero.");
  if (files.length === 0) return [];

  const items: UploadItem[] = files.map((file) => ({
    name: file.name, finalName: file.name, size: file.size,
    status: "waiting", percent: 0,
  }));
  const say = (): void => onProgress?.(items.map((one) => ({ ...one })));

  const sem = new AdaptiveSemaphore(START_CONCURRENCY, MIN_CONCURRENCY, MAX_CONCURRENCY);
  const uploaded: UploadedFile[] = [];
  let failure: string | null = null;

  say();
  for (let at = 0; at < files.length && !failure; at++) {
    const file = files[at]!;
    const item = items[at]!;
    try {
      const done = await uploadOne(file, (patch) => {
        Object.assign(item, patch);
        say();
      }, sem);
      uploaded.push(done);
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : "No se pudo subir.";
      // No se corta la cola por un archivo: los demÃ¡s ya elegidos suben igual,
      // y al final se cuenta cuÃ¡les no llegaron.
      failure = item.error;
    }
    say();
  }

  if (uploaded.length === 0) {
    throw new Error(failure ?? "No se pudo subir ningÃºn archivo.");
  }

  /* adjuntar los que sÃ­ llegaron */

  const attachRes = await fetch("/api/notion-upload?step=attach", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Notion-Token": token },
    body: JSON.stringify({
      pageId,
      blocks: uploaded.map((one) => ({
        uploadId: one.uploadId,
        name: one.name,
        mimeType: one.mimeType,
        zipped: one.zipped,
      })),
    }),
  });
  const attach = await attachRes.json().catch(() => null) as
    | { success?: boolean; ids?: string[] }
    | null;
  if (!attachRes.ok || !attach?.success) throw await readError(attachRes);

  // Los ids de bloque que Notion creÃ³, para que el editor ancle su lÃ­nea ðŸ“Ž y
  // el guardado siguiente no los vea como nuevos.
  (attach.ids ?? []).forEach((blockId, at) => {
    if (uploaded[at]) uploaded[at]!.blockId = blockId;
  });

  if (failure) throw new Error(`Subieron ${uploaded.length} de ${files.length}. ${failure}`);
  return uploaded;
}
