import { el, render } from "../dom.ts";
import { icon } from "../icons.ts";
import { session } from "../../core/persist/session.ts";
import {
  uploadFiles, type UploadItem, type UploadedFile,
} from "../../core/notion/upload.ts";

/**
 * Subir archivos, con su hoja de progreso.
 *
 * La gramática es la de la plataforma: una hoja que baja —la del asistente, la
 * del panel— con cada archivo como fila, su peso y su barra. Mientras sube, no
 * se cierra con Escape: un envío a medias no se tira sin querer. La X sólo
 * aparece cuando todo acabó o nada empezó.
 *
 * No hay campo de formulario: los archivos ya se eligieron —arrastrados o por
 * el selector— y lo que se muestra es lo que pasa con ellos, no lo que falta
 * escribir. Si uno falla, la fila lo dice y los demás siguen.
 */

/** El tamaño legible: KB, MB, GB, con una cifra si es redondo. */
function pretty(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let at = 0;
  while (value >= 1024 && at < units.length - 1) { value /= 1024; at++; }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[at]}`;
}

export interface UploadPanel {
  root: HTMLElement;
  /**
   * Empieza la subida hacia esa página. `after` es el id del bloque después
   * del que van —donde estaba el cursor al elegir—; sin él van al final.
   * Se cierra sola al acabar.
   */
  start(files: readonly File[], pageId: string, after?: string | null): void;
}

export function mountUploadPanel(onDone: (uploaded: readonly UploadedFile[]) => void): UploadPanel {
  const list = el("div", { class: "upl__list", attrs: { role: "log", "aria-live": "polite" } });
  const title = el("span", { class: "upl__title", text: "Subiendo archivos" });
  const say = el("p", { class: "upl__say" });

  const close = el("button", {
    class: "upl__x",
    attrs: { type: "button", "aria-label": "Cerrar" },
    on: { click: () => { shut(); } },
  }, [icon("cross", "ico ico--small")]);

  let running = false;

  const root = el("section", {
    class: "upl",
    attrs: { "aria-label": "Subida de archivos", hidden: true },
    on: { keydown: (event) => { if (event.key === "Escape" && !running) shut(); } },
  }, [
    el("header", { class: "upl__bar" }, [title, close]),
    say,
    list,
  ]);

  function shut(): void {
    root.hidden = true;
    render(list);
  }

  function row(item: UploadItem): HTMLElement {
    const bar = el("span", { class: "upl__fill" });
    bar.style.width = `${item.percent}%`;

    const status =
      item.status === "waiting" ? "En cola"
      : item.status === "zipping" ? "Comprimiendo…"
      : item.status === "done" ? "Listo"
      : item.status === "failed" ? item.error ?? "No subió"
      : `${item.percent}%`;

    return el("div", { class: `upl__one upl__one--${item.status}` }, [
      el("span", { class: "upl__ico" }, [icon("page", "ico ico--small")]),
      el("span", { class: "upl__txt" }, [
        el("span", { class: "upl__name", text: item.name }),
        el("span", { class: "upl__meta", text: `${pretty(item.size)} · ${status}` }),
        el("span", { class: "upl__row" }, [bar]),
      ]),
    ]);
  }

  function paint(items: readonly UploadItem[]): void {
    render(list, ...items.map(row));
  }

  function start(files: readonly File[], pageId: string, after?: string | null): void {
    if (files.length === 0 || running) return;

    const token = session.get()?.token;
    if (!token) {
      root.hidden = false;
      render(list);
      say.className = "upl__say upl__say--bad";
      say.textContent = "Sin sesión de Notion no se puede subir. Conéctate desde la franja y vuelve a intentarlo.";
      return;
    }

    root.hidden = false;
    running = true;
    close.disabled = true;
    title.textContent = files.length === 1 ? "Subiendo un archivo" : `Subiendo ${files.length} archivos`;
    say.className = "upl__say";
    say.textContent = "No cierres la página mientras sube: el archivo viaja a tu Notion.";

    void uploadFiles(files, pageId, {
      ...(after ? { after } : {}),
      onProgress: (items) => { paint(items); },
    })
      .then((uploaded) => {
        say.textContent = uploaded.length === 1
          ? "El archivo quedó en el documento."
          : `Quedaron ${uploaded.length} archivos en el documento.`;
        onDone(uploaded);
      })
      .catch((error: unknown) => {
        say.className = "upl__say upl__say--bad";
        say.textContent = error instanceof Error ? error.message : "No se pudo subir.";
      })
      .finally(() => {
        running = false;
        close.disabled = false;
      });
  }

  return { root, start };
}
