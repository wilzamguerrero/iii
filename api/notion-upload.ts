/**
 * La subida de archivos a Notion, con el token de quien estudia.
 *
 *   POST /api/notion-upload?step=init      { filename, mimeType, fileSize }
 *   POST /api/notion-upload?step=part&upload_id=…   (multipart: la parte)
 *   POST /api/notion-upload?step=complete  { uploadId }
 *   POST /api/notion-upload?step=attach   { pageId, blocks: [{uploadId, name, mimeType, zipped}] }
 *
 * Es el sistema de `reference/wzpage` (`functions/api/upload-*.ts`) portado a
 * la firma propia de `api/` (`_types.ts`), para que corra igual bajo el plugin
 * de desarrollo, Vercel y el adaptador de Cloudflare.
 *
 * Tres decisiones de fondo:
 *
 * 1. **El token es de la persona.** En wzpage los archivos iban al workspace
 *    del dueño del despliegue; aquí van al Notion de quien estudia, que es
 *    donde vive su proyecto. Sin token no hay subida: 401, igual que
 *    `/api/notion`.
 * 2. **Todo archivo va por partes.** wzpage tenía una vía rápida de una
 *    petición para los pequeños; aquí no hace falta: Notion acepta
 *    `multi_part` desde 1 parte, y una sola vía es menos código que dos que
 *    divergen. El `step=part` no toca el cuerpo: reenvía el multipart tal cual
 *    añadiendo sólo la autenticación, que es lo que hace barato un chunk sin
 *    importar su tamaño.
 * 3. **La versión de la API es la que wzpage ya valida** contra
 *    `file_uploads` (`2026-03-11`): la de `/api/notion` (`2022-06-28`) no
 *    conoce este endpoint.
 */

import type { ApiHandler, ApiResponse } from "./_types.ts";
import {
  CHUNK_SIZE, MAX_FILE_SIZE, NOTION_BASE, NOTION_VERSION,
  cleanFilename, resolveUploadMeta, userToken,
} from "./_upload.ts";

const GAP_MS = 400;
let lastCall = 0;

/** Notion admite unas tres peticiones por segundo: las partes se espacian. */
async function paced(): Promise<void> {
  const since = Date.now() - lastCall;
  if (since < GAP_MS) await new Promise((done) => { setTimeout(done, GAP_MS - since); });
  lastCall = Date.now();
}

function bad(res: ApiResponse, status: number, code: string, message: string): void {
  res.status(status).json({ error: code, message });
}

/** El id de una subida de Notion, con guiones o sin ellos. */
const ID = /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function explain(response: Response, what: string): Promise<string> {
  const text = await response.text().catch(() => "");
  const data = (() => { try { return JSON.parse(text) as { message?: string }; } catch { return null; } })();
  return data?.message ?? `${what} (${response.status}) ${text.slice(0, 200)}`.trim();
}

const handler: ApiHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const token = userToken(req);
  if (!token) {
    bad(res, 401, "missing_token", "Falta la cabecera X-Notion-Token. Conecta Notion primero.");
    return;
  }

  const step = String(req.query.step ?? "");
  const auth = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
  };

  /* --- step=init: crear el file upload ------------------------------------ */

  if (step === "init") {
    const body = (req.body ?? {}) as { filename?: unknown; mimeType?: unknown; fileSize?: unknown };
    const filename = typeof body.filename === "string" ? cleanFilename(body.filename) : null;
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const fileSize = typeof body.fileSize === "number" && Number.isFinite(body.fileSize) ? body.fileSize : 0;

    if (!filename) { bad(res, 400, "bad_filename", "Se requiere el nombre del archivo."); return; }
    if (fileSize <= 0) { bad(res, 400, "bad_size", "Se requiere el tamaño del archivo."); return; }
    if (fileSize > MAX_FILE_SIZE) {
      bad(res, 413, "too_large",
        "El archivo excede lo que esta plataforma puede subir " +
        "(Notion admite 5 GB con plan de pago; 5 MB en el gratuito).");
      return;
    }

    const { uploadName, contentType } = resolveUploadMeta(filename, mimeType);
    const numberOfParts = Math.ceil(fileSize / CHUNK_SIZE);

    const create = await fetch(`${NOTION_BASE}/file_uploads`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: uploadName,
        content_type: contentType,
        mode: "multi_part",
        number_of_parts: numberOfParts,
      }),
    });

    const upload = await create.json().catch(() => null) as
      | { id?: string; message?: string }
      | null;

    if (!create.ok || !upload?.id) {
      // El 400 de «archivo demasiado grande para este workspace» llega aquí:
      // el plan gratuito de Notion limita a 5 MiB por archivo, y el mensaje
      // propio de Notion lo explica mejor que uno inventado.
      bad(res, create.status === 400 ? 413 : create.status || 502,
        "notion_rejected", await explain(create, "Notion no aceptó crear el upload"));
      return;
    }

    res.status(200).json({
      success: true,
      id: upload.id,
      numberOfParts,
      uploadName,
      contentType,
    });
    return;
  }

  /* --- step=part: reenviar una parte tal cual ------------------------------ */

  if (step === "part") {
    const uploadId = String(req.query.upload_id ?? "");
    const part = Number(req.query.part ?? "");
    if (!ID.test(uploadId)) { bad(res, 400, "missing_upload_id", "Se requiere upload_id."); return; }
    if (!Number.isInteger(part) || part < 1 || part > 1000) {
      bad(res, 400, "bad_part", "Se requiere part (1 a 1000).");
      return;
    }

    const contentType = req.headers["content-type"] ?? "";
    const typeText = Array.isArray(contentType) ? contentType[0] ?? "" : String(contentType);
    if (!typeText.toLowerCase().includes("multipart/form-data")) {
      bad(res, 400, "bad_content_type", "La parte debe llegar como multipart/form-data.");
      return;
    }

    // Los bytes de la parte, tal cual vinieron. El `part_number` va dentro del
    // propio multipart —lo puso el cliente— y el boundary es a la vez cuerpo y
    // cabecera, así que lo único que hay que hacer es reenviarlos con la
    // autenticación puesta. Cada entorno cuelga los bytes donde los tiene:
    // el plugin de desarrollo y Cloudflare en `rawBody` (Buffer/Uint8Array),
    // y en Vercel el propio `req` es un `IncomingMessage` del que se leen.
    const raw = (req as { rawBody?: Uint8Array | Buffer }).rawBody;
    let bytes: Uint8Array | Buffer | null = raw ?? null;
    if (!bytes && typeof (req as unknown as { on?: unknown }).on === "function") {
      // Vercel: el req de Node, con su stream sin consumir.
      bytes = await new Promise<Buffer>((done, fail) => {
        const chunks: Buffer[] = [];
        (req as unknown as NodeJS.ReadableStream)
          .on("data", (chunk: Buffer) => chunks.push(chunk))
          .on("end", () => done(Buffer.concat(chunks)))
          .on("error", fail);
      });
    }
    if (!bytes || bytes.length === 0) {
      bad(res, 400, "bad_body", "La parte llegó vacía.");
      return;
    }

    await paced();

    const send = await fetch(`${NOTION_BASE}/file_uploads/${uploadId}/send`, {
      method: "POST",
      headers: { ...auth, "Content-Type": typeText },
      body: bytes as unknown as BodyInit,
    });

    if (!send.ok) {
      const message = await explain(send, "Notion rechazó la parte");
      // Los transitorios van como 503 para que el navegador reintente la parte.
      const transient = [429, 500, 502, 503, 504, 529].includes(send.status);
      res.status(transient ? 503 : 502).json({ error: "notion_rejected", message });
      return;
    }

    const result = await send.json().catch(() => ({ status: "uploaded" })) as { status?: string };
    res.status(200).json({ success: true, status: result.status ?? "uploaded" });
    return;
  }

  /* --- step=complete: cerrar la subida multi-part --------------------------- */

  if (step === "complete") {
    const body = (req.body ?? {}) as { uploadId?: unknown };
    const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
    if (!ID.test(uploadId)) { bad(res, 400, "missing_upload_id", "Se requiere uploadId."); return; }

    await paced();

    const complete = await fetch(`${NOTION_BASE}/file_uploads/${uploadId}/complete`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
    });

    const result = await complete.json().catch(() => null) as
      | { status?: string; message?: string }
      | null;

    if (!complete.ok) {
      bad(res, complete.status || 502, "notion_rejected",
        await explain(complete, "Notion no completó el upload"));
      return;
    }

    res.status(200).json({ success: true, id: uploadId, status: result?.status ?? "complete" });
    return;
  }

  /* --- step=attach: colgar los archivos subidos en una página ---------------- */

  if (step === "attach") {
    const body = (req.body ?? {}) as {
      pageId?: unknown;
      blocks?: unknown;
    };
    const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
    if (!ID.test(pageId)) { bad(res, 400, "bad_page", "Se requiere el id de la página de destino."); return; }
    if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
      bad(res, 400, "bad_blocks", "No hay archivos que adjuntar.");
      return;
    }
    if (body.blocks.length > 100) {
      bad(res, 400, "bad_blocks", "Como máximo 100 archivos por envío.");
      return;
    }

    const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "tif", "ico", "heic", "avif", "apng"]);
    const VIDEO = new Set(["mp4", "mov", "webm", "m4v", "ogv", "avi", "wmv", "asf", "flv", "f4v", "amv", "mpeg", "qt", "mkv", "3gp", "3g2"]);
    const AUDIO = new Set(["aac", "adts", "mid", "midi", "mp3", "mpga", "m4a", "m4b", "oga", "ogg", "opus", "wav", "wma", "weba", "flac"]);

    const children = [];
    for (const raw of body.blocks) {
      const one = raw as Record<string, unknown>;
      const uploadId = typeof one.uploadId === "string" ? one.uploadId : "";
      const name = typeof one.name === "string" ? one.name.slice(0, 1900) : "";
      if (!ID.test(uploadId)) {
        bad(res, 400, "bad_blocks", "Un uploadId no es válido.");
        return;
      }

      const caption = [{ type: "text", text: { content: name } }];
      const mime = typeof one.mimeType === "string" ? one.mimeType : "";
      const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      const zipped = one.zipped === true;

      let type = "file";
      if (!zipped) {
        if (mime.startsWith("image/") || IMAGE.has(ext)) type = "image";
        else if (mime.startsWith("video/") || VIDEO.has(ext)) type = "video";
        else if (mime.startsWith("audio/") || AUDIO.has(ext)) type = "audio";
        else if (ext === "pdf" || mime === "application/pdf") type = "pdf";
      }

      children.push({
        object: "block",
        type,
        [type]: { type: "file_upload", file_upload: { id: uploadId }, caption },
      });
    }

    await paced();

    const made = await fetch(`${NOTION_BASE}/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ children }),
    });

    if (!made.ok) {
      bad(res, made.status || 502, "notion_rejected", await explain(made, "Notion no adjuntó los archivos"));
      return;
    }

    // Los ids de los bloques creados: el editor los necesita para anclar la
    // línea 📎 al bloque de verdad y que el guardado siguiente no los vea como
    // nuevos.
    const answer = await made.json().catch(() => null) as
      | { results?: { id?: string }[] }
      | null;
    const ids = (answer?.results ?? [])
      .map((one) => one.id ?? "")
      .filter((id) => ID.test(id));

    res.status(200).json({ success: true, count: children.length, ids });
    return;
  }

  bad(res, 400, "bad_step", "Usa ?step=init, part, complete o attach.");
};

export default handler;
