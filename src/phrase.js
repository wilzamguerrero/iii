/**
 * La frase: revelado por cortina y, después, físicas.
 *
 * Cada palabra vive dentro de una máscara que la recorta. Cuando el avión pasa,
 * las palabras se desprenden de la maquetación y pasan a integrarse a mano:
 * el impulso de cada una sale de la posición y la velocidad reales del avión
 * en pantalla, no de un keyframe. Por eso la que está más cerca de la
 * trayectoria sale disparada y la del borde apenas se tambalea.
 */

import { clamp, rng, smoothstep } from "./utils.js";

const STAGGER = 0.085; // entre palabras
const LINE_GAP = 0.55; // respiración entre versos
const REVEAL_DUR = 1.15; // debe coincidir con la transición del CSS

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `{palabra}` marca énfasis en serif itálica. */
const markup = (token) =>
  escapeHtml(token).replace(/\{([^}]*)\}/g, "<em>$1</em>");

export class Phrase {
  /** @param {HTMLElement} el @param {{text:string}[]} lines */
  constructor(el, lines) {
    this.el = el;
    this.words = [];
    this.loose = false;
    this.rand = rng(0x2f6d);
    this.totalDelay = 0;

    el.textContent = "";
    lines.forEach((line, li) => {
      const lineEl = document.createElement("span");
      lineEl.className = `line line--${li + 1}`;

      line.text.split(/\s+/).forEach((token, wi) => {
        if (wi > 0) lineEl.appendChild(document.createTextNode(" "));
        const mask = document.createElement("span");
        mask.className = "w-mask";
        const word = document.createElement("span");
        word.className = "w";
        word.innerHTML = markup(token);
        const delay = li * LINE_GAP + wi * STAGGER;
        word.style.transitionDelay = `${delay.toFixed(3)}s`;
        this.totalDelay = Math.max(this.totalDelay, delay);
        mask.appendChild(word);
        lineEl.appendChild(mask);
        this.words.push({
          mask, word,
          x: 0, y: 0, rot: 0, vx: 0, vy: 0, vr: 0,
          wake: 0, alpha: 1, blur: 0, age: 0, hit: false,
          cx0: 0, cy0: 0,
        });
      });

      el.appendChild(lineEl);
    });
  }

  /** Duración total del revelado, en segundos. */
  get revealDuration() {
    return this.totalDelay + REVEAL_DUR;
  }

  /**
   * ¿Ha llegado el avión a la frase? El revelado no va por reloj: lo dispara
   * el avión al entrar en la banda del texto. Así las palabras no aparecen
   * solas, las deja él al pasar.
   * @param {{x:number,y:number,vx:number,vy:number,valid:boolean}|null} screen
   */
  cued(screen) {
    if (!screen || !screen.valid || Math.abs(screen.vx) < 40) return false;
    const r = this.el.getBoundingClientRect();
    const band = Math.max(150, r.height * 1.6);
    if (screen.y < r.top - band || screen.y > r.bottom + band) return false;
    return screen.vx > 0 ? screen.x > r.left : screen.x < r.right;
  }

  /**
   * Reparte los retardos según por dónde va el avión: cada palabra sube cuando
   * la estela le pasa por encima, no por su número de orden.
   */
  sweepDelays(screen, rate) {
    const dir = screen.vx >= 0 ? 1 : -1;
    const speed = Math.max(180, rate || Math.abs(screen.vx));

    // Cuánto tarda la estela en llegar a cada palabra dentro de su propio
    // renglón, entendiendo por renglón el que dibuja el navegador y no el verso:
    // en una pantalla estrecha un verso ocupa dos o tres.
    const rows = [];
    const info = this.words.map((w) => {
      const r = w.mask.getBoundingClientRect();
      const edge = dir > 0 ? r.left : r.right;
      const reach = Math.min(2, Math.max(0, (edge - screen.x) * dir) / speed);
      let row = rows.find((q) => Math.abs(q.top - r.top) < 6);
      if (!row) rows.push((row = { top: r.top, span: 0, at: 0 }));
      row.span = Math.max(row.span, reach);
      return { reach, row };
    });

    // Y encadenarlos: cada renglón arranca con el anterior a medias. Repartiendo
    // sólo por x se cruzaban en cuanto la frase se envolvía — la primera palabra
    // de abajo salía antes que la última de arriba.
    for (let i = 1; i < rows.length; i++) {
      rows[i].at = rows[i - 1].at + rows[i - 1].span * 0.5 + 0.12;
    }

    let max = 0;
    this.words.forEach((w, i) => {
      const d = info[i].row.at + info[i].reach;
      w.word.style.transitionDelay = `${d.toFixed(3)}s`;
      max = Math.max(max, d);
    });
    this.totalDelay = max;
  }

  reveal(screen = null, rate = 0) {
    if (screen && screen.valid) this.sweepDelays(screen, rate);
    // Fuerza el reflow para que la transición arranque desde el estado inicial.
    void this.el.offsetHeight;
    this.el.classList.add("is-in");
    // La cortina sólo hace falta mientras sube la palabra. Después estorba:
    // recortaría las colas de la g y la j y el vuelo de las itálicas.
    clearTimeout(this._openT);
    this._openT = setTimeout(() => this.el.classList.add("is-open"), this.revealDuration * 1000 + 60);
  }

  /**
   * Congela la maquetación: mide cada palabra y la pasa a posición absoluta
   * en el mismo sitio en que estaba. A partir de aquí manda el integrador.
   */
  loosen() {
    if (this.loose) return;
    const box = this.el.getBoundingClientRect();
    const rects = this.words.map((w) => w.mask.getBoundingClientRect());

    this.el.style.height = `${box.height}px`;
    this.el.classList.add("is-loose");

    this.words.forEach((w, i) => {
      const r = rects[i];
      w.cx0 = r.left + r.width / 2;
      w.cy0 = r.top + r.height / 2;
      w.mask.style.left = `${r.left - box.left}px`;
      w.mask.style.top = `${r.top - box.top}px`;
      w.mask.style.width = `${r.width}px`;
      w.mask.style.height = `${r.height}px`;
    });

    this.loose = true;
  }

  impulse(w, ux, uy, perp, radius) {
    const f = 1 - Math.abs(perp) / radius; // cercanía a la trayectoria
    const speed = 600 + 900 * f;
    const sgn = perp >= 0 ? 1 : -1;
    const px = -uy * sgn;
    const py = ux * sgn;
    const kick = 190 + 430 * f;

    w.vx = ux * speed + px * kick;
    w.vy = uy * speed * 0.55 + py * kick - 150; // un poco de sustentación
    w.vr = sgn * (200 + 640 * this.rand());
    w.hit = true;
    w.age = 0;
  }

  /**
   * @param {number} dt
   * @param {{x:number,y:number,vx:number,vy:number,valid:boolean}|null} hero
   */
  update(dt, hero) {
    if (!this.loose) return;

    const radius = Math.max(300, window.innerHeight * 0.44);

    if (hero && hero.valid) {
      const vlen = Math.hypot(hero.vx, hero.vy);
      if (vlen > 160) {
        const ux = hero.vx / vlen;
        const uy = hero.vy / vlen;
        // El avión no está en un punto: en el barrido cruza cientos de píxeles
        // por fotograma, más que la ventana de golpeo entera. Muestreándolo
        // como un punto había palabras que caían justo entre dos fotogramas y
        // nunca recibían el empujón: se quedaban quietas mientras las demás
        // volaban y sólo se iban después, con el barrido de reserva. La ventana
        // se estira por detrás con lo volado desde el fotograma anterior —el
        // tramo que el avión ya recorrió—, así que el barrido es continuo y no
        // se escapa ninguna. Estirar por delante, en cambio, golpearía antes de
        // llegar.
        const travel = vlen * dt;
        for (const w of this.words) {
          if (w.hit) continue;
          const dx = w.cx0 + w.x - hero.x;
          const dy = w.cy0 + w.y - hero.y;
          const along = dx * ux + dy * uy;
          const perp = dx * -uy + dy * ux;

          if (along < 70 && along > -240 - travel && Math.abs(perp) < radius) {
            this.impulse(w, ux, uy, perp, radius);
          } else {
            // Anticipación: la palabra nota el aire antes del golpe.
            const d = Math.hypot(dx, dy);
            const near = 1 - clamp(d / (radius * 1.7), 0, 1);
            w.wake = near * near * 7;
          }
        }
      }
    }

    for (const w of this.words) {
      if (!w.hit) {
        if (w.wake !== 0) {
          w.mask.style.transform = `translate3d(0, ${(-w.wake).toFixed(2)}px, 0)`;
        }
        continue;
      }
      if (w.alpha <= 0) continue;

      w.age += dt;
      w.vy += 640 * dt; // gravedad
      const drag = Math.exp(-1.15 * dt);
      w.vx *= drag;
      w.vy *= drag;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.rot += w.vr * dt;
      w.alpha = 1 - smoothstep(0.14, 0.66, w.age);

      const blur = Math.min(4, Math.hypot(w.vx, w.vy) / 480);
      const q = Math.round(blur * 2) / 2; // cuantizado: evita recalcular el filtro cada frame
      const s = 1 + Math.min(0.08, w.age * 0.12);

      w.mask.style.transform =
        `translate3d(${w.x.toFixed(2)}px, ${w.y.toFixed(2)}px, 0) ` +
        `rotate(${w.rot.toFixed(2)}deg) scale(${s.toFixed(3)})`;
      w.mask.style.opacity = w.alpha.toFixed(3);
      if (q !== w.blur) {
        w.mask.style.filter = q > 0.4 ? `blur(${q}px)` : "none";
        w.blur = q;
      }
    }
  }

  /** Al cambiar de tamaño hay que volver a medir, si nada se ha roto aún. */
  remeasure() {
    if (!this.loose || this.words.some((w) => w.hit)) return;
    this.el.classList.remove("is-loose");
    this.el.style.height = "";
    for (const w of this.words) {
      w.mask.style.left = "";
      w.mask.style.top = "";
      w.mask.style.width = "";
      w.mask.style.height = "";
    }
    this.loose = false;
    this.loosen();
  }

  /** Por si alguna palabra quedó fuera del barrido: nadie se queda en pantalla. */
  scatterRest(dirX = 1) {
    if (!this.loose) return;
    const radius = Math.max(300, window.innerHeight * 0.44);
    const sgn = dirX >= 0 ? 1 : -1;
    for (const w of this.words) {
      if (w.hit) continue;
      const perp = (this.rand() - 0.5) * radius;
      this.impulse(w, 0.94 * sgn, -0.34, perp, radius);
      w.vx *= 0.7;
      w.vy *= 0.7;
    }
  }

  get settled() {
    return this.words.every((w) => w.hit && w.alpha <= 0);
  }

  fadeOut() {
    this.el.classList.add("is-gone");
  }

  hide() {
    clearTimeout(this._openT);
    this.el.style.visibility = "hidden";
  }
}
