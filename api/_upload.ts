/**
 * Lo compartido de la subida de archivos a Notion.
 *
 * El sistema viene de `reference/wzpage` (sus `functions/api/upload-*.ts`), con
 * dos diferencias de fondo:
 *
 * 1. Allí los archivos iban al Notion del dueño del sitio con la clave del
 *    servidor; aquí van al Notion de **quien estudia**, con su token OAuth
 *    (`X-Notion-Token`, el mismo que usa `/api/notion`). Así los archivos
 *    quedan en el proyecto de la persona y no en un espacio ajeno.
 * 2. Allí el chunk era de 16 MiB porque corría sólo en Cloudflare Pages (100 MB
 *    de body por petición). Aquí el proyecto despliega también en Vercel, cuyo
 *    tope de body es **4,5 MB**: el chunk baja a 4 MiB para que la misma
 *    subida funcione en los dos.
 *
 * Vercel no despliega como función los archivos de `api/` que empiezan por `_`.
 */

export const NOTION_VERSION = "2026-03-11";
export const NOTION_BASE = "https://api.notion.com/v1";

/** El token de la persona, o `null` si no vino. */
export function userToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers["x-notion-token"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  return typeof token === "string" && token ? token : null;
}

/**
 * IMPORTANTE: CHUNK_SIZE debe coincidir con el del cliente
 * (`src/core/notion/upload.ts`). 4 MiB: bajo el tope de body de Vercel (4,5 MB)
 * y con margen; Notion admite partes de hasta 20 MiB, así que de sobra.
 */
export const CHUNK_SIZE = 4 * 1024 * 1024;
/**
 * Por encima de esto el archivo va en varias partes. Notion exige multi_part
 * por encima de 20 MiB; aquí se usa antes, para que la petición única quepa en
 * Vercel. Notion acepta multi_part para archivos menores también: el umbral de
 * 20 MiB es la obligación, no el permiso.
 */
export const MULTI_PART_THRESHOLD = 4 * 1024 * 1024;
/** Tope de partes de Notion: `part_number` entre 1 y 1000. */
export const MAX_PARTS = 1000;
/** Tope absoluto de Notion por archivo (workspaces de pago; los gratis, 5 MiB). */
export const MAX_FILE_SIZE = MAX_PARTS * CHUNK_SIZE; // 4 GiB con partes de 4 MiB
/** Tope del cuerpo binario que este endpoint acepta: un chunk con margen. */
export const MAX_PART_BYTES = 5 * 1024 * 1024;

export const MIME_OF_EXT: Readonly<Record<string, string>> = {
  // Comprimidos
  zip: "application/zip",
  gz: "application/gzip",
  gzip: "application/gzip",
  tar: "application/x-tar",
  "7z": "application/x-7z-compressed",
  bz2: "application/x-bzip2",
  rar: "application/vnd.rar",
  // Imágenes
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  ico: "image/vnd.microsoft.icon",
  heic: "image/heic",
  avif: "image/avif",
  apng: "image/apng",
  // Audio
  aac: "audio/aac",
  adts: "audio/aac",
  mid: "audio/midi",
  midi: "audio/midi",
  mp3: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  wma: "audio/x-ms-wma",
  weba: "audio/webm",
  flac: "audio/x-flac",
  // Vídeo
  amv: "video/x-amv",
  asf: "video/x-ms-asf",
  wmv: "video/x-ms-asf",
  avi: "video/x-msvideo",
  f4v: "video/x-f4v",
  flv: "video/x-flv",
  m4v: "video/mp4",
  mp4: "video/mp4",
  mkv: "video/webm",
  webm: "video/webm",
  mov: "video/quicktime",
  qt: "video/quicktime",
  mpeg: "video/mpeg",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  // Documentos
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  js: "application/javascript",
  ts: "application/typescript",
  tsx: "application/typescript",
  py: "text/x-python",
  doc: "application/msword",
  dot: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  xls: "application/vnd.ms-excel",
  xlt: "application/vnd.ms-excel",
  xla: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  ppt: "application/vnd.ms-powerpoint",
  pot: "application/vnd.ms-powerpoint",
  pps: "application/vnd.ms-powerpoint",
  ppa: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
  rtf: "application/rtf",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  epub: "application/epub+zip",
  xml: "text/xml",
  css: "text/css",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  ics: "text/calendar",
  yaml: "text/yaml",
  yml: "text/yaml",
  tsv: "text/tab-separated-values",
};

/** Extensiones que Notion sabe recibir. Las demás se comprimen a ZIP en el cliente. */
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(MIME_OF_EXT));

/** Nombre limpio y dentro del tope de Notion (900 bytes; 200 sobra). */
export function cleanFilename(name: string): string | null {
  const clean = name.replace(/[\/\\]/g, "_").trim().slice(0, 200);
  return clean || null;
}

/**
 * El nombre de subida y su content type.
 *
 * Notion exige un MIME que esté en su lista; una extensión conocida lo resuelve
 * y una desconocida se envuelve como ZIP — el cliente comprime antes de subir,
 * igual que hacía wzpage con JSZip.
 */
export function resolveUploadMeta(
  filename: string,
  mimeType: string,
): { uploadName: string; contentType: string; zipped: boolean } {
  const dot = filename.lastIndexOf(".");
  const ext = dot !== -1 ? filename.slice(dot + 1).toLowerCase() : "";
  const known = MIME_OF_EXT[ext];
  if (known) return { uploadName: filename, contentType: known, zipped: false };
  // Sin extensión conocida no queda MIME confiable: se envuelve como ZIP.
  void mimeType;
  return { uploadName: filename + ".zip", contentType: "application/zip", zipped: true };
}
